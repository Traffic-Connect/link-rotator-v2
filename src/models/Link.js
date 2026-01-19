const mongoose = require('mongoose');

const redirectSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true,
        trim: true
    },
    position: {
        type: Number,
        required: true,
        default: 0
    },
    clickCount: {
        type: Number,
        default: 0,
        index: true
    }
}, { _id: true });

const cloudflareSchema = new mongoose.Schema({
    enabled: {
        type: Boolean,
        default: false
    },
    credential: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CloudflareCredential'
    },
    link: {
        type: String,
        trim: true
    },
    workerName: {
        type: String,
        trim: true
    },
    workerId: {
        type: String,
        trim: true
    },
    routeId: {
        type: String,
        trim: true
    },
    routePattern: {
        type: String,
        trim: true
    },
    zoneId: {
        type: String,
        trim: true
    },
    zoneName: {
        type: String,
        trim: true
    },
    dnsRecordId: {
        type: String,
        trim: true
    },
    dnsHostname: {
        type: String,
        trim: true
    }
}, { _id: false });

const linkSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    name: {
        type: String,
        trim: true,
        default: ''
    },
    redirects: [redirectSchema],
    totalClicks: {
        type: Number,
        default: 0,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    cloudflare: {
        type: cloudflareSchema,
        default: () => ({ enabled: false })
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Индексы для производительности
linkSchema.index({ key: 1, isActive: 1 });
linkSchema.index({ userId: 1, createdAt: -1 });
linkSchema.index({ 'redirects.clickCount': -1 });
linkSchema.index(
    { 'cloudflare.credential': 1, 'cloudflare.link': 1 },
    {
        unique: true,
        partialFilterExpression: {
            'cloudflare.enabled': true,
            'cloudflare.credential': { $type: 'objectId' },
            'cloudflare.link': { $type: 'string' }
        }
    }
);

// Виртуальное поле для кликов
linkSchema.virtual('clicks', {
    ref: 'Click',
    localField: '_id',
    foreignField: 'linkId'
});

// Методы модели
linkSchema.methods.getNextRedirect = function() {
    if (!this.redirects || this.redirects.length === 0) {
        return null;
    }

    // Сортируем по позиции
    const sortedRedirects = this.redirects.sort((a, b) => a.position - b.position);
    return sortedRedirects[0];
};

linkSchema.methods.rotateRedirects = function() {
    if (!this.redirects || this.redirects.length <= 1) {
        return;
    }

    // Циклический сдвиг позиций
    this.redirects.forEach(redirect => {
        redirect.position = (redirect.position + 1) % this.redirects.length;
    });
};

linkSchema.methods.incrementRedirectClick = function(redirectId) {
    const redirect = this.redirects.id(redirectId);
    if (redirect) {
        redirect.clickCount += 1;
        this.totalClicks += 1;
    }
};

// Статические методы
linkSchema.statics.findByKey = function(key) {
    return this.findOne({ key, isActive: true });
};

linkSchema.statics.getStats = async function(userId, dateFilter = null) {
    const Click = mongoose.model('Click');

    const matchStage = { userId };
    if (dateFilter) {
        matchStage.createdAt = {
            $gte: new Date(dateFilter),
            $lt: new Date(new Date(dateFilter).getTime() + 24 * 60 * 60 * 1000)
        };
    }

    const stats = await this.aggregate([
        { $match: matchStage },
        {
            $lookup: {
                from: 'clicks',
                let: { linkId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$linkId', '$$linkId'] },
                            ...(dateFilter ? {
                                createdAt: {
                                    $gte: new Date(dateFilter),
                                    $lt: new Date(new Date(dateFilter).getTime() + 24 * 60 * 60 * 1000)
                                }
                            } : {})
                        }
                    },
                    {
                        $group: {
                            _id: '$redirectId',
                            count: { $sum: 1 }
                        }
                    }
                ],
                as: 'dailyClicks'
            }
        },
        {
            $project: {
                key: 1,
                name: 1,
                redirects: 1,
                totalClicks: 1,
                dailyClicks: 1,
                createdAt: 1,
                updatedAt: 1
            }
        },
        { $sort: { createdAt: -1 } }
    ]);

    return stats;
};

const Link = mongoose.model('Link', linkSchema);

module.exports = Link;
