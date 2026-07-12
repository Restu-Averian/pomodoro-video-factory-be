function planError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveAudioPlan(project, assets, mappings, options = {}) {
  const preview = options.preview === true;
  const mapped = mappings.length > 0;
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const mappingBySession = new Map(mappings.map((mapping) => [mapping.session_index, mapping]));
  const legacyFocus = assets.find((asset) => asset.type === 'audio');
  const legacyBreak = assets.find((asset) => asset.type === 'break_audio') || legacyFocus;
  const sessionCount = preview ? 1 : project.session_count;
  const includeFinalBreak = preview || Boolean(project.include_final_break);
  const focusDuration = preview ? 15 : project.focus_duration_minutes * 60;
  const breakDuration = preview ? 15 : project.break_duration_minutes * 60;
  const plan = [];

  function select(sessionIndex, key, legacy, segmentName) {
    const id = mapped ? mappingBySession.get(sessionIndex)?.[key] : legacy?.id;
    if (!id) throw planError(key === 'focus_audio_asset_id' ? 'MISSING_SESSION_FOCUS_AUDIO' : 'MISSING_SESSION_BREAK_AUDIO', `${segmentName} audio is required for Session ${sessionIndex}.`);
    const asset = byId.get(id);
    if (!asset || asset.project_id !== project.id) throw planError('AUDIO_ASSET_NOT_FOUND', `${segmentName} audio for Session ${sessionIndex} was not found.`);
    if (!asset.file_path) throw planError('AUDIO_ASSET_NOT_FOUND', `${segmentName} audio for Session ${sessionIndex} is missing from local storage.`);
    return asset;
  }

  for (let sessionIndex = 1; sessionIndex <= sessionCount; sessionIndex += 1) {
    const focus = select(sessionIndex, 'focus_audio_asset_id', legacyFocus, 'Focus');
    plan.push({ type: 'focus', sessionIndex, audioAssetId: focus.id, audioPath: focus.file_path, durationSeconds: focusDuration });
    if (sessionIndex < sessionCount || includeFinalBreak) {
      const breakAudio = select(sessionIndex, 'break_audio_asset_id', legacyBreak, 'Break');
      plan.push({ type: 'break', sessionIndex, audioAssetId: breakAudio.id, audioPath: breakAudio.file_path, durationSeconds: breakDuration });
    }
  }
  return plan;
}

module.exports = { resolveAudioPlan };
