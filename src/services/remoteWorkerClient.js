const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const REQUEST_TIMEOUT_MS = 5000;
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

async function requestJson(url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Worker returned ${response.status}`);
    return response.json();
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("Worker request timed out");
    if (error.message === "fetch failed") {
      const cause = error.cause
        ? error.cause.code || error.cause.message
        : "network error";
      throw new Error(`Remote worker offline: ${cause}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function multipartStream({ boundary, manifest, files }) {
  async function* parts() {
    yield `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(manifest)}\r\n`;
    for (const file of files) {
      yield `--${boundary}\r\nContent-Disposition: form-data; name="${file.logicalPath}"; filename="${path.basename(file.logicalPath)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      yield* fs.createReadStream(file.path);
      yield "\r\n";
    }
    yield `--${boundary}--\r\n`;
  }
  return Readable.from(parts());
}

async function submitRemoteRenderJob({
  url = process.env.REMOTE_WORKER_URL,
  token = process.env.REMOTE_WORKER_API_TOKEN,
  manifest,
  files,
  fetchImpl = fetch,
} = {}) {
  if (!url || !token) throw new Error("Remote worker is not configured");
  const baseUrl = url.replace(/\/$/, "");
  const status = await requestJson(
    `${baseUrl}/api/status`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchImpl,
  );
  if (status.renderUploadSupported !== true) {
    throw new Error(
      "Remote worker does not support render uploads. Deploy Phase 5.9B worker and restart it.",
    );
  }
  const boundary = `niititu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/api/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartStream({ boundary, manifest, files }),
      duplex: "half",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Worker upload failed: ${response.status} ${await response.text()}`,
      );
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Worker upload timed out");
    if (error.message === "fetch failed") {
      const cause = error.cause
        ? error.cause.code || error.cause.message
        : "network error";
      if (cause === "EPIPE" || cause === "ECONNRESET") {
        throw new Error(
          `Upload rejected by worker (Check worker logs/token): ${cause}`,
        );
      }
      throw new Error(`Remote worker offline: ${cause}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapWorkerJob(job) {
  const stateMap = {
    receiving: "queued",
    queued: "queued",
    rendering: "rendering",
    completed: "completed",
    failed: "failed",
    cancelled: "failed",
    interrupted: "failed",
  };
  return {
    id: job.id,
    status: stateMap[job.state] || "queued",
    progress: Number(job.progress || 0),
    currentStep: job.currentStep || job.current_step || job.state,
    currentTimeSeconds: job.currentTimeSeconds,
    outputPath: job.outputPath || null,
    errorMessage: job.errorMessage || null,
  };
}

async function getRemoteRenderJob({
  url = process.env.REMOTE_WORKER_URL,
  token = process.env.REMOTE_WORKER_API_TOKEN,
  workerJobId,
  fetchImpl = fetch,
} = {}) {
  if (!url || !token) throw new Error("Remote worker is not configured");
  const job = await requestJson(
    `${url.replace(/\/$/, "")}/api/jobs/${workerJobId}`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchImpl,
  );
  return mapWorkerJob(job);
}

async function getRemoteWorkerStatus({
  url = process.env.REMOTE_WORKER_URL,
  token = process.env.REMOTE_WORKER_API_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!url || !token)
    return {
      online: false,
      ready: false,
      error: "Remote worker is not configured",
    };
  try {
    const baseUrl = url.replace(/\/$/, "");
    const health = await requestJson(`${baseUrl}/health`, {}, fetchImpl);
    const status = await requestJson(
      `${baseUrl}/api/status`,
      { headers: { Authorization: `Bearer ${token}` } },
      fetchImpl,
    );
    return {
      online: health.ok === true,
      ready: status.ready === true,
      ffmpegAvailable: health.ffmpegAvailable === true,
      ffprobeAvailable: health.ffprobeAvailable === true,
      activeJobId: status.activeJobId || null,
      queuedJobCount: status.queuedJobCount || 0,
      renderUploadSupported: status.renderUploadSupported === true,
    };
  } catch (error) {
    return {
      online: false,
      ready: false,
      error:
        error.name === "AbortError"
          ? "Worker request timed out"
          : error.message,
    };
  }
}

module.exports = {
  getRemoteWorkerStatus,
  submitRemoteRenderJob,
  getRemoteRenderJob,
  mapWorkerJob,
};
