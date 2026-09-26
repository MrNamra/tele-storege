const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { processNextJob } = require('../services/queueService');

const chunksBaseDir = path.join(__dirname, '../storage/app/chunks');
const assembledBaseDir = path.join(__dirname, '../storage/app/assembled');

if (!fs.existsSync(chunksBaseDir)) fs.mkdirSync(chunksBaseDir, { recursive: true });
if (!fs.existsSync(assembledBaseDir)) fs.mkdirSync(assembledBaseDir, { recursive: true });

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
    const { file_name, file_size, total_chunks, bucket_id, code } = req.body;

    if (!file_name) {
      return res.status(422).json({ success: false, message: 'file_name is required' });
    }

    let bucket = null;
    let isShareUpload = false;

    if (code) {
      const share = db.prepare('SELECT * FROM bucket_shares WHERE code = ?').get(code);
      if (share) {
        bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(share.bucket_id);
        isShareUpload = true;
      }
    } else if (bucket_id) {
      bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucket_id);
    }

    if (!bucket) {
      return res.status(404).json({ success: false, message: 'Bucket not found or invalid share code' });
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
    const chunkDir = path.join(chunksBaseDir, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });

    const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const assembledPath = path.join(assembledBaseDir, `${uploadId}_${safeName}`);
    const userId = req.user ? req.user.id : null;

    db.prepare(
      `INSERT INTO upload_queues (upload_id, bucket_id, channel_id, file_path, file_name, file_size, status, progress, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(uploadId, bucket.id, bucket.channel_id, assembledPath, file_name, file_size || 0, userId);

    return res.status(200).json({
      success: true,
      data: {
        upload_id: uploadId,
        chunk_size: 5 * 1024 * 1024,
        total_chunks: parseInt(total_chunks, 10) || 1,
      },
    });
  } catch (error) {
    console.error('Upload init error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const uploadChunk = async (req, res) => {
  try {
    const uploadId = req.body.upload_id;
    const chunkIndex = req.body.chunk_index;

    if (!uploadId || chunkIndex === undefined) {
      return res.status(422).json({ success: false, message: 'upload_id and chunk_index are required' });
    }

    const job = db.prepare('SELECT * FROM upload_queues WHERE upload_id = ?').get(uploadId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Upload session not found' });
    }

    if (!verifyUploadAccess(req, job)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const chunkDir = path.join(chunksBaseDir, uploadId);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ success: false, message: 'Upload session directory not found' });
    }

    if (!req.file) {
      return res.status(422).json({ success: false, message: 'No chunk file provided' });
    }

    const destPath = path.join(chunkDir, String(chunkIndex));
    fs.renameSync(req.file.path, destPath);

    return res.status(200).json({
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
    });
  } catch (error) {
    console.error('Upload chunk error:', error);
    return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const complete = async (req, res) => {
  try {
    const { upload_id } = req.body;

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

    const chunkDir = path.join(chunksBaseDir, upload_id);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ success: false, message: 'Chunks not found' });
    }

    // Assemble asynchronously in background to avoid blocking HTTP response
    setImmediate(async () => {
      try {
        const chunkFiles = fs
          .readdirSync(chunkDir)
          .map((f) => parseInt(f, 10))
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);

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

        // Enqueue background processing
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
    const uploadId = req.params.uploadId;
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
    const uploadId = req.params.uploadId;
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

    const chunkDir = path.join(chunksBaseDir, uploadId);
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
