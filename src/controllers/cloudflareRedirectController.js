const { validationResult } = require('express-validator');
const { initializeJob, getCurrentJob } = require('../services/cloudflareRedirectJobManager');

class CloudflareRedirectController {
    getStatus(req, res) {
        res.json({ job: getCurrentJob() });
    }

    createJob(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { action, originUrls, partnerUrls, config } = req.body;

            if (!['create', 'delete'].includes(action)) {
                return res.status(400).json({ error: 'Invalid action. Use create or delete.' });
            }

            if (action === 'create') {
                if (!originUrls || !partnerUrls) {
                    return res.status(400).json({ error: 'Origin and Partner URLs are required' });
                }
            }

            const job = initializeJob({
                action,
                originUrls,
                partnerUrls,
                config,
                requestedBy: req.user?.email || 'system'
            });

            res.status(201).json({ job });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CloudflareRedirectController();
