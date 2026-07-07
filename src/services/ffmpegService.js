const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`Command failed with code ${code}\nStderr: ${stderr}`),
        );
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

async function probeMedia(filePath) {
  const args = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  try {
    const { stdout } = await runCommand("ffprobe", args);
    return JSON.parse(stdout);
  } catch (error) {
    console.error("Failed to probe media:", error.message);
    throw new Error("Failed to probe media: " + error.message);
  }
}

async function normalizeVideo(inputPath, outputPath) {
  // Normalize to 1920x1080, 30fps, remove audio
  // Scale, crop/pad as needed to keep aspect ratio
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    "-r",
    "30",
    "-an", // remove audio
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    outputPath,
  ];
  await runCommand("ffmpeg", args);
  return outputPath;
}

async function createSegment(
  inputPath,
  outputPath,
  durationSeconds,
  label,
  isFocus,
) {
  // Loop the normalized video to the target duration
  const args = [
    "-y",
    "-stream_loop",
    "-1", // infinite loop
    "-i",
    inputPath,
    "-t",
    String(durationSeconds),
    "-vf",
    `drawtext=text='${label}':x=w-tw-50:y=50:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    outputPath,
  ];
  await runCommand("ffmpeg", args);
  return outputPath;
}

async function concatSegments(segmentsListFile, outputPath) {
  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    segmentsListFile,
    "-c",
    "copy", // We can copy because segments are exactly same format
    outputPath,
  ];
  await runCommand("ffmpeg", args);
  return outputPath;
}

async function attachAudio(videoPath, audioPath, outputPath, durationSeconds) {
  // Loop audio or trim audio to final duration
  const args = [
    "-y",
    "-i",
    videoPath,
    "-stream_loop",
    "-1",
    "-i",
    audioPath,
    "-t",
    String(durationSeconds), // Truncate to match video duration
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    outputPath,
  ];
  await runCommand("ffmpeg", args);
  return outputPath;
}

module.exports = {
  probeMedia,
  normalizeVideo,
  createSegment,
  concatSegments,
  attachAudio,
};
