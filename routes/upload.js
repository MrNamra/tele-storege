const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const tmpDir = path.join(__dirname, '../storage/app/tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ dest: tmpDir });

const ChunkUploadController = require('../controller/ChunkUploadController');
const { optionalAuthMiddleware } = require('../middleware/AuthMiddleware');

router.post('/init', optionalAuthMiddleware, ChunkUploadController.init);
router.post('/chunk', optionalAuthMiddleware, upload.single('chunk'), ChunkUploadController.uploadChunk);
router.post('/complete', optionalAuthMiddleware, ChunkUploadController.complete);
router.get('/status/:uploadId', optionalAuthMiddleware, ChunkUploadController.status);
router.post('/cancel/:uploadId', optionalAuthMiddleware, ChunkUploadController.cancel);

module.exports = router;
