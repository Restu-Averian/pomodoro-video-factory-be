const renderService = require("./renderService");

class RenderQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  addJob(jobId) {
    this.queue.push(jobId);
    console.log(`Job ${jobId} added to queue. Position: ${this.queue.length}`);
  }

  getNextJob() {
    return this.queue.shift();
  }

  get queueLength() {
    return this.queue.length;
  }
}

const queueInstance = new RenderQueue();
module.exports = queueInstance;
