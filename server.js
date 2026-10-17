
const express = require("express");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ||
  "https://ryuhmo.github.io";

const DIR = path.join("/tmp", "ryuhmo-downloads");
fs.mkdirSync(DIR, { recursive: true });

app.use(express.json({ limit: "20kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function validPublicUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (!host.includes(".") || host === "localhost") return false;
    if (
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      host.endsWith(".local")
    ) return false;
    return true;
  } catch {
    return false;
  }
}

app.get("/", (req, res) => {
  res.json({
    service: "RYUHMO Video Backend",
    status: "online"
  });
});

app.post("/api/download", async (req, res) => {
  const { url, mode, quality } = req.body || {};

  if (!validPublicUrl(url)) {
    return res.status(400).json({
      error: "Please provide a valid public HTTP or HTTPS video URL."
    });
  }

  if (!["video", "audio"].includes(mode)) {
    return res.status(400).json({ error: "Invalid download type." });
  }

  const allowedQualities = ["480", "720", "1080", "best"];
  if (!allowedQualities.includes(quality)) {
    return res.status(400).json({ error: "Invalid quality selection." });
  }

  if (!PUBLIC_URL) {
    return res.status(500).json({
      error: "The server administrator must configure PUBLIC_URL."
    });
  }

  const id = crypto.randomUUID();
  const output = path.join(DIR, id + ".%(ext)s");

  const args = [
  "--verbose",
  "--js-runtimes", "node",
  "--no-playlist",
    "--no-part",
    "--max-filesize", "300M",
    "--socket-timeout", "20",
    "--retries", "1",
    "--restrict-filenames",
    "--no-warnings",
    "-o", output
  ];

  if (mode === "audio") {
    args.push("-x", "--audio-format", "mp3");
  } else if (quality === "best") {
    args.push("-f", "best[ext=mp4]/best");
  } else {
    args.push(
      "-f",
      `best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best`
    );
  }

  args.push("--", url);

  let finished = false;
  const child = spawn("yt-dlp", args, {
  stdio: ["ignore", "ignore", "pipe"]
});

child.stderr.on("data", chunk => {
  console.error("yt-dlp error:", chunk.toString());
});

  const timeout = setTimeout(() => {
    if (!finished) child.kill("SIGKILL");
  }, 180000);

  child.on("error", () => {
    clearTimeout(timeout);
    finished = true;
    if (!res.headersSent) {
      res.status(500).json({
        error: "Downloader could not start. Check the server installation."
      });
    }
  });

  child.on("close", (code) => {
    clearTimeout(timeout);
    finished = true;

    if (code !== 0) {
      return res.status(422).json({
        error: "This link could not be processed. The site may be unsupported, restricted, or temporarily unavailable."
      });
    }

    const file = fs.readdirSync(DIR)
      .find(name => name.startsWith(id + "."));

    if (!file) {
      return res.status(500).json({
        error: "The server did not produce a download file."
      });
    }

    res.json({
      title: file,
      downloadUrl: `${PUBLIC_URL}/files/${encodeURIComponent(file)}`
    });
  });
});

app.get("/files/:file", (req, res) => {
  const name = req.params.file;

  // Only serve generated filenames from this service.
  if (!/^[a-f0-9-]{36}\.[a-zA-Z0-9]+$/.test(name)) {
    return res.status(400).send("Invalid file name.");
  }

  const fullPath = path.join(DIR, name);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).send("File not found or temporary file expired.");
  }

  res.download(fullPath, name, (err) => {
    if (!err) {
      fs.unlink(fullPath, () => {});
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RYUHMO backend listening on port ${PORT}`);
});
