function generateTimestamps(config) {
  const { focusDurationMinutes, breakDurationMinutes, sessionCount, includeFinalBreak } = config;

  const timestamps = [];
  let elapsedSeconds = 0;

  for (let sessionIndex = 1; sessionIndex <= sessionCount; sessionIndex += 1) {
    timestamps.push({
      seconds: elapsedSeconds,
      label: `Focus Session ${sessionIndex}`,
    });

    elapsedSeconds += focusDurationMinutes * 60;

    const hasBreak = sessionIndex < sessionCount || Boolean(includeFinalBreak);

    if (hasBreak) {
      timestamps.push({
        seconds: elapsedSeconds,
        label: `Break ${sessionIndex}`,
      });

      elapsedSeconds += breakDurationMinutes * 60;
    }
  }

  return { timestamps, elapsedSeconds };
}

function formatTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const mStr = m.toString().padStart(2, "0");
  const sStr = s.toString().padStart(2, "0");

  if (h > 0) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

module.exports = {
  generateTimestamps,
  formatTimestamp,
};
