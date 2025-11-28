const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { connectRedis } = require('./config/redis');
const { errorHandler } = require('./middleware/errorHandler');
const { initializeAdmin } = require('./utils/initAdmin');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Отключаем для разработки
}));
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
    .then(() => {
        console.log('✅ MongoDB connected successfully');

        // Инициализируем администратора
        return initializeAdmin();
    })
    .then(() => {
        // Подключение к Redis
        return connectRedis();
    })
    .then(() => {
        console.log('✅ Redis connected successfully');

        // Запуск сервера
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV}`);
        });
    })
    .catch(err => {
        console.error('❌ Connection error:', err);
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing server gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Closing server gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

module.exports = app;