const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAudioPlan } = require('../src/services/audioPlanService');

const project = {
  id: 'project-1',
  focus_duration_minutes: 1,
  break_duration_minutes: 1,
  session_count: 2,
  include_final_break: 1,
};

const assets = [
  { id: 'focus-a', project_id: 'project-1', type: 'audio_track', file_path: '/tmp/focus-a.mp3' },
  { id: 'focus-b', project_id: 'project-1', type: 'audio_track', file_path: '/tmp/focus-b.mp3' },
  { id: 'break-a', project_id: 'project-1', type: 'audio_track', file_path: '/tmp/break-a.mp3' },
  { id: 'legacy-focus', project_id: 'project-1', type: 'audio', file_path: '/tmp/legacy-focus.mp3' },
  { id: 'legacy-break', project_id: 'project-1', type: 'break_audio', file_path: '/tmp/legacy-break.mp3' },
];

test('resolves every mapped segment by its selected asset ID', () => {
  const plan = resolveAudioPlan(project, assets, [
    { session_index: 1, focus_audio_asset_id: 'focus-a', break_audio_asset_id: 'break-a' },
    { session_index: 2, focus_audio_asset_id: 'focus-b', break_audio_asset_id: 'break-a' },
  ]);

  assert.deepEqual(plan.map(({ type, sessionIndex, audioAssetId }) => ({ type, sessionIndex, audioAssetId })), [
    { type: 'focus', sessionIndex: 1, audioAssetId: 'focus-a' },
    { type: 'break', sessionIndex: 1, audioAssetId: 'break-a' },
    { type: 'focus', sessionIndex: 2, audioAssetId: 'focus-b' },
    { type: 'break', sessionIndex: 2, audioAssetId: 'break-a' },
  ]);
});

test('rejects an incomplete mapped project instead of borrowing another track', () => {
  assert.throws(
    () => resolveAudioPlan(project, assets, [{ session_index: 1, focus_audio_asset_id: 'focus-a', break_audio_asset_id: 'break-a' }]),
    { code: 'MISSING_SESSION_FOCUS_AUDIO' },
  );
});

test('uses legacy focus and break audio only when no mapping exists', () => {
  const plan = resolveAudioPlan(project, assets, []);
  assert.deepEqual(plan.map((segment) => segment.audioAssetId), [
    'legacy-focus', 'legacy-break', 'legacy-focus', 'legacy-break',
  ]);
});

test('preview resolves Focus 1 and Break 1 with 15-second durations', () => {
  const plan = resolveAudioPlan(project, assets, [
    { session_index: 1, focus_audio_asset_id: 'focus-a', break_audio_asset_id: 'break-a' },
  ], { preview: true });
  assert.deepEqual(plan.map(({ type, durationSeconds, audioAssetId }) => ({ type, durationSeconds, audioAssetId })), [
    { type: 'focus', durationSeconds: 15, audioAssetId: 'focus-a' },
    { type: 'break', durationSeconds: 15, audioAssetId: 'break-a' },
  ]);
});
