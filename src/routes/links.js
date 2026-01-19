const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const linkController = require('../controllers/linkController');
const { authenticate } = require('../middleware/auth');

// Публичный редирект (без аутентификации)
router.get('/r/:key', linkController.redirect);

// Все остальные роуты требуют аутентификации
router.use(authenticate);

const cloudflareValidators = [
    body('cloudflare').optional().custom(value => {
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Cloudflare payload must be an object');
        }
        if (value.enabled) {
            if (!value.credentialId) {
                throw new Error('Cloudflare credential is required');
            }
            if (!value.link || typeof value.link !== 'string' || !value.link.trim()) {
                throw new Error('Cloudflare Link is required');
            }
        }
        return true;
    }),
    body('cloudflare.enabled').optional().isBoolean(),
    body('cloudflare.credentialId').optional().isMongoId().withMessage('Invalid Cloudflare credential'),
    body('cloudflare.link').optional().isString().trim().withMessage('Cloudflare Link must be a string')
];

// Получить все ссылки текущего пользователя
router.get('/', linkController.getAll);

// Получить одну ссылку по ID
router.get('/:id',
    param('id').isMongoId().withMessage('Invalid link ID'),
    linkController.getOne
);

// Создать новую ссылку
router.post('/',
    [
        body('key')
            .trim()
            .notEmpty()
            .withMessage('Key is required')
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage('Key can only contain letters, numbers, dashes and underscores'),
        body('name').optional().trim(),
        body('redirects')
            .isArray({ min: 1 })
            .withMessage('At least one redirect URL is required'),
        body('redirects.*')
            .isURL({ require_protocol: true })
            .withMessage('Each redirect must be a valid URL')
    ].concat(cloudflareValidators),
    linkController.create
);

// Обновить ссылку
router.put('/:id',
    [
        param('id').isMongoId().withMessage('Invalid link ID'),
        body('key')
            .optional()
            .trim()
            .notEmpty()
            .withMessage('Key cannot be empty')
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage('Key can only contain letters, numbers, dashes and underscores'),
        body('name').optional().trim(),
        body('redirects')
            .optional()
            .isArray({ min: 1 })
            .withMessage('At least one redirect URL is required'),
        body('redirects.*')
            .optional()
            .isURL({ require_protocol: true })
            .withMessage('Each redirect must be a valid URL')
    ].concat(cloudflareValidators),
    linkController.update
);

// Удалить ссылку
router.delete('/:id',
    param('id').isMongoId().withMessage('Invalid link ID'),
    linkController.delete
);

// Удалить все ссылки пользователя
router.delete('/', linkController.deleteAll);

// Экспорт статистики в CSV
router.get('/export/csv', linkController.exportCSV);

module.exports = router;
