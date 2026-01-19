const {
    createWaMoneyForDomain,
    removeWaMoneyForDomain
} = require('./cloudflareWaMoneyService');

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
        domain: entry.domainLabel,
        managerDomain: entry.managerDomain,
        cloudflareDomain: entry.cloudflareDomain,
        archiveUrl: entry.archiveUrl,
        moneyUrl: entry.moneyUrl,
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

function parseUrlList(input) {
    if (!input) {
        return [];
    }
    const list = Array.isArray(input) ? input : input.split('\n');
    const urls = [];
    const seen = new Set();

    list.forEach(raw => {
        const trimmed = (raw || '').trim();
        if (!trimmed) {
            return;
        }
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        try {
            const url = new URL(withProtocol);
            const normalized = url.toString();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                urls.push(normalized);
            }
        } catch (error) {
            return;
        }
    });

    return urls;
}

function buildDomainEntry(url) {
    try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        const hostname = parsed.hostname.toLowerCase();
        const managerDomain = hostname; // у менеджер API відправляємо як є (можливо з www)
        const baseDomain = hostname.replace(/^www\./i, '');
        return {
            domainLabel: baseDomain,
            managerDomain,
            cloudflareDomain: baseDomain,
            archiveUrl: url
        };
    } catch (error) {
        return null;
    }
}

function normalizePairs(archiveUrls, moneyUrls) {
    const archives = parseUrlList(archiveUrls);
    const monies = parseUrlList(moneyUrls);
    const limit = Math.min(archives.length, monies.length);
    const entries = [];

    for (let i = 0; i < limit; i += 1) {
        const domainEntry = buildDomainEntry(archives[i]);
        if (!domainEntry) {
            continue;
        }
        entries.push({
            ...domainEntry,
            moneyUrl: monies[i]
        });
    }

    return entries;
}

function getCurrentJob() {
    return currentJob;
}

function ensureNoActiveJob() {
    if (currentJob.status === JOB_STATUS.RUNNING) {
        const error = new Error('A WA Money cloak job is already running');
        error.statusCode = 400;
        throw error;
    }
}

function initializeJob({ action, archiveUrls, moneyUrls, requestedBy, config }) {
    const pairs = action === 'delete'
        ? parseUrlList(archiveUrls).map(url => buildDomainEntry(url)).filter(Boolean)
        : normalizePairs(archiveUrls, moneyUrls);

    if (pairs.length === 0) {
        const error = new Error(action === 'delete'
            ? 'Please provide at least one archive URL'
            : 'Please provide at least one archive and money URL pair');
        error.statusCode = 400;
        throw error;
    }

    ensureNoActiveJob();

    currentJob = {
        id: Date.now().toString(),
        status: JOB_STATUS.RUNNING,
        action,
        total: pairs.length,
        completed: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        requestedBy,
        config: config || {},
        domains: pairs,
        results: pairs.map(createResult)
    };

    processJob();

    return currentJob;
}

async function processDomain(action, domainEntry, config) {
    switch (action) {
        case 'create':
            return createWaMoneyForDomain(domainEntry, {
                archiveUrl: domainEntry.archiveUrl,
                moneyUrl: domainEntry.moneyUrl,
                treatMarkupTestsAsGoogle: config?.treatMarkupTestsAsGoogle,
                verifyReverseDns: config?.verifyReverseDns,
                failOpenOnDnsError: config?.failOpenOnDnsError,
                rdnsCacheTtl: config?.rdnsCacheTtl,
                maxRedirects: config?.maxRedirects
            });
        case 'delete':
            return removeWaMoneyForDomain(domainEntry);
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
            const result = await processDomain(currentJob.action, item, currentJob.config);
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
