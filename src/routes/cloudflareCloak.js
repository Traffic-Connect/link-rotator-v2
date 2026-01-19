const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const cloudflareCloakController = require('../controllers/cloudflareCloakController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.get('/status', cloudflareCloakController.getStatus);

router.post('/jobs',
    [
        body('action').isIn(['create', 'delete']).withMessage('Invalid action'),
        body('domains').notEmpty().withMessage('Domains are required')
    ],
    cloudflareCloakController.createJob
);

module.exports = router;
