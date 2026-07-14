const fs = require("fs");
const path = require("path");
const projectsRepo = require("../db/projectsRepo");
const assetsRepo = require("../db/assetsRepo");
const jobsRepo = require("../db/jobsRepo");
const sessionAudioRepo = require("../db/sessionAudioRepo");
const { resolveAudioPlan } = require("./audioPlanService");
const { submitRemoteRenderJob } = require("./remoteWorkerClient");
const { executeRenderPipeline } = require("../shared/renderPipeline");

async function executeRender(jobId) {
  const job = jobsRepo.getJobById(jobId);
  if (!job) return;

  const projectId = job.project_id;
  const project = projectsRepo.getProjectById(projectId);
  if (!project) {
    jobsRepo.setJobFailed(jobId, "Project not found");
    return;
  }

  try {
    jobsRepo.setJobStarted(jobId);

    // Step 1: Validate Assets
    jobsRepo.updateJobStatus(jobId, "rendering", 5, "Validating assets");
    const assets = assetsRepo.getAssetsByProjectId(projectId);
    const focusAsset = assets.find((a) => a.type === "focus_video");
    const breakAsset = assets.find((a) => a.type === "break_video");
    if (!focusAsset || !breakAsset) {
      throw new Error("Missing required video assets.");
    }

    const isPreview = job.type === "preview";
    jobsRepo.updateJobStatus(
      jobId,
      "rendering",
      10,
      "Resolving session audio mappings",
    );
    const audioPlan = resolveAudioPlan(
      project,
      assets,
      sessionAudioRepo.getSessionAudio(projectId),
      { preview: isPreview },
    );
    const bell = project.session_bell_asset_id
      ? assets.find((asset) => asset.id === project.session_bell_asset_id)
      : null;

    if (
      project.session_bell_asset_id &&
      (!bell ||
        bell.project_id !== projectId ||
        !bell.file_path ||
        !fs.existsSync(bell.file_path))
    ) {
      const error = new Error("Session bell is missing from local storage.");
      error.code = "BELL_ASSET_NOT_FOUND";
      throw error;
    }
    for (const segment of audioPlan) {
      if (!fs.existsSync(segment.audioPath)) {
        const error = new Error(
          `${segment.type === "focus" ? "Focus" : "Break"} audio for Session ${segment.sessionIndex} is missing from local storage.`,
        );
        error.code = "AUDIO_ASSET_NOT_FOUND";
        throw error;
      }
    }

    const targetDuration = audioPlan.reduce(
      (total, segment) => total + segment.durationSeconds,
      0,
    );
    const finalFilename = isPreview
      ? `preview-${Date.now()}.mp4`
      : `final-${Date.now()}.mp4`;

    if (process.env.RENDER_MODE === "remote") {
      await runRemoteRender(
        jobId,
        projectId,
        project,
        isPreview,
        focusAsset,
        breakAsset,
        bell,
        audioPlan,
        targetDuration,
        finalFilename,
      );
    } else {
      await runLocalRender(
        jobId,
        projectId,
        project,
        isPreview,
        focusAsset,
        breakAsset,
        bell,
        audioPlan,
        targetDuration,
        finalFilename,
      );
    }
  } catch (error) {
    console.error("Render job failed:", error);
    const message =
      error.code || !error.message.includes("Command failed")
        ? error.message
        : "Render failed. Check the server logs.";
    jobsRepo.setJobFailed(jobId, message);
    projectsRepo.updateProject(projectId, {
      status: "failed",
      error_message: message,
    });
  }
}

function assertLocalFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath))
    throw new Error(`${label} is missing from local storage.`);
}

function extension(filePath, fallback) {
  return path.extname(filePath) || fallback;
}

function buildRemoteSubmission({
  project,
  isPreview,
  focusAsset,
  breakAsset,
  bell,
  audioPlan,
  finalFilename,
}) {
  const files = [];
  const byLocalPath = new Map();
  function addFile(logicalPath, filePath, label) {
    assertLocalFile(filePath, label);
    if (!byLocalPath.has(filePath)) {
      byLocalPath.set(filePath, logicalPath);
      files.push({ logicalPath, path: filePath });
    }
    return byLocalPath.get(filePath);
  }

  const remoteAudioPlan = audioPlan.map((segment, index) => ({
    type: segment.type,
    sessionIndex: segment.sessionIndex,
    durationSeconds: segment.durationSeconds,
    audioPath: addFile(
      `assets/audio-${index + 1}${extension(segment.audioPath, ".mp3")}`,
      segment.audioPath,
      `${segment.type} audio for Session ${segment.sessionIndex}`,
    ),
  }));
  const fontPath = path.resolve(
    __dirname,
    "../assets/fonts/CormorantGaramond-Italic.ttf",
  );

  const manifest = {
    version: 1,
    config: {
      projectId: project.id,
      type: isPreview ? "preview" : "final",
      isPreview,
      sessionCount: project.session_count,
      timerTextColor: project.timer_text_color,
      finalFilename,
    },
    assets: {
      focusVideo: addFile(
        `assets/focus-video${extension(focusAsset.file_path, ".mp4")}`,
        focusAsset.file_path,
        "Focus video",
      ),
      breakVideo: addFile(
        `assets/break-video${extension(breakAsset.file_path, ".mp4")}`,
        breakAsset.file_path,
        "Break video",
      ),
      fontItalic: addFile(
        "assets/CormorantGaramond-Italic.ttf",
        fontPath,
        "Italic font",
      ),
      audioPlan: remoteAudioPlan,
    },
  };
  if (bell)
    manifest.assets.sessionBell = addFile(
      `assets/session-bell${extension(bell.file_path, ".mp3")}`,
      bell.file_path,
      "Session bell",
    );
  return { manifest, files };
}

async function runRemoteRender(
  jobId,
  projectId,
  project,
  isPreview,
  focusAsset,
  breakAsset,
  bell,
  audioPlan,
  targetDuration,
  finalFilename,
) {
  jobsRepo.updateJobStatus(jobId, "queued", 1, "Uploading Sources");
  const submission = buildRemoteSubmission({
    project,
    isPreview,
    focusAsset,
    breakAsset,
    bell,
    audioPlan,
    finalFilename,
  });
  const remoteJob = await submitRemoteRenderJob(submission);
  jobsRepo.updateJobStatus(
    jobId,
    "queued",
    5,
    "Queued on remote worker",
    `remote:${remoteJob.id}`,
  );
  projectsRepo.updateProject(projectId, {
    status: "queued",
    rendered_duration_seconds: targetDuration,
  });
}

async function runLocalRender(
  jobId,
  projectId,
  project,
  isPreview,
  focusAsset,
  breakAsset,
  bell,
  audioPlan,
  targetDuration,
  finalFilename,
) {
  const tempDir = path.resolve(__dirname, `../../../data/temp/${projectId}`);
  const outDir = path.resolve(__dirname, `../../../data/outputs/${projectId}`);

  const manifest = {
    focusVideoPath: focusAsset.file_path,
    breakVideoPath: breakAsset.file_path,
    timerTextColor: project.timer_text_color,
    isPreview,
    sessionCount: project.session_count,
    audioPlan,
    bellPath: bell ? bell.file_path : null,
    fontItalicPath: path.resolve(
      __dirname,
      "../assets/fonts/CormorantGaramond-Italic.ttf",
    ),
    tempDir,
    outDir,
    finalFilename,
    keepTempFiles: process.env.KEEP_TEMP_FILES === "true",
  };

  const onProgress = (percentage, step) => {
    jobsRepo.updateJobStatus(jobId, "rendering", percentage, step);
  };

  const finalPath = await executeRenderPipeline(manifest, onProgress);

  if (isPreview) {
    projectsRepo.updateProject(projectId, {
      status: "draft",
      preview_path: `/outputs/${projectId}/${finalFilename}`,
    });
  } else {
    const stats = fs.statSync(finalPath);
    projectsRepo.updateProject(projectId, {
      status: "completed",
      output_path: `/outputs/${projectId}/${finalFilename}`,
      output_size_bytes: stats.size,
      rendered_duration_seconds: targetDuration,
    });
  }
  jobsRepo.setJobCompleted(jobId, `/outputs/${projectId}/${finalFilename}`);
}

module.exports = {
  executeRender,
  buildRemoteSubmission,
};
