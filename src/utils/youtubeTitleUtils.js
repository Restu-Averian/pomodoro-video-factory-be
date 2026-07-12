function formatDurationLabel(seconds) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const remainder = seconds % 3600;
    const minutes = Math.round(remainder / 60);
    if (minutes > 0) {
      return `${hours}-Hour ${minutes}-Minute`;
    }
    return `${hours}-Hour`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes}-Minute`;
}

function generateTitle({ durationSeconds, focusDurationMinutes, breakDurationMinutes, theme, audioType }) {
  const durationLabel = formatDurationLabel(durationSeconds);
  const formatLabel = `${focusDurationMinutes}/${breakDurationMinutes}`;
  
  let sanitizedTheme = theme.trim().replace(/\s+/g, ' ');
  
  // [DURATION] Pomodoro Timer [FORMAT] | [THEME] With Niititu | [AUDIO TYPE]
  // 100 character limit
  
  const constructTitle = (t) => {
    return `${durationLabel} Pomodoro Timer ${formatLabel} | ${t} With Niititu | ${audioType}`;
  };

  let title = constructTitle(sanitizedTheme);

  if (title.length > 100) {
    const excess = title.length - 100;
    // Try to safely truncate the theme without cutting halfway through a surrogate pair etc.
    let truncatedTheme = sanitizedTheme;
    // Simple truncation for now, avoiding mid-word if possible, but strict limit applies
    while (constructTitle(truncatedTheme).length > 100 && truncatedTheme.length > 0) {
      truncatedTheme = truncatedTheme.slice(0, -1).trim();
    }
    title = constructTitle(truncatedTheme);
  }

  return title;
}

module.exports = {
  formatDurationLabel,
  generateTitle,
};
