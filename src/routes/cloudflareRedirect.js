const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const cloudflareRedirectController = require('../controllers/cloudflareRedirectController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.get('/status', cloudflareRedirectController.getStatus);

router.post('/jobs',
    [
        body('action').isIn(['create', 'delete']).withMessage('Invalid action'),
        body('originUrls')
            .custom((value, { req }) => {
                return typeof value === 'string' && value.trim().length > 0;
            })
            .withMessage('Origin URLs are required'),
        body('partnerUrls')
            .custom((value, { req }) => {
                if (req.body.action === 'create') {
                    return typeof value === 'string' && value.trim().length > 0;
                }
                return true;
            })
            .withMessage('Partner URLs are required'),
        body('config.verifyReverseDns').optional().isBoolean(),
        body('config.failOpenOnDnsError').optional().isBoolean(),
        body('config.rdnsCacheTtl').optional().isNumeric(),
        body('config.bypassGeos').optional().isString(),
        body('config.wpPaths').optional().isString(),
        body('config.treatMarkupTestsAsGoogle').optional().isBoolean()
    ],
    cloudflareRedirectController.createJob
);

module.exports = router;
