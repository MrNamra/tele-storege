const express = require('express')
const router = express.Router()
const BucketController = require('../controller/BucketController')
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware')
const fileShareController = require('../controller/FileShareController');

router.post('/create', jwtAuthMiddleware, BucketController.createBucket);
router.put('/edit/:bucketId', jwtAuthMiddleware, BucketController.editBucket);
router.get('/list', jwtAuthMiddleware, BucketController.listBuckets);

router.get('/display/:bucketId', jwtAuthMiddleware, BucketController.showBucket);
router.get('/display/:bucketId/:fileId', jwtAuthMiddleware, BucketController.showBucketFile);

router.get('/show/:code', BucketController.showBucket);
router.get('/show/:code/:fileId', BucketController.showBucketFile);
// Share file route
router.post('/share', jwtAuthMiddleware, fileShareController.shareBucket);
router.delete('/end-share/:code', jwtAuthMiddleware, fileShareController.endShare);

// Delete Bucket
router.delete('/:bucketId', jwtAuthMiddleware, BucketController.deleteBucket);
router.delete('/:bucketId/deletefile', jwtAuthMiddleware, BucketController.deleteBucketFile);

module.exports = router;