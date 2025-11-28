const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const statsController = require('../controllers/statsController');

// Все роуты требуют аутентификации
router.use(authenticate);

// Получить общую статистику
router.get('/dashboard', statsController.getDashboard);

// Получить статистику по конкретной ссылке
router.get('/link/:linkId', statsController.getLinkStats);

// Получить топ ссылок
router.get('/top-links', statsController.getTopLinks);

module.exports = router;