const db = require('./client');
const { v4: uuidv4 } = require('uuid');

const AUDIO_TYPES = new Set(['audio', 'break_audio', 'audio_track', 'session_bell']);

function getSessionAudio(projectId) {
  return db.prepare('SELECT * FROM project_session_audio WHERE project_id = ? ORDER BY session_index').all(projectId);
}

function getAssetUsage(assetId) {
  return db.prepare(`
    SELECT SUM(CASE WHEN psa.id IS NOT NULL THEN 1 ELSE 0 END) AS mapping_count,
      SUM(CASE WHEN p.session_bell_asset_id = ? THEN 1 ELSE 0 END) AS bell_count
    FROM projects p
    LEFT JOIN project_session_audio psa ON psa.project_id = p.id
      AND (psa.focus_audio_asset_id = ? OR psa.break_audio_asset_id = ?)
  `).get(assetId, assetId, assetId);
}

function validateAudioAsset(projectId, assetId, errorCode) {
  if (!assetId) return null;
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) {
    const error = new Error('Selected audio asset was not found.');
    error.code = errorCode === 'BELL_ASSET_NOT_FOUND' ? errorCode : 'AUDIO_ASSET_NOT_FOUND';
    throw error;
  }
  if (asset.project_id !== projectId) {
    const error = new Error('Selected audio asset belongs to another project.');
    error.code = errorCode === 'BELL_ASSET_PROJECT_MISMATCH' ? errorCode : 'AUDIO_ASSET_PROJECT_MISMATCH';
    throw error;
  }
  if (!AUDIO_TYPES.has(asset.type) || !String(asset.mime_type || '').startsWith('audio/')) {
    const error = new Error('Selected asset is not an audio file.');
    error.code = 'INVALID_AUDIO_ASSET';
    throw error;
  }
  return asset;
}

function replaceSessionAudio(project, payload) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const seen = new Set();
  for (const session of sessions) {
    const index = Number(session.sessionIndex);
    if (!Number.isInteger(index) || index < 1 || index > project.session_count) {
      const error = new Error('Session index must be within the project session count.');
      error.code = 'INVALID_SESSION_INDEX';
      throw error;
    }
    if (seen.has(index)) {
      const error = new Error('Each session index may appear only once.');
      error.code = 'DUPLICATE_SESSION_INDEX';
      throw error;
    }
    seen.add(index);
    validateAudioAsset(project.id, session.focusAudioAssetId, 'AUDIO_ASSET_NOT_FOUND');
    validateAudioAsset(project.id, session.breakAudioAssetId, 'AUDIO_ASSET_NOT_FOUND');
  }
  validateAudioAsset(project.id, payload.bellAssetId, 'BELL_ASSET_NOT_FOUND');

  db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO project_session_audio (id, project_id, session_index, focus_audio_asset_id, break_audio_asset_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, session_index) DO UPDATE SET
        focus_audio_asset_id = excluded.focus_audio_asset_id,
        break_audio_asset_id = excluded.break_audio_asset_id,
        updated_at = CURRENT_TIMESTAMP
    `);
    for (const session of sessions) {
      upsert.run(uuidv4(), project.id, session.sessionIndex, session.focusAudioAssetId || null, session.breakAudioAssetId || null);
    }
    db.prepare('DELETE FROM project_session_audio WHERE project_id = ? AND session_index > ?').run(project.id, project.session_count);
    const keep = [...seen];
    if (keep.length) {
      db.prepare(`DELETE FROM project_session_audio WHERE project_id = ? AND session_index <= ? AND session_index NOT IN (${keep.map(() => '?').join(',')})`).run(project.id, project.session_count, ...keep);
    } else {
      db.prepare('DELETE FROM project_session_audio WHERE project_id = ?').run(project.id);
    }
    db.prepare('UPDATE projects SET session_bell_asset_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payload.bellAssetId || null, project.id);
  })();

  return getSessionAudio(project.id);
}

module.exports = { AUDIO_TYPES, getSessionAudio, getAssetUsage, validateAudioAsset, replaceSessionAudio };
