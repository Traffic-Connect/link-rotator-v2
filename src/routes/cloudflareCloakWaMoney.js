const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const cloudflareWaMoneyController = require('../controllers/cloudflareWaMoneyController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.get('/status', cloudflareWaMoneyController.getStatus);

router.post('/jobs',
    [
        body('action').isIn(['create', 'delete']).withMessage('Invalid action'),
        body('archiveUrls')
            .custom((value, { req }) => {
                if (req.body.action === 'delete' || req.body.action === 'create') {
                    return typeof value === 'string' && value.trim().length > 0;
                }
                return true;
            })
            .withMessage('Archive URL is required'),
        body('moneyUrls')
            .custom((value, { req }) => {
                if (req.body.action === 'create') {
                    return typeof value === 'string' && value.trim().length > 0;
                }
                return true;
            })
            .withMessage('Money URL is required for create'),
        body('config.treatMarkupTestsAsGoogle').optional().isBoolean(),
        body('config.verifyReverseDns').optional().isBoolean(),
        body('config.failOpenOnDnsError').optional().isBoolean()
    ],
    cloudflareWaMoneyController.createJob
);

module.exports = router;
