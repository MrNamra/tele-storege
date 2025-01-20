const express = require('express');
const multer = require('multer');
const router = express.Router();
const fileShareController = require('../controller/FileShareController');
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware');

// Set up multer to handle file uploads (in memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }).single('file');

// upload file route
router.post('/upload', jwtAuthMiddleware, upload, fileShareController.uploadFile);
router.post('/:code/upload', upload, fileShareController.uploadFileByCode);

// delete upload file route
router.delete('/:fileId', jwtAuthMiddleware, fileShareController.deleteUploadFile);

// Access shared file route
router.get('/:fileId', jwtAuthMiddleware, fileShareController.accessFile);

module.exports = router;
