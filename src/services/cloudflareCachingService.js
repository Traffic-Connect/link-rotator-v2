const fetch = global.fetch;

const MANAGER_API_BASE = (process.env.MANAGER_BASE_URL || 'http://manager.tcnct.com/api/v1').replace(/\/$/, '');
const MANAGER_API_URL = process.env.TC_MANAGER_API_URL
    || `${MANAGER_API_BASE}/domain/cdn-credentials`;
const MANAGER_API_TOKEN = process.env.TC_MANAGER_API_TOKEN
    || process.env.MANAGER_BEARER
    || '';
const MANAGER_ACCOUNT_EMAIL = process.env.TC_MANAGER_ACCOUNT_EMAIL
    || process.env.MANAGER_EMAIL
    || '';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days

if (!MANAGER_API_TOKEN) {
    console.warn('TC_MANAGER_API_TOKEN is not configured. Cloudflare caching jobs will fail.');
}

if (!MANAGER_ACCOUNT_EMAIL) {
    console.warn('TC_MANAGER_ACCOUNT_EMAIL is not configured. Cloudflare caching jobs will fail.');
}

async function callManagerApi(domain) {
    const response = await fetch(MANAGER_API_URL, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MANAGER_API_TOKEN}`
        },
        body: JSON.stringify({
            email: MANAGER_ACCOUNT_EMAIL,
            domain
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Manager API error (${response.status}): ${text}`);
    }

    const payload = await response.json();
    if (payload.status !== 'success' || !payload.data) {
        throw new Error('Manager API did not return credentials');
    }

    const data = payload.data;
    return {
        domain: data.domain,
        email: data.custom_cdn_login,
        password: data.custom_cdn_password,
        apiKey: data.cdn_token
    };
}

function formatCloudflareMessages(data) {
    const errorsArray = Array.isArray(data?.errors) ? data.errors : [];
    const messagesArray = Array.isArray(data?.messages) ? data.messages : [];

    const detailedMessages = [];

    errorsArray.forEach(error => {
        if (error?.message) {
            detailedMessages.push(error.message);
        }
        if (Array.isArray(error?.error_chain)) {
            error.error_chain.forEach(chainItem => {
                if (chainItem?.message) {
                    detailedMessages.push(chainItem.message);
                }
            });
        }
    });

    messagesArray.forEach(message => {
        if (typeof message === 'string') {
            detailedMessages.push(message);
        } else if (message?.message) {
            detailedMessages.push(message.message);
        }
    });

    return {
        errorsArray,
        detailedMessages
    };
}

function createWarning(stage, message) {
    return {
        stage,
        message
    };
}

function buildCloudflareClient({ email, apiKey }) {
    const baseHeaders = {
        'X-Auth-Email': email,
        'X-Auth-Key': apiKey,
        'Content-Type': 'application/json'
    };

    return async function request(method, endpoint, body, options = {}) {
        const headers = {
            ...baseHeaders,
            ...(options.headers || {})
        };

        let requestBody = body ? JSON.stringify(body) : undefined;

        if (options.rawBody) {
            requestBody = body;
            if (options.contentType) {
                headers['Content-Type'] = options.contentType;
            } else if (!options.headers || !options.headers['Content-Type']) {
                delete headers['Content-Type'];
            }
        }

        const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
            method,
            headers,
            body: requestBody
        });

        const rawText = await response.text();

        if (options.expectText) {
            if (!response.ok) {
                const error = new Error(`Cloudflare API error (${response.status})`);
                error.status = response.status;
                error.statusCode = response.status;
                throw error;
            }
            return rawText;
        }

        let data;

        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch (error) {
            data = null;
        }

        const success = data?.success;

        if (!response.ok || success === false) {
            const { errorsArray, detailedMessages } = formatCloudflareMessages(data || {});
            const fallbackMessage = `Cloudflare API error (${response.status})`;
            const message = detailedMessages.length ? detailedMessages.join('; ') : fallbackMessage;
            const error = new Error(message);
            error.status = response.status;
            error.statusCode = response.status;
            error.details = errorsArray;
            error.messages = detailedMessages;
            error.cloudflareResponse = data || rawText;
            throw error;
        }

        return data || {};
    };
}

async function getZone(client, domain) {
    const response = await client('GET', `/zones?name=${domain}`);
    const zone = response.result?.[0];
    if (!zone) {
        throw new Error(`Zone not found for ${domain}`);
    }
    return zone;
}

function wrapStageError(domain, stage, error) {
    const message = error?.message || error?.toString() || 'Unknown error';
    const wrapped = new Error(`[${domain}] ${stage}: ${message}`);
    wrapped.stack = error?.stack || wrapped.stack;
    wrapped.stage = stage;
    wrapped.domain = domain;
    wrapped.status = error?.status || error?.statusCode;
    wrapped.statusCode = error?.statusCode || error?.status;
    if (error?.details) {
        wrapped.details = error.details;
    }
    if (error?.messages) {
        wrapped.messages = error.messages;
    }
    if (error?.cloudflareResponse) {
        wrapped.cloudflareResponse = error.cloudflareResponse;
    }
    return wrapped;
}

async function enableAlwaysOnline(client, zoneId) {
    await client('PATCH', `/zones/${zoneId}/settings/always_online`, { value: 'on' });
}

async function enableTieredCaching(client, zoneId) {
    try {
        await client('PATCH', `/zones/${zoneId}/argo/tiered_caching`, { value: 'on' });
        return [];
    } catch (error) {
        return [createWarning('tiered_caching', `Argo tiered caching unavailable: ${error.message}`)];
    }
}

async function enableSmartTieredCaching(client, zoneId) {
    await client('PATCH', `/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`, { value: 'on' });
}

const CACHE_RULE_NAME = 'T6 Rules';
const CACHE_RULE_EXPRESSION = 'not (http.request.uri.path contains "/wp-admin") and not (http.request.uri.path contains "/wp-login.php") and not (http.request.uri.path contains "/wp-admin/admin-ajax.php")';

async function getCacheRuleset(client, zoneId) {
    const response = await client('GET', `/zones/${zoneId}/rulesets/phases/http_request_cache_settings/entrypoint`);
    return response.result;
}

async function createCacheRuleset(client, zoneId) {
    const response = await client('POST', `/zones/${zoneId}/rulesets`, {
        name: 'Auto Cache Rules',
        description: 'Auto-created cache ruleset for T6',
        kind: 'zone',
        phase: 'http_request_cache_settings',
        rules: []
    });
    return response.result;
}

async function updateCacheRuleset(client, zoneId, rulesetId, rules) {
    return client('PUT', `/zones/${zoneId}/rulesets/${rulesetId}`, { rules });
}

async function ensureCacheRule(client, zoneId) {
    const warnings = [];
    let ruleset;
    try {
        ruleset = await getCacheRuleset(client, zoneId);
    } catch (error) {
        if (error.message?.toLowerCase().includes('entrypoint ruleset')) {
            ruleset = await createCacheRuleset(client, zoneId);
        } else {
            throw error;
        }
    }

    const rules = ruleset.rules || [];

    const activeRule = rules.find(rule => rule.enabled);
    if (activeRule) {
        const description = activeRule.description || 'Existing rule';
        if (description === CACHE_RULE_NAME) {
            warnings.push(createWarning('cache_rules', 'T6 cache rule already active. No changes applied.'));
        } else {
            warnings.push(createWarning('cache_rules', `Another active cache rule detected (${description}). T6 rule not created.`));
        }
        return { warnings };
    }

    const existingRule = rules.find(rule => rule.description === CACHE_RULE_NAME);
    if (existingRule) {
        existingRule.enabled = true;
        await updateCacheRuleset(client, zoneId, ruleset.id, rules);
        warnings.push(createWarning('cache_rules', 'Existing T6 cache rule re-enabled.'));
        return { warnings };
    }

    const newRule = {
        description: CACHE_RULE_NAME,
        expression: CACHE_RULE_EXPRESSION,
        action: 'set_cache_settings',
        action_parameters: {
            cache: true,
            edge_ttl: {
                mode: 'override_origin',
                default: CACHE_TTL_SECONDS
            },
            browser_ttl: {
                mode: 'override_origin',
                default: CACHE_TTL_SECONDS
            }
        },
        enabled: true
    };

    const updatedRules = [...rules, newRule];
    await updateCacheRuleset(client, zoneId, ruleset.id, updatedRules);
    return { warnings };
}

async function disableCacheRule(client, zoneId) {
    const warnings = [];
    let ruleset;
    try {
        ruleset = await getCacheRuleset(client, zoneId);
    } catch (error) {
        if (error.message?.toLowerCase().includes('entrypoint ruleset')) {
            warnings.push(createWarning('cache_rules', 'No cache ruleset found. Nothing to disable.'));
            return {
                warnings,
                message: 'Cache ruleset missing; nothing to disable'
            };
        }
        throw error;
    }

    const rules = ruleset.rules || [];
    const targetRule = rules.find(rule => rule.description === CACHE_RULE_NAME);

    if (!targetRule) {
        warnings.push(createWarning('cache_rules', 'T6 cache rule not found. Nothing to disable.'));
        return {
            warnings,
            message: 'T6 cache rule not found'
        };
    }

    if (!targetRule.enabled) {
        warnings.push(createWarning('cache_rules', 'T6 cache rule is already disabled.'));
        return {
            warnings,
            message: 'T6 cache rule already disabled'
        };
    }

    targetRule.enabled = false;
    await updateCacheRuleset(client, zoneId, ruleset.id, rules);

    return {
        warnings,
        message: 'T6 cache rule disabled'
    };
}

async function updateCacheRuleTtl(client, zoneId, ttlSeconds) {
    const warnings = [];
    let ruleset;
    try {
        ruleset = await getCacheRuleset(client, zoneId);
    } catch (error) {
        if (error.message?.toLowerCase().includes('entrypoint ruleset')) {
            warnings.push(createWarning('cache_rules', 'No cache ruleset found. TTL not updated.'));
            return { warnings, updated: false };
        }
        throw error;
    }

    const rules = ruleset.rules || [];
    const targetRule = rules.find(rule => rule.description === CACHE_RULE_NAME);

    if (!targetRule) {
        warnings.push(createWarning('cache_rules', 'T6 cache rule not found. TTL not updated.'));
        return { warnings, updated: false };
    }

    const params = targetRule.action_parameters || {};
    params.edge_ttl = {
        ...(params.edge_ttl || {}),
        mode: 'override_origin',
        default: ttlSeconds
    };
    params.browser_ttl = {
        ...(params.browser_ttl || {}),
        mode: 'override_origin',
        default: ttlSeconds
    };
    targetRule.action_parameters = params;

    await updateCacheRuleset(client, zoneId, ruleset.id, rules);

    return {
        warnings,
        updated: true
    };
}

async function purgeEverything(client, zoneId) {
    await client('POST', `/zones/${zoneId}/purge_cache`, { purge_everything: true });
}

function resolveDomainLabel(entry) {
    if (!entry) {
        return '';
    }
    if (typeof entry === 'string') {
        return entry;
    }
    return entry.domain || entry.managerDomain || entry.cloudflareDomain || '';
}

function ensureDomainEntry(entry) {
    if (!entry) {
        return null;
    }
    if (typeof entry === 'string') {
        const cleaned = entry.trim().toLowerCase();
        return {
            domain: cleaned,
            managerDomain: cleaned,
            cloudflareDomain: cleaned.replace(/^www\./i, '')
        };
    }
    return entry;
}

async function configureDomainCaching(domainEntry) {
    const entry = ensureDomainEntry(domainEntry);
    if (!entry?.managerDomain || !entry.cloudflareDomain) {
        throw new Error('Invalid domain entry');
    }
    const domainLabel = resolveDomainLabel(entry);

    let credentials;
    try {
        credentials = await callManagerApi(entry.managerDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'manager credentials', error);
    }

    const client = buildCloudflareClient({ email: credentials.email, apiKey: credentials.apiKey });

    let zone;
    try {
        zone = await getZone(client, entry.cloudflareDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch zone', error);
    }

    const warnings = [];

    try {
        await enableAlwaysOnline(client, zone.id);
        const tieredWarnings = await enableTieredCaching(client, zone.id);
        warnings.push(...tieredWarnings);
        await enableSmartTieredCaching(client, zone.id);
        const cacheRuleResult = await ensureCacheRule(client, zone.id);
        warnings.push(...(cacheRuleResult?.warnings || []));
    } catch (error) {
        throw wrapStageError(domainLabel, 'configure caching', error);
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        warnings
    };
}

async function purgeDomainCache(domainEntry) {
    const entry = ensureDomainEntry(domainEntry);
    if (!entry?.managerDomain || !entry.cloudflareDomain) {
        throw new Error('Invalid domain entry');
    }
    const domainLabel = resolveDomainLabel(entry);

    let credentials;
    try {
        credentials = await callManagerApi(entry.managerDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'manager credentials', error);
    }

    const client = buildCloudflareClient({ email: credentials.email, apiKey: credentials.apiKey });

    let zone;
    try {
        zone = await getZone(client, entry.cloudflareDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch zone', error);
    }

    const warnings = [];

    try {
        const ttlResult = await updateCacheRuleTtl(client, zone.id, CACHE_TTL_SECONDS);
        warnings.push(...(ttlResult?.warnings || []));
    } catch (error) {
        throw wrapStageError(domainLabel, 'update cache ttl', error);
    }

    try {
        await purgeEverything(client, zone.id);
    } catch (error) {
        throw wrapStageError(domainLabel, 'purge cache', error);
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        warnings
    };
}

async function disableDomainCaching(domainEntry) {
    const entry = ensureDomainEntry(domainEntry);
    if (!entry?.managerDomain || !entry.cloudflareDomain) {
        throw new Error('Invalid domain entry');
    }
    const domainLabel = resolveDomainLabel(entry);

    let credentials;
    try {
        credentials = await callManagerApi(entry.managerDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'manager credentials', error);
    }

    const client = buildCloudflareClient({ email: credentials.email, apiKey: credentials.apiKey });

    let zone;
    try {
        zone = await getZone(client, entry.cloudflareDomain);
    } catch (error) {
        throw wrapStageError(domainLabel, 'fetch zone', error);
    }

    let disableResult;
    try {
        disableResult = await disableCacheRule(client, zone.id);
    } catch (error) {
        throw wrapStageError(domainLabel, 'disable cache rule', error);
    }

    return {
        domain: domainLabel || credentials.domain,
        zoneId: zone.id,
        warnings: disableResult?.warnings || [],
        message: disableResult?.message || 'T6 cache rule disabled'
    };
}

module.exports = {
    configureDomainCaching,
    purgeDomainCache,
    disableDomainCaching,
    callManagerApi,
    buildCloudflareClient,
    getZone,
    wrapStageError
};
