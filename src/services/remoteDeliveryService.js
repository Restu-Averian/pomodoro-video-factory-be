const fs = require("node:fs");
const path = require("node:path");
const jobsRepoDefault = require("../db/jobsRepo");
const projectsRepoDefault = require("../db/projectsRepo");
const {
  downloadRemoteJobOutput: downloadRemoteJobOutputDefault,
} = require("./remoteWorkerClient");

const remoteMarker = (job) =>
  job?.output_path?.startsWith("remote:")
    ? job.output_path.slice("remote:".length)
    : null;

function safeMp4Filename(remote) {
  const filename = path.basename(
    remote.outputFilename || remote.outputPath || "final.mp4",
  );
  if (!/^[A-Za-z0-9._ -]+\.mp4$/i.test(filename))
    throw new Error("Remote output filename is invalid");
  return filename;
}

function publicOutputPath(projectId, filename) {
  return `/outputs/${projectId}/${filename}`;
}

function localOutputPath(dataRoot, projectId, filename) {
  return path.resolve(dataRoot, "outputs", projectId, filename);
}

function validLocalFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (_) {
    return false;
  }
}

function createRemoteDeliveryService({
  jobsRepo = jobsRepoDefault,
  projectsRepo = projectsRepoDefault,
  downloadRemoteJobOutput = downloadRemoteJobOutputDefault,
  dataRoot = path.resolve(__dirname, "../../../data"),
} = {}) {
  const locks = new Map();

  async function deliverCompletedRemoteJob(job, remote) {
    const workerJobId = remoteMarker(job);
    if (!workerJobId) return { status: "ignored" };
    if (locks.has(job.id)) return locks.get(job.id);

    const promise = (async () => {
      const filename = safeMp4Filename(remote);
      const finalPath = localOutputPath(dataRoot, job.project_id, filename);
      const outputPath = publicOutputPath(job.project_id, filename);

      try {
        jobsRepo.updateJobStatus(
          job.id,
          "rendering",
          99,
          "Downloading Result",
          job.output_path,
          null,
        );
        if (!validLocalFile(finalPath)) {
          await downloadRemoteJobOutput({ workerJobId, finalPath });
        }
        if (!validLocalFile(finalPath))
          throw new Error("Downloaded output is missing from local storage");

        jobsRepo.setJobCompleted(job.id, outputPath);
        if (job.type === "preview") {
          projectsRepo.updateProject(job.project_id, {
            status: "draft",
            preview_path: outputPath,
            error_message: null,
          });
        } else {
          const stats = fs.statSync(finalPath);
          projectsRepo.updateProject(job.project_id, {
            status: "completed",
            output_path: outputPath,
            output_size_bytes: stats.size,
            error_message: null,
          });
        }
        return { status: "completed", outputPath, finalPath };
      } catch (error) {
        jobsRepo.updateJobStatus(
          job.id,
          "rendering",
          99,
          "Downloading Result",
          job.output_path,
          error.message,
        );
        projectsRepo.updateProject(job.project_id, {
          error_message: error.message,
        });
        return { status: "failed", errorMessage: error.message };
      }
    })();

    locks.set(job.id, promise);
    try {
      return await promise;
    } finally {
      locks.delete(job.id);
    }
  }

  return { deliverCompletedRemoteJob };
}

module.exports = {
  createRemoteDeliveryService,
  remoteMarker,
  safeMp4Filename,
};
