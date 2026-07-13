const REQUEST_TIMEOUT_MS = 5000;

async function requestJson(url, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Worker returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getRemoteWorkerStatus({ url = process.env.REMOTE_WORKER_URL, token = process.env.REMOTE_WORKER_API_TOKEN, fetchImpl = fetch } = {}) {
  if (!url || !token) return { online: false, ready: false, error: 'Remote worker is not configured' };
  try {
    const baseUrl = url.replace(/\/$/, '');
    const health = await requestJson(`${baseUrl}/health`, {}, fetchImpl);
    const status = await requestJson(`${baseUrl}/api/status`, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    return { online: health.ok === true, ready: status.ready === true, ffmpegAvailable: health.ffmpegAvailable === true, ffprobeAvailable: health.ffprobeAvailable === true, activeJobId: status.activeJobId || null, queuedJobCount: status.queuedJobCount || 0 };
  } catch (error) {
    return { online: false, ready: false, error: error.name === 'AbortError' ? 'Worker request timed out' : error.message };
  }
}

module.exports = { getRemoteWorkerStatus };
