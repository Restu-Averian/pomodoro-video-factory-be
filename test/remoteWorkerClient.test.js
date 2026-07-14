const test = require('node:test');
const assert = require('node:assert/strict');
const { getRemoteWorkerStatus, submitRemoteRenderJob, getRemoteRenderJob } = require('../src/services/remoteWorkerClient');

test('returns an offline result instead of throwing when the worker cannot be reached', async () => {
  const result = await getRemoteWorkerStatus({
    url: 'http://127.0.0.1:1',
    token: 'test-token',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  });

  assert.deepEqual(result, { online: false, ready: false, error: 'connect ECONNREFUSED' });
});

test('remote render upload failure is reported without exposing the token', async () => {
  const calls = [];
  await assert.rejects(
    submitRemoteRenderJob({
      url: 'http://worker.test',
      token: 'secret-token',
      manifest: { version: 1 },
      files: [],
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/api/status')) return { ok: true, json: async () => ({ renderUploadSupported: true }) };
        return { ok: false, status: 500, text: async () => 'disk full' };
      },
    }),
    /Worker upload failed: 500 disk full/,
  );

  assert.equal(calls[0].url, 'http://worker.test/api/status');
  assert.equal(calls[1].url, 'http://worker.test/api/jobs');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[1].options.duplex, 'half');
});

test('remote render upload stops before streaming when worker lacks 5.9B upload support', async () => {
  const calls = [];
  await assert.rejects(
    submitRemoteRenderJob({
      url: 'http://worker.test',
      token: 'secret-token',
      manifest: { version: 1 },
      files: [{ logicalPath: 'assets/big.mp4', path: '/does/not/matter.mp4' }],
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ ready: true }) };
      },
    }),
    /Remote worker does not support render uploads/,
  );

  assert.deepEqual(calls, ['http://worker.test/api/status']);
});

test('remote render job status maps worker state for frontend progress', async () => {
  const status = await getRemoteRenderJob({
    url: 'http://worker.test',
    token: 'secret-token',
    workerJobId: 'worker-job',
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'worker-job', state: 'rendering', progress: 42, currentStep: 'Rendering segments' }) }),
  });

  assert.equal(status.status, 'rendering');
  assert.equal(status.progress, 42);
  assert.equal(status.currentStep, 'Rendering segments');
});
