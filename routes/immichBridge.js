const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { getTmpDir, safeMkdirSync } = require('../utils/storagePaths');
const { safeEncryptId, safeDecryptId } = require('../utils/crypto');
const { ensureUserPhotosBucket } = require('../utils/photosBucket');

const router = express.Router();

// Dedicated mapping table: 1 Immich user -> 1 tele-storege user + 1 private Telegram channel bucket
db.exec(`
  CREATE TABLE IF NOT EXISTS "immich_user_buckets" (
    "immich_user_id" VARCHAR PRIMARY KEY NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    FOREIGN KEY("bucket_id") REFERENCES "buckets"("id") ON DELETE CASCADE
  );
`);

const pendingBuckets = new Map();

function requireImmichSecret(req, res, next) {
  const expected = process.env.IMMICH_BRIDGE_SECRET;
  if (!expected) {
    return res.status(503).json({ status: false, message: 'IMMICH_BRIDGE_SECRET is not configured on tele-storage.' });
  }

  const provided = String(req.headers['x-immich-secret'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ status: false, message: 'Invalid Immich bridge secret.' });
  }

  next();
}

async function ensureImmichUserBucket(immichUserId, ownerEmail, ownerName) {
  const existing = db
    .prepare(
      `SELECT b.* FROM immich_user_buckets m
       JOIN buckets b ON b.id = m.bucket_id
       WHERE m.immich_user_id = ?`
    )
    .get(immichUserId);
  if (existing) return existing;

  // Serialize concurrent first-time uploads for the same Immich user so we only create 1 Telegram channel
  if (pendingBuckets.has(immichUserId)) {
    return pendingBuckets.get(immichUserId);
  }

  const promise = (async () => {
    const email = (ownerEmail && ownerEmail.trim().toLowerCase()) || `immich_${immichUserId}@immich.local`;
    const displayName = (ownerName && ownerName.trim()) || email.split('@')[0] || `user_${immichUserId.slice(0, 8)}`;

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      const randomPass = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
      const inserted = db
        .prepare(
          `INSERT INTO users (name, email, password, role, bucketAllowed, status, created_at, updated_at)
           VALUES (?, ?, ?, 'user', 5, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(displayName, email, randomPass);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
    }

    // Share the user's single dedicated hidden Photos bucket across Immich, /photos UI, and /webdav/Photos
    const bucket = await ensureUserPhotosBucket(user.id, displayName);

    db.prepare(
      `INSERT OR REPLACE INTO immich_user_buckets (immich_user_id, user_id, bucket_id, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(immichUserId, user.id, bucket.id);

    return bucket;
  })();

  pendingBuckets.set(immichUserId, promise);
  try {
    return await promise;
  } finally {
    pendingBuckets.delete(immichUserId);
  }
}

router.use(requireImmichSecret);

// Stream-upload an original file directly into the Immich user's dedicated Telegram channel
router.post('/upload', async (req, res) => {
  const ownerId = String(req.headers['x-owner-id'] || '').trim();
  const ownerEmail = decodeURIComponent(String(req.headers['x-owner-email'] || ''));
  const ownerName = decodeURIComponent(String(req.headers['x-owner-name'] || ''));
  const rawFileName = decodeURIComponent(String(req.headers['x-file-name'] || 'asset.bin'));

  if (!ownerId) {
    return res.status(422).json({ status: false, message: 'x-owner-id header is required.' });
  }

  const safeName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset.bin';
  const tmpDir = getTmpDir();
  safeMkdirSync(tmpDir);
  const tmpPath = path.join(tmpDir, `immich-${crypto.randomUUID()}-${safeName}`);

  try {
    // Stream raw request body straight to temp disk so 2GB videos don't spike RAM
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });

    const stats = fs.statSync(tmpPath);
    if (stats.size === 0) {
      return res.status(422).json({ status: false, message: 'Uploaded file is empty.' });
    }

    const bucket = await ensureImmichUserBucket(ownerId, ownerEmail, ownerName);
    const uploadRes = await telegramService.uploadFileToChannel(
      bucket.channel_id,
      bucket.access_hash,
      tmpPath,
      path.basename(rawFileName)
    );

    if (!uploadRes || !uploadRes.id) {
      throw new Error('Cloud storage upload did not return a file ID.');
    }

    return res.status(200).json({
      status: true,
      bucketId: String(bucket.id),
      msgId: safeEncryptId(uploadRes.id, bucket.id),
    });
  } catch (err) {
    console.error('[Immich Bridge] Upload error:', err);
    return res.status(500).json({ status: false, message: err.message || 'Upload failed' });
  } finally {
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
});

// Stream or download an offloaded asset back to Immich (supports HTTP 206 Byte Range seeking)
router.all('/stream/:bucketId/:msgId', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).end();
  }

  try {
    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(req.params.bucketId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    const msgId = safeDecryptId(req.params.msgId, bucket.id);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid file ID.' });
    }

    const isDownload = req.query.dl === '1' || req.query.download === 'true';
    return await telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, isDownload);
  } catch (err) {
    console.error('[Immich Bridge] Stream error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: err.message || 'Stream failed' });
    }
  }
});

// Delete an offloaded file from Telegram when permanently deleted in Immich
router.delete('/file/:bucketId/:msgId', async (req, res) => {
  try {
    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(req.params.bucketId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    const msgId = safeDecryptId(req.params.msgId, bucket.id);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid file ID.' });
    }

    await telegramService.deleteMessages(bucket.channel_id, bucket.access_hash, [msgId]);
    return res.status(200).json({ status: true });
  } catch (err) {
    console.error('[Immich Bridge] Delete error:', err);
    return res.status(500).json({ status: false, message: err.message || 'Delete failed' });
  }
});

module.exports = router;
module.exports.ensureImmichUserBucket = ensureImmichUserBucket;
