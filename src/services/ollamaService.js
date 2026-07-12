const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || "rafw007/qwen35-claude-coder:9b";
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 120000;
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "10m";

async function fetchWithTimeout(url, options = {}) {
  const { timeout = OLLAMA_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);
  return response;
}

async function checkHealth() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 5000,
    });
    if (!res.ok) {
      return { reachable: false, modelInstalled: false, model: OLLAMA_MODEL };
    }
    const data = await res.json();
    const modelInstalled = data.models?.some((m) => m.name === OLLAMA_MODEL);
    return {
      reachable: true,
      modelInstalled: !!modelInstalled,
      model: OLLAMA_MODEL,
    };
  } catch (err) {
    return { reachable: false, modelInstalled: false, model: OLLAMA_MODEL };
  }
}

async function generateParagraphs(facts, formatType = "object") {
  const systemPrompt = `You write concise English YouTube description copy for a cozy
Pomodoro focus channel named Niititu.

Return valid JSON only with exactly two string fields:
openingParagraph and closingParagraph.

Do not generate a title.
Do not generate timestamps.
Do not change provided facts.
Do not add hashtags, links, emojis, Markdown headings,
scientific claims, medical claims, or calls to subscribe.

The opening paragraph must be 45–85 words.
The closing paragraph must be 20–45 words.
Use a natural, calming, non-repetitive tone.`;

  const userContent = `Theme: ${facts.theme}
Duration label: ${facts.durationLabel}
Pomodoro format: ${facts.formatLabel}
Focus minutes: ${facts.focusDurationMinutes}
Break minutes: ${facts.breakDurationMinutes}
Session count: ${facts.sessionCount}
Final break included: ${facts.includeFinalBreak ? "yes" : "no"}
Audio type: ${facts.audioType}
Brand: Niititu`;

  const format =
    formatType === "object"
      ? {
          type: "object",
          properties: {
            openingParagraph: { type: "string" },
            closingParagraph: { type: "string" },
          },
          required: ["openingParagraph", "closingParagraph"],
        }
      : "json";

  const payload = {
    model: OLLAMA_MODEL,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    format,
    options: {
      temperature: 0.4,
      top_p: 0.9,
    },
  };

  const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const messageContent = data.message?.content || "";
  return messageContent;
}

function parseAndValidate(jsonString) {
  let parsed;
  try {
    let cleanString = jsonString.trim();
    if (cleanString.startsWith("\`\`\`json")) {
      cleanString = cleanString.substring(7);
    }
    if (cleanString.startsWith("\`\`\`")) {
      cleanString = cleanString.substring(3);
    }
    if (cleanString.endsWith("\`\`\`")) {
      cleanString = cleanString.substring(0, cleanString.length - 3);
    }
    parsed = JSON.parse(cleanString.trim());
  } catch (err) {
    throw new Error("MALFORMED_JSON");
  }

  if (
    typeof parsed.openingParagraph !== "string" ||
    !parsed.openingParagraph.trim()
  ) {
    throw new Error("INVALID_OPENING_PARAGRAPH");
  }
  if (
    typeof parsed.closingParagraph !== "string" ||
    !parsed.closingParagraph.trim()
  ) {
    throw new Error("INVALID_CLOSING_PARAGRAPH");
  }

  if (
    parsed.openingParagraph.includes("http") ||
    parsed.closingParagraph.includes("http")
  ) {
    throw new Error("CONTAINS_LINKS");
  }

  return {
    openingParagraph: parsed.openingParagraph.trim(),
    closingParagraph: parsed.closingParagraph.trim(),
  };
}

async function getYouTubeCopy(facts) {
  // Check health first to provide targeted errors
  const health = await checkHealth();
  if (!health.reachable) {
    const err = new Error("The local Ollama model is unreachable.");
    err.code = "OLLAMA_UNREACHABLE";
    throw err;
  }
  if (!health.modelInstalled) {
    const err = new Error(
      `The local Ollama model ${OLLAMA_MODEL} is not installed. Run: ollama pull ${OLLAMA_MODEL}`,
    );
    err.code = "OLLAMA_MODEL_NOT_FOUND";
    throw err;
  }

  try {
    const content = await generateParagraphs(facts, "object");
    return parseAndValidate(content);
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error("Ollama request timed out");
      timeoutErr.code = "OLLAMA_TIMEOUT";
      throw timeoutErr;
    }

    // Retry once with "json" format
    console.warn("First Ollama attempt failed, retrying...", err.message);
    try {
      const contentRetry = await generateParagraphs(facts, "json");
      return parseAndValidate(contentRetry);
    } catch (retryErr) {
      const finalErr = new Error("Failed to generate valid JSON from Ollama");
      finalErr.code = "OLLAMA_INVALID_RESPONSE";
      throw finalErr;
    }
  }
}

module.exports = {
  checkHealth,
  getYouTubeCopy,
  OLLAMA_MODEL,
};
