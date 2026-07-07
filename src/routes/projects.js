const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const projectsRepo = require("../db/projectsRepo");
const assetsRepo = require("../db/assetsRepo");
const ffmpeg = require("../services/ffmpegService");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const projectId = req.params.id;
    const dir = path.resolve(__dirname, `../../../data/uploads/${projectId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

router.get("/", (req, res) => {
  res.json(projectsRepo.getAllProjects());
});

router.post("/", (req, res) => {
  const project = projectsRepo.createProject(req.body);
  res.status(201).json(project);
});

router.get("/:id", (req, res) => {
  const project = projectsRepo.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const assets = assetsRepo.getAssetsByProjectId(req.params.id);
  res.json({ ...project, assets });
});

router.patch("/:id", (req, res) => {
  const project = projectsRepo.updateProject(req.params.id, req.body);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

router.delete("/:id", (req, res) => {
  projectsRepo.deleteProject(req.params.id);
  res.json({ success: true });
});

router.post("/:id/assets", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Project not found" });
  }

  const { type } = req.body;
  if (!["focus_video", "break_video", "audio", "break_audio", "thumbnail"].includes(type)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Invalid asset type" });
  }

  let durationSeconds = null;
  let width = null;
  let height = null;

  try {
    const probeData = await ffmpeg.probeMedia(req.file.path);
    const format = probeData.format;
    const videoStream = probeData.streams?.find(
      (s) => s.codec_type === "video",
    );

    if (format?.duration) durationSeconds = parseFloat(format.duration);
    if (videoStream) {
      width = videoStream.width;
      height = videoStream.height;
    }
  } catch (err) {
    console.error("Probe failed:", err);
  }

  const asset = assetsRepo.createAsset({
    projectId: id,
    type,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    filePath: req.file.path,
    sizeBytes: req.file.size,
    durationSeconds,
    width,
    height,
  });

  res.status(201).json(asset);
});

router.post("/:id/duplicate", (req, res) => {
  const project = projectsRepo.duplicateProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.status(201).json(project);
});

module.exports = router;
