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
      include_final_break INTEGER,
      timer_style TEXT,
      output_resolution TEXT,
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

  console.log('Database initialized successfully.');

  try {
    db.exec(`ALTER TABLE projects ADD COLUMN output_size_bytes INTEGER;`);
  } catch (err) {
    // Column might already exist, ignore
  }

  try {
    db.exec(`ALTER TABLE projects ADD COLUMN rendered_duration_seconds INTEGER;`);
  } catch (err) {
    // Column might already exist, ignore
  }
}

if (require.main === module) {
  initDb();
}

module.exports = initDb;
