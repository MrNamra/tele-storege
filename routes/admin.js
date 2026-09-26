const express = require('express');
const router = express.Router();
const AdminController = require('../controller/AdminController');
const { authMiddleware, adminMiddleware } = require('../middleware/AuthMiddleware');

// Apply auth and admin check to all admin routes
router.use(authMiddleware, adminMiddleware);

router.get('/stats', AdminController.stats);
router.get('/users', AdminController.users);
router.get('/users/:user', AdminController.show);
router.put('/users/:user', AdminController.update);
router.post('/users/:user', AdminController.update);
router.post('/users/:user/update', AdminController.update);
router.delete('/users/:user', AdminController.destroy);
router.post('/users/:user/impersonate', AdminController.impersonate);
router.post('/users/:user/password', AdminController.changePassword);
router.post('/users/:user/toggle-status', AdminController.toggleStatus);

module.exports = router;
