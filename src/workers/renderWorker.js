const renderQueue = require("../services/renderQueue");
const renderService = require("../services/renderService");

async function processQueue() {
  if (renderQueue.isProcessing) return;

  const jobId = renderQueue.getNextJob();
  if (!jobId) return;

  renderQueue.isProcessing = true;
  console.log(`Starting execution for job: ${jobId}`);

  try {
    await renderService.executeRender(jobId);
  } catch (err) {
    console.error(`Error in worker processing job ${jobId}:`, err);
  } finally {
    renderQueue.isProcessing = false;
    // Process next job if available
    setTimeout(processQueue, 1000);
  }
}

function startWorker() {
  console.log("Render worker started.");
  setInterval(() => {
    processQueue();
  }, 3000);
}

module.exports = {
  startWorker,
};
