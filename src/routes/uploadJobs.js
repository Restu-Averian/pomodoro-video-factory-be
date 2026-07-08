const express = require('express');
const router = express.Router();
const uploadJobsRepo = require('../db/uploadJobsRepo');

router.get('/:id', (req, res) => {
  try {
    const job = uploadJobsRepo.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { message: 'Upload job not found' } });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

module.exports = router;
