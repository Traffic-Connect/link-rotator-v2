const { validationResult } = require('express-validator');
const CloudflareCredential = require('../models/CloudflareCredential');
const Link = require('../models/Link');
const { verifyCredentials } = require('../services/cloudflareManager');

class CloudflareCredentialController {
    async list(req, res, next) {
        try {
            const credentials = await CloudflareCredential.find()
                .sort({ createdAt: -1 })
                .select('label login accountId accountName lastVerifiedAt createdAt updatedAt')
                .lean();

            res.json({ credentials });
        } catch (error) {
            next(error);
        }
    }

    async create(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { label, login, password, apiToken } = req.body;

            const verification = await verifyCredentials(apiToken);

            if (!verification.accountId) {
                return res.status(400).json({ error: 'Cloudflare API token is not linked to an account' });
            }

            const credential = await CloudflareCredential.create({
                label: label || login,
                login,
                password,
                apiToken,
                accountId: verification.accountId,
                accountName: verification.accountName,
                lastVerifiedAt: new Date(),
                createdBy: req.user.id
            });

            res.status(201).json({
                credential: {
                    id: credential._id,
                    label: credential.label,
                    login: credential.login,
                    accountId: credential.accountId,
                    accountName: credential.accountName,
                    lastVerifiedAt: credential.lastVerifiedAt
                }
            });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(400).json({ error: 'Cloudflare credential already exists' });
            }
            if (error.status || error.statusCode) {
                return res.status(error.status || error.statusCode || 400).json({
                    error: error.message,
                    messages: error.messages || [],
                    details: error.details || []
                });
            }
            next(error);
        }
    }

    async remove(req, res, next) {
        try {
            const { id } = req.params;

            const credential = await CloudflareCredential.findById(id).select('+apiToken');

            if (!credential) {
                return res.status(404).json({ error: 'Credential not found' });
            }

            const linked = await Link.exists({
                'cloudflare.credential': credential._id,
                'cloudflare.enabled': true
            });

            if (linked) {
                return res.status(400).json({ error: 'Credential is used by existing links' });
            }

            await credential.deleteOne();

            res.json({ message: 'Credential deleted successfully' });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new CloudflareCredentialController();
