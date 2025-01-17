const express = require('express');
const router = express.Router();
const fileShareController = require('../controller/FileShareController');
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware');

// Share file route
router.post('/share', jwtAuthMiddleware, fileShareController.shareFile);

// Access shared file route
router.post('/access/:fileId', fileShareController.accessSharedFile);

module.exports = router;
