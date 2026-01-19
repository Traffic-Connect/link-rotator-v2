const { validationResult } = require('express-validator');
const { initializeJob, getCurrentJob } = require('../services/cloudflareWaMoneyJobManager');

class CloudflareWaMoneyController {
    getStatus(req, res) {
        res.json({ job: getCurrentJob() });
    }

    createJob(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { action, archiveUrls, moneyUrls, config } = req.body;

            if (!['create', 'delete'].includes(action)) {
                return res.status(400).json({ error: 'Invalid action. Use create or delete.' });
            }

            const job = initializeJob({
                action,
                archiveUrls,
                moneyUrls,
                config,
                requestedBy: req.user?.email || 'system'
            });

            res.status(201).json({ job });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CloudflareWaMoneyController();
