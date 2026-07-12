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
const sessionAudioRepo = require("../db/sessionAudioRepo");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const projectId = req.params.id;
    const dir = path.resolve(__dirname, `../../../data/uploads/${projectId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(
      null,
      `${uuidv4()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    );
  },
});
const upload = multer({ storage: storage });

router.get("/", (req, res) => {
  res.json(projectsRepo.getAllProjects());
});

router.post("/", (req, res) => {
  try {
    const project = projectsRepo.createProject(req.body);
    res.status(201).json(project);
  } catch (error) {
    res
      .status(400)
      .json({
        error: {
          code: error.code || "INVALID_PROJECT_CONFIG",
          message: error.message,
        },
      });
  }
});

router.get("/:id", (req, res) => {
  const project = projectsRepo.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const assets = assetsRepo.getAssetsByProjectId(req.params.id);
  res.json({ ...project, assets });
});

router.patch("/:id", (req, res) => {
  try {
    const existing = projectsRepo.getProjectById(req.params.id);
    if (!existing)
      return res
        .status(404)
        .json({
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
    const configKeys = [
      "pomodoroPreset",
      "focusDurationMinutes",
      "breakDurationMinutes",
      "sessionCount",
      "includeFinalBreak",
    ];
    const updates = {};
    if (configKeys.some((key) => req.body[key] !== undefined)) {
      const config = projectsRepo.normalizeProjectConfig({
        pomodoroPreset: req.body.pomodoroPreset ?? existing.pomodoro_preset,
        focusDurationMinutes:
          req.body.focusDurationMinutes ?? existing.focus_duration_minutes,
        breakDurationMinutes:
          req.body.breakDurationMinutes ?? existing.break_duration_minutes,
        sessionCount: req.body.sessionCount ?? existing.session_count,
        includeFinalBreak:
          req.body.includeFinalBreak ?? existing.include_final_break,
      });
      Object.assign(updates, {
        pomodoro_preset: config.pomodoroPreset,
        focus_duration_minutes: config.focusDurationMinutes,
        break_duration_minutes: config.breakDurationMinutes,
        session_count: config.sessionCount,
        include_final_break: config.includeFinalBreak ? 1 : 0,
        total_duration_seconds: config.totalDurationSeconds,
      });
    }
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined)
      updates.description = req.body.description;
    if (req.body.timerTextColor !== undefined)
      updates.timer_text_color = req.body.timerTextColor;
    if (req.body.outputResolution !== undefined)
      updates.output_resolution = req.body.outputResolution;
    if (req.body.sessionBellAssetId !== undefined) {
      sessionAudioRepo.validateAudioAsset(
        existing.id,
        req.body.sessionBellAssetId,
        "BELL_ASSET_NOT_FOUND",
      );
      updates.session_bell_asset_id = req.body.sessionBellAssetId || null;
    }
    res.json(projectsRepo.updateProject(req.params.id, updates));
  } catch (error) {
    res
      .status(400)
      .json({
        error: {
          code: error.code || "INVALID_PROJECT_CONFIG",
          message: error.message,
        },
      });
  }
});

router.get("/:id/session-audio", (req, res) => {
  const project = projectsRepo.getProjectById(req.params.id);
  if (!project)
    return res
      .status(404)
      .json({
        error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
      });
  res.json({
    projectId: project.id,
    sessionCount: project.session_count,
    bellAssetId: project.session_bell_asset_id || null,
    sessions: sessionAudioRepo.getSessionAudio(project.id).map((row) => ({
      sessionIndex: row.session_index,
      focusAudioAssetId: row.focus_audio_asset_id,
      breakAudioAssetId: row.break_audio_asset_id,
    })),
  });
});

router.put("/:id/session-audio", (req, res) => {
  try {
    const project = projectsRepo.getProjectById(req.params.id);
    if (!project)
      return res
        .status(404)
        .json({
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
    const rows = sessionAudioRepo.replaceSessionAudio(project, req.body || {});
    const saved = projectsRepo.getProjectById(project.id);
    res.json({
      projectId: project.id,
      sessionCount: project.session_count,
      bellAssetId: saved.session_bell_asset_id || null,
      sessions: rows.map((row) => ({
        sessionIndex: row.session_index,
        focusAudioAssetId: row.focus_audio_asset_id,
        breakAudioAssetId: row.break_audio_asset_id,
      })),
    });
  } catch (error) {
    res
      .status(
        error.code &&
          [
            "AUDIO_ASSET_PROJECT_MISMATCH",
            "BELL_ASSET_PROJECT_MISMATCH",
          ].includes(error.code)
          ? 403
          : 400,
      )
      .json({
        error: {
          code: error.code || "INVALID_SESSION_AUDIO",
          message: error.message,
        },
      });
  }
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
  if (!project || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path);
    return res
      .status(404)
      .json({
        error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
      });
  }

  const { type } = req.body;
  if (
    ![
      "focus_video",
      "break_video",
      "audio",
      "break_audio",
      "audio_track",
      "session_bell",
      "thumbnail",
    ].includes(type)
  ) {
    fs.unlinkSync(req.file.path);
    return res
      .status(400)
      .json({
        error: { code: "INVALID_ASSET_TYPE", message: "Invalid asset type" },
      });
  }
  const audioType = [
    "audio",
    "break_audio",
    "audio_track",
    "session_bell",
  ].includes(type);
  if (
    (audioType && !req.file.mimetype.startsWith("audio/")) ||
    (!audioType &&
      ["focus_video", "break_video"].includes(type) &&
      !req.file.mimetype.startsWith("video/"))
  ) {
    fs.unlinkSync(req.file.path);
    return res
      .status(400)
      .json({
        error: {
          code: "INVALID_MEDIA_TYPE",
          message: "Uploaded file type does not match the selected asset type.",
        },
      });
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

router.delete("/:id/assets/:assetId", (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.assetId);
  if (!asset || asset.project_id !== req.params.id)
    return res
      .status(404)
      .json({ error: { code: "ASSET_NOT_FOUND", message: "Asset not found" } });
  const usage = sessionAudioRepo.getAssetUsage(asset.id);
  if (
    Number(usage.mapping_count || 0) > 0 ||
    Number(usage.bell_count || 0) > 0
  ) {
    return res
      .status(409)
      .json({
        error: {
          code: "ASSET_IN_USE",
          message:
            "This audio asset is currently used by one or more session mappings.",
        },
      });
  }
  try {
    if (asset.file_path && fs.existsSync(asset.file_path))
      fs.unlinkSync(asset.file_path);
    assetsRepo.deleteAsset(asset.id);
    res.json({ success: true });
  } catch (error) {
    res
      .status(500)
      .json({
        error: {
          code: "ASSET_DELETE_FAILED",
          message: "Failed to delete the asset.",
        },
      });
  }
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

  const absoluteOutputPath = path.resolve(
    __dirname,
    "../../../data",
    project.output_path.replace(/^\//, ""),
  );
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

const youtubeMetadataService = require("../services/youtubeMetadataService");

router.post("/:id/youtube/metadata/generate", async (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);

  try {
    const metadata = await youtubeMetadataService.generateMetadata(project, req.body.theme);
    
    // Save drafts
    projectsRepo.updateProject(id, {
      youtube_metadata_theme: metadata.theme,
      youtube_title_draft: metadata.title,
      youtube_description_draft: metadata.description,
      youtube_metadata_generated_at: metadata.generatedAt,
      youtube_metadata_source: metadata.source,
    });
    
    res.json(metadata);
  } catch (error) {
    res.status(error.code === 'PROJECT_NOT_FOUND' ? 404 : 400).json({
      error: {
        code: error.code || "METADATA_GENERATION_FAILED",
        message: error.message
      }
    });
  }
});

module.exports = router;
