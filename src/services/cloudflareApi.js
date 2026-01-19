const BASE_URL = 'https://api.cloudflare.com/client/v4';

async function cloudflareRequest({ endpoint, method = 'GET', apiToken, json, body, headers = {} }) {
    if (!apiToken) {
        throw new Error('Cloudflare API token is required');
    }

    const requestHeaders = {
        Authorization: `Bearer ${apiToken}`,
        ...headers
    };

    let requestBody = body;

    if (json) {
        requestHeaders['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(json);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers: requestHeaders,
        body: requestBody
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        const errorsArray = Array.isArray(data.errors) ? data.errors : [];
        const chainedMessages = errorsArray.flatMap(err => {
            const messages = [];
            if (err?.message) {
                messages.push(err.message);
            }
            if (Array.isArray(err.error_chain)) {
                err.error_chain.forEach(chainItem => {
                    if (chainItem?.message) {
                        messages.push(chainItem.message);
                    }
                });
            }
            return messages;
        });

        const message = chainedMessages.length
            ? chainedMessages.join('; ')
            : `Cloudflare API error (${response.status})`;

        const error = new Error(message);
        error.status = response.status;
        error.statusCode = response.status;
        error.details = errorsArray;
        error.messages = chainedMessages;
        error.cloudflareResponse = data;
        throw error;
    }

    return data;
}

async function verifyToken(apiToken) {
    return cloudflareRequest({
        endpoint: '/user/tokens/verify',
        apiToken
    });
}

async function fetchZones(apiToken) {
    const zones = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const response = await cloudflareRequest({
            endpoint: `/zones?page=${page}&per_page=50`,
            apiToken
        });

        zones.push(...response.result);
        totalPages = response.result_info?.total_pages || 1;
        page += 1;
    }

    return zones;
}

async function fetchAccounts(apiToken) {
    const accounts = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
        const response = await cloudflareRequest({
            endpoint: `/accounts?page=${page}&per_page=50`,
            apiToken
        });

        accounts.push(...response.result);
        totalPages = response.result_info?.total_pages || 1;
        page += 1;
    }

    return accounts;
}

async function listDnsRecords({ apiToken, zoneId, name }) {
    const response = await cloudflareRequest({
        endpoint: `/zones/${zoneId}/dns_records${name ? `?name=${encodeURIComponent(name)}` : ''}`,
        apiToken
    });

    return response.result || [];
}

async function createDnsRecord({ apiToken, zoneId, type, name, content, ttl = 1, proxied = true }) {
    return cloudflareRequest({
        endpoint: `/zones/${zoneId}/dns_records`,
        method: 'POST',
        apiToken,
        json: {
            type,
            name,
            content,
            ttl,
            proxied
        }
    });
}

async function deleteDnsRecord({ apiToken, zoneId, recordId }) {
    return cloudflareRequest({
        endpoint: `/zones/${zoneId}/dns_records/${recordId}`,
        method: 'DELETE',
        apiToken
    });
}

async function upsertWorkerScript({ apiToken, accountId, name, script }) {
    return cloudflareRequest({
        endpoint: `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`,
        method: 'PUT',
        apiToken,
        body: script,
        headers: {
            'Content-Type': 'application/javascript'
        }
    });
}

async function deleteWorkerScript({ apiToken, accountId, name }) {
    return cloudflareRequest({
        endpoint: `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`,
        method: 'DELETE',
        apiToken
    });
}

async function listRoutes({ apiToken, zoneId }) {
    const response = await cloudflareRequest({
        endpoint: `/zones/${zoneId}/workers/routes`,
        apiToken
    });

    return response.result || [];
}

async function createRoute({ apiToken, zoneId, pattern, script }) {
    return cloudflareRequest({
        endpoint: `/zones/${zoneId}/workers/routes`,
        method: 'POST',
        apiToken,
        json: {
            pattern,
            script
        }
    });
}

async function updateRoute({ apiToken, zoneId, routeId, pattern, script }) {
    return cloudflareRequest({
        endpoint: `/zones/${zoneId}/workers/routes/${routeId}`,
        method: 'PUT',
        apiToken,
        json: {
            pattern,
            script
        }
    });
}

async function deleteRoute({ apiToken, zoneId, routeId }) {
    return cloudflareRequest({
        endpoint: `/zones/${zoneId}/workers/routes/${routeId}`,
        method: 'DELETE',
        apiToken
    });
}

module.exports = {
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
};
