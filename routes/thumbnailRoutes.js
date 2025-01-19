const express = require('express');
const router = express.Router();
const thumbnailController = require('../controller/ThumbnailController');

router.get('/:fileId', thumbnailController.getThumbNail);

module.exports = router;