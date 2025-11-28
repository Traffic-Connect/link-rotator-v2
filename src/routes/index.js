const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const linkRoutes = require('./links');
const userRoutes = require('./users');
const statsRoutes = require('./stats');

// API routes
router.use('/auth', authRoutes);
router.use('/links', linkRoutes);
router.use('/users', userRoutes);
router.use('/stats', statsRoutes);

module.exports = router;