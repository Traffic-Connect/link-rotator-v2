const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const statsController = require('../controllers/statsController');
const analyticsController = require('../controllers/analyticsController');

router.use(authenticate);

router.get('/dashboard', statsController.getDashboard);

router.get('/link/:linkId', statsController.getLinkStats);

router.get('/top-links', statsController.getTopLinks);

router.get('/analytics', analyticsController.getAnalytics);

module.exports = router;