const express = require('express');
const multer = require('multer');
const router = express.Router();
const fileShareController = require('../controller/FileShareController');
const bucketController = require('../controller/BucketController');
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware');

// Set up multer to handle file uploads (in memory storage)
let storage, upload;
storage = multer.memoryStorage();
upload = multer({ storage: storage, limits: { fileSize: 11 * 1024 * 1024 * 1024 } }).array('files', 100);

// upload file route
router.post('/upload', jwtAuthMiddleware, upload, fileShareController.uploadFile);
router.post('/:code/upload', upload, fileShareController.uploadFileByCode);

// Access shared file route
router.get('/:fileId', jwtAuthMiddleware, fileShareController.accessFile);

// delete upload file route
router.delete('/:bucketId', jwtAuthMiddleware, bucketController.deleteBucketFile);

module.exports = router;
    