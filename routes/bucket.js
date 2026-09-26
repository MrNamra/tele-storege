const express = require('express');
const router = express.Router();
const { flexibleUpload } = require('../middleware/uploadMiddleware');
const BucketController = require('../controller/BucketController');
const FileController = require('../controller/FileController');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/AuthMiddleware');

// Bucket CRUD & Sharing
router.post('/create', authMiddleware, BucketController.createBucket);
router.get('/list', authMiddleware, BucketController.listBuckets);
router.get('/display/:bucket', optionalAuthMiddleware, BucketController.displayBucket);
router.get('/display/:bucket/:fileId', optionalAuthMiddleware, FileController.downloadFile);
router.post('/edit/:bucket', authMiddleware, BucketController.editBucket);
router.post('/delete/:bucket', authMiddleware, BucketController.deleteBucket);
router.post('/share', authMiddleware, BucketController.shareBucket);
router.post('/end-share/:code', authMiddleware, BucketController.endShare);

// Bucket File Management
router.post('/:bucket/delete-file', authMiddleware, FileController.removeFile);
router.post('/file/upload', authMiddleware, flexibleUpload, FileController.uploadFile);
router.all('/file/download/:bucket?/:fileId?', optionalAuthMiddleware, FileController.downloadFile);
router.all('/file/stream', optionalAuthMiddleware, FileController.streamFile);

module.exports = router;
