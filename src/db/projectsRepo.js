const db = require('./client');
const { v4: uuidv4 } = require('uuid');

function getAllProjects() {
  const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
  return stmt.all();
}

function getProjectById(id) {
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  return stmt.get(id);
}

function createProject(data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO projects (
      id, title, description, focus_duration_minutes, break_duration_minutes,
      session_count, include_final_break, timer_style, output_resolution,
      status, total_duration_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Calculate total duration (Focus + Break sessions)
  // Total focus time: focus_duration_minutes * session_count
  // Total break time: break_duration_minutes * (session_count - (include_final_break ? 0 : 1))
  const focusTime = (data.focusDurationMinutes || 25) * (data.sessionCount || 4) * 60;
  const breakCount = Math.max(0, (data.sessionCount || 4) - (data.includeFinalBreak ? 0 : 1));
  const breakTime = (data.breakDurationMinutes || 5) * breakCount * 60;
  const totalDurationSeconds = focusTime + breakTime;

  stmt.run(
    id,
    data.title || 'Untitled Project',
    data.description || null,
    data.focusDurationMinutes || 25,
    data.breakDurationMinutes || 5,
    data.sessionCount || 4,
    data.includeFinalBreak === true ? 1 : 0,
    data.timerStyle || 'minimal',
    data.outputResolution || '1920x1080',
    'draft',
    totalDurationSeconds
  );

  return getProjectById(id);
}

function updateProject(id, data) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getProjectById(id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const query = `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`;
  const stmt = db.prepare(query);
  stmt.run(...values);

  return getProjectById(id);
}

function deleteProject(id) {
  const transaction = db.transaction((projectId) => {
    db.prepare('DELETE FROM upload_jobs WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM render_jobs WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM assets WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });
  transaction(id);
}

function duplicateProject(id) {
  const existing = getProjectById(id);
  if (!existing) return null;

  const newId = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO projects (
      id, title, description, focus_duration_minutes, break_duration_minutes,
      session_count, include_final_break, timer_style, output_resolution,
      status, total_duration_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    newId,
    (existing.title || 'Untitled') + ' (Copy)',
    existing.description,
    existing.focus_duration_minutes,
    existing.break_duration_minutes,
    existing.session_count,
    existing.include_final_break,
    existing.timer_style,
    existing.output_resolution,
    'draft',
    existing.total_duration_seconds
  );

  return getProjectById(newId);
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  duplicateProject
};
