const db = require('./client');

function createJob(job) {
  const stmt = db.prepare(`
    INSERT INTO upload_jobs (id, project_id, platform, status, privacy_status, scheduled_at, title, description, tags_json, thumbnail_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    job.id,
    job.project_id,
    job.platform,
    job.status,
    job.privacy_status,
    job.scheduled_at,
    job.title,
    job.description,
    job.tags_json,
    job.thumbnail_path
  );
}

function updateJobStatus(id, status, updates = {}) {
  const fields = ['status = ?'];
  const values = [status];

  if (updates.youtube_video_id) {
    fields.push('youtube_video_id = ?');
    values.push(updates.youtube_video_id);
  }
  if (updates.error_message) {
    fields.push('error_message = ?');
    values.push(updates.error_message);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const stmt = db.prepare(`
    UPDATE upload_jobs
    SET ${fields.join(', ')}
    WHERE id = ?
  `);
  stmt.run(...values);
}

function getJob(id) {
  return db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(id);
}

function getJobsForProject(projectId) {
  return db.prepare('SELECT * FROM upload_jobs WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
}

module.exports = {
  createJob,
  updateJobStatus,
  getJob,
  getJobsForProject
};
