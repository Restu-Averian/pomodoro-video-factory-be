const express = require('express');
const { getRemoteWorkerStatus } = require('../services/remoteWorkerClient');

const router = express.Router();

router.get('/render-worker/status', async (_req, res) => {
  res.json(await getRemoteWorkerStatus());
});

module.exports = router;
