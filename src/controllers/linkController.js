const Link = require('../models/Link');
const Click = require('../models/Click');
const { validationResult } = require('express-validator');
const { redisGet, redisSet, redisDel } = require('../config/redis');
const CloudflareCredential = require('../models/CloudflareCredential');
const { syncWorker, removeWorker } = require('../services/cloudflareManager');

const REDIS_PREFIX = 'rotator:';
const ROTATION_CACHE_TTL = parseInt(process.env.ROTATION_CACHE_TTL) || 3600;

function mapRedirects(redirects) {
    return redirects.map((url, index) => ({
        url,
        position: index,
        clickCount: 0
    }));
}

async function loadCredential(credentialId) {
    if (!credentialId) {
        return null;
    }
    return CloudflareCredential.findById(credentialId)
        .select('+apiToken +password +accountId +accountName +login');
}

async function ensureCloudflareUnique(credentialId, cloudflareLink, excludeId = null) {
    if (!credentialId || !cloudflareLink) {
        return false;
    }
    const query = {
        'cloudflare.credential': credentialId,
        'cloudflare.link': cloudflareLink,
        'cloudflare.enabled': true
    };
    if (excludeId) {
        query._id = { $ne: excludeId };
    }
    const exists = await Link.findOne(query).select('_id').lean();
    return !!exists;
}

async function detachCloudflare(link) {
    if (!link?.cloudflare?.enabled) {
        return;
    }
    const credential = await loadCredential(link.cloudflare.credential);
    if (!credential) {
        return;
    }
    await removeWorker({
        credential,
        workerName: link.cloudflare.workerName,
        zoneId: link.cloudflare.zoneId,
        routeId: link.cloudflare.routeId,
        dnsRecordId: link.cloudflare.dnsRecordId
    });
}

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

            const links = await Link.find({ userId })
                .sort({ createdAt: -1 })
                .populate('cloudflare.credential', 'label login accountName')
                .lean();

            // Получаем ID всех ссылок пользователя
            const linkIds = links.map(link => link._id);

            // Определяем дату для статистики
            const selectedDate = date || new Date().toISOString().split('T')[0];

            // Получаем статистику по редиректам за выбранную дату
            const dailyStats = await Click.getDailyStats(selectedDate);

            // Считаем общее количество кликов за выбранную дату только для ссылок этого пользователя
            const startOfDay = new Date(selectedDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(selectedDate);
            endOfDay.setHours(23, 59, 59, 999);

            const totalClicksForDate = await Click.countDocuments({
                linkId: { $in: linkIds },
                createdAt: {
                    $gte: startOfDay,
                    $lte: endOfDay
                }
            });

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
                date: selectedDate
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
            }).populate('cloudflare.credential', 'label login accountName');

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

            const { key, name, redirects, cloudflare } = req.body;

            // Проверяем уникальность ключа
            const existingLink = await Link.findOne({ key });
            if (existingLink) {
                return res.status(400).json({ error: 'Link key already exists' });
            }

            const redirectsWithPositions = mapRedirects(redirects);
            let cloudflarePayload = { enabled: false };
            let credentialDoc = null;
            let workerMeta = null;

            if (cloudflare?.enabled) {
                const normalizedLink = cloudflare.link?.trim();
                if (!normalizedLink) {
                    return res.status(400).json({ error: 'Cloudflare Link is required' });
                }

                credentialDoc = await loadCredential(cloudflare.credentialId);
                if (!credentialDoc) {
                    return res.status(400).json({ error: 'Cloudflare credential not found' });
                }

                const duplicate = await ensureCloudflareUnique(credentialDoc._id, normalizedLink);
                if (duplicate) {
                    return res.status(400).json({ error: 'Cloudflare worker for this link already exists' });
                }

                workerMeta = await syncWorker({
                    credential: credentialDoc,
                    redirects,
                    cloudflareLink: normalizedLink,
                    fallbackSlug: key
                });

                cloudflarePayload = {
                    enabled: true,
                    credential: credentialDoc._id,
                    link: workerMeta.link,
                    workerName: workerMeta.workerName,
                    workerId: workerMeta.workerId,
                    routeId: workerMeta.routeId,
                    routePattern: workerMeta.routePattern,
                    zoneId: workerMeta.zoneId,
                    zoneName: workerMeta.zoneName,
                    dnsRecordId: workerMeta.dnsRecordId,
                    dnsHostname: workerMeta.dnsHostname
                };
            }

            let link;
            try {
                link = await Link.create({
                    key,
                    name: name || '',
                    redirects: redirectsWithPositions,
                    userId: req.user.id,
                    cloudflare: cloudflarePayload
                });
            } catch (creationError) {
                if (cloudflarePayload.enabled && credentialDoc && workerMeta) {
                    try {
                            await removeWorker({
                                credential: credentialDoc,
                                workerName: workerMeta.workerName,
                                zoneId: workerMeta.zoneId,
                                routeId: workerMeta.routeId,
                                dnsRecordId: workerMeta.dnsRecordId
                            });
                    } catch (cleanupError) {
                        console.error('Failed to rollback Cloudflare worker:', cleanupError);
                    }
                }
                throw creationError;
            }

            await link.populate('cloudflare.credential', 'label login accountName');

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

            const { key, name, redirects, cloudflare } = req.body;
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

            let redirectSource = link.redirects.map(r => r.url);

            if (redirects && Array.isArray(redirects)) {
                link.redirects = mapRedirects(redirects);
                redirectSource = redirects;
            }

            const existingCloudflare = link.cloudflare?.enabled
                ? (typeof link.cloudflare.toObject === 'function'
                    ? link.cloudflare.toObject()
                    : { ...link.cloudflare })
                : null;

            let newCloudflarePayload = existingCloudflare
                ? { ...existingCloudflare, credential: existingCloudflare.credential }
                : { enabled: false };

            if (cloudflare) {
                if (cloudflare.enabled) {
                    const normalizedLink = (cloudflare.link || existingCloudflare?.link || '').trim();
                    if (!normalizedLink) {
                        return res.status(400).json({ error: 'Cloudflare Link is required' });
                    }

                    const credentialId = cloudflare.credentialId || existingCloudflare?.credential?.toString();
                    if (!credentialId) {
                        return res.status(400).json({ error: 'Cloudflare credential is required' });
                    }

                    const credentialDoc = await loadCredential(credentialId);
                    if (!credentialDoc) {
                        return res.status(400).json({ error: 'Cloudflare credential not found' });
                    }

                    const duplicate = await ensureCloudflareUnique(credentialDoc._id, normalizedLink, link._id);
                    if (duplicate) {
                        return res.status(400).json({ error: 'Cloudflare worker for this link already exists' });
                    }

                    const workerMeta = await syncWorker({
                        credential: credentialDoc,
                        redirects: redirectSource,
                        cloudflareLink: normalizedLink,
                        fallbackSlug: key || link.key
                    });

                    newCloudflarePayload = {
                        enabled: true,
                        credential: credentialDoc._id,
                        link: workerMeta.link,
                        workerName: workerMeta.workerName,
                        workerId: workerMeta.workerId,
                        routeId: workerMeta.routeId,
                        routePattern: workerMeta.routePattern,
                        zoneId: workerMeta.zoneId,
                        zoneName: workerMeta.zoneName,
                        dnsRecordId: workerMeta.dnsRecordId,
                        dnsHostname: workerMeta.dnsHostname
                    };

                    if (existingCloudflare) {
                        const oldCredentialId = existingCloudflare.credential?.toString();
                        const workerChanged = existingCloudflare.workerName !== workerMeta.workerName
                            || existingCloudflare.routePattern !== workerMeta.routePattern
                            || existingCloudflare.zoneId !== workerMeta.zoneId
                            || oldCredentialId !== credentialDoc._id.toString();

                        if (workerChanged) {
                            const oldCredential = await loadCredential(existingCloudflare.credential);
                            if (oldCredential) {
                                await removeWorker({
                                    credential: oldCredential,
                                    workerName: existingCloudflare.workerName,
                                    zoneId: existingCloudflare.zoneId,
                                    routeId: existingCloudflare.routeId,
                                    dnsRecordId: existingCloudflare.dnsRecordId
                                });
                            }
                        }
                    }
                } else if (existingCloudflare) {
                    const oldCredential = await loadCredential(existingCloudflare.credential);
                    if (oldCredential) {
                        await removeWorker({
                            credential: oldCredential,
                            workerName: existingCloudflare.workerName,
                            zoneId: existingCloudflare.zoneId,
                            routeId: existingCloudflare.routeId,
                            dnsRecordId: existingCloudflare.dnsRecordId
                        });
                    }
                    newCloudflarePayload = { enabled: false };
                }
            }

            link.cloudflare = newCloudflarePayload;

            await link.save();

            await clearLinkCache(link.key);

            await link.populate('cloudflare.credential', 'label login accountName');

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

            if (link.cloudflare?.enabled) {
                await detachCloudflare(link);
            }

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
                if (link.cloudflare?.enabled) {
                    await detachCloudflare(link);
                }
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
            const { startDate, endDate } = req.query;
            const userId = req.user.id;

            const links = await Link.find({ userId }).lean();

            let dailyStats = [];
            if (startDate && endDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);

                dailyStats = await Click.aggregate([
                    {
                        $match: {
                            createdAt: {
                                $gte: start,
                                $lte: end
                            }
                        }
                    },
                    {
                        $group: {
                            _id: '$redirectId',
                            count: { $sum: 1 }
                        }
                    }
                ]);
            }

            const clicksMap = {};
            dailyStats.forEach(stat => {
                clicksMap[stat._id.toString()] = stat.count;
            });

            let csv = 'Link Key,Link Name,Redirect URL,Total Clicks,Period Clicks\n';

            links.forEach(link => {
                link.redirects.forEach(redirect => {
                    const periodClicks = clicksMap[redirect._id.toString()] || 0;
                    csv += `"${link.key}","${link.name || ''}","${redirect.url}",${redirect.clickCount},${periodClicks}\n`;
                });
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=links_export_${Date.now()}.csv`);
            res.send(csv);

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new LinkController();
