const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticate = async (req, res, next) => {
    try {
        // Получаем токен из заголовка Authorization или cookie
        let token = req.headers.authorization?.split(' ')[1] || req.cookies.token;

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Проверяем токен
        const decoded = jwt.verify(token, JWT_SECRET);

        // Получаем пользователя
        const user = await User.findById(decoded.id);

        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'Invalid token or user not found' });
        }

        // Добавляем пользователя в request
        req.user = {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role
        };

        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        next(error);
    }
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

module.exports = {
    authenticate,
    authorize
};