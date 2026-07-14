const express = require("express");
const projectsRepo = require("../db/projectsRepo");
const jobsRepo = require("../db/jobsRepo");
const renderQueue = require("../services/renderQueue");
const renderService = require("../services/renderService");
const { getRemoteRenderJob } = require("../services/remoteWorkerClient");

const router = express.Router();
const remoteMarker = (job) =>
  job?.output_path?.startsWith("remote:")
    ? job.output_path.slice("remote:".length)
    : null;

function startRenderJob(job) {
  if (process.env.RENDER_MODE === "remote") {
    renderService
      .executeRender(job.id)
      .catch((error) =>
        console.error("Remote render submission failed:", error),
      );
  } else {
    renderQueue.addJob(job.id);
  }
}

router.post("/projects/:id/render/preview", (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const job = jobsRepo.createJob({ projectId: id, type: "preview" });
  startRenderJob(job);

  projectsRepo.updateProject(id, { status: "queued", error_message: null });

  res.json({
    jobId: job.id,
    status: "queued",
    currentStep:
      process.env.RENDER_MODE === "remote" ? "Uploading Sources" : "Queued",
  });
});

router.post("/projects/:id/render/final", (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const job = jobsRepo.createJob({ projectId: id, type: "final" });
  startRenderJob(job);

  projectsRepo.updateProject(id, { status: "queued", error_message: null });

  res.json({
    jobId: job.id,
    status: "queued",
    currentStep:
      process.env.RENDER_MODE === "remote" ? "Uploading Sources" : "Queued",
  });
});

router.get("/render-jobs/:id", async (req, res) => {
  const job = jobsRepo.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const workerJobId = remoteMarker(job);
  if (workerJobId) {
    try {
      const remote = await getRemoteRenderJob({ workerJobId });
      if (remote.status === "completed") {
        jobsRepo.setJobCompleted(job.id, job.output_path);
        projectsRepo.updateProject(job.project_id, {
          status: job.type === "preview" ? "draft" : "completed",
          error_message: null,
        });
      } else if (remote.status === "failed") {
        jobsRepo.setJobFailed(
          job.id,
          remote.errorMessage || remote.currentStep || "Remote render failed",
        );
        projectsRepo.updateProject(job.project_id, {
          status: "failed",
          error_message: remote.errorMessage || "Remote render failed",
        });
      } else {
        jobsRepo.updateJobStatus(
          job.id,
          remote.status,
          remote.progress,
          remote.currentStep,
          job.output_path,
        );
      }
      return res.json({
        ...remote,
        id: job.id,
        projectId: job.project_id,
        outputPath: job.output_path,
      });
    } catch (error) {
      return res.json({
        id: job.id,
        projectId: job.project_id,
        status: job.status,
        progress: job.progress,
        currentStep: "Remote worker offline",
        outputPath: job.output_path,
        errorMessage: error.message,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      });
    }
  }

  res.json({
    id: job.id,
    projectId: job.project_id,
    status: job.status,
    progress: job.progress,
    currentStep: job.current_step,
    outputPath: job.output_path,
    errorMessage: job.error_message,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  });
});

module.exports = router;
