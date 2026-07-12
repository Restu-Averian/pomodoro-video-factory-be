const db = require('./client');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      focus_duration_minutes INTEGER,
      break_duration_minutes INTEGER,
      session_count INTEGER,
      include_final_break BOOLEAN DEFAULT 1,
      timer_text_color TEXT,
      output_resolution TEXT DEFAULT '1080p',
      status TEXT,
      total_duration_seconds INTEGER,
      output_path TEXT,
      preview_path TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_path TEXT,
      size_bytes INTEGER,
      duration_seconds INTEGER,
      width INTEGER,
      height INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS render_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT,
      status TEXT,
      progress REAL,
      current_step TEXT,
      output_path TEXT,
      error_message TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_accounts (
      id TEXT PRIMARY KEY,
      name TEXT,
      channel_id TEXT,
      access_token TEXT,
      refresh_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      platform TEXT,
      status TEXT,
      youtube_video_id TEXT,
      privacy_status TEXT,
      scheduled_at DATETIME,
      title TEXT,
      description TEXT,
      tags_json TEXT,
      thumbnail_path TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id)
    );
  `);

  const columns = new Set(db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name));
  for (const [name, definition] of Object.entries({
    output_size_bytes: 'INTEGER',
    rendered_duration_seconds: 'INTEGER',
    pomodoro_preset: "TEXT NOT NULL DEFAULT 'custom'",
    session_bell_asset_id: 'TEXT',
    youtube_metadata_theme: 'TEXT',
    youtube_title_draft: 'TEXT',
    youtube_description_draft: 'TEXT',
    youtube_metadata_generated_at: 'TEXT',
    youtube_metadata_source: 'TEXT',
  })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_session_audio (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_index INTEGER NOT NULL,
      focus_audio_asset_id TEXT,
      break_audio_asset_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, session_index)
    );
    CREATE INDEX IF NOT EXISTS idx_project_session_audio_project_id ON project_session_audio(project_id);
  `);
  console.log('Database initialized successfully.');
}

if (require.main === module) {
  initDb();
}

module.exports = initDb;
