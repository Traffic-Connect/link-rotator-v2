const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Регистрация
router.post('/register',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    ],
    authController.register
);

// Вход
router.post('/login',
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    authController.login
);

// Выход
router.post('/logout', authenticate, authController.logout);

// Получение текущего пользователя
router.get('/me', authenticate, authController.getCurrentUser);

// Обновление профиля
router.put('/me',
    authenticate,
    [
        body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
        body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required')
    ],
    authController.updateProfile
);

// Смена пароля
router.put('/change-password',
    authenticate,
    [
        body('currentPassword').notEmpty().withMessage('Current password is required'),
        body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
    ],
    authController.changePassword
);

module.exports = router;