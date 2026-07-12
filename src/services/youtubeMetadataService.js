const { generateTimestamps, formatTimestamp } = require('../utils/timestampUtils');
const { formatDurationLabel, generateTitle } = require('../utils/youtubeTitleUtils');
const ollamaService = require('./ollamaService');
const fs = require('fs');
const path = require('path');

function getAudioType(project) {
  // 1. Existing project audio_edition/audio_type field, if one already exists
  if (project.audio_edition) return project.audio_edition;
  if (project.audio_type) return project.audio_type;
  
  // 3. Default to Focus Music
  return 'Focus Music';
}

function getExpectedDurationSeconds(project) {
  const { focus_duration_minutes, break_duration_minutes, session_count, include_final_break } = project;
  let total = focus_duration_minutes * 60 * session_count;
  const breakCount = include_final_break ? session_count : session_count - 1;
  total += break_duration_minutes * 60 * Math.max(0, breakCount);
  return total;
}

function getDurationSeconds(project) {
  if (project.rendered_duration_seconds) return project.rendered_duration_seconds;
  if (project.total_duration_seconds) return project.total_duration_seconds;
  return getExpectedDurationSeconds(project);
}

function buildFallbackDescription(facts, title, timestampsFormatted) {
  const openingParagraph = `Enjoy a focused ${facts.durationLabel} Pomodoro session with Niititu
in a peaceful ${facts.theme} atmosphere. This ${facts.formatLabel} timer is designed
for studying, coding, working, reading, and other tasks that benefit
from calm, structured focus, with regular breaks to help you pause
before the next session.`.replace(/\n/g, ' ');

  const closingParagraph = `Take each session one step at a time, use every break to reset,
and let Niititu keep you company until the final timer ends.`.replace(/\n/g, ' ');

  return `${openingParagraph}

Timestamps:
${timestampsFormatted}


${closingParagraph}`;
}

async function generateMetadata(project, theme) {
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (project.status !== 'completed') {
    const err = new Error("Project render not completed");
    err.code = "PROJECT_NOT_COMPLETED";
    throw err;
  }
  
  const absoluteOutputPath = path.resolve(__dirname, '../../../data', (project.output_path || '').replace(/^\//, ''));
  if (!fs.existsSync(absoluteOutputPath)) {
    const err = new Error("Output video missing");
    err.code = "OUTPUT_FILE_NOT_FOUND";
    throw err;
  }

  if (!theme || typeof theme !== 'string' || !theme.trim()) {
    const err = new Error("Theme is required");
    err.code = "THEME_REQUIRED";
    throw err;
  }
  
  const cleanTheme = theme.trim();
  if (cleanTheme.length > 80) {
    const err = new Error("Theme must be at most 80 characters");
    err.code = "THEME_TOO_LONG";
    throw err;
  }

  const durationSeconds = getDurationSeconds(project);
  const expectedDurationSeconds = getExpectedDurationSeconds(project);
  
  const config = {
    focusDurationMinutes: project.focus_duration_minutes,
    breakDurationMinutes: project.break_duration_minutes,
    sessionCount: project.session_count,
    includeFinalBreak: project.include_final_break,
  };

  const { timestamps, elapsedSeconds } = generateTimestamps(config);
  
  if (elapsedSeconds !== expectedDurationSeconds) {
    const err = new Error("Timestamp calculation mismatch");
    err.code = "INVALID_SESSION_CONFIG";
    throw err;
  }

  const timestampsFormatted = timestamps.map(t => `${formatTimestamp(t.seconds)} ${t.label}`).join('\n');
  
  const facts = {
    theme: cleanTheme,
    durationSeconds,
    durationLabel: formatDurationLabel(durationSeconds),
    formatLabel: `${config.focusDurationMinutes}/${config.breakDurationMinutes}`,
    focusDurationMinutes: config.focusDurationMinutes,
    breakDurationMinutes: config.breakDurationMinutes,
    sessionCount: config.sessionCount,
    includeFinalBreak: Boolean(config.includeFinalBreak),
    audioType: getAudioType(project),
  };

  const title = generateTitle(facts);

  let source = 'ollama';
  let description = '';
  let warning = null;
  
  try {
    const { openingParagraph, closingParagraph } = await ollamaService.getYouTubeCopy(facts);
    
    description = `${openingParagraph}

Timestamps:
${timestampsFormatted}


${closingParagraph}`;

  } catch (err) {
    source = 'fallback';
    warning = {
      code: err.code || "OLLAMA_UNAVAILABLE",
      message: err.message || "Local AI was unavailable, so a deterministic fallback description was generated."
    };
    description = buildFallbackDescription(facts, title, timestampsFormatted);
  }

  return {
    projectId: project.id,
    theme: cleanTheme,
    title,
    titleCharacterCount: title.length,
    description,
    timestamps: timestamps.map(t => ({
      seconds: t.seconds,
      formatted: formatTimestamp(t.seconds),
      label: t.label
    })),
    source,
    model: ollamaService.OLLAMA_MODEL,
    generatedAt: new Date().toISOString(),
    warning
  };
}

module.exports = {
  generateMetadata
};
