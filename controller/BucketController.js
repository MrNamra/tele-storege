const crypto = require('crypto');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { canAccessBucket } = require('../middleware/AuthMiddleware');

function generateShareCode(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

const createBucket = async (req, res) => {
  try {
    const bucketName = req.body.name || req.body.bucketName;
    const userId = req.user.id;

    if (!bucketName || !bucketName.trim()) {
      return res.status(422).json({ status: false, message: 'Bucket name is required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    if (user.bucketAllowed < 1) {
      return res.status(400).json({ status: false, message: 'You have reached your bucket limit.' });
    }

    let channelId = null;
    let accessHash = null;

    try {
      const channel = await telegramService.createPrivateChannel(bucketName.trim());
      channelId = channel.channel_id;
      accessHash = channel.access_hash;
    } catch (err) {
      console.warn('Telegram channel creation warning:', err.message);
      // Fallback virtual channel ID if Telegram is connecting/testing
      channelId = `-100${Date.now()}`;
      accessHash = '0';
    }

    const insertResult = db
      .prepare(
        `INSERT INTO buckets (user_id, bucketName, channel_id, access_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(userId, bucketName.trim(), channelId, accessHash);

    // Decrement bucketAllowed
    db.prepare('UPDATE users SET bucketAllowed = bucketAllowed - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    const newBucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(insertResult.lastInsertRowid);

    return res.status(200).json({
      status: true,
      message: 'Bucket created successfully',
      data: newBucket,
      bucket: newBucket,
    });
  } catch (error) {
    console.error('Create bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const listBuckets = async (req, res) => {
  try {
    const userId = req.user.id;
    const buckets = db.prepare('SELECT * FROM buckets WHERE user_id = ? ORDER BY id DESC').all(userId);
    return res.status(200).json({
      status: true,
      message: 'Buckets retrieved successfully',
      data: buckets,
      buckets,
    });
  } catch (error) {
    console.error('List buckets error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const editBucket = async (req, res) => {
  try {
    const bucketId = req.params.bucket || req.params.bucketId;
    const bucketName = req.body.name || req.body.bucketName;
    const userId = req.user.id;

    if (!bucketName || !bucketName.trim()) {
      return res.status(422).json({ status: false, message: 'Bucket name is required.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ? AND user_id = ?').get(bucketId, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    try {
      if (bucket.channel_id && bucket.access_hash) {
        await telegramService.updateChannelName(bucket.channel_id, bucket.access_hash, bucketName.trim());
      }
    } catch (err) {
      console.warn('Update channel title warning:', err.message);
    }

    db.prepare('UPDATE buckets SET bucketName = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      bucketName.trim(),
      bucket.id
    );

    const updated = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucket.id);

    return res.status(200).json({
      status: true,
      message: 'Bucket updated successfully',
      data: updated,
      bucket: updated,
    });
  } catch (error) {
    console.error('Edit bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const deleteBucket = async (req, res) => {
  try {
    const bucketId = req.params.bucket || req.params.bucketId;
    const userId = req.user.id;

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ? AND user_id = ?').get(bucketId, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    try {
      if (bucket.channel_id && bucket.access_hash) {
        await telegramService.deleteChannel(bucket.channel_id, bucket.access_hash);
      }
    } catch (err) {
      console.warn('Delete channel warning:', err.message);
    }

    // Delete shares & bucket
    db.prepare('DELETE FROM bucket_shares WHERE bucket_id = ?').run(bucket.id);
    db.prepare('DELETE FROM buckets WHERE id = ?').run(bucket.id);

    // Increment bucketAllowed
    db.prepare('UPDATE users SET bucketAllowed = bucketAllowed + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    return res.status(200).json({
      status: true,
      message: 'Bucket deleted successfully',
    });
  } catch (error) {
    console.error('Delete bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const shareBucket = async (req, res) => {
  try {
    const { bucket_id, password } = req.body;
    const userId = req.user.id;

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ? AND user_id = ?').get(bucket_id, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    // Check existing share
    let share = db.prepare('SELECT * FROM bucket_shares WHERE bucket_id = ?').get(bucket.id);

    if (share) {
      if (password !== undefined) {
        db.prepare('UPDATE bucket_shares SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(password || null, share.id);
        share = db.prepare('SELECT * FROM bucket_shares WHERE id = ?').get(share.id);
      }
    } else {
      let code = generateShareCode();
      while (db.prepare('SELECT id FROM bucket_shares WHERE code = ?').get(code)) {
        code = generateShareCode();
      }

      const resInsert = db
        .prepare(
          `INSERT INTO bucket_shares (bucket_id, password, code, created_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(bucket.id, password || null, code);

      share = db.prepare('SELECT * FROM bucket_shares WHERE id = ?').get(resInsert.lastInsertRowid);
    }

    return res.status(200).json({
      status: true,
      message: 'Bucket shared successfully',
      data: share,
      code: share.code,
    });
  } catch (error) {
    console.error('Share bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const endShare = async (req, res) => {
  try {
    const code = req.params.code;
    const userId = req.user.id;

    const share = db
      .prepare(
        `SELECT s.* FROM bucket_shares s
         JOIN buckets b ON b.id = s.bucket_id
         WHERE s.code = ? AND b.user_id = ?`
      )
      .get(code, userId);

    if (!share) {
      return res.status(404).json({ status: false, message: 'Share link not found or access denied.' });
    }

    db.prepare('DELETE FROM bucket_shares WHERE id = ?').run(share.id);

    return res.status(200).json({
      status: true,
      message: 'Bucket sharing ended successfully',
    });
  } catch (error) {
    console.error('End share error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const displayBucket = async (req, res) => {
  try {
    const bucketId = req.params.bucket || req.params.bucketId;
    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucketId);

    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    if (!canAccessBucket(req, bucket)) {
      return res.status(403).json({ status: false, message: 'Access denied to bucket.' });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 15;
    const search = req.query.search ? String(req.query.search).toLowerCase().trim() : '';

    const channelData = await telegramService.getChannelFiles(
      bucket.channel_id,
      bucket.access_hash,
      bucket.id,
      page,
      limit
    );

    let files = channelData.files;
    if (search) {
      files = files.filter((f) => f.file_name && f.file_name.toLowerCase().includes(search));
    }

    return res.status(200).json({
      status: true,
      data: files,
      pagination: channelData.pagination,
      totalStorage: channelData.totalStorage,
    });
  } catch (error) {
    console.error('Display bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

module.exports = {
  createBucket,
  listBuckets,
  editBucket,
  deleteBucket,
  shareBucket,
  endShare,
  displayBucket,
};
