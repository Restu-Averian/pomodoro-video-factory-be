const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const projectsRepo = require("../db/projectsRepo");
const assetsRepo = require("../db/assetsRepo");
const uploadJobsRepo = require("../db/uploadJobsRepo");
const ffmpeg = require("../services/ffmpegService");
const youtubeService = require("../services/youtubeService");

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
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    // Note: YouTube video deletion is out of scope.
    // If the project was uploaded to YouTube (has youtube_video_id in upload_jobs),
    // we only delete the local database records and files here.
    projectsRepo.deleteProject(id);

    // Delete local files
    const dirsToDelete = [
      path.resolve(__dirname, `../../../data/uploads/${id}`),
      path.resolve(__dirname, `../../../data/temp/${id}`),
      path.resolve(__dirname, `../../../data/outputs/${id}`),
    ];

    let warnings = [];
    dirsToDelete.forEach((dir) => {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
          console.warn(`Failed to delete directory ${dir}:`, err);
          warnings.push(`Could not fully delete ${path.basename(dir)} files`);
        }
      }
    });

    res.json({
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    console.error("Failed to delete project:", err);
    res.status(500).json({ error: { message: "Failed to delete project" } });
  }
});

router.post("/:id/assets", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Project not found" });
  }

  const { type } = req.body;
  if (
    ![
      "focus_video",
      "break_video",
      "audio",
      "break_audio",
      "thumbnail",
    ].includes(type)
  ) {
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

router.post("/:id/youtube/upload", (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);

  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.status !== "completed")
    return res.status(400).json({ error: "Project render not completed" });

  const absoluteOutputPath = path.resolve(__dirname, '../../../data', project.output_path.replace(/^\//, ''));
  if (!fs.existsSync(absoluteOutputPath))
    return res.status(400).json({ error: "Output video missing" });

  const {
    title,
    description,
    tags,
    privacyStatus,
    scheduledAt,
    thumbnailPath,
  } = req.body;

  const jobId = uuidv4();
  const job = {
    id: jobId,
    project_id: id,
    platform: "youtube",
    status: "queued",
    privacy_status: privacyStatus || "private",
    scheduled_at: scheduledAt || null,
    title,
    description,
    tags_json: tags ? JSON.stringify(tags) : "[]",
    thumbnail_path: thumbnailPath || null,
  };

  try {
    uploadJobsRepo.createJob(job);

    // Start background upload
    youtubeService.uploadVideo(jobId);

    res.status(201).json({ id: jobId, status: "queued" });
  } catch (error) {
    console.error("Failed to queue upload:", error);
    res.status(500).json({ error: { message: "Failed to queue upload" } });
  }
});

router.get("/:id/upload-jobs", (req, res) => {
  try {
    const jobs = uploadJobsRepo.getJobsForProject(req.params.id);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

module.exports = router;
