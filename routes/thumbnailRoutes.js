const express = require('express');
const router = express.Router();
const thumbnailController = require('../controller/ThumbnailController');

router.get('/thumbnail/:fileId', thumbnailController.getThumbNail);
router.get('/file/:fileId', thumbnailController.getFile);

module.exports = router;