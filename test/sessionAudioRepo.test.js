const test = require('node:test');
const assert = require('node:assert/strict');
const initDb = require('../src/db/init');
const projectsRepo = require('../src/db/projectsRepo');
const assetsRepo = require('../src/db/assetsRepo');
const sessionAudioRepo = require('../src/db/sessionAudioRepo');

initDb();

function audio(projectId, name) {
  return assetsRepo.createAsset({
    projectId,
    type: 'audio_track',
    originalName: name,
    mimeType: 'audio/mpeg',
    filePath: `/tmp/${name}`,
  });
}

test('persists IDs, reuses tracks, and removes stale session mappings', () => {
  const project = projectsRepo.createProject({ title: 'mapping repository test', pomodoroPreset: 'classic_25_5' });
  const otherProject = projectsRepo.createProject({ title: 'other project', pomodoroPreset: 'custom' });
  try {
    const focusA = audio(project.id, 'focus-a.mp3');
    const focusB = audio(project.id, 'focus-b.mp3');
    const breakA = audio(project.id, 'break-a.mp3');
    const bell = assetsRepo.createAsset({
      projectId: project.id,
      type: 'session_bell',
      originalName: 'bell.mp3',
      mimeType: 'audio/mpeg',
      filePath: '/tmp/bell.mp3',
    });
    const foreign = audio(otherProject.id, 'foreign.mp3');
    const sessions = [1, 2, 3, 4].map((sessionIndex) => ({
      sessionIndex,
      focusAudioAssetId: sessionIndex % 2 ? focusA.id : focusB.id,
      breakAudioAssetId: breakA.id,
    }));

    sessionAudioRepo.replaceSessionAudio(project, { sessions, bellAssetId: bell.id });
    assert.deepEqual(sessionAudioRepo.getSessionAudio(project.id).map((row) => row.session_index), [1, 2, 3, 4]);
    assert.equal(sessionAudioRepo.getSessionAudio(project.id)[1].break_audio_asset_id, breakA.id);
    assert.equal(projectsRepo.getProjectById(project.id).session_bell_asset_id, bell.id);
    assert.throws(
      () => sessionAudioRepo.replaceSessionAudio(project, { sessions: [{ sessionIndex: 1, focusAudioAssetId: foreign.id, breakAudioAssetId: breakA.id }] }),
      { code: 'AUDIO_ASSET_PROJECT_MISMATCH' },
    );

    projectsRepo.updateProject(project.id, { session_count: 3 });
    const resizedProject = projectsRepo.getProjectById(project.id);
    sessionAudioRepo.replaceSessionAudio(resizedProject, { sessions: sessions.slice(0, 3) });
    assert.deepEqual(sessionAudioRepo.getSessionAudio(project.id).map((row) => row.session_index), [1, 2, 3]);
  } finally {
    projectsRepo.deleteProject(project.id);
    projectsRepo.deleteProject(otherProject.id);
  }
});
