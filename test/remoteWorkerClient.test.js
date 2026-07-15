const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getRemoteWorkerStatus,
  submitRemoteRenderJob,
  getRemoteRenderJob,
  downloadRemoteJobOutput,
} = require("../src/services/remoteWorkerClient");

function webStreamFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

test("returns an offline result instead of throwing when the worker cannot be reached", async () => {
  const result = await getRemoteWorkerStatus({
    url: "http://127.0.0.1:1",
    token: "test-token",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.deepEqual(result, {
    online: false,
    ready: false,
    error: "connect ECONNREFUSED",
  });
});

test("remote render upload failure is reported without exposing the token", async () => {
  const calls = [];
  await assert.rejects(
    submitRemoteRenderJob({
      url: "http://worker.test",
      token: "secret-token",
      manifest: { version: 1 },
      files: [],
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/api/status"))
          return {
            ok: true,
            json: async () => ({ renderUploadSupported: true }),
          };
        return { ok: false, status: 500, text: async () => "disk full" };
      },
    }),
    /Worker upload failed: 500 disk full/,
  );

  assert.equal(calls[0].url, "http://worker.test/api/status");
  assert.equal(calls[1].url, "http://worker.test/api/jobs");
  assert.equal(calls[1].options.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[1].options.duplex, undefined);
});

test("remote render upload stops before streaming when worker lacks 5.9B upload support", async () => {
  const calls = [];
  await assert.rejects(
    submitRemoteRenderJob({
      url: "http://worker.test",
      token: "secret-token",
      manifest: { version: 1 },
      files: [{ logicalPath: "assets/big.mp4", path: "/does/not/matter.mp4" }],
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ ready: true }) };
      },
    }),
    /Remote worker does not support render uploads/,
  );

  assert.deepEqual(calls, ["http://worker.test/api/status"]);
});

test("remote render upload uses native FormData with stable asset fields", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-client-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const focusPath = path.join(dir, "focus.mp4");
  fs.writeFileSync(focusPath, "focus");

  const calls = [];
  await submitRemoteRenderJob({
    url: "http://worker.test",
    token: "secret-token",
    manifest: { version: 1 },
    files: [{ logicalPath: "assets/focus-video.mp4", path: focusPath }],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/status"))
        return {
          ok: true,
          json: async () => ({ renderUploadSupported: true }),
        };
      return {
        ok: true,
        json: async () => ({ id: "worker-job", state: "queued" }),
      };
    },
  });

  const body = calls[1].options.body;
  assert.equal(body.constructor.name, "FormData");
  assert.equal(calls[1].options.headers["Content-Type"], undefined);
  assert.equal(calls[1].options.duplex, undefined);
  assert.deepEqual([...body.keys()], ["manifest", "assets"]);
});

test("remote render job status maps worker state for frontend progress", async () => {
  const status = await getRemoteRenderJob({
    url: "http://worker.test",
    token: "secret-token",
    workerJobId: "worker-job",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: "worker-job",
        state: "rendering",
        progress: 42,
        currentStep: "Rendering segments",
      }),
    }),
  });

  assert.equal(status.status, "rendering");
  assert.equal(status.progress, 42);
  assert.equal(status.currentStep, "Rendering segments");
});

test("completed remote output downloads by stream to a part file then renames", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-download-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const finalPath = path.join(dir, "final.mp4");
  let requestedUrl = null;

  const result = await downloadRemoteJobOutput({
    url: "http://worker.test/",
    token: "secret-token",
    workerJobId: "worker-job",
    finalPath,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.headers.Authorization, "Bearer secret-token");
      return new Response(webStreamFrom(["remote-video"]), {
        status: 200,
        headers: { "Content-Length": String(Buffer.byteLength("remote-video")) },
      });
    },
  });

  assert.equal(requestedUrl, "http://worker.test/api/jobs/worker-job/output");
  assert.equal(result.bytesWritten, Buffer.byteLength("remote-video"));
  assert.equal(fs.readFileSync(finalPath, "utf8"), "remote-video");
  assert.equal(fs.existsSync(`${finalPath}.part`), false);
});

test("failed remote output download removes partial file and is retryable", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "niititu-download-fail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const finalPath = path.join(dir, "final.mp4");

  await assert.rejects(
    downloadRemoteJobOutput({
      url: "http://worker.test",
      token: "secret-token",
      workerJobId: "worker-job",
      finalPath,
      fetchImpl: async () => new Response(webStreamFrom(["short"]), {
        status: 200,
        headers: { "Content-Length": "99" },
      }),
    }),
    /Downloaded size mismatch/,
  );

  assert.equal(fs.existsSync(finalPath), false);
  assert.equal(fs.existsSync(`${finalPath}.part`), false);
});
