const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
        select: false // Не возвращать пароль по умолчанию
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    lastLogin: {
        type: Date
    }
}, {
    timestamps: true
});

// Хеширование пароля перед сохранением
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Метод для проверки пароля
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Password comparison failed');
    }
};

// Метод для получения публичных данных пользователя
userSchema.methods.toPublicJSON = function() {
    return {
        id: this._id,
        name: this.name,
        email: this.email,
        role: this.role,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };
};

// Статический метод для поиска пользователя по email
userSchema.statics.findByEmail = function(email) {
    return this.findOne({ email: email.toLowerCase(), isActive: true });
};

// Виртуальное поле для ссылок пользователя
userSchema.virtual('links', {
    ref: 'Link',
    localField: '_id',
    foreignField: 'userId'
});

const User = mongoose.model('User', userSchema);

module.exports = User;