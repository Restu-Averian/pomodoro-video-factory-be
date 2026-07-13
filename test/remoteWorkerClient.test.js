const test = require('node:test');
const assert = require('node:assert/strict');
const { getRemoteWorkerStatus } = require('../src/services/remoteWorkerClient');

test('returns an offline result instead of throwing when the worker cannot be reached', async () => {
  const result = await getRemoteWorkerStatus({
    url: 'http://127.0.0.1:1',
    token: 'test-token',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  });

  assert.deepEqual(result, { online: false, ready: false, error: 'connect ECONNREFUSED' });
});
