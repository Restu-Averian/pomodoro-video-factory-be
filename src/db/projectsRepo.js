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
  const config = normalizeProjectConfig(data);
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO projects (
      id, title, description, focus_duration_minutes, break_duration_minutes,
      session_count, include_final_break, timer_text_color, output_resolution,
      status, total_duration_seconds, pomodoro_preset, session_bell_asset_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Calculate total duration (Focus + Break sessions)
  // Total focus time: focus_duration_minutes * session_count
  // Total break time: break_duration_minutes * (session_count - (include_final_break ? 0 : 1))
  stmt.run(
    id,
    data.title || 'Untitled Project',
    data.description || null,
    config.focusDurationMinutes,
    config.breakDurationMinutes,
    config.sessionCount,
    config.includeFinalBreak ? 1 : 0,
    data.timerTextColor || '0x7D6556',
    data.outputResolution || '1920x1080',
    'draft',
    config.totalDurationSeconds,
    config.pomodoroPreset,
    null
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
    db.prepare('DELETE FROM project_session_audio WHERE project_id = ?').run(projectId);
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
      session_count, include_final_break, timer_text_color, output_resolution,
      status, total_duration_seconds, pomodoro_preset, session_bell_asset_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    newId,
    (existing.title || 'Untitled') + ' (Copy)',
    existing.description,
    existing.focus_duration_minutes,
    existing.break_duration_minutes,
    existing.session_count,
    existing.include_final_break,
    existing.timer_text_color,
    existing.output_resolution,
    'draft',
    existing.total_duration_seconds,
    existing.pomodoro_preset || 'custom',
    null
  );

  return getProjectById(newId);
}

function normalizeProjectConfig(data) {
  const presets = {
    classic_25_5: { focusDurationMinutes: 25, breakDurationMinutes: 5, sessionCount: 4, includeFinalBreak: true },
    deep_work_50_10: { focusDurationMinutes: 50, breakDurationMinutes: 10, sessionCount: 3, includeFinalBreak: true },
  };
  const pomodoroPreset = data.pomodoroPreset || 'custom';
  if (!['classic_25_5', 'deep_work_50_10', 'custom'].includes(pomodoroPreset)) {
    const error = new Error('Pomodoro preset is invalid.'); error.code = 'INVALID_POMODORO_PRESET'; throw error;
  }
  const config = presets[pomodoroPreset] || {
    focusDurationMinutes: Number(data.focusDurationMinutes ?? 25),
    breakDurationMinutes: Number(data.breakDurationMinutes ?? 5),
    sessionCount: Number(data.sessionCount ?? 4),
    includeFinalBreak: data.includeFinalBreak === true || data.includeFinalBreak === 1,
  };
  if (!Number.isInteger(config.focusDurationMinutes) || config.focusDurationMinutes < 1 || !Number.isInteger(config.breakDurationMinutes) || config.breakDurationMinutes < 0 || !Number.isInteger(config.sessionCount) || config.sessionCount < 1) {
    const error = new Error('Pomodoro durations and session count are invalid.'); error.code = 'INVALID_PROJECT_CONFIG'; throw error;
  }
  config.pomodoroPreset = pomodoroPreset;
  config.totalDurationSeconds = (config.focusDurationMinutes * config.sessionCount + config.breakDurationMinutes * Math.max(0, config.sessionCount - (config.includeFinalBreak ? 0 : 1))) * 60;
  return config;
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  duplicateProject,
  normalizeProjectConfig
};
