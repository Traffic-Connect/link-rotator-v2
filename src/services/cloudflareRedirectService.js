const fs = require('fs');
const path = require('path');
const {
    callManagerApi,
    buildCloudflareClient,
    getZone,
    wrapStageError
} = require('./cloudflareCachingService');

const WORKER_PREFIX = 't6-redirect-';
const MAX_WORKER_NAME_LENGTH = 63;
const WORKER_PATH = path.join(__dirname, '..', 'cloudflare_worker_cloak_redirect.js');
const WORKER_SOURCE = fs.readFileSync(WORKER_PATH, 'utf8');
const CFG_REGEX = /const\s+CLOAK_CFG\s*=\s*({[\s\S]*?});/;

function normalizeDomainValue(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }
    return value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/\.$/, '')
        .replace(/^www\./, '');
}

function resolveDomainLabel(entry) {
    if (!entry) return '';
    const value = entry.domain || entry.managerDomain || entry.cloudflareDomain || '';
    return normalizeDomainValue(value);
}

function buildRoutePattern(entry) {
    const host = entry?.managerDomain || entry?.cloudflareDomain || entry?.domain;
    const normalized = normalizeDomainValue(host);
    if (!normalized) {
        throw new Error('Invalid domain for route pattern');
    }
    return `*${normalized}/*`;
}

function normalizeRoutePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return '';
    }
    return pattern
        .trim()
        .toLowerCase()
        .replace(/\/+\*?$/, '/*')
        .replace(/(?<!\*)$/, '/*');
}

function extractPatternHost(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return '';
    }
    const [hostPart] = pattern.toLowerCase().split('/');
    return hostPart
        .replace(/^\*\./, '')
        .replace(/^\*/, '')
        .replace(/^www\./, '')
        .replace(/\.$/, '');
}

function patternTargetsDomain(pattern, domain) {
    const patternHost = extractPatternHost(pattern);
    const normalizedDomain = normalizeDomainValue(domain);
    if (!patternHost || !normalizedDomain) {
        return false;
    }
    return patternHost === normalizedDomain || patternHost === `www.${normalizedDomain}`;
}

function buildWorkerName(entry) {
    const domainLabel = resolveDomainLabel(entry);
    if (!domainLabel) {
        throw new Error('Invalid domain for worker name');
    }

    let slug = domainLabel
        .replace(/\./g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!slug) {
        slug = 'domain';
    }

    if (!/^[a-z]/.test(slug)) {
        slug = `a-${slug}`;
    }

    const fullName = `${WORKER_PREFIX}${slug}`;
    return fullName.slice(0, MAX_WORKER_NAME_LENGTH);
}

function ensureUrlProtocol(value) {
    if (!value) {
        return '';
    }
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    return `https://${value}`;
}

function parseUrlList(input) {
    if (!input) {
        return [];
    }
    const list = Array.isArray(input) ? input : input.split(/\r?\n/);
    const urls = [];

    list.forEach(raw => {
        const trimmed = (raw || '').trim();
        if (!trimmed) {
            return;
        }
        const withProtocol = ensureUrlProtocol(trimmed);
        try {
            const url = new URL(withProtocol);
            urls.push(url.toString());
        } catch (error) {
            return;
        }
    });

    return urls;
}

function buildDomainEntry(originUrl, partnerUrl) {
    try {
        const parsed = new URL(ensureUrlProtocol(originUrl));
        const hostname = parsed.hostname.toLowerCase();
        const managerDomain = hostname.replace(/^www\./i, '');
        return {
            domainLabel: managerDomain,
            managerDomain,
            cloudflareDomain: managerDomain,
            originUrl: ensureUrlProtocol(originUrl),
            partnerUrl: ensureUrlProtocol(partnerUrl || originUrl)
        };
    } catch (error) {
        return null;
    }
}

function normalizePairs(originUrls, partnerUrls) {
    const origins = parseUrlList(originUrls);
    const partners = parseUrlList(partnerUrls);

    if (origins.length === 0 || partners.length === 0) {
        return [];
    }

    if (origins.length !== partners.length) {
        const error = new Error(`Origin/Partner lines count mismatch (${origins.length} vs ${partners.length})`);
        error.statusCode = 400;
        throw error;
    }

    const limit = origins.length;
    const entries = [];

    for (let i = 0; i < limit; i += 1) {
        const domainEntry = buildDomainEntry(origins[i], partners[i]);
        if (!domainEntry) {
            continue;
        }
        entries.push(domainEntry);
    }

    return entries;
}

function normalizeOriginsOnly(originUrls) {
    const origins = parseUrlList(originUrls);
    const entries = [];
    origins.forEach(url => {
        const entry = buildDomainEntry(url, url);
        if (entry) {
            entries.push(entry);
        }
    });
    return entries;
}

function embedConfig(source, config) {
    const cfgString = JSON.stringify(config, null, 2);
    if (CFG_REGEX.test(source)) {
        return source.replace(CFG_REGEX, `const CLOAK_CFG = ${cfgString};`);
    }
    return `const CLOAK_CFG = ${cfgString};\n${source}`;
}

async function fetchExistingWorker(client, accountId, workerName) {
    try {
        const script = await client('GET', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`, null, {
            headers: { Accept: 'application/javascript' },
            expectText: true
        });
        return script || '';
    } catch (error) {
        if (error?.status === 404 || error?.statusCode === 404) {
            return '';
        }
        throw error;
    }
}

async function uploadWorker(client, accountId, workerName, config) {
    const existing = await fetchExistingWorker(client, accountId, workerName);
    const sourceToUpload = embedConfig(existing || WORKER_SOURCE, config);

    const endpoint = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`;
    const response = await client('PUT', endpoint, sourceToUpload, {
        rawBody: true,
        contentType: 'application/javascript'
    });
    return response?.result || null;
}

async function fetchZoneRoutes(client, zoneId) {
    const response = await client('GET', `/zones/${zoneId}/workers/routes`);
    return Array.isArray(response?.result) ? response.result : [];
}

async function ensureRouteForDomain(client, zoneId, domainEntry, workerName, desiredPattern) {
    const routes = await fetchZoneRoutes(client, zoneId);
    const normalizedDesired = normalizeRoutePattern(desiredPattern);
    const domainForMatch = domainEntry.cloudflareDomain || domainEntry.managerDomain || desiredPattern;

    const byPattern = routes.find(route => normalizeRoutePattern(route.pattern) === normalizedDesired);
    if (byPattern) {
        const scriptName = (byPattern.script || '').toLowerCase();
        if (scriptName === workerName.toLowerCase()) {
            return {
                id: byPattern.id,
                pattern: byPattern.pattern || desiredPattern,
                message: 'Domain already attached'
            };
        }

        const updated = await client('PUT', `/zones/${zoneId}/workers/routes/${byPattern.id}`, {
            pattern: desiredPattern,
            script: workerName
        });
        return {
            id: updated.result?.id || byPattern.id,
            pattern: updated.result?.pattern || desiredPattern,
            message: 'Route reassigned'
        };
    }

    const byDomain = routes.find(route => patternTargetsDomain(route.pattern, domainForMatch));
    if (byDomain) {
        const updated = await client('PUT', `/zones/${zoneId}/workers/routes/${byDomain.id}`, {
            pattern: desiredPattern,
            script: workerName
        });
        return {
            id: updated.result?.id || byDomain.id,
            pattern: updated.result?.pattern || desiredPattern,
            message: 'Route reassigned'
        };
    }

    const created = await client('POST', `/zones/${zoneId}/workers/routes`, {
        pattern: desiredPattern,
        script: workerName
    });

    return {
        id: created.result?.id,
        pattern: created.result?.pattern || desiredPattern,
        message: 'Route created'
    };
}

function buildConfig(domainEntry, configInput = {}) {
    const bypassGeos = Array.isArray(configInput.bypassGeos)
        ? configInput.bypassGeos
        : typeof configInput.bypassGeos === 'string'
            ? configInput.bypassGeos.split(/[,|\n]/)
            : [];

    const wpPaths = Array.isArray(configInput.wpPaths)
        ? configInput.wpPaths
        : typeof configInput.wpPaths === 'string'
            ? configInput.wpPaths.split(/\r?\n/)
            : [];

    const rdnsCacheTtl = Number.isFinite(Number(configInput.rdnsCacheTtl))
        ? Number(configInput.rdnsCacheTtl)
        : undefined;

    return {
        originBase: domainEntry.originUrl,
        partnerUrl: domainEntry.partnerUrl,
        bypassGeos: bypassGeos
            .map(code => (code || '').trim().toUpperCase())
            .filter(Boolean),
        wpPaths: wpPaths
            .map(p => (p || '').trim())
            .filter(Boolean),
        verifyReverseDns: configInput.verifyReverseDns !== false,
        failOpenOnDnsError: configInput.failOpenOnDnsError !== false,
        treatMarkupTestsAsGoogle: configInput.treatMarkupTestsAsGoogle === true,
        ...(rdnsCacheTtl !== undefined ? { rdnsCacheTtl } : {})
    };
}

async function createRedirectForDomain(domainEntry, configInput = {}) {
    const domainLabel = resolveDomainLabel(domainEntry);
    const config = buildConfig(domainEntry, configInput);

    let credentials;
    try {
        credentials = await callManagerApi(domainEntry.managerDomain || domainEntry.domain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'manager credentials', error);
    }

    const client = buildCloudflareClient({
        email: credentials.email,
        apiKey: credentials.apiKey
    });

    let zone;
    try {
        zone = await getZone(client, domainEntry.cloudflareDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch zone', error);
    }

    const accountId = zone?.account?.id;
    if (!accountId) {
        throw wrapStageError(domainLabel, 'resolve account', new Error('Account ID not found for Cloudflare zone'));
    }

    const workerName = buildWorkerName(domainEntry);

    try {
        await uploadWorker(client, accountId, workerName, config);
    } catch (error) {
        throw wrapStageError(domainLabel, 'create worker', error);
    }

    const routePattern = buildRoutePattern(domainEntry);

    let routeResult;
    try {
        routeResult = await ensureRouteForDomain(client, zone.id, domainEntry, workerName, routePattern);
    } catch (error) {
        throw wrapStageError(domainLabel, 'configure route', error);
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        accountId,
        workerName,
        routeId: routeResult.id,
        routePattern: routeResult.pattern,
        message: routeResult.message || 'Worker attached'
    };
}

async function removeRedirectForDomain(domainEntry) {
    const domainLabel = resolveDomainLabel(domainEntry);

    let credentials;
    try {
        credentials = await callManagerApi(domainEntry.managerDomain || domainEntry.domain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'manager credentials', error);
    }

    const client = buildCloudflareClient({
        email: credentials.email,
        apiKey: credentials.apiKey
    });

    let zone;
    try {
        zone = await getZone(client, domainEntry.cloudflareDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch zone', error);
    }

    const workerName = buildWorkerName(domainEntry);
    const targetScript = workerName.toLowerCase();
    const routePattern = buildRoutePattern(domainEntry);
    const normalizedPattern = normalizeRoutePattern(routePattern);

    let routes;
    try {
        routes = await fetchZoneRoutes(client, zone.id);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch routes', error);
    }

    const matchingRoutes = routes.filter(route => {
        const scriptMatches = (route?.script || '').toLowerCase() === targetScript;
        const routePatternNormalized = normalizeRoutePattern(route.pattern);
        const domainMatch = patternTargetsDomain(route.pattern, domainEntry.cloudflareDomain || domainEntry.managerDomain);
        return scriptMatches && (routePatternNormalized === normalizedPattern || domainMatch);
    });

    for (const route of matchingRoutes) {
        try {
            await client('DELETE', `/zones/${zone.id}/workers/routes/${route.id}`);
        } catch (error) {
            if (error?.status === 404 || error?.statusCode === 404) {
                continue;
            }
            throw wrapStageError(domainLabel, 'remove route', error);
        }
    }

    try {
        await client('DELETE', `/accounts/${zone.account.id}/workers/scripts/${encodeURIComponent(workerName)}`);
    } catch (error) {
        if (error?.status !== 404 && error?.statusCode !== 404) {
            throw wrapStageError(domainLabel, 'delete worker', error);
        }
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        accountId: zone.account.id,
        message: matchingRoutes.length
            ? 'Domain detached and worker deleted'
            : 'Worker deleted (no routes found)'
    };
}

module.exports = {
    createRedirectForDomain,
    removeRedirectForDomain,
    normalizePairs,
    normalizeOriginsOnly
};
