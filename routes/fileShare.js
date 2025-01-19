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
router.delete('/:code/delete', fileShareController.deleteFileByCode);

// Access shared file route
router.get('/:code', fileShareController.accessFile);
router.delete('/end-share/:code', fileShareController.endShare);

module.exports = router;
