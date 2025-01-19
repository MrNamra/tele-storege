const {jwtAuthMiddleware} = require('../middleware/AuthMiddleware')
const fileController = require('../controller/FileController')
const express = require('express')
const router = express.Router()

router.post('/upload', jwtAuthMiddleware, fileController.uploadFile)
router.delete('/delete', jwtAuthMiddleware, fileController.deleteFile)

module.exports = router