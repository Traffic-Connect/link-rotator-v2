const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const subdomainController = require('../controllers/subdomainController');
const { authenticate, authorize } = require('../middleware/auth');

const subdomainValidator = body('subdomain')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Subdomain is required')
    .matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i)
    .withMessage('Subdomain must contain 1-63 alphanumeric characters or hyphen (no leading/trailing hyphen)');

router.use(authenticate, authorize('admin'));

router.get('/', subdomainController.list);

router.post('/',
    [
        subdomainValidator,
        body('domains')
            .custom(value => {
                if (Array.isArray(value)) {
                    return value.length > 0;
                }
                return typeof value === 'string' && value.trim().length > 0;
            })
            .withMessage('Please provide at least one domain')
    ],
    subdomainController.create
);

router.put('/:id',
    [
        param('id').isMongoId().withMessage('Invalid subdomain ID'),
        subdomainValidator
    ],
    subdomainController.update
);

router.delete('/:id',
    param('id').isMongoId().withMessage('Invalid subdomain ID'),
    subdomainController.remove
);

router.post('/bulk-delete',
    [
        body('ids').isArray({ min: 1 }).withMessage('Please provide IDs to delete'),
        body('ids.*').isMongoId().withMessage('Invalid subdomain ID')
    ],
    subdomainController.bulkRemove
);

module.exports = router;
