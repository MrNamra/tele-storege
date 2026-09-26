const express = require('express');
const router = express.Router();
const { flexibleUpload } = require('../middleware/uploadMiddleware');
const ChunkUploadController = require('../controller/ChunkUploadController');
const { optionalAuthMiddleware } = require('../middleware/AuthMiddleware');

router.post('/init', optionalAuthMiddleware, flexibleUpload, ChunkUploadController.init);
router.post('/chunk', optionalAuthMiddleware, flexibleUpload, ChunkUploadController.uploadChunk);
router.post('/complete', optionalAuthMiddleware, ChunkUploadController.complete);
router.get('/status/:uploadId', optionalAuthMiddleware, ChunkUploadController.status);
router.post('/cancel/:uploadId', optionalAuthMiddleware, ChunkUploadController.cancel);

module.exports = router;
