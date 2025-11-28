const Link = require('../models/Link');
const Click = require('../models/Click');
const { validationResult } = require('express-validator');
const { redisGet, redisSet, redisDel, redisKeys } = require('../config/redis');

const REDIS_PREFIX = 'rotator:';
const ROTATION_CACHE_TTL = parseInt(process.env.ROTATION_CACHE_TTL) || 3600;

// Вспомогательная функция для очистки кеша
async function clearLinkCache(key) {
    try {
        await redisDel(`${REDIS_PREFIX}link:${key}`);
        await redisDel(`${REDIS_PREFIX}rotation:${key}`);
    } catch (error) {
        console.error('Error clearing cache:', error);
    }
}

class LinkController {
    // ПУБЛИЧНЫЙ РЕДИРЕКТ - самый важный метод
    async redirect(req, res, next) {
        try {
            const { key } = req.params;

            // 1. Пытаемся получить данные из Redis
            const cacheKey = `${REDIS_PREFIX}link:${key}`;
            let linkData = await redisGet(cacheKey);

            if (linkData) {
                linkData = JSON.parse(linkData);
            } else {
                // 2. Если нет в кеше - берем из MongoDB
                const link = await Link.findByKey(key).lean();

                if (!link || !link.redirects || link.redirects.length === 0) {
                    return res.status(404).json({ error: 'Link not found' });
                }

                // Кешируем в Redis
                linkData = {
                    id: link._id.toString(),
                    redirects: link.redirects.map(r => ({
                        id: r._id.toString(),
                        url: r.url,
                        position: r.position
                    }))
                };

                await redisSet(cacheKey, JSON.stringify(linkData), ROTATION_CACHE_TTL);
            }

            // 3. Получаем следующий редирект из ротации
            const rotationKey = `${REDIS_PREFIX}rotation:${key}`;
            let currentPosition = await redisGet(rotationKey);

            if (currentPosition === null) {
                currentPosition = 0;
            } else {
                currentPosition = parseInt(currentPosition);
            }

            // Выбираем редирект
            const nextPosition = (currentPosition + 1) % linkData.redirects.length;
            const redirect = linkData.redirects.find(r => r.position === currentPosition)
                || linkData.redirects[0];

            // Обновляем позицию в Redis
            await redisSet(rotationKey, nextPosition.toString(), ROTATION_CACHE_TTL);

            // 4. Логируем клик асинхронно (не блокируем редирект)
            setImmediate(async () => {
                try {
                    await Click.create({
                        linkId: linkData.id,
                        redirectId: redirect.id,
                        redirectUrl: redirect.url,
                        ipAddress: req.ip || req.connection.remoteAddress,
                        userAgent: req.get('user-agent') || '',
                        referer: req.get('referer') || ''
                    });

                    // Инкрементируем счетчик в Link
                    await Link.findByIdAndUpdate(
                        linkData.id,
                        {
                            $inc: {
                                totalClicks: 1,
                                'redirects.$[elem].clickCount': 1
                            }
                        },
                        {
                            arrayFilters: [{ 'elem._id': redirect.id }]
                        }
                    );
                } catch (error) {
                    console.error('Error logging click:', error);
                }
            });

            // 5. Редирект пользователя
            return res.redirect(302, redirect.url);

        } catch (error) {
            next(error);
        }
    }

    // Получить все ссылки пользователя
    async getAll(req, res, next) {
        try {
            const { date } = req.query;
            const userId = req.user.id;

            const links = await Link.find({ userId }).sort({ createdAt: -1 }).lean();

            // Получаем статистику кликов за день
            let dailyStats = [];
            if (date) {
                dailyStats = await Click.getDailyStats(date);
            }

            // Формируем карту кликов по redirectId
            const clicksMap = {};
            dailyStats.forEach(stat => {
                clicksMap[stat._id.toString()] = stat.count;
            });

            // Обогащаем данные ссылок статистикой
            const enrichedLinks = links.map(link => {
                const redirects = link.redirects.map(redirect => ({
                    ...redirect,
                    dailyClicks: clicksMap[redirect._id.toString()] || 0
                }));

                const totalDailyClicks = redirects.reduce((sum, r) => sum + r.dailyClicks, 0);

                return {
                    ...link,
                    redirects,
                    dailyClicks: totalDailyClicks
                };
            });

            const totalClicks = await Click.getTotalClicksToday();

            res.json({
                links: enrichedLinks,
                totalClicks,
                date: date || new Date().toISOString().split('T')[0]
            });

        } catch (error) {
            next(error);
        }
    }

    // Получить одну ссылку
    async getOne(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const link = await Link.findOne({
                _id: req.params.id,
                userId: req.user.id
            });

            if (!link) {
                return res.status(404).json({ error: 'Link not found' });
            }

            res.json(link);

        } catch (error) {
            next(error);
        }
    }

    // Создать новую ссылку
    async create(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { key, name, redirects } = req.body;

            // Проверяем уникальность ключа
            const existingLink = await Link.findOne({ key });
            if (existingLink) {
                return res.status(400).json({ error: 'Link key already exists' });
            }

            // Формируем массив редиректов с позициями
            const redirectsWithPositions = redirects.map((url, index) => ({
                url,
                position: index,
                clickCount: 0
            }));

            const link = await Link.create({
                key,
                name: name || '',
                redirects: redirectsWithPositions,
                userId: req.user.id
            });

            res.status(201).json(link);

        } catch (error) {
            next(error);
        }
    }

    // Обновить ссылку
    async update(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { key, name, redirects } = req.body;
            const linkId = req.params.id;

            const link = await Link.findOne({
                _id: linkId,
                userId: req.user.id
            });

            if (!link) {
                return res.status(404).json({ error: 'Link not found' });
            }

            // Проверяем уникальность ключа если он меняется
            if (key && key !== link.key) {
                const existingLink = await Link.findOne({ key });
                if (existingLink) {
                    return res.status(400).json({ error: 'Link key already exists' });
                }

                // Удаляем старый кеш
                await clearLinkCache(link.key);

                link.key = key;
            }

            if (name !== undefined) {
                link.name = name;
            }

            if (redirects && Array.isArray(redirects)) {
                link.redirects = redirects.map((url, index) => ({
                    url,
                    position: index,
                    clickCount: 0
                }));
            }

            await link.save();

            // Очищаем кеш
            await clearLinkCache(link.key);

            res.json(link);

        } catch (error) {
            next(error);
        }
    }

    // Удалить ссылку
    async delete(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const link = await Link.findOne({
                _id: req.params.id,
                userId: req.user.id
            });

            if (!link) {
                return res.status(404).json({ error: 'Link not found' });
            }

            // Очищаем кеш
            await clearLinkCache(link.key);

            // Удаляем ссылку
            await link.deleteOne();

            // Удаляем связанные клики (опционально, можно оставить для статистики)
            // await Click.deleteMany({ linkId: link._id });

            res.json({ message: 'Link deleted successfully' });

        } catch (error) {
            next(error);
        }
    }

    // Удалить все ссылки пользователя
    async deleteAll(req, res, next) {
        try {
            const userId = req.user.id;

            // Получаем все ссылки пользователя
            const links = await Link.find({ userId });

            // Очищаем кеш для каждой ссылки
            for (const link of links) {
                await clearLinkCache(link.key);
            }

            // Удаляем все ссылки
            await Link.deleteMany({ userId });

            res.json({ message: 'All links deleted successfully' });

        } catch (error) {
            next(error);
        }
    }

    // Экспорт в CSV
    async exportCSV(req, res, next) {
        try {
            const { date } = req.query;
            const userId = req.user.id;

            const links = await Link.find({ userId }).lean();

            let dailyStats = [];
            if (date) {
                dailyStats = await Click.getDailyStats(date);
            }

            const clicksMap = {};
            dailyStats.forEach(stat => {
                clicksMap[stat._id.toString()] = stat.count;
            });

            // Формируем CSV
            let csv = 'Link Key,Link Name,Redirect URL,Total Clicks,Daily Clicks\n';

            links.forEach(link => {
                link.redirects.forEach(redirect => {
                    const dailyClicks = clicksMap[redirect._id.toString()] || 0;
                    csv += `"${link.key}","${link.name || ''}","${redirect.url}",${redirect.clickCount},${dailyClicks}\n`;
                });
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=links_export_${Date.now()}.csv`);
            res.send(csv);

        } catch (error) {
            next(error);
        }
    }

    // Получить все ссылки пользователя
    async getAll(req, res, next) {
        try {
            const { date } = req.query;
            const userId = req.user.id;

            const links = await Link.find({ userId }).sort({ createdAt: -1 }).lean();

            // Получаем статистику кликов за выбранную дату
            let dailyStats = [];
            let totalClicksForDate = 0;

            if (date) {
                dailyStats = await Click.getDailyStats(date);

                // Считаем общее количество кликов за выбранную дату
                totalClicksForDate = dailyStats.reduce((sum, stat) => sum + stat.count, 0);
            } else {
                // Если дата не указана - берем сегодняшнюю
                const today = new Date().toISOString().split('T')[0];
                dailyStats = await Click.getDailyStats(today);
                totalClicksForDate = await Click.getTotalClicksToday();
            }

            // Формируем карту кликов по redirectId
            const clicksMap = {};
            dailyStats.forEach(stat => {
                clicksMap[stat._id.toString()] = stat.count;
            });

            // Обогащаем данные ссылок статистикой
            const enrichedLinks = links.map(link => {
                const redirects = link.redirects.map(redirect => ({
                    ...redirect,
                    dailyClicks: clicksMap[redirect._id.toString()] || 0
                }));

                const totalDailyClicks = redirects.reduce((sum, r) => sum + r.dailyClicks, 0);

                return {
                    ...link,
                    redirects,
                    dailyClicks: totalDailyClicks
                };
            });

            res.json({
                links: enrichedLinks,
                totalClicks: totalClicksForDate,
                date: date || new Date().toISOString().split('T')[0]
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new LinkController();