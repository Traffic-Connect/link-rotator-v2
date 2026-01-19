const {
    configureDomainCaching,
    purgeDomainCache,
    disableDomainCaching
} = require('./cloudflareCachingService');

const JOB_STATUS = {
    IDLE: 'idle',
    RUNNING: 'running',
    COMPLETED: 'completed'
};

let currentJob = {
    status: JOB_STATUS.IDLE
};

function createResult(entry) {
    return {
        domain: entry.domain || entry.managerDomain || entry.cloudflareDomain,
        managerDomain: entry.managerDomain,
        cloudflareDomain: entry.cloudflareDomain,
        status: 'pending',
        message: '',
        logs: []
    };
}

function recordLog(result, level, message, extra = {}) {
    if (!result.logs) {
        result.logs = [];
    }

    result.logs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level,
        message,
        stage: extra.stage || null,
        timestamp: new Date().toISOString()
    });
}

function collectErrorMessages(error) {
    const messages = [];

    if (Array.isArray(error?.messages) && error.messages.length) {
        messages.push(...error.messages.filter(Boolean));
    }

    if (Array.isArray(error?.details)) {
        error.details.forEach(detail => {
            if (detail?.message) {
                messages.push(detail.code ? `[${detail.code}] ${detail.message}` : detail.message);
            }
            if (Array.isArray(detail?.error_chain)) {
                detail.error_chain.forEach(chainItem => {
                    if (chainItem?.message) {
                        messages.push(chainItem.message);
                    }
                });
            }
        });
    }

    if (messages.length === 0 && error?.message) {
        messages.push(error.message);
    }

    return [...new Set(messages)];
}

function extractHostname(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    let input = value.trim();
    if (!input) {
        return '';
    }

    if (!/^https?:\/\//i.test(input)) {
        input = `https://${input}`;
    }

    try {
        const url = new URL(input);
        return url.hostname.toLowerCase();
    } catch (error) {
        return value.trim().toLowerCase();
    }
}

function prepareDomainEntry(entry) {
    if (!entry || typeof entry !== 'string') {
        return null;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
        return null;
    }

    const hostname = extractHostname(trimmed);
    if (!hostname) {
        return null;
    }

    const managerDomain = hostname;
    const cloudflareDomain = managerDomain.replace(/^www\./i, '');

    return {
        input: entry,
        domain: trimmed,
        managerDomain,
        cloudflareDomain
    };
}

function normalizeDomains(domains) {
    if (!domains) {
        return [];
    }
    const list = Array.isArray(domains) ? domains : domains.split('\n');
    const entries = [];
    const seen = new Set();

    list.forEach(item => {
        const parsed = prepareDomainEntry(item);
        if (!parsed) {
            return;
        }
        const key = parsed.cloudflareDomain || parsed.managerDomain;
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push(parsed);
    });

    return entries;
}

function getCurrentJob() {
    return currentJob;
}

function ensureNoActiveJob() {
    if (currentJob.status === JOB_STATUS.RUNNING) {
        const error = new Error('A Cloudflare caching job is already running');
        error.statusCode = 400;
        throw error;
    }
}

function initializeJob({ action, domains, requestedBy }) {
    const domainEntries = normalizeDomains(domains);

    if (domainEntries.length === 0) {
        const error = new Error('Please provide at least one domain');
        error.statusCode = 400;
        throw error;
    }

    ensureNoActiveJob();

    currentJob = {
        id: Date.now().toString(),
        status: JOB_STATUS.RUNNING,
        action,
        total: domainEntries.length,
        completed: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestedBy,
        domains: domainEntries,
        results: domainEntries.map(createResult)
    };

    processJob();

    return currentJob;
}

async function processDomain(action, domainEntry) {
    switch (action) {
        case 'create':
            return configureDomainCaching(domainEntry);
        case 'purge':
            return purgeDomainCache(domainEntry);
        case 'disable':
            return disableDomainCaching(domainEntry);
        default:
            throw new Error('Unsupported job action');
    }
}

async function processJob() {
    for (const item of currentJob.results) {
        item.status = 'in_progress';
        item.message = '';
        currentJob.updatedAt = new Date().toISOString();

        try {
            const result = await processDomain(currentJob.action, item);
            const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
            const resultMessage = result?.message;
            item.status = 'success';
            item.warningMessages = warnings.map(warning => warning.message);
            if (warnings.length > 0) {
                item.message = resultMessage || 'Completed with warnings';
                warnings.forEach(warning => {
                    recordLog(item, 'warning', warning.message, { stage: warning.stage });
                });
            } else {
                item.message = resultMessage || 'Completed successfully';
            }
        } catch (error) {
            item.status = 'error';
            item.message = error.message || 'Unknown error';
            item.errorStage = error.stage || null;
            item.errorStatusCode = error.statusCode || error.status || null;
            item.errorMessages = collectErrorMessages(error);
            if (error.cloudflareResponse) {
                item.cloudflareResponse = error.cloudflareResponse;
            }
            item.errorMessages.forEach(message => {
                recordLog(item, 'error', message, { stage: item.errorStage });
            });
        }

        currentJob.completed += 1;
        currentJob.updatedAt = new Date().toISOString();
    }

    currentJob.status = JOB_STATUS.COMPLETED;
    currentJob.finishedAt = new Date().toISOString();
}

module.exports = {
    getCurrentJob,
    initializeJob
};
