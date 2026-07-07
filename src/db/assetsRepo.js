const db = require('./client');
const { v4: uuidv4 } = require('uuid');

function getAssetsByProjectId(projectId) {
  const stmt = db.prepare('SELECT * FROM assets WHERE project_id = ?');
  return stmt.all(projectId);
}

function getAssetById(id) {
  const stmt = db.prepare('SELECT * FROM assets WHERE id = ?');
  return stmt.get(id);
}

function createAsset(data) {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO assets (
      id, project_id, type, original_name, mime_type, file_path, size_bytes,
      duration_seconds, width, height
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.projectId,
    data.type,
    data.originalName,
    data.mimeType,
    data.filePath,
    data.sizeBytes || 0,
    data.durationSeconds || null,
    data.width || null,
    data.height || null
  );

  return getAssetById(id);
}

function deleteAsset(id) {
  const stmt = db.prepare('DELETE FROM assets WHERE id = ?');
  stmt.run(id);
}

module.exports = {
  getAssetsByProjectId,
  getAssetById,
  createAsset,
  deleteAsset
};
