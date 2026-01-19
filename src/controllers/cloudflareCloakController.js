const { initializeJob, getCurrentJob } = require('../services/cloudflareCloakJobManager');

class CloudflareCloakController {
    getStatus(req, res) {
        res.json({ job: getCurrentJob() });
    }

    createJob(req, res, next) {
        try {
            const { action, domains, config } = req.body;

            if (!['create', 'delete'].includes(action)) {
                return res.status(400).json({ error: 'Invalid action. Use create or delete.' });
            }

            const job = initializeJob({
                action,
                domains,
                config,
                requestedBy: req.user?.email || 'system'
            });

            res.status(201).json({ job });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CloudflareCloakController();
