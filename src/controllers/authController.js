const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

class AuthController {
    // Регистрация
    async register(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { name, email, password } = req.body;

            // Проверяем, существует ли пользователь
            const existingUser = await User.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ error: 'User with this email already exists' });
            }

            // Создаем пользователя
            const user = await User.create({
                name,
                email,
                password
            });

            // Генерируем JWT токен
            const token = jwt.sign(
                { id: user._id, email: user.email },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );

            // Отправляем токен в cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней
            });

            res.status(201).json({
                message: 'User registered successfully',
                user: user.toPublicJSON(),
                token
            });

        } catch (error) {
            next(error);
        }
    }

    // Вход
    async login(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { email, password } = req.body;

            // Ищем пользователя (включаем поле password)
            const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

            if (!user || !user.isActive) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Проверяем пароль
            const isPasswordValid = await user.comparePassword(password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Обновляем время последнего входа
            user.lastLogin = new Date();
            await user.save();

            // Генерируем JWT токен
            const token = jwt.sign(
                { id: user._id, email: user.email },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );

            // Отправляем токен в cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.json({
                message: 'Login successful',
                user: user.toPublicJSON(),
                token
            });

        } catch (error) {
            next(error);
        }
    }

    // Выход
    async logout(req, res, next) {
        try {
            res.clearCookie('token');
            res.json({ message: 'Logout successful' });
        } catch (error) {
            next(error);
        }
    }

    // Получить текущего пользователя
    async getCurrentUser(req, res, next) {
        try {
            const user = await User.findById(req.user.id);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({ user: user.toPublicJSON() });

        } catch (error) {
            next(error);
        }
    }

    // Обновить профиль
    async updateProfile(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { name, email } = req.body;
            const user = await User.findById(req.user.id);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Проверяем уникальность email если он меняется
            if (email && email !== user.email) {
                const existingUser = await User.findByEmail(email);
                if (existingUser) {
                    return res.status(400).json({ error: 'Email already in use' });
                }
                user.email = email;
            }

            if (name) {
                user.name = name;
            }

            await user.save();

            res.json({
                message: 'Profile updated successfully',
                user: user.toPublicJSON()
            });

        } catch (error) {
            next(error);
        }
    }

    // Смена пароля
    async changePassword(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { currentPassword, newPassword } = req.body;
            const user = await User.findById(req.user.id).select('+password');

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Проверяем текущий пароль
            const isPasswordValid = await user.comparePassword(currentPassword);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Устанавливаем новый пароль
            user.password = newPassword;
            await user.save();

            res.json({ message: 'Password changed successfully' });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AuthController();