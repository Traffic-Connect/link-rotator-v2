const {
    createRedirectForDomain,
    removeRedirectForDomain,
    normalizePairs,
    normalizeOriginsOnly
} = require('./cloudflareRedirectService');

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
        originUrl: entry.originUrl,
        partnerUrl: entry.partnerUrl,
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

function getCurrentJob() {
    return currentJob;
}

function ensureNoActiveJob() {
    if (currentJob.status === JOB_STATUS.RUNNING) {
        const error = new Error('A redirect cloak job is already running');
        error.statusCode = 400;
        throw error;
    }
}

function initializeJob({ action, originUrls, partnerUrls, requestedBy, config }) {
    let pairs = [];

    if (action === 'create') {
        pairs = normalizePairs(originUrls, partnerUrls);
        if (pairs.length === 0) {
            const error = new Error('Please provide at least one matching origin/partner line');
            error.statusCode = 400;
            throw error;
        }
    } else {
        pairs = normalizeOriginsOnly(originUrls);
        if (pairs.length === 0) {
            const error = new Error('Please provide at least one origin URL');
            error.statusCode = 400;
            throw error;
        }
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
            return createRedirectForDomain(domainEntry, config);
        case 'delete':
            return removeRedirectForDomain(domainEntry);
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
