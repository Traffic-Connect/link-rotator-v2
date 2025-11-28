const redis = require('redis');

let redisClient = null;

const connectRedis = async () => {
    try {
        redisClient = redis.createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        console.error('❌ Redis: Max reconnection attempts reached');
                        return new Error('Max reconnection attempts reached');
                    }
                    return Math.min(retries * 100, 3000);
                }
            }
        });

        redisClient.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        redisClient.on('connect', () => {
            console.log('Redis: Connecting...');
        });

        redisClient.on('ready', () => {
            console.log('Redis: Ready');
        });

        redisClient.on('reconnecting', () => {
            console.log('Redis: Reconnecting...');
        });

        await redisClient.connect();

        return redisClient;
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
        throw error;
    }
};

const getRedisClient = () => {
    if (!redisClient || !redisClient.isOpen) {
        throw new Error('Redis client is not connected');
    }
    return redisClient;
};

// Обертки для основных операций с автоматической обработкой ошибок
const redisGet = async (key) => {
    try {
        return await getRedisClient().get(key);
    } catch (error) {
        console.error(`Redis GET error for key ${key}:`, error);
        return null;
    }
};

const redisSet = async (key, value, ttl = null) => {
    try {
        if (ttl) {
            return await getRedisClient().setEx(key, ttl, value);
        }
        return await getRedisClient().set(key, value);
    } catch (error) {
        console.error(`Redis SET error for key ${key}:`, error);
        return null;
    }
};

const redisDel = async (key) => {
    try {
        return await getRedisClient().del(key);
    } catch (error) {
        console.error(`Redis DEL error for key ${key}:`, error);
        return null;
    }
};

const redisIncr = async (key) => {
    try {
        return await getRedisClient().incr(key);
    } catch (error) {
        console.error(`Redis INCR error for key ${key}:`, error);
        return null;
    }
};

const redisKeys = async (pattern) => {
    try {
        return await getRedisClient().keys(pattern);
    } catch (error) {
        console.error(`Redis KEYS error for pattern ${pattern}:`, error);
        return [];
    }
};

const redisFlushDb = async () => {
    try {
        return await getRedisClient().flushDb();
    } catch (error) {
        console.error('Redis FLUSHDB error:', error);
        return null;
    }
};

module.exports = {
    connectRedis,
    getRedisClient,
    redisGet,
    redisSet,
    redisDel,
    redisIncr,
    redisKeys,
    redisFlushDb
};