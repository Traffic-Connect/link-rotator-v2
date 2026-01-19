const { initializeJob, getCurrentJob } = require('../services/cacheJobManager');

class CloudflareCacheController {
    getStatus(req, res) {
        res.json({ job: getCurrentJob() });
    }

    createJob(req, res, next) {
        try {
            const { action, domains } = req.body;

            if (!['create', 'purge', 'disable'].includes(action)) {
                return res.status(400).json({ error: 'Invalid action. Use create, purge or disable.' });
            }

            const job = initializeJob({
                action,
                domains,
                requestedBy: req.user?.email || 'system'
            });

            res.status(201).json({ job });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CloudflareCacheController();
