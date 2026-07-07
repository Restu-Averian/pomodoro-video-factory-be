const express = require("express");
const { execSync } = require("child_process");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pomodoro-video-factory-api",
  });
});

router.get("/ffmpeg/health", (req, res) => {
  let ffmpegInstalled = false;
  let ffprobeInstalled = false;

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    ffmpegInstalled = true;
  } catch (error) {
    console.error("ffmpeg not found");
  }

  try {
    execSync("ffprobe -version", { stdio: "ignore" });
    ffprobeInstalled = true;
  } catch (error) {
    console.error("ffprobe not found");
  }

  res.json({
    ffmpegInstalled,
    ffprobeInstalled,
  });
});

module.exports = router;
