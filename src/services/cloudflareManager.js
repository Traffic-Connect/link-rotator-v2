const fs = require('fs');
const path = require('path');
const {
    verifyToken,
    fetchZones,
    fetchAccounts,
    listDnsRecords,
    createDnsRecord,
    deleteDnsRecord,
    upsertWorkerScript,
    deleteWorkerScript,
    listRoutes,
    createRoute,
    updateRoute,
    deleteRoute
} = require('./cloudflareApi');

const workerTemplatePath = path.join(__dirname, '..', 'cloudflare_worker.js');
const workerTemplate = fs.readFileSync(workerTemplatePath, 'utf8');
const DEFAULT_WORKER_DNS_IP = '192.0.2.1';

function buildWorkerScript(redirects) {
    if (!Array.isArray(redirects) || redirects.length === 0) {
        throw new Error('Redirect list for worker is empty');
    }

    const serialized = redirects
        .map(url => `  ${JSON.stringify(url)}`)
        .join(',\n');

    const arrayLiteral = `const TARGET_URLS = [\n${serialized}\n];`;

    if (!workerTemplate.includes('const TARGET_URLS')) {
        throw new Error('Worker template is invalid');
    }

    return workerTemplate.replace(/const TARGET_URLS = \[[\s\S]*?\];/, arrayLiteral);
}

function ensureProtocol(value) {
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    return `https://${value}`;
}

function sanitizeWorkerName(value, fallback) {
    const cleaned = value
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (cleaned.length === 0) {
        return fallback;
    }

    return cleaned.slice(0, 63);
}

function normalizeCloudflareLink(input, fallbackSlug) {
    if (!input || typeof input !== 'string') {
        throw new Error('Cloudflare Link is required');
    }

    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('Cloudflare Link is required');
    }

    let url;
    try {
        url = new URL(ensureProtocol(trimmed));
    } catch (error) {
        throw new Error('Cloudflare Link must be a valid domain or URL');
    }

    const host = url.hostname.toLowerCase();
    let pathname = url.pathname || '/';

    if (!pathname.endsWith('*')) {
        if (!pathname.endsWith('/')) {
            pathname = `${pathname}*`;
        } else {
            pathname = `${pathname}*`;
        }
    }

    if (!pathname.startsWith('/')) {
        pathname = `/${pathname}`;
    }

    const routePattern = `${host}${pathname}`;
    const workerName = sanitizeWorkerName(trimmed, fallbackSlug);

    return {
        host,
        routePattern,
        workerName,
        original: trimmed
    };
}

function findMatchingZone(host, zones) {
    const sorted = zones.slice().sort((a, b) => b.name.length - a.name.length);
    return sorted.find(zone => host === zone.name || host.endsWith(`.${zone.name}`));
}

async function ensureRoute({ apiToken, zoneId, pattern, workerName }) {
    const routes = await listRoutes({ apiToken, zoneId });
    const existing = routes.find(route => route.pattern.toLowerCase() === pattern.toLowerCase());

    if (existing) {
        const updated = await updateRoute({
            apiToken,
            zoneId,
            routeId: existing.id,
            pattern,
            script: workerName
        });

        return updated.result;
    }

    const created = await createRoute({
        apiToken,
        zoneId,
        pattern,
        script: workerName
    });

    return created.result;
}

async function ensureDnsRecord({ credential, zoneId, host }) {
    const records = await listDnsRecords({
        apiToken: credential.apiToken,
        zoneId,
        name: host
    });

    const existing = records.find(record => record.name.toLowerCase() === host.toLowerCase());
    if (existing) {
        return existing;
    }

    const created = await createDnsRecord({
        apiToken: credential.apiToken,
        zoneId,
        type: 'A',
        name: host,
        content: DEFAULT_WORKER_DNS_IP,
        ttl: 1,
        proxied: true
    });

    return created.result;
}

async function syncWorker({ credential, redirects, cloudflareLink, fallbackSlug }) {
    if (!credential || !credential.apiToken || !credential.accountId) {
        throw new Error('Cloudflare credential is invalid');
    }

    const normalized = normalizeCloudflareLink(cloudflareLink, fallbackSlug);
    const zones = await fetchZones(credential.apiToken);
    const zone = findMatchingZone(normalized.host, zones);

    if (!zone) {
        throw new Error('Zone for provided Cloudflare Link was not found');
    }

    const dnsRecord = await ensureDnsRecord({
        credential,
        zoneId: zone.id,
        host: normalized.host
    });

    const script = buildWorkerScript(redirects);

    const workerResponse = await upsertWorkerScript({
        apiToken: credential.apiToken,
        accountId: credential.accountId,
        name: normalized.workerName,
        script
    });

    const route = await ensureRoute({
        apiToken: credential.apiToken,
        zoneId: zone.id,
        pattern: normalized.routePattern,
        workerName: normalized.workerName
    });

    return {
        link: normalized.original,
        workerName: normalized.workerName,
        workerId: workerResponse.result?.id || normalized.workerName,
        routeId: route.id,
        routePattern: route.pattern,
        zoneId: zone.id,
        zoneName: zone.name,
        dnsRecordId: dnsRecord?.id || null,
        dnsHostname: dnsRecord?.name || normalized.host
    };
}

async function removeWorker({ credential, workerName, zoneId, routeId, dnsRecordId }) {
    if (!credential || !credential.apiToken || !credential.accountId) {
        throw new Error('Cloudflare credential is invalid');
    }

    if (zoneId && routeId) {
        try {
            await deleteRoute({
                apiToken: credential.apiToken,
                zoneId,
                routeId
            });
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }
        }
    }

    if (zoneId && dnsRecordId) {
        try {
            await deleteDnsRecord({
                apiToken: credential.apiToken,
                zoneId,
                recordId: dnsRecordId
            });
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }
        }
    }

    try {
        await deleteWorkerScript({
            apiToken: credential.apiToken,
            accountId: credential.accountId,
            name: workerName
        });
    } catch (error) {
        if (error.status !== 404) {
            throw error;
        }
    }
}

async function verifyCredentials(apiToken) {
    const verification = await verifyToken(apiToken);
    const accounts = await fetchAccounts(apiToken);

    if (!accounts.length) {
        const error = new Error('No Cloudflare accounts are accessible with this token');
        error.status = 400;
        throw error;
    }

    const account = accounts[0];
    const result = verification.result || {};

    return {
        accountId: account.id,
        accountName: account.name || '',
        userName: result.user?.name || '',
        userEmail: result.user?.email || ''
    };
}

module.exports = {
    buildWorkerScript,
    normalizeCloudflareLink,
    syncWorker,
    removeWorker,
    verifyCredentials
};
