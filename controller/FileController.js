const fs = require('fs');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { safeDecryptId, safeEncryptId } = require('../utils/crypto');
const { canAccessBucket } = require('../middleware/AuthMiddleware');

const uploadFile = async (req, res) => {
  try {
    const bucketId = req.body.bucket_id;
    const userId = req.user.id;

    if (!bucketId) {
      return res.status(422).json({ status: false, message: 'bucket_id is required.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ? AND user_id = ?').get(bucketId, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found or unauthorized.' });
    }

    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(422).json({ status: false, message: 'No files provided.' });
    }

    const results = [];

    for (const file of files) {
      try {
        const uploadRes = await telegramService.uploadFileToChannel(
          bucket.channel_id,
          bucket.access_hash,
          file.path,
          file.originalname
        );

        results.push({
          name: file.originalname,
          uploaded: true,
          msg_id: uploadRes ? safeEncryptId(uploadRes.id, bucket.id) : null,
        });
      } catch (err) {
        console.error('File upload to Telegram error:', err);
        results.push({
          name: file.originalname,
          uploaded: false,
          error: err.message,
        });
      } finally {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    const allSuccess = results.every((r) => r.uploaded);
    return res.status(200).json({
      status: allSuccess,
      message: allSuccess ? 'file(s) uploaded successfully' : 'Some files failed to upload',
      data: results,
    });
  } catch (error) {
    console.error('Upload file error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const removeFile = async (req, res) => {
  try {
    const bucketId = req.params.bucket || req.params.bucketId;
    const userId = req.user.id;

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ? AND user_id = ?').get(bucketId, userId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    const fileIds = Array.isArray(req.body.file_id) ? req.body.file_id : [req.body.file_id];
    if (fileIds.length === 0) {
      return res.status(422).json({ status: false, message: 'file_id is required.' });
    }

    const decryptedMsgIds = fileIds
      .map((id) => safeDecryptId(id) || parseInt(id, 10))
      .filter((id) => !isNaN(id) && id > 0);

    if (decryptedMsgIds.length > 0) {
      await telegramService.deleteMessages(bucket.channel_id, bucket.access_hash, decryptedMsgIds);
    }

    return res.status(200).json({
      status: true,
      message: 'File(s) Deleted Successfully',
    });
  } catch (error) {
    console.error('Remove file error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const streamFile = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type, Origin, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Access-Control-Max-Age': '86400',
    }).end();
  }

  try {
    const bucketId = req.params.bucket || req.query.bucket_id || req.body.bucket_id;
    const rawId = req.params.id || req.query.file_id || req.body.file_id;

    if (!bucketId || !rawId) {
      return res.status(422).json({ status: false, message: 'bucket_id and file id are required.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucketId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    if (!canAccessBucket(req, bucket)) {
      return res.status(403).json({ status: false, message: 'Access denied.' });
    }

    const msgId = safeDecryptId(rawId, bucket.id) || (isFinite(rawId) ? parseInt(rawId, 10) : null);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid file ID.' });
    }

    const isDownload = req.query.dl === '1' || req.query.download === 'true';
    return await telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, isDownload);
  } catch (error) {
    console.error('Stream file error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
    }
  }
};

const downloadFile = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type, Origin, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Access-Control-Max-Age': '86400',
    }).end();
  }

  try {
    const bucketId = req.params.bucket || req.params.bucketId || req.query.bucket_id || req.body.bucket_id;
    const rawId = req.params.id || req.params.fileId || req.query.file_id || req.body.file_id;

    if (!bucketId || !rawId) {
      return res.status(422).json({ status: false, message: 'bucket_id and file_id are required.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucketId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    if (!canAccessBucket(req, bucket)) {
      return res.status(403).json({ status: false, message: 'Access denied.' });
    }

    const msgId = safeDecryptId(rawId, bucket.id) || (isFinite(rawId) ? parseInt(rawId, 10) : null);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid file ID.' });
    }

    return await telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, true);
  } catch (error) {
    console.error('Download file error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
    }
  }
};

const streamThumbnail = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type, Origin, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'Access-Control-Max-Age': '86400',
    }).end();
  }

  try {
    const bucketId = req.params.bucket || req.query.bucket_id;
    const rawId = req.params.id || req.query.file_id;

    if (!bucketId || !rawId) {
      return res.status(422).json({ status: false, message: 'bucket and id required.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucketId);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    if (!canAccessBucket(req, bucket)) {
      return res.status(403).json({ status: false, message: 'Access denied.' });
    }

    const msgId = safeDecryptId(rawId, bucket.id) || (isFinite(rawId) ? parseInt(rawId, 10) : null);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid thumbnail ID.' });
    }

    return await telegramService.streamThumbnail(bucket.channel_id, bucket.access_hash, msgId, req, res);
  } catch (error) {
    console.error('Stream thumbnail error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
    }
  }
};

// Shared Bucket Controllers
const showSharedBucket = async (req, res) => {
  try {
    const code = req.params.code;
    const share = db.prepare('SELECT * FROM bucket_shares WHERE code = ?').get(code);

    if (!share) {
      return res.status(404).json({ status: false, message: 'Shared bucket not found.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(share.bucket_id);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    // Check password if set
    if (share.password) {
      const providedPassword = req.query.password || req.headers['x-bucket-password'];
      if (!providedPassword || providedPassword !== share.password) {
        return res.status(403).json({
          status: false,
          requiresPassword: true,
          message: 'Password required to access this bucket.',
        });
      }
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
      message: 'Data found',
      data: {
        bucket: {
          id: bucket.id,
          bucketName: bucket.bucketName,
          code: share.code,
        },
        files,
      },
      files,
      totalFiles: channelData.pagination.totalFiles,
      totalStorage: channelData.totalStorage,
      pagination: channelData.pagination,
    });
  } catch (error) {
    console.error('Show shared bucket error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const uploadToSharedBucket = async (req, res) => {
  try {
    const code = req.params.code;
    const share = db.prepare('SELECT * FROM bucket_shares WHERE code = ?').get(code);

    if (!share) {
      return res.status(404).json({ status: false, message: 'Shared bucket not found.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(share.bucket_id);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(422).json({ status: false, message: 'No files uploaded.' });
    }

    const results = [];

    for (const file of files) {
      try {
        const uploadRes = await telegramService.uploadFileToChannel(
          bucket.channel_id,
          bucket.access_hash,
          file.path,
          file.originalname
        );

        results.push({
          name: file.originalname,
          uploaded: true,
          msg_id: uploadRes ? safeEncryptId(uploadRes.id, bucket.id) : null,
        });
      } catch (err) {
        console.error('Shared upload error:', err);
        results.push({
          name: file.originalname,
          uploaded: false,
          error: err.message,
        });
      } finally {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    return res.status(200).json({
      status: true,
      message: 'File(s) uploaded successfully',
      data: results,
    });
  } catch (error) {
    console.error('Shared upload error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const downloadFromSharedBucket = async (req, res) => {
  try {
    const code = req.params.code;
    const rawId = req.params.fileId || req.query.file_id || req.body.file_id;

    const share = db.prepare('SELECT * FROM bucket_shares WHERE code = ?').get(code);
    if (!share) {
      return res.status(404).json({ status: false, message: 'Shared bucket not found.' });
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(share.bucket_id);
    if (!bucket) {
      return res.status(404).json({ status: false, message: 'Bucket not found.' });
    }

    const msgId = safeDecryptId(rawId, bucket.id) || (isFinite(rawId) ? parseInt(rawId, 10) : null);
    if (!msgId) {
      return res.status(404).json({ status: false, message: 'Invalid file ID.' });
    }

    return await telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, true);
  } catch (error) {
    console.error('Download from shared bucket error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
    }
  }
};

module.exports = {
  uploadFile,
  removeFile,
  streamFile,
  downloadFile,
  streamThumbnail,
  showSharedBucket,
  uploadToSharedBucket,
  downloadFromSharedBucket,
};
