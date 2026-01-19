const { validationResult } = require('express-validator');
const Subdomain = require('../models/Subdomain');
const {
    sanitizeSubdomain,
    parseDomainsInput,
    createSubdomainRecord,
    deleteCloudflareRecord,
    recreateSubdomainRecord
} = require('../services/subdomainService');

class SubdomainController {
    async list(req, res, next) {
        try {
            const subdomains = await Subdomain.find()
                .sort({ createdAt: -1 })
                .lean();

            res.json({ subdomains });
        } catch (error) {
            next(error);
        }
    }

    async create(req, res, next) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const normalizedSubdomain = sanitizeSubdomain(req.body.subdomain);
        if (!normalizedSubdomain) {
            return res.status(400).json({ error: 'Invalid subdomain value' });
        }

        const domains = parseDomainsInput(req.body.domains);
        if (!domains.length) {
            return res.status(400).json({ error: 'Please provide at least one domain' });
        }

        try {
            const duplicates = await Subdomain.find({
                subdomain: normalizedSubdomain,
                domain: { $in: domains }
            }).lean();

            if (duplicates.length) {
                const existingDomains = duplicates.map(item => item.domain).join(', ');
                return res.status(400).json({
                    error: `Subdomain already exists for domains: ${existingDomains}`
                });
            }

            const docsPayload = [];
            const rollbackTasks = [];

            try {
                for (const domain of domains) {
                    const result = await createSubdomainRecord({
                        domain,
                        subdomain: normalizedSubdomain
                    });
                    rollbackTasks.push(() => result.rollback());
                    docsPayload.push({
                        ...result.document,
                        createdBy: req.user.id
                    });
                }
            } catch (error) {
                await Promise.allSettled(rollbackTasks.map(task => task()));
                throw error;
            }

            let inserted;
            try {
                inserted = await Subdomain.insertMany(docsPayload, { ordered: true });
            } catch (error) {
                await Promise.allSettled(rollbackTasks.map(task => task()));
                throw error;
            }

            res.status(201).json({ subdomains: inserted });
        } catch (error) {
            next(error);
        }
    }

    async update(req, res, next) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const normalizedSubdomain = sanitizeSubdomain(req.body.subdomain);
        if (!normalizedSubdomain) {
            return res.status(400).json({ error: 'Invalid subdomain value' });
        }

        try {
            const subdomain = await Subdomain.findById(req.params.id);
            if (!subdomain) {
                return res.status(404).json({ error: 'Subdomain not found' });
            }

            if (subdomain.subdomain === normalizedSubdomain) {
                return res.json({ subdomain });
            }

            const conflict = await Subdomain.findOne({
                _id: { $ne: subdomain._id },
                subdomain: normalizedSubdomain,
                domain: subdomain.domain
            }).lean();

            if (conflict) {
                return res.status(400).json({ error: 'Subdomain already exists for this domain' });
            }

            const updatedRecord = await recreateSubdomainRecord(subdomain, normalizedSubdomain);

            subdomain.subdomain = updatedRecord.subdomain;
            subdomain.fqdn = updatedRecord.fqdn;
            subdomain.zoneId = updatedRecord.zoneId;
            subdomain.zoneName = updatedRecord.zoneName;
            subdomain.dnsRecordId = updatedRecord.dnsRecordId;
            subdomain.dnsRecordType = updatedRecord.dnsRecordType;
            subdomain.dnsContent = updatedRecord.dnsContent;
            subdomain.ttl = updatedRecord.ttl;
            subdomain.proxied = updatedRecord.proxied;
            subdomain.updatedAt = new Date();

            await subdomain.save();

            res.json({ subdomain });
        } catch (error) {
            next(error);
        }
    }

    async remove(req, res, next) {
        try {
            const subdomain = await Subdomain.findById(req.params.id);
            if (!subdomain) {
                return res.status(404).json({ error: 'Subdomain not found' });
            }

            await deleteCloudflareRecord(subdomain);
            await subdomain.deleteOne();

            res.json({ message: 'Subdomain deleted', id: req.params.id });
        } catch (error) {
            next(error);
        }
    }

    async bulkRemove(req, res, next) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const ids = req.body.ids;

        try {
            const records = await Subdomain.find({ _id: { $in: ids } });
            if (!records.length) {
                return res.json({ deleted: 0 });
            }

            for (const record of records) {
                await deleteCloudflareRecord(record);
                await record.deleteOne();
            }

            res.json({ deleted: records.length });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new SubdomainController();
