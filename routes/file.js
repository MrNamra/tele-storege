const express = require('express');
const router = express.Router();
const { flexibleUpload } = require('../middleware/uploadMiddleware');
const FileController = require('../controller/FileController');
const { optionalAuthMiddleware } = require('../middleware/AuthMiddleware');

// Shared Bucket endpoints
router.get('/show/:code', optionalAuthMiddleware, FileController.showSharedBucket);
router.post('/files/upload/:code', flexibleUpload, FileController.uploadToSharedBucket);
router.all('/files/download/:code/:fileId?', optionalAuthMiddleware, FileController.downloadFromSharedBucket);

// Direct Media Streaming, Thumbnails & Downloads
router.all('/s/:bucket/:id', optionalAuthMiddleware, FileController.streamFile);
router.all('/stream/:bucket/:id', optionalAuthMiddleware, FileController.streamFile);
router.all('/stream-file/:bucket/:id', optionalAuthMiddleware, FileController.streamFile);
router.all('/stream/:id', optionalAuthMiddleware, FileController.streamFile);

router.all('/t/:bucket/:id', optionalAuthMiddleware, FileController.streamThumbnail);
router.all('/thumbnail/:bucket/:id', optionalAuthMiddleware, FileController.streamThumbnail);

router.all('/d/:bucket/:id', optionalAuthMiddleware, FileController.downloadFile);

module.exports = router;