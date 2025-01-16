const express = require('express');
const UserController = require('../controller/UserController');

const router = express.Router();

router.get('/dashboard', UserController.dashboard);

router.post('/upload', UserController.upload);

router.get('/download', UserController.download);

router.get('/download/:code', UserController.downloadFile);

module.exports = router;