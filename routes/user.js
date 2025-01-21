const express = require('express');
const router = express.Router();
const userController = require('../controller/UserController');
const { jwtAuthMiddleware } = require('../middleware/AuthMiddleware');

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/profile', jwtAuthMiddleware, userController.profile);
router.put('/profile', jwtAuthMiddleware, userController.updateProfile);
router.get('/dashboard', jwtAuthMiddleware, userController.dashboard);

module.exports = router;