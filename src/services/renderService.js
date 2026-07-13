const fs = require("fs");
const path = require("path");
const { executeRenderPipeline } = require("../../../shared/renderPipeline");
const projectsRepo = require("../db/projectsRepo");
const assetsRepo = require("../db/assetsRepo");
const jobsRepo = require("../db/jobsRepo");
const sessionAudioRepo = require('../db/sessionAudioRepo');
const { resolveAudioPlan } = require('./audioPlanService');

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
    jobsRepo.updateJobStatus(jobId, "rendering", 10, "Resolving session audio mappings");
    const audioPlan = resolveAudioPlan(project, assets, sessionAudioRepo.getSessionAudio(projectId), { preview: isPreview });
    const bell = project.session_bell_asset_id ? assets.find((asset) => asset.id === project.session_bell_asset_id) : null;

    if (project.session_bell_asset_id && (!bell || bell.project_id !== projectId || !bell.file_path || !fs.existsSync(bell.file_path))) {
      const error = new Error('Session bell is missing from local storage.'); error.code = 'BELL_ASSET_NOT_FOUND'; throw error;
    }
    for (const segment of audioPlan) {
      if (!fs.existsSync(segment.audioPath)) {
        const error = new Error(`${segment.type === 'focus' ? 'Focus' : 'Break'} audio for Session ${segment.sessionIndex} is missing from local storage.`);
        error.code = 'AUDIO_ASSET_NOT_FOUND'; throw error;
      }
    }

    const targetDuration = audioPlan.reduce((total, segment) => total + segment.durationSeconds, 0);
    const finalFilename = isPreview ? `preview-${Date.now()}.mp4` : `final-${Date.now()}.mp4`;

    await runLocalRender(jobId, projectId, project, isPreview, focusAsset, breakAsset, bell, audioPlan, targetDuration, finalFilename);
  } catch (error) {
    console.error("Render job failed:", error);
    const message = error.code || !error.message.includes('Command failed') ? error.message : 'Render failed. Check the server logs.';
    jobsRepo.setJobFailed(jobId, message);
    projectsRepo.updateProject(projectId, {
      status: "failed",
      error_message: message,
    });
  }
}

async function runLocalRender(jobId, projectId, project, isPreview, focusAsset, breakAsset, bell, audioPlan, targetDuration, finalFilename) {
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
    fontItalicPath: path.resolve(__dirname, '../assets/fonts/CormorantGaramond-Italic.ttf'),
    tempDir,
    outDir,
    finalFilename,
    keepTempFiles: process.env.KEEP_TEMP_FILES === 'true'
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
};
