const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { processNextJob } = require('../services/queueService');

const {
  getChunksDir,
  getAssembledDir,
  safeMkdirSync,
  findChunkDir,
} = require('../utils/storagePaths');

function verifyUploadAccess(req, job) {
  if (!job) return false;

  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(job.bucket_id);
  if (!bucket) return false;

  // 1. Authenticated user who is the bucket owner, upload owner, or admin
  if (req.user) {
    if (
      Number(req.user.id) === Number(bucket.user_id) ||
      req.user.role === 'admin' ||
      (job.user_id && Number(req.user.id) === Number(job.user_id))
    ) {
      return true;
    }
  }

  // 2. If uploaded via a shared bucket link, allow if the requester provides the valid share code
  const shareCode = req.query.code || req.headers['x-bucket-code'] || (req.body && req.body.code);
  if (shareCode) {
    const share = db.prepare('SELECT id FROM bucket_shares WHERE bucket_id = ? AND code = ?').get(bucket.id, shareCode);
    if (share) return true;
  }

  return false;
}

const init = async (req, res) => {
  try {
    const rawFileName =
      (req.body && (req.body.file_name || req.body.filename || req.body.name)) ||
      (req.query && (req.query.file_name || req.query.filename)) ||
      (req.file && req.file.originalname);

    const rawFileSize =
      (req.body && (req.body.file_size || req.body.fileSize || req.body.size)) ||
      (req.query && req.query.file_size) ||
      (req.file && req.file.size) ||
      0;

    const rawTotalChunks =
      (req.body && (req.body.total_chunks || req.body.totalChunks || req.body.chunks)) ||
      (req.query && req.query.total_chunks) ||
      1;

    const rawBucketId =
      (req.body && (req.body.bucket_id || req.body.bucketId || req.body.bucket)) ||
      (req.query && (req.query.bucket_id || req.query.bucket));

    const rawCode =
      (req.body && (req.body.code || req.body.share_code)) ||
      req.headers['x-bucket-code'] ||
      (req.query && (req.query.code || req.query.share_code));

    const rawPassword =
      (req.body && (req.body.password || req.body.share_password)) ||
      req.headers['x-bucket-password'] ||
      (req.query && req.query.password);

    // If an entire file or tmp files were uploaded to /init, clean them up immediately
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    if (req.files && Array.isArray(req.files)) {
      for (const f of req.files) {
        if (fs.existsSync(f.path)) {
          try { fs.unlinkSync(f.path); } catch (_) {}
        }
      }
    }

    if (!rawFileName) {
      return res.status(422).json({
        success: false,
        message: 'file_name is required. Please provide "file_name" or "filename" in the request body.',
      });
    }

    let bucket = null;
    let isShareUpload = false;

    if (rawCode) {
      const share = db.prepare('SELECT * FROM bucket_shares WHERE code = ?').get(rawCode);
      if (share) {
        if (share.password) {
          if (!rawPassword || rawPassword !== share.password) {
            return res.status(403).json({
              success: false,
              requiresPassword: true,
              message: 'Password is wrong or required to upload files to this shared bucket.',
            });
          }
        }
        bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(share.bucket_id);
        isShareUpload = true;
      }
    } else if (rawBucketId) {
      bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(rawBucketId);
    } else if (req.user) {
      // Default to user's first bucket if neither bucket_id nor code was specified
      bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(req.user.id);
    }

    if (!bucket) {
      return res.status(404).json({
        success: false,
        message: rawCode
          ? 'Shared bucket not found with the provided code.'
          : 'Bucket not found. Please provide a valid bucket_id or share code.',
      });
    }

    // If private bucket upload, caller must be logged in and own the bucket
    if (!isShareUpload) {
      if (!req.user || Number(req.user.id) !== Number(bucket.user_id)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: only the bucket owner can upload files here.',
        });
      }
    }

    const uploadId = crypto.randomUUID();
    let chunkDir;
    try {
      chunkDir = safeMkdirSync(path.join(getChunksDir(), uploadId));
    } catch (fsErr) {
      console.error('Failed to create chunk directory:', fsErr);
      return res.status(500).json({
        success: false,
        message: 'Storage permission error: Could not create upload directory on server.',
        error: fsErr.message,
      });
    }

    const safeName = String(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const assembledDir = getAssembledDir();
    safeMkdirSync(assembledDir);
    const assembledPath = path.join(assembledDir, `${uploadId}_${safeName}`);
    const userId = req.user ? req.user.id : null;

    db.prepare(
      `INSERT INTO upload_queues (upload_id, bucket_id, channel_id, file_path, file_name, file_size, status, progress, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'uploading', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(uploadId, bucket.id, bucket.channel_id, assembledPath, rawFileName, Number(rawFileSize) || 0, userId);

    return res.status(200).json({
      success: true,
      data: {
        upload_id: uploadId,
        chunk_size: 5 * 1024 * 1024,
        total_chunks: parseInt(rawTotalChunks, 10) || 1,
      },
    });
  } catch (error) {
    console.error('Upload init error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const uploadChunk = async (req, res) => {
  const uploadId = (req.body && (req.body.upload_id || req.body.uploadId)) || (req.query && req.query.upload_id);
  const chunkIndex = (req.body && req.body.chunk_index !== undefined)
    ? req.body.chunk_index
    : ((req.body && req.body.chunkIndex !== undefined)
      ? req.body.chunkIndex
      : (req.query && req.query.chunk_index));

  try {
    if (!uploadId || chunkIndex === undefined) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(422).json({ success: false, message: 'upload_id and chunk_index are required' });
    }

    const job = db.prepare('SELECT * FROM upload_queues WHERE upload_id = ?').get(uploadId);
    if (!job) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(404).json({ success: false, message: 'Upload session not found' });
    }

    // If session was already marked failed or cancelled by a previous error, stop all next chunks immediately
    if (job.status === 'failed' || job.status === 'cancelled') {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(409).json({
        success: false,
        message: `Upload session already terminated (${job.status}): ${job.error || 'Upload aborted'}`,
      });
    }

    if (!verifyUploadAccess(req, job)) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const chunkDir = findChunkDir(uploadId);
    if (!fs.existsSync(chunkDir)) {
      try {
        safeMkdirSync(chunkDir);
      } catch (_) {
        if (req.file && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(404).json({ success: false, message: 'Upload session directory not found' });
      }
    }

    const chunkFile = req.file || (req.files && req.files.find((f) => f.fieldname === 'chunk')) || (req.files && req.files[0]);

    if (!chunkFile) {
      // Mark session as failed so any next chunks are aborted immediately
      db.prepare("UPDATE upload_queues SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(`Missing chunk payload for chunk ${chunkIndex}`, job.id);
      return res.status(422).json({ success: false, message: 'No chunk file provided' });
    }

    const destPath = path.join(chunkDir, String(chunkIndex));
    fs.renameSync(chunkFile.path, destPath);

    return res.status(200).json({
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
    });
  } catch (error) {
    console.error('Upload chunk error:', error);
    // Mark session as failed in DB so all subsequent/concurrent chunks stop immediately
    if (uploadId) {
      try {
        db.prepare("UPDATE upload_queues SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?")
          .run(error.message || 'Chunk upload failed', uploadId);
      } catch (_) {}
    }
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const complete = async (req, res) => {
  try {
    const upload_id = (req.body && (req.body.upload_id || req.body.uploadId)) || req.query.upload_id;

    if (!upload_id) {
      return res.status(422).json({ success: false, message: 'upload_id is required' });
    }

    const job = db.prepare('SELECT * FROM upload_queues WHERE upload_id = ?').get(upload_id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Upload record not found' });
    }

    if (!verifyUploadAccess(req, job)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const chunkDir = findChunkDir(upload_id);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ success: false, message: 'Chunks not found' });
    }

    db.prepare("UPDATE upload_queues SET status = 'assembling', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);

    // Assemble asynchronously in background to avoid blocking HTTP response
    setImmediate(async () => {
      try {
        const chunkFiles = fs
          .readdirSync(chunkDir)
          .map((f) => parseInt(f, 10))
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);

        safeMkdirSync(path.dirname(job.file_path));
        const writeStream = fs.createWriteStream(job.file_path);

        for (const idx of chunkFiles) {
          const chunkPath = path.join(chunkDir, String(idx));
          const chunkData = fs.readFileSync(chunkPath);
          writeStream.write(chunkData);
        }

        writeStream.end();

        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        // Clean up chunk files
        try {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        } catch {}

        // Enqueue background processing now that assembled file is on disk
        db.prepare("UPDATE upload_queues SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
        processNextJob();
      } catch (err) {
        console.error('Assembly error for upload', upload_id, err);
        db.prepare("UPDATE upload_queues SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(err.message, job.id);
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        upload_id,
        status: 'processing',
        file_name: job.file_name,
      },
      message: 'File assembly queued',
    });
  } catch (error) {
    console.error('Upload complete error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const status = async (req, res) => {
  try {
    const uploadId = req.params.uploadId || (req.query && req.query.upload_id) || (req.body && (req.body.upload_id || req.body.uploadId));
    const job = db.prepare('SELECT * FROM upload_queues WHERE upload_id = ?').get(uploadId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Upload not found' });
    }

    if (!verifyUploadAccess(req, job)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    let clientStatus = job.status;
    if (clientStatus === 'uploading_to_cloud') {
      clientStatus = 'uploading_to_cloud';
    }

    return res.status(200).json({
      success: true,
      data: {
        status: clientStatus,
        progress: job.progress || 0,
        error: job.error || null,
        message: job.error || (job.status === 'completed' ? 'Upload complete' : 'Processing upload...'),
      },
    });
  } catch (error) {
    console.error('Upload status error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const cancel = async (req, res) => {
  try {
    const uploadId = req.params.uploadId || (req.query && req.query.upload_id) || (req.body && (req.body.upload_id || req.body.uploadId));
    const job = db.prepare('SELECT * FROM upload_queues WHERE upload_id = ?').get(uploadId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Upload not found' });
    }

    if (!verifyUploadAccess(req, job)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    db.prepare("UPDATE upload_queues SET status = 'failed', error = 'Cancelled by user', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
    if (fs.existsSync(job.file_path)) {
      try { fs.unlinkSync(job.file_path); } catch {}
    }

    const chunkDir = findChunkDir(uploadId);
    if (fs.existsSync(chunkDir)) {
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}
    }

    return res.status(200).json({ success: true, message: 'Upload cancelled successfully' });
  } catch (error) {
    console.error('Upload cancel error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

module.exports = {
  init,
  uploadChunk,
  complete,
  status,
  cancel,
};
