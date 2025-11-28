const mongoose = require('mongoose');

const clickSchema = new mongoose.Schema({
    linkId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Link',
        required: true,
        index: true
    },
    redirectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    redirectUrl: {
        type: String,
        required: true
    },
    ipAddress: {
        type: String,
        default: ''
    },
    userAgent: {
        type: String,
        default: ''
    },
    referer: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Составные индексы для быстрых запросов
clickSchema.index({ linkId: 1, createdAt: -1 });
clickSchema.index({ redirectId: 1, createdAt: -1 });
clickSchema.index({ createdAt: -1 });

// TTL индекс - автоматическое удаление старых записей через 90 дней
clickSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Статические методы
clickSchema.statics.getDailyStats = async function(dateFilter) {
    const startOfDay = new Date(dateFilter);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dateFilter);
    endOfDay.setHours(23, 59, 59, 999);

    return await this.aggregate([
        {
            $match: {
                createdAt: {
                    $gte: startOfDay,
                    $lte: endOfDay
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
};

clickSchema.statics.getTotalClicksToday = async function() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await this.countDocuments({
        createdAt: { $gte: today }
    });
};

clickSchema.statics.getClicksByLink = async function(linkId, startDate, endDate) {
    const match = { linkId };

    if (startDate && endDate) {
        match.createdAt = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    return await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    redirectId: '$redirectId'
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.date': -1 } }
    ]);
};

const Click = mongoose.model('Click', clickSchema);

module.exports = Click;