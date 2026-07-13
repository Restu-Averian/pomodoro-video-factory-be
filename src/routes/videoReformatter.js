const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const ffmpegService = require('../services/ffmpegService');

const TEMP_BASE = path.join(__dirname, '../../../data/temp/video-reformatter');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const jobId = uuidv4();
    const jobDir = path.join(TEMP_BASE, jobId);
    try {
      await fs.mkdir(jobDir, { recursive: true });
      req.jobDir = jobDir;
      req.jobId = jobId;
      cb(null, jobDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `input${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

router.post('/', upload.single('video'), async (req, res) => {
  const jobDir = req.jobDir;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const {
      zoom = 1.0,
      x = 0,
      y = 0,
      topBar = 0,
      bottomBar = 0
    } = req.body;

    const inputPath = req.file.path;
    const outputPath = path.join(jobDir, 'output.mp4');

    const params = {
      zoom: parseFloat(zoom),
      x: parseInt(x, 10),
      y: parseInt(y, 10),
      topBar: parseInt(topBar, 10),
      bottomBar: parseInt(bottomBar, 10)
    };

    if (isNaN(params.zoom) || isNaN(params.x) || isNaN(params.y) || isNaN(params.topBar) || isNaN(params.bottomBar)) {
      throw new Error('Invalid numeric parameters provided');
    }

    await ffmpegService.reformatVideo(inputPath, outputPath, params);

    res.download(outputPath, 'reformatted.mp4', async (err) => {
      if (err) {
        console.error(`Error sending file for job ${req.jobId}:`, err);
      }
      try {
        await fs.rm(jobDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`Failed to cleanup temp dir ${jobDir}:`, cleanupErr);
      }
    });

  } catch (error) {
    console.error('Error in video reformatter:', error);
    
    if (jobDir) {
      try {
        await fs.rm(jobDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`Failed to cleanup temp dir ${jobDir}:`, cleanupErr);
      }
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'An error occurred during video processing' });
    }
  }
});

module.exports = router;
