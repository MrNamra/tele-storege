const express = require('express');
const fs = require('fs');
const mime = require('mime-types');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { authMiddleware } = require('../middleware/AuthMiddleware');
const { safeDecryptId } = require('../utils/crypto');
const { getUserPhotosBucket, ensureUserPhotosBucket } = require('../utils/photosBucket');

const router = express.Router();

// Lightweight SQLite metadata for favorites (zero media bytes stored locally)
db.exec(`
  CREATE TABLE IF NOT EXISTS "photo_meta" (
    "user_id" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "msg_id" VARCHAR NOT NULL,
    "is_favorite" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("user_id", "bucket_id", "msg_id"),
    FOREIGN KEY("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    FOREIGN KEY("bucket_id") REFERENCES "buckets"("id") ON DELETE CASCADE
  );
`);

const PHOTO_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?|svg)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv|ts|3gp)$/i;

function classifyMedia(file) {
  const mt = String(file.mime_type || '').toLowerCase();
  const name = String(file.file_name || '');
  if (file.type === 'photo' || mt.startsWith('image/') || PHOTO_EXT.test(name)) return 'photo';
  if (file.type === 'video' || mt.startsWith('video/') || VIDEO_EXT.test(name)) return 'video';
  return 'other';
}

router.use(authMiddleware);

// Media timeline reads ONLY from the user's dedicated Photos storage bucket (hidden from Drives, visible in WebDAV & Immich)
router.get('/timeline', async (req, res) => {
  try {
    const userId = req.user.id;
    const view = String(req.query.view || 'all').toLowerCase();
    const search = req.query.q ? String(req.query.q).toLowerCase().trim() : '';
    const includeDocs = req.query.include_docs === '1';
    const limit = Math.max(10, Math.min(100, parseInt(req.query.limit, 10) || 100));

    const photosBucket = getUserPhotosBucket(userId);
    if (!photosBucket) {
      return res.status(200).json({
        status: true,
        data: [],
        photosBucketId: null,
        counts: { total: 0, photos: 0, videos: 0, favorites: 0 },
      });
    }

    const favRows = db
      .prepare('SELECT msg_id FROM photo_meta WHERE user_id = ? AND bucket_id = ? AND is_favorite = 1')
      .all(userId, photosBucket.id);
    const favSet = new Set(favRows.map((r) => String(r.msg_id)));

    const channelData = await telegramService.getChannelFiles(
      photosBucket.channel_id,
      photosBucket.access_hash,
      photosBucket.id,
      1,
      limit
    );

    let items = channelData.files.map((f) => ({
      ...f,
      bucket_id: photosBucket.id,
      bucket_name: photosBucket.bucketName,
      media_kind: classifyMedia(f),
      is_favorite: favSet.has(String(f.msg_id)),
    }));

    // Prepend active background uploads targeting the Photos bucket so new uploads appear immediately
    const activeJobs = db
      .prepare(
        "SELECT * FROM upload_queues WHERE bucket_id = ? AND status IN ('pending', 'processing', 'uploading_to_cloud') ORDER BY id DESC"
      )
      .all(photosBucket.id);

    if (activeJobs.length > 0) {
      const existingNames = new Set(items.map((f) => f.file_name));
      const queued = activeJobs
        .filter((j) => !existingNames.has(j.file_name))
        .map((job) => {
          const mimeType = mime.lookup(job.file_name) || 'application/octet-stream';
          const base = {
            msg_id: `queue_${job.id}`,
            file_name: job.file_name,
            size: job.file_size,
            date: Math.floor(new Date(job.created_at || Date.now()).getTime() / 1000),
            mime_type: mimeType,
            type: mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'photo' : 'document',
            is_queued: true,
            queue_status: job.status,
            queue_progress: job.progress || 0,
            thumbnail: `/t/${photosBucket.id}/queue_${job.id}`,
            stream_url: `/s/${photosBucket.id}/queue_${job.id}`,
            download_url: `/d/${photosBucket.id}/queue_${job.id}`,
            bucket_id: photosBucket.id,
            bucket_name: photosBucket.bucketName,
            is_favorite: false,
          };
          return { ...base, media_kind: classifyMedia(base) };
        });
      items = [...queued, ...items];
    }

    items.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

    const mediaItems = includeDocs ? items : items.filter((i) => i.media_kind === 'photo' || i.media_kind === 'video');

    const counts = {
      total: mediaItems.length,
      photos: mediaItems.filter((i) => i.media_kind === 'photo').length,
      videos: mediaItems.filter((i) => i.media_kind === 'video').length,
      favorites: mediaItems.filter((i) => i.is_favorite).length,
    };

    let filtered = mediaItems;
    if (view === 'photos') {
      filtered = filtered.filter((i) => i.media_kind === 'photo');
    } else if (view === 'videos') {
      filtered = filtered.filter((i) => i.media_kind === 'video');
    } else if (view === 'favorites') {
      filtered = filtered.filter((i) => i.is_favorite);
    }

    if (search) {
      filtered = filtered.filter((i) => i.file_name && i.file_name.toLowerCase().includes(search));
    }

    return res.status(200).json({
      status: true,
      data: filtered,
      photosBucketId: photosBucket.id,
      counts,
    });
  } catch (error) {
    console.error('[Photos] Timeline error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
});

// Returns or creates the user's dedicated hidden Photos bucket (shared with WebDAV & Immich)
router.post('/ensure-default-bucket', async (req, res) => {
  try {
    const bucket = await ensureUserPhotosBucket(req.user.id, req.user.name || req.user.email);
    return res.status(200).json({
      status: true,
      bucket: { id: bucket.id, bucketName: bucket.bucketName, kind: bucket.kind, created_at: bucket.created_at },
    });
  } catch (error) {
    console.error('[Photos] Ensure bucket error:', error);
    return res.status(503).json({ status: false, message: 'Photos library initialization failed: ' + error.message });
  }
});

// Toggle or set favorite flag in SQLite
router.post('/favorite', (req, res) => {
  try {
    const userId = req.user.id;
    const { bucket_id, msg_id, is_favorite } = req.body || {};

    if (!bucket_id || !msg_id) {
      return res.status(422).json({ status: false, message: 'bucket_id and msg_id are required.' });
    }

    const bucket = db
      .prepare("SELECT id FROM buckets WHERE id = ? AND user_id = ? AND kind = 'photos'")
      .get(bucket_id, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Photos library not found.' });
    }

    const current = db
      .prepare('SELECT is_favorite FROM photo_meta WHERE user_id = ? AND bucket_id = ? AND msg_id = ?')
      .get(userId, bucket.id, String(msg_id));

    const nextFav = typeof is_favorite === 'boolean' ? (is_favorite ? 1 : 0) : current?.is_favorite ? 0 : 1;

    db.prepare(
      `INSERT INTO photo_meta (user_id, bucket_id, msg_id, is_favorite, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, bucket_id, msg_id)
       DO UPDATE SET is_favorite = excluded.is_favorite, updated_at = CURRENT_TIMESTAMP`
    ).run(userId, bucket.id, String(msg_id), nextFav);

    return res.status(200).json({ status: true, is_favorite: Boolean(nextFav) });
  } catch (error) {
    console.error('[Photos] Favorite error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
});

// Bulk delete photos/videos from the user's dedicated Photos bucket
router.post('/delete', async (req, res) => {
  try {
    const userId = req.user.id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(422).json({ status: false, message: 'items array is required.' });
    }

    const bucket = getUserPhotosBucket(userId);
    if (!bucket) {
      return res.status(200).json({ status: true, deleted: 0 });
    }

    const msgIds = [];
    let deletedCount = 0;

    for (const item of items) {
      if (!item?.msg_id || String(item.bucket_id) !== String(bucket.id)) continue;
      const rawId = String(item.msg_id);
      if (rawId.startsWith('queue_')) {
        const qId = parseInt(rawId.replace('queue_', ''), 10);
        const job = db.prepare('SELECT * FROM upload_queues WHERE id = ? AND bucket_id = ?').get(qId, bucket.id);
        if (job) {
          db.prepare("UPDATE upload_queues SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
          try { if (fs.existsSync(job.file_path)) fs.unlinkSync(job.file_path); } catch (_) {}
          deletedCount++;
        }
      } else {
        const dec = safeDecryptId(rawId, bucket.id) || (isFinite(rawId) ? parseInt(rawId, 10) : null);
        if (dec && dec > 0) msgIds.push(dec);
        db.prepare('DELETE FROM photo_meta WHERE user_id = ? AND bucket_id = ? AND msg_id = ?').run(userId, bucket.id, rawId);
      }
    }

    if (msgIds.length > 0) {
      await telegramService.deleteMessages(bucket.channel_id, bucket.access_hash, msgIds);
      deletedCount += msgIds.length;
    }

    return res.status(200).json({ status: true, deleted: deletedCount });
  } catch (error) {
    console.error('[Photos] Delete error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
});

module.exports = router;
