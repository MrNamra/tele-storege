const express = require('express');
const router = express.Router();
const AuthController = require('../controller/AuthController');
const { authMiddleware } = require('../middleware/AuthMiddleware');

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.get('/user/profile', authMiddleware, AuthController.profile);
router.post('/user/profile', authMiddleware, AuthController.updateProfile);
router.get('/user/dashboard', authMiddleware, AuthController.dashboard);

module.exports = router;
