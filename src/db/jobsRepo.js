const db = require("./client");
const { v4: uuidv4 } = require("uuid");

function getJobById(id) {
  const stmt = db.prepare("SELECT * FROM render_jobs WHERE id = ?");
  return stmt.get(id);
}

function getJobsByProjectId(projectId) {
  const stmt = db.prepare(
    "SELECT * FROM render_jobs WHERE project_id = ? ORDER BY created_at DESC",
  );
  return stmt.all(projectId);
}

function createJob(data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO render_jobs (
      id, project_id, type, status, progress, current_step
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, data.projectId, data.type || "final", "queued", 0, "Queued");

  return getJobById(id);
}

function updateJobStatus(
  id,
  status,
  progress,
  currentStep,
  outputPath = null,
  errorMessage = null,
) {
  const stmt = db.prepare(`
    UPDATE render_jobs 
    SET status = ?, progress = ?, current_step = ?, output_path = COALESCE(?, output_path), error_message = COALESCE(?, error_message), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(status, progress, currentStep, outputPath, errorMessage, id);
  return getJobById(id);
}

function setJobStarted(id) {
  const stmt = db.prepare(
    "UPDATE render_jobs SET started_at = CURRENT_TIMESTAMP, status = 'rendering', progress = 0, current_step = 'Starting', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  stmt.run(id);
}

function setJobCompleted(id, outputPath) {
  const stmt = db.prepare(
    "UPDATE render_jobs SET completed_at = CURRENT_TIMESTAMP, status = 'completed', progress = 100, current_step = 'Completed', output_path = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  stmt.run(outputPath, id);
}

function setJobFailed(id, errorMessage) {
  const stmt = db.prepare(
    "UPDATE render_jobs SET completed_at = CURRENT_TIMESTAMP, status = 'failed', current_step = 'Failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  stmt.run(errorMessage, id);
}

module.exports = {
  getJobById,
  getJobsByProjectId,
  createJob,
  updateJobStatus,
  setJobStarted,
  setJobCompleted,
  setJobFailed,
};
