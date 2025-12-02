const Link = require('../models/Link');
const Click = require('../models/Click');
const mongoose = require('mongoose');

class AnalyticsController {
    async getAnalytics(req, res, next) {
        try {
            const { startDate, endDate } = req.query;
            const userId = req.user.id;

            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            const links = await Link.find({ userId }).lean();
            const linkIds = links.map(l => l._id);

            const totalClicks = await Click.countDocuments({
                linkId: { $in: linkIds },
                createdAt: { $gte: start, $lte: end }
            });

            const clicksByDayRaw = await Click.aggregate([
                {
                    $match: {
                        linkId: { $in: linkIds },
                        createdAt: { $gte: start, $lte: end }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } },
                {
                    $project: {
                        date: '$_id',
                        count: 1,
                        _id: 0
                    }
                }
            ]);

            const clicksMap = {};
            clicksByDayRaw.forEach(item => {
                clicksMap[item.date] = item.count;
            });

            const clicksByDay = [];
            const currentDate = new Date(start);
            while (currentDate <= end) {
                const dateStr = currentDate.toISOString().split('T')[0];
                clicksByDay.push({
                    date: dateStr,
                    count: clicksMap[dateStr] || 0
                });
                currentDate.setDate(currentDate.getDate() + 1);
            }

            const topLinks = await Click.aggregate([
                {
                    $match: {
                        linkId: { $in: linkIds },
                        createdAt: { $gte: start, $lte: end }
                    }
                },
                {
                    $group: {
                        _id: '$linkId',
                        clicks: { $sum: 1 }
                    }
                },
                { $sort: { clicks: -1 } },
                { $limit: 5 },
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
                    $project: {
                        key: '$link.key',
                        name: '$link.name',
                        clicks: 1,
                        _id: 0
                    }
                }
            ]);

            const detailedStats = await Promise.all(
                links.map(async (link) => {
                    const periodClicks = await Click.countDocuments({
                        linkId: link._id,
                        createdAt: { $gte: start, $lte: end }
                    });

                    const redirectCount = link.redirects?.length || 0;
                    const avgPerRedirect = redirectCount > 0
                        ? Math.round(periodClicks / redirectCount)
                        : 0;

                    return {
                        _id: link._id,
                        key: link.key,
                        name: link.name,
                        totalClicks: link.totalClicks || 0,
                        periodClicks,
                        redirectCount,
                        avgPerRedirect
                    };
                })
            );

            detailedStats.sort((a, b) => b.periodClicks - a.periodClicks);

            const uniqueLinks = detailedStats.filter(l => l.periodClicks > 0).length;

            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;
            const avgClicksPerDay = Math.round(totalClicks / daysDiff);

            const peakDay = clicksByDay.reduce((max, day) =>
                    day.count > max.count ? day : max,
                { count: 0, date: '-' }
            );

            res.json({
                totalClicks,
                uniqueLinks,
                avgClicksPerDay,
                peakClicks: peakDay.count,
                peakDate: peakDay.date !== '-' ? new Date(peakDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-',
                clicksByDay,
                topLinks,
                detailedStats
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AnalyticsController();