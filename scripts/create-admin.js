const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Подключаемся к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/link_rotator', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Определяем схему пользователя (упрощенная версия)
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    lastLogin: Date
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Создаем администратора
async function createAdmin() {
    try {
        const adminEmail = 'adminseo@trafficconnect.com';
        const adminPassword = 'm9OviUHdCOKM';

        // Проверяем, существует ли администратор
        const existingAdmin = await User.findOne({ email: adminEmail });

        if (existingAdmin) {
            console.log('ℹ️  Admin user already exists');
            console.log(`   Email: ${adminEmail}`);
            console.log(`   ID: ${existingAdmin._id}`);
            process.exit(0);
        }

        // Хешируем пароль
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        // Создаем администратора
        const admin = await User.create({
            name: 'Admin SEO',
            email: adminEmail,
            password: hashedPassword,
            role: 'admin',
            isActive: true
        });

        console.log('✅ Admin user created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   Name:     ${admin.name}`);
        console.log(`   Email:    ${admin.email}`);
        console.log(`   Password: ${adminPassword}`);
        console.log(`   Role:     ${admin.role}`);
        console.log(`   ID:       ${admin._id}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🔐 Login credentials:');
        console.log(`   POST /api/auth/login`);
        console.log(`   Body: { "email": "${adminEmail}", "password": "${adminPassword}" }`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin:', error);
        process.exit(1);
    }
}

// Запускаем
createAdmin();