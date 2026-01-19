const fs = require('fs');
const path = require('path');
const {
    callManagerApi,
    buildCloudflareClient,
    getZone,
    wrapStageError
} = require('./cloudflareCachingService');

// Cloudflare worker names must be lowercase, alphanumeric and dashes only.
const CLOAK_WORKER_NAME = 't6-cloak';
const CLOAK_WORKER_PATH = path.join(__dirname, '..', 'cloudflare_worker_cloak.js');
const CLOAK_WORKER_SOURCE = fs.readFileSync(CLOAK_WORKER_PATH, 'utf8');
const CLOAK_CONFIG_REGEX = /const\s+CLOAK_CONFIG\s*=\s*({[\s\S]*?});/;

function createWarning(stage, message) {
    return { stage, message };
}

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

function parseCloakConfig(source) {
    const match = CLOAK_CONFIG_REGEX.exec(source);
    if (!match || match.length < 2) {
        return { hasConfig: false, config: {} };
    }

    try {
        // eslint-disable-next-line no-new-func
        const parsed = Function(`"use strict"; return (${match[1]});`)();
        if (parsed && typeof parsed === 'object') {
            return { hasConfig: true, config: parsed };
        }
    } catch (error) {
        return { hasConfig: true, config: {} };
    }

    return { hasConfig: true, config: {} };
}

function embedCloakConfig(source, config) {
    const configString = JSON.stringify(config, null, 2);
    if (CLOAK_CONFIG_REGEX.test(source)) {
        return source.replace(CLOAK_CONFIG_REGEX, `const CLOAK_CONFIG = ${configString};`);
    }
    return `const CLOAK_CONFIG = ${configString};\n${source}`;
}

async function fetchExistingWorker(client, accountId) {
    try {
        const script = await client('GET', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(CLOAK_WORKER_NAME)}`, null, {
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

async function ensureWorkerScript(client, accountId, domainLabel, domainConfig) {
    const existingSource = await fetchExistingWorker(client, accountId);
    const { hasConfig, config: existingConfig } = parseCloakConfig(existingSource || '');

    const mergedConfig = {
        ...(hasConfig ? existingConfig : {}),
        [domainLabel]: domainConfig
    };

    const sourceToUpload = hasConfig
        ? embedCloakConfig(existingSource, mergedConfig)
        : embedCloakConfig(CLOAK_WORKER_SOURCE, mergedConfig);

    const endpoint = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(CLOAK_WORKER_NAME)}`;
    const response = await client('PUT', endpoint, sourceToUpload, {
        rawBody: true,
        contentType: 'application/javascript'
    });
    return {
        result: response?.result || null,
        updatedConfig: mergedConfig,
        hadConfig: hasConfig
    };
}

async function fetchZoneRoutes(client, zoneId) {
    const response = await client('GET', `/zones/${zoneId}/workers/routes`);
    return Array.isArray(response?.result) ? response.result : [];
}

async function ensureRouteForDomain(client, zoneId, domainEntry, desiredPattern) {
    const routes = await fetchZoneRoutes(client, zoneId);
    const normalizedDesired = normalizeRoutePattern(desiredPattern);
    const domainForMatch = domainEntry.cloudflareDomain || domainEntry.managerDomain || desiredPattern;
    const warnings = [];

    const byPattern = routes.find(route => normalizeRoutePattern(route.pattern) === normalizedDesired);
    if (byPattern) {
        const scriptName = (byPattern.script || '').toLowerCase();
        if (scriptName === CLOAK_WORKER_NAME.toLowerCase()) {
            warnings.push(createWarning('route', 'Route already bound to t6-cloak.'));
            return {
                id: byPattern.id,
                pattern: byPattern.pattern || desiredPattern,
                warnings,
                message: 'Domain already attached'
            };
        }

        warnings.push(createWarning('route', `Route already bound to another worker (${byPattern.script || 'unknown'}). Skipped.`));
        return {
            id: byPattern.id,
            pattern: byPattern.pattern || desiredPattern,
            warnings,
            message: 'Skipped: existing route uses another worker',
            skipped: true
        };
    }

    const byDomain = routes.find(route => patternTargetsDomain(route.pattern, domainForMatch));
    if (byDomain) {
        const scriptName = (byDomain.script || '').toLowerCase();
        if (scriptName === CLOAK_WORKER_NAME.toLowerCase()) {
            warnings.push(createWarning('route', 'Domain already attached to t6-cloak.'));
            return {
                id: byDomain.id,
                pattern: byDomain.pattern || desiredPattern,
                warnings,
                message: 'Domain already attached'
            };
        }

        warnings.push(createWarning('route', `Existing route for domain is bound to another worker (${byDomain.script || 'unknown'}). Skipped.`));
        return {
            id: byDomain.id,
            pattern: byDomain.pattern || desiredPattern,
            warnings,
            message: 'Skipped: domain route already in use by another worker',
            skipped: true
        };
    }

    const created = await client('POST', `/zones/${zoneId}/workers/routes`, {
        pattern: desiredPattern,
        script: CLOAK_WORKER_NAME
    });

    return {
        id: created.result?.id,
        pattern: created.result?.pattern || desiredPattern,
        warnings,
        message: 'Route created'
    };
}

async function listAllZones(client) {
    const zones = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const response = await client('GET', `/zones?page=${page}&per_page=50`);
        if (Array.isArray(response?.result)) {
            zones.push(...response.result);
        }
        totalPages = response?.result_info?.total_pages || 1;
        page += 1;
    }

    return zones;
}

async function workerHasRoutes(client) {
    const zones = await listAllZones(client);
    const target = CLOAK_WORKER_NAME.toLowerCase();

    for (const zone of zones) {
        const routes = await fetchZoneRoutes(client, zone.id);
        const hasBinding = routes.some(route => (route?.script || '').toLowerCase() === target);
        if (hasBinding) {
            return true;
        }
    }

    return false;
}

function normalizeConfigInput(configInput = {}) {
    const allowedGeos = Array.isArray(configInput.allowedGeos)
        ? configInput.allowedGeos
        : typeof configInput.allowedGeos === 'string'
            ? configInput.allowedGeos.split(/[,|\n]/)
            : [];

    return {
        allowedGeos: allowedGeos
            .map(code => (code || '').trim().toUpperCase())
            .filter(Boolean),
        allowDesktop: Boolean(configInput.allowDesktop),
        allowVpn: Boolean(configInput.allowVpn),
        hideSeoTags: configInput.hideSeoTags === false ? false : true,
        treatMarkupTestsAsGoogle: configInput.treatMarkupTestsAsGoogle === true
    };
}

async function createCloakForDomain(domainEntry, configInput = {}) {
    const domainLabel = resolveDomainLabel(domainEntry);
    const normalizedConfig = normalizeConfigInput(configInput);

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

    try {
        await ensureWorkerScript(client, accountId, domainLabel, normalizedConfig);
    } catch (error) {
        throw wrapStageError(domainLabel, 'create worker', error);
    }

    const routePattern = buildRoutePattern(domainEntry);

    let routeResult;
    try {
        routeResult = await ensureRouteForDomain(client, zone.id, domainEntry, routePattern);
    } catch (error) {
        throw wrapStageError(domainLabel, 'configure route', error);
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        accountId,
        routeId: routeResult.id,
        routePattern: routeResult.pattern,
        warnings: routeResult.warnings || [],
        message: routeResult.message || 'Worker attached'
    };
}

async function removeCloakForDomain(domainEntry) {
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

    const accountId = zone?.account?.id;
    if (!accountId) {
        throw wrapStageError(domainLabel, 'resolve account', new Error('Account ID not found for Cloudflare zone'));
    }

    let routes;
    try {
        routes = await fetchZoneRoutes(client, zone.id);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch routes', error);
    }

    const targetPattern = buildRoutePattern(domainEntry);
    const normalizedPattern = normalizeRoutePattern(targetPattern);
    const targetScript = CLOAK_WORKER_NAME.toLowerCase();

    const matchingRoutes = routes.filter(route => {
        const routePattern = normalizeRoutePattern(route.pattern);
        const scriptMatches = (route?.script || '').toLowerCase() === targetScript;
        const domainMatch = patternTargetsDomain(route.pattern, domainEntry.cloudflareDomain || domainEntry.managerDomain);
        return scriptMatches && (routePattern === normalizedPattern || domainMatch);
    });

    if (matchingRoutes.length === 0) {
        return {
            domain: domainLabel || credentials.domain,
            zoneId: zone.id,
            accountId,
            warnings: [createWarning('route', 'Domain is not attached to T6 Cloak.')],
            message: 'No routes to remove'
        };
    }

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

    let stillUsed = true;
    try {
        stillUsed = await workerHasRoutes(client);
    } catch (error) {
        throw wrapStageError(domainLabel, 'check worker usage', error);
    }

    if (!stillUsed) {
        try {
            await client('DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(CLOAK_WORKER_NAME)}`);
        } catch (error) {
            if (error?.status !== 404 && error?.statusCode !== 404) {
                throw wrapStageError(domainLabel, 'delete worker', error);
            }
        }
    } else {
        // Обновляем конфиг воркера: удаляем домен из CLOAK_CONFIG, если он есть
        try {
            const existingSource = await fetchExistingWorker(client, accountId);
            const parsed = parseCloakConfig(existingSource || '');
            if (parsed.hasConfig) {
                const updatedConfig = { ...parsed.config };
                delete updatedConfig[domainLabel];
                const sourceToUpload = embedCloakConfig(existingSource, updatedConfig);
                await client('PUT', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(CLOAK_WORKER_NAME)}`, sourceToUpload, {
                    rawBody: true,
                    contentType: 'application/javascript'
                });
            }
        } catch (error) {
            // Не падаем, если не удалось обновить конфиг, но логируем этап
            throw wrapStageError(domainLabel, 'update worker config', error);
        }
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        accountId,
        warnings: [],
        message: stillUsed
            ? 'Domain detached from T6 Cloak.'
            : 'Domain detached and worker deleted.'
    };
}

module.exports = {
    createCloakForDomain,
    removeCloakForDomain
};
