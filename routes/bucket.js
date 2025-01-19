const express = require('express')
const router = express.Router()
const BucketController = require('../controller/BucketController')
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware')
const fileShareController = require('../controller/FileShareController');

router.post('/create', jwtAuthMiddleware, BucketController.createBucket);
router.get('/list', jwtAuthMiddleware, BucketController.listBuckets);
router.get('/show/:code', BucketController.showBucket);
router.get('/show/:code/:file_id', BucketController.showBucketFile);
router.delete('/:bucketId', jwtAuthMiddleware, BucketController.deleteBucket);
// Share file route
router.post('/share', jwtAuthMiddleware, fileShareController.shareBucket);

module.exports = router;

