const fs = require("fs");
const path = require("path");
const ffmpeg = require("./ffmpegService");
const projectsRepo = require("../db/projectsRepo");
const assetsRepo = require("../db/assetsRepo");
const jobsRepo = require("../db/jobsRepo");

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
    const audioAsset = assets.find((a) => a.type === "audio");

    if (!focusAsset || !breakAsset || !audioAsset) {
      throw new Error("Missing required assets (focus, break, or audio)");
    }

    // Step 2: Normalize
    jobsRepo.updateJobStatus(jobId, "rendering", 20, "Normalizing video clips");
    const focusNormPath = path.join(tempDir, "focus-normalized.mp4");
    const breakNormPath = path.join(tempDir, "break-normalized.mp4");

    await ffmpeg.normalizeVideo(focusAsset.file_path, focusNormPath);
    await ffmpeg.normalizeVideo(breakAsset.file_path, breakNormPath);

    // Step 3: Render Segments
    jobsRepo.updateJobStatus(jobId, "rendering", 40, "Rendering segments");
    const isPreview = job.type === "preview";
    const focusDurationSecs = isPreview
      ? 15
      : (project.focus_duration_minutes || 25) * 60;
    const breakDurationSecs = isPreview
      ? 15
      : (project.break_duration_minutes || 5) * 60;
    const sessionCount = isPreview ? 1 : project.session_count || 4;
    const includeFinalBreak = isPreview
      ? false
      : project.include_final_break === 1;

    const segmentFiles = [];

    // Simple calculation to increment progress
    const totalSegments = sessionCount * 2 - (includeFinalBreak ? 0 : 1);
    let segmentsDone = 0;

    for (let i = 1; i <= sessionCount; i++) {
      // Focus
      const focusSegPath = path.join(tempDir, `focus-${i}.mp4`);
      await ffmpeg.createSegment(
        focusNormPath,
        focusSegPath,
        focusDurationSecs,
        `Focus ${i}/${sessionCount}`,
        true,
      );
      segmentFiles.push(focusSegPath);
      segmentsDone++;
      jobsRepo.updateJobStatus(
        jobId,
        "rendering",
        40 + Math.floor((segmentsDone / totalSegments) * 45),
        `Rendered focus ${i}`,
      );

      // Break
      if (i < sessionCount || includeFinalBreak) {
        const breakSegPath = path.join(tempDir, `break-${i}.mp4`);
        await ffmpeg.createSegment(
          breakNormPath,
          breakSegPath,
          breakDurationSecs,
          `Break ${i}/${sessionCount}`,
          false,
        );
        segmentFiles.push(breakSegPath);
        segmentsDone++;
        jobsRepo.updateJobStatus(
          jobId,
          "rendering",
          40 + Math.floor((segmentsDone / totalSegments) * 45),
          `Rendered break ${i}`,
        );
      }
    }

    // Step 6: Concatenate
    jobsRepo.updateJobStatus(jobId, "rendering", 90, "Concatenating segments");
    const listPath = path.join(tempDir, "segments.txt");
    const listContent = segmentFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listContent);

    const concatPath = path.join(tempDir, "concat-no-audio.mp4");
    await ffmpeg.concatSegments(listPath, concatPath);

    // Step 7: Audio
    jobsRepo.updateJobStatus(jobId, "rendering", 95, "Attaching audio");
    const finalFilename = isPreview
      ? `preview-${Date.now()}.mp4`
      : `final-${Date.now()}.mp4`;
    const finalPath = path.join(outDir, finalFilename);
    const targetDuration = isPreview ? 30 : project.total_duration_seconds;

    await ffmpeg.attachAudio(
      concatPath,
      audioAsset.file_path,
      finalPath,
      targetDuration,
    );

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
    jobsRepo.setJobFailed(jobId, error.message);
    projectsRepo.updateProject(projectId, {
      status: "failed",
      error_message: error.message,
    });
  }
}

module.exports = {
  executeRender,
};
