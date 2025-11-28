const User = require('../models/User');

class UserController {
    async getAll(req, res, next) {
        try {
            const users = await User.find().select('-password').sort({ createdAt: -1 });
            res.json({ users });
        } catch (error) {
            next(error);
        }
    }

    async create(req, res, next) {
        try {
            const { name, email, password, role } = req.body;

            const existingUser = await User.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            const user = await User.create({ name, email, password, role: role || 'user' });
            res.status(201).json({ user: user.toPublicJSON() });
        } catch (error) {
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const { name, email, password, role } = req.body;
            const user = await User.findById(req.params.id);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (email && email !== user.email) {
                const existingUser = await User.findByEmail(email);
                if (existingUser) {
                    return res.status(400).json({ error: 'Email already in use' });
                }
                user.email = email;
            }

            if (name) user.name = name;
            if (role) user.role = role;

            // Обновляем пароль только если он передан
            if (password && password.trim() !== '') {
                user.password = password;
            }

            await user.save();
            res.json({ user: user.toPublicJSON() });
        } catch (error) {
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const user = await User.findById(req.params.id);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Не позволяем удалить самого себя
            if (user._id.toString() === req.user.id) {
                return res.status(400).json({ error: 'Cannot delete yourself' });
            }

            await user.deleteOne();
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new UserController();