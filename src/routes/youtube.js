const express = require('express');
const router = express.Router();
const youtubeService = require('../services/youtubeService');
const youtubeRepo = require('../db/youtubeRepo');

router.get('/auth/url', (req, res) => {
  try {
    const url = youtubeService.getAuthUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing code');
  }
  try {
    await youtubeService.handleCallback(code);
    res.send('<script>window.close();</script>Successfully connected YouTube account. You can close this window.');
  } catch (error) {
    res.status(500).send('Error connecting YouTube account: ' + error.message);
  }
});

router.get('/accounts', (req, res) => {
  try {
    const account = youtubeRepo.getAccount();
    if (account) {
      // Don't send tokens to frontend
      res.json({
        id: account.id,
        name: account.name,
        channel_id: account.channel_id,
        connected: true
      });
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

module.exports = router;
