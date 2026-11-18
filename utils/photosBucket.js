const db = require('../config/db');
const telegramService = require('../services/telegramService');

const pendingByUser = new Map();

function getUserPhotosBucket(userId) {
  return db
    .prepare("SELECT * FROM buckets WHERE user_id = ? AND kind = 'photos' ORDER BY id ASC LIMIT 1")
    .get(userId);
}

/**
 * Returns (or creates) the single dedicated private Photos bucket for a user.
 * Shared across the built-in Photos UI, WebDAV (/webdav/Photos), and the Immich bridge.
 * Hidden from normal Drives lists and does not consume drive quota.
 */
async function ensureUserPhotosBucket(userId, displayNameHint = '') {
  const existing = getUserPhotosBucket(userId);
  if (existing) return existing;

  const lockKey = String(userId);
  if (pendingByUser.has(lockKey)) {
    return pendingByUser.get(lockKey);
  }

  const promise = (async () => {
    const recheck = getUserPhotosBucket(userId);
    if (recheck) return recheck;

    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    const label = (displayNameHint && displayNameHint.trim()) || user.name || user.email || `User ${user.id}`;
    const channel = await telegramService.createPrivateChannel(`Photos - ${label}`);
    if (!channel || !channel.channel_id) {
      throw new Error('Failed to initialize private photos storage.');
    }

    const inserted = db
      .prepare(
        `INSERT INTO buckets (user_id, bucketName, channel_id, access_hash, kind, created_at, updated_at)
         VALUES (?, 'Photos', ?, ?, 'photos', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(user.id, channel.channel_id, channel.access_hash);

    return db.prepare('SELECT * FROM buckets WHERE id = ?').get(inserted.lastInsertRowid);
  })();

  pendingByUser.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    pendingByUser.delete(lockKey);
  }
}

module.exports = {
  getUserPhotosBucket,
  ensureUserPhotosBucket,
};
