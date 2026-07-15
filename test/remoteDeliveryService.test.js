const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRemoteDeliveryService } = require("../src/services/remoteDeliveryService");

function deps({ downloadImpl, remoteImpl, projectType = "final" } = {}) {
  const jobs = new Map([
    [
      "job-1",
      {
        id: "job-1",
        project_id: "project-1",
        type: projectType,
        status: "rendering",
        progress: 100,
        current_step: "Rendering",
        output_path: "remote:worker-job",
      },
    ],
  ]);
  const projects = new Map([
    ["project-1", { id: "project-1", status: "queued", output_path: null }],
  ]);
  const calls = { downloads: 0, jobUpdates: [], projectUpdates: [] };
  return {
    calls,
    jobsRepo: {
      getJobById: (id) => jobs.get(id),
      setJobCompleted: (id, outputPath) => {
        const job = jobs.get(id);
        Object.assign(job, {
          status: "completed",
          progress: 100,
          current_step: "Completed",
          output_path: outputPath,
          error_message: null,
          completed_at: new Date().toISOString(),
        });
        calls.jobUpdates.push({ id, outputPath });
      },
      updateJobStatus: (id, status, progress, currentStep, outputPath, errorMessage) => {
        Object.assign(jobs.get(id), {
          status,
          progress,
          current_step: currentStep,
          output_path: outputPath,
          error_message: errorMessage,
        });
        calls.jobUpdates.push({ id, status, progress, currentStep, outputPath, errorMessage });
      },
    },
    projectsRepo: {
      getProjectById: (id) => projects.get(id),
      updateProject: (id, update) => {
        Object.assign(projects.get(id), update);
        calls.projectUpdates.push({ id, update });
      },
    },
    getRemoteRenderJob: remoteImpl || (async () => ({
      status: "completed",
      outputFilename: "final-remote.mp4",
      outputPath: "D:\\worker\\outputs\\worker-job\\final-remote.mp4",
    })),
    downloadRemoteJobOutput: async (args) => {
      calls.downloads += 1;
      return downloadImpl(args);
    },
    jobs,
    projects,
  };
}

test("remote delivery stores local public output path only after download succeeds", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-delivery-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const graph = deps({
    downloadImpl: async ({ finalPath }) => {
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.writeFileSync(finalPath, "video");
      return { bytesWritten: 5 };
    },
  });
  const service = createRemoteDeliveryService({ ...graph, dataRoot });

  const delivered = await service.deliverCompletedRemoteJob(graph.jobs.get("job-1"), {
    status: "completed",
    outputFilename: "final-remote.mp4",
    outputPath: "D:\\worker\\outputs\\worker-job\\final-remote.mp4",
  });

  assert.equal(delivered.outputPath, "/outputs/project-1/final-remote.mp4");
  assert.equal(graph.jobs.get("job-1").output_path, "/outputs/project-1/final-remote.mp4");
  assert.equal(graph.projects.get("project-1").output_path, "/outputs/project-1/final-remote.mp4");
  assert.equal(graph.projects.get("project-1").status, "completed");
  assert.equal(graph.calls.downloads, 1);
});

test("failed delivery keeps remote marker and leaves project retryable", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-delivery-fail-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const graph = deps({
    downloadImpl: async () => {
      throw new Error("stream broke");
    },
  });
  const service = createRemoteDeliveryService({ ...graph, dataRoot });

  const result = await service.deliverCompletedRemoteJob(graph.jobs.get("job-1"), {
    status: "completed",
    outputFilename: "final-remote.mp4",
  });

  assert.equal(result.status, "failed");
  assert.equal(graph.jobs.get("job-1").output_path, "remote:worker-job");
  assert.equal(graph.jobs.get("job-1").current_step, "Downloading Result");
  assert.equal(graph.jobs.get("job-1").error_message, "stream broke");
  assert.equal(graph.projects.get("project-1").output_path, null);
  assert.equal(graph.projects.get("project-1").status, "queued");
});

test("repeated delivery polling uses one in-flight download", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-delivery-lock-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  let release;
  const graph = deps({
    downloadImpl: async ({ finalPath }) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.writeFileSync(finalPath, "video");
      return { bytesWritten: 5 };
    },
  });
  const service = createRemoteDeliveryService({ ...graph, dataRoot });
  const first = service.deliverCompletedRemoteJob(graph.jobs.get("job-1"), {
    status: "completed",
    outputFilename: "final-remote.mp4",
  });
  const second = service.deliverCompletedRemoteJob(graph.jobs.get("job-1"), {
    status: "completed",
    outputFilename: "final-remote.mp4",
  });
  release();
  const results = await Promise.all([first, second]);

  assert.equal(graph.calls.downloads, 1);
  assert.deepEqual(results.map((result) => result.outputPath), [
    "/outputs/project-1/final-remote.mp4",
    "/outputs/project-1/final-remote.mp4",
  ]);
});
