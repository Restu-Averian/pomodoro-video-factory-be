const { google } = require('googleapis');
const fs = require('fs');
const youtubeRepo = require('../db/youtubeRepo');
const uploadJobsRepo = require('../db/uploadJobsRepo');
const projectsRepo = require('../db/projectsRepo');

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

function getAuthUrl() {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
  ];
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force to get refresh token
  });
}

async function handleCallback(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const channelRes = await youtube.channels.list({
    part: 'snippet',
    mine: true
  });

  const channel = channelRes.data.items[0];
  const accountId = 'default';

  youtubeRepo.saveAccount({
    id: accountId,
    name: channel.snippet.title,
    channel_id: channel.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token
  });
}

async function getClient() {
  const account = youtubeRepo.getAccount();
  if (!account) {
    throw new Error('YouTube account not connected');
  }

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token
  });

  // Handle token refresh automatically if configured
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      account.refresh_token = tokens.refresh_token;
    }
    account.access_token = tokens.access_token;
    youtubeRepo.saveAccount(account);
  });

  return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function uploadVideo(jobId) {
  try {
    const job = uploadJobsRepo.getJob(jobId);
    if (!job) throw new Error('Job not found');

    const project = projectsRepo.getProject(job.project_id);
    if (!project) throw new Error('Project not found');

    if (!fs.existsSync(project.output_path)) {
      throw new Error('Video file not found');
    }

    uploadJobsRepo.updateJobStatus(jobId, 'uploading');

    const youtube = await getClient();

    const tags = job.tags_json ? JSON.parse(job.tags_json) : [];

    const requestBody = {
      snippet: {
        title: job.title,
        description: job.description,
        tags: tags
      },
      status: {
        privacyStatus: job.privacy_status,
        madeForKids: false, // Following defaults
        selfDeclaredMadeForKids: false
      }
    };

    if (job.scheduled_at) {
      requestBody.status.publishAt = job.scheduled_at;
      // Note: to use publishAt, privacyStatus must be private until publishAt
      requestBody.status.privacyStatus = 'private';
    }

    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody,
      media: {
        body: fs.createReadStream(project.output_path)
      }
    });

    uploadJobsRepo.updateJobStatus(jobId, job.scheduled_at ? 'scheduled' : 'uploaded', {
      youtube_video_id: res.data.id
    });

  } catch (error) {
    console.error('YouTube Upload Error:', error);
    uploadJobsRepo.updateJobStatus(jobId, 'failed', {
      error_message: error.message || 'Unknown error during upload'
    });
  }
}

module.exports = {
  getAuthUrl,
  handleCallback,
  uploadVideo
};
