const Link = require('../models/Link');
const Click = require('../models/Click');

class StatsController {
    async getDashboard(req, res, next) {
        try {
            const { date } = req.query;
            const userId = req.user.id;

            // Общее количество ссылок
            const totalLinks = await Link.countDocuments({ userId, isActive: true });

            // Общее количество кликов
            const totalClicks = await Click.countDocuments({
                linkId: { $in: await Link.find({ userId }).distinct('_id') }
            });

            // Клики за сегодня
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const todayClicks = await Click.countDocuments({
                linkId: { $in: await Link.find({ userId }).distinct('_id') },
                createdAt: { $gte: today }
            });

            // Статистика по дням за последнюю неделю
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const clicksByDay = await Click.aggregate([
                {
                    $match: {
                        linkId: { $in: await Link.find({ userId }).distinct('_id') },
                        createdAt: { $gte: weekAgo }
                    }
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            // Топ 5 ссылок по кликам
            const topLinks = await Link.find({ userId, isActive: true })
                .sort({ totalClicks: -1 })
                .limit(5)
                .select('key name totalClicks');

            res.json({
                totalLinks,
                totalClicks,
                todayClicks,
                clicksByDay,
                topLinks
            });

        } catch (error) {
            next(error);
        }
    }

    async getLinkStats(req, res, next) {
        try {
            const { linkId } = req.params;
            const { startDate, endDate } = req.query;

            const link = await Link.findOne({
                _id: linkId,
                userId: req.user.id
            });

            if (!link) {
                return res.status(404).json({ error: 'Link not found' });
            }

            // Получаем клики
            const clicks = await Click.getClicksByLink(linkId, startDate, endDate);

            // Группируем по редиректам
            const redirectStats = {};
            link.redirects.forEach(redirect => {
                redirectStats[redirect._id.toString()] = {
                    url: redirect.url,
                    position: redirect.position,
                    totalClicks: redirect.clickCount,
                    clicksByDate: []
                };
            });

            clicks.forEach(click => {
                const redirectId = click._id.redirectId.toString();
                if (redirectStats[redirectId]) {
                    redirectStats[redirectId].clicksByDate.push({
                        date: click._id.date,
                        count: click.count
                    });
                }
            });

            res.json({
                link: {
                    id: link._id,
                    key: link.key,
                    name: link.name,
                    totalClicks: link.totalClicks
                },
                redirects: Object.values(redirectStats)
            });

        } catch (error) {
            next(error);
        }
    }

    async getTopLinks(req, res, next) {
        try {
            const { limit = 10, period = '7d' } = req.query;
            const userId = req.user.id;

            // Определяем период
            let startDate = new Date();
            switch(period) {
                case '24h':
                    startDate.setHours(startDate.getHours() - 24);
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    break;
                default:
                    startDate.setDate(startDate.getDate() - 7);
            }

            // Получаем топ ссылки за период
            const topLinks = await Click.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$linkId',
                        clickCount: { $sum: 1 }
                    }
                },
                { $sort: { clickCount: -1 } },
                { $limit: parseInt(limit) },
                {
                    $lookup: {
                        from: 'links',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'link'
                    }
                },
                { $unwind: '$link' },
                {
                    $match: {
                        'link.userId': userId
                    }
                },
                {
                    $project: {
                        linkId: '$_id',
                        key: '$link.key',
                        name: '$link.name',
                        clickCount: 1
                    }
                }
            ]);

            res.json({ topLinks });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new StatsController();