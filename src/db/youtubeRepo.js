const db = require('./client');

function saveAccount(account) {
  const stmt = db.prepare(`
    INSERT INTO youtube_accounts (id, name, channel_id, access_token, refresh_token, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      channel_id = excluded.channel_id,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, youtube_accounts.refresh_token),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    account.id,
    account.name,
    account.channel_id,
    account.access_token,
    account.refresh_token || null
  );
}

function getAccount(id = 'default') {
  return db.prepare('SELECT * FROM youtube_accounts WHERE id = ?').get(id);
}

module.exports = {
  saveAccount,
  getAccount
};
