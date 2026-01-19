const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const cloudflareCacheController = require('../controllers/cloudflareCacheController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.get('/status', cloudflareCacheController.getStatus);

router.post('/jobs',
    [
        body('action').isIn(['create', 'purge', 'disable']).withMessage('Invalid action'),
        body('domains').notEmpty().withMessage('Domains are required')
    ],
    cloudflareCacheController.createJob
);

module.exports = router;
