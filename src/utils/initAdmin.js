const User = require('../models/User');

const ADMIN_CONFIG = {
    name: 'Admin SEO',
    email: 'adminseo@trafficconnect.com',
    password: 'm9OviUHdCOKM',
    role: 'admin'
};

async function initializeAdmin() {
    try {
        // Проверяем, существует ли администратор
        const existingAdmin = await User.findOne({ email: ADMIN_CONFIG.email });

        if (existingAdmin) {
            console.log('ℹ️  Admin user already exists:', ADMIN_CONFIG.email);
            return existingAdmin;
        }

        // Создаем администратора
        const admin = await User.create({
            name: ADMIN_CONFIG.name,
            email: ADMIN_CONFIG.email,
            password: ADMIN_CONFIG.password,
            role: ADMIN_CONFIG.role,
            isActive: true
        });

        console.log('✅ Admin user created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   Name:     ${admin.name}`);
        console.log(`   Email:    ${admin.email}`);
        console.log(`   Password: ${ADMIN_CONFIG.password}`);
        console.log(`   Role:     ${admin.role}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        return admin;
    } catch (error) {
        console.error('❌ Error initializing admin:', error.message);
        // Не падаем, продолжаем работу приложения
        return null;
    }
}

module.exports = { initializeAdmin };