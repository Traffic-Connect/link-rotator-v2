const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const userController = require('../controllers/userController');

// Все роуты требуют аутентификации и прав администратора
router.use(authenticate);
router.use(authorize('admin'));

// Получить всех пользователей
router.get('/', userController.getAll);

// Создать пользователя
router.post('/', userController.create);

// Обновить пользователя
router.put('/:id', userController.update);

// Удалить пользователя
router.delete('/:id', userController.delete);

module.exports = router;