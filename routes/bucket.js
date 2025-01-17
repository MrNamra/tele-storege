const express = require('express')
const router = express.Router()
const {createBucket, listBuckets, deleteBucket} = require('../controller/BucketController')
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware')

router.post('/create', jwtAuthMiddleware, createBucket);
router.get('/list', jwtAuthMiddleware, listBuckets);
router.delete('/:bucketId', jwtAuthMiddleware, deleteBucket);

module.exports = router;

