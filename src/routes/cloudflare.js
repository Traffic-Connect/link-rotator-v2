const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const cloudflareCredentialController = require('../controllers/cloudflareCredentialController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.get('/credentials', cloudflareCredentialController.list);

router.post('/credentials',
    [
        body('label').optional().isString().trim(),
        body('login').isString().trim().notEmpty(),
        body('password').isString().trim().notEmpty(),
        body('apiToken').isString().trim().notEmpty()
    ],
    cloudflareCredentialController.create
);

router.delete('/credentials/:id',
    param('id').isMongoId().withMessage('Invalid credential ID'),
    cloudflareCredentialController.remove
);

module.exports = router;
