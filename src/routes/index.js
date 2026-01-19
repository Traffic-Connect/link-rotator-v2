const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const linkRoutes = require('./links');
const userRoutes = require('./users');
const statsRoutes = require('./stats');
const cloudflareRoutes = require('./cloudflare');
const cloudflareCacheRoutes = require('./cloudflareCache');
const cloudflareCloakRoutes = require('./cloudflareCloak');
const cloudflareCloakWaMoneyRoutes = require('./cloudflareCloakWaMoney');
const cloudflareRedirectRoutes = require('./cloudflareRedirect');
const subdomainRoutes = require('./subdomains');

// API routes
router.use('/auth', authRoutes);
router.use('/links', linkRoutes);
router.use('/users', userRoutes);
router.use('/stats', statsRoutes);
router.use('/cloudflare', cloudflareRoutes);
router.use('/cloudflare-cache', cloudflareCacheRoutes);
router.use('/cloudflare-cloak', cloudflareCloakRoutes);
router.use('/cloudflare-wa-money', cloudflareCloakWaMoneyRoutes);
router.use('/cloudflare-redirect', cloudflareRedirectRoutes);
router.use('/subdomains', subdomainRoutes);

module.exports = router;
