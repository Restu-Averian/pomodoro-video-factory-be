const express = require("express");
const projectsRepo = require("../db/projectsRepo");
const jobsRepo = require("../db/jobsRepo");
const renderQueue = require("../services/renderQueue");

const router = express.Router();

router.post("/projects/:id/render/preview", (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const job = jobsRepo.createJob({ projectId: id, type: "preview" });
  renderQueue.addJob(job.id);

  projectsRepo.updateProject(id, { status: "queued" });

  res.json({ jobId: job.id, status: "queued" });
});

router.post("/projects/:id/render/final", (req, res) => {
  const { id } = req.params;
  const project = projectsRepo.getProjectById(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const job = jobsRepo.createJob({ projectId: id, type: "final" });
  renderQueue.addJob(job.id);

  projectsRepo.updateProject(id, { status: "queued" });

  res.json({ jobId: job.id, status: "queued" });
});

router.get("/render-jobs/:id", (req, res) => {
  const job = jobsRepo.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

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
