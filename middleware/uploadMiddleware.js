const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { getTmpDir } = require('../utils/storagePaths');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const dest = getTmpDir();
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `up-${unique}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // Support large files up to 2GB per chunk/file
    fileSize: 2 * 1024 * 1024 * 1024,
  },
});

/**
 * Universal flexible upload middleware that accepts any field name
 * (e.g., 'files', 'file', 'files[]', 'attachment', 'photo', 'image', 'chunk')
 * and intercepts Multer errors to return clear, user-friendly JSON responses.
 */
function flexibleUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      console.warn(`[Upload Error] ${err.message} (${err.code || 'UNKNOWN'}) on ${req.method} ${req.originalUrl}`);
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          status: false,
          success: false,
          error: err.code,
          message: `File upload error: ${err.message}${err.field ? ` (field: "${err.field}")` : ''}`,
        });
      }
      return res.status(400).json({
        status: false,
        success: false,
        message: err.message || 'Error processing uploaded file',
      });
    }

    // Helper: populate req.file for single-file handlers
    if (req.files && req.files.length > 0 && !req.file) {
      // If there's a file specifically named 'chunk', prefer it for chunk uploads
      const chunkNamed = req.files.find((f) => f.fieldname === 'chunk');
      req.file = chunkNamed || req.files[0];
    }

    next();
  });
}

module.exports = {
  upload,
  flexibleUpload,
};
