const fs = require("fs");
const path = require("path");
const ffmpeg = require("./ffmpegService");
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

  const tempDir = path.resolve(__dirname, `../../../data/temp/${projectId}`);
  const outDir = path.resolve(__dirname, `../../../data/outputs/${projectId}`);

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

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

    // Step 2: Normalize
    jobsRepo.updateJobStatus(jobId, "rendering", 20, "Normalizing video clips");
    const focusNormPath = path.join(tempDir, "focus-normalized.mp4");
    const breakNormPath = path.join(tempDir, "break-normalized.mp4");

    await ffmpeg.normalizeVideo(focusAsset.file_path, focusNormPath);
    await ffmpeg.normalizeVideo(breakAsset.file_path, breakNormPath);

    // Step 3: Render Segments
    jobsRepo.updateJobStatus(jobId, "rendering", 40, "Rendering segments");
    const segmentFiles = [];
    let segmentsDone = 0;
    const sessionCount = isPreview ? 1 : project.session_count;

    for (const segment of audioPlan) {
      const segmentVideoPath = path.join(tempDir, `${segment.type}-${segment.sessionIndex}-video.mp4`);
      const segmentPath = path.join(tempDir, `${segment.type}-${segment.sessionIndex}.mp4`);
      await ffmpeg.createSegment(
        segment.type === 'focus' ? focusNormPath : breakNormPath,
        segmentVideoPath,
        segment.durationSeconds,
        `${segment.type === 'focus' ? 'Focus' : 'Break'} ${segment.sessionIndex}/${sessionCount}`,
        segment.type === 'focus',
        project.timer_text_color || "0x7D6556",
      );
      await ffmpeg.attachAudioToSegment(segmentVideoPath, segment.audioPath, segmentPath, segment.durationSeconds, bell?.file_path || null);
      segmentFiles.push(segmentPath);
      segmentsDone++;
      jobsRepo.updateJobStatus(jobId, "rendering", 40 + Math.floor((segmentsDone / audioPlan.length) * 45), `Rendered ${segment.type} ${segment.sessionIndex}`);
    }

    // Step 6: Concatenate
    jobsRepo.updateJobStatus(jobId, "rendering", 90, "Concatenating segments");
    const listPath = path.join(tempDir, "segments.txt");
    const listContent = segmentFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listContent);

    const finalFilename = isPreview
      ? `preview-${Date.now()}.mp4`
      : `final-${Date.now()}.mp4`;
    const finalPath = path.join(outDir, finalFilename);
    const targetDuration = audioPlan.reduce((total, segment) => total + segment.durationSeconds, 0);

    await ffmpeg.concatSegments(listPath, finalPath);

    // Complete
    if (isPreview) {
      projectsRepo.updateProject(projectId, {
        status: "draft", // Preview doesn't change overall draft status to complete
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

    // Cleanup temp files if not disabled
    if (process.env.KEEP_TEMP_FILES !== "true") {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error("Failed to clean up temp files:", err);
      }
    }
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

module.exports = {
  executeRender,
};
