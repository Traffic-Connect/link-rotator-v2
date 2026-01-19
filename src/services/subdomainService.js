const { callManagerApi, buildCloudflareClient, getZone, wrapStageError } = require('./cloudflareCachingService');

function sanitizeSubdomain(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const cleaned = value.trim().toLowerCase();
    if (!cleaned) {
        return null;
    }

    const isValid = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(cleaned);
    if (!isValid) {
        return null;
    }

    return cleaned;
}

function normalizeDomain(value) {
    if (typeof value !== 'string') {
        return null;
    }

    let trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }

    if (!/^[a-z]+:\/\//.test(trimmed)) {
        trimmed = `https://${trimmed}`;
    }

    try {
        const url = new URL(trimmed);
        let host = url.hostname.toLowerCase();
        host = host.replace(/\.$/, '');
        return host.replace(/^www\./, '');
    } catch (error) {
        return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    }
}

function parseDomainsInput(domains) {
    if (!domains) {
        return [];
    }

    const list = Array.isArray(domains)
        ? domains
        : domains
            .split(/\r?\n/)
            .map(item => item.split(/[,;]/))
            .flat();

    const normalized = [];
    const seen = new Set();

    list.forEach(item => {
        const domain = normalizeDomain(item);
        if (!domain) {
            return;
        }
        if (seen.has(domain)) {
            return;
        }
        seen.add(domain);
        normalized.push(domain);
    });

    return normalized;
}

async function resolveClientAndZone(domain) {
    let credentials;
    try {
        credentials = await callManagerApi(domain);
    } catch (error) {
        throw wrapStageError(domain, 'manager credentials', error);
    }

    const client = buildCloudflareClient({
        email: credentials.email,
        apiKey: credentials.apiKey
    });

    let zone;
    try {
        zone = await getZone(client, domain);
    } catch (error) {
        throw wrapStageError(domain, 'fetch zone', error);
    }

    return { client, zone };
}

async function queryDnsRecord(client, zoneId, name, type) {
    const endpoint = `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}${type ? `&type=${type}` : ''}`;
    const response = await client('GET', endpoint);
    return Array.isArray(response?.result) ? response.result[0] : null;
}

async function findOriginRecord(client, zoneId, domain) {
    const candidates = [
        { type: 'A', names: [domain, `www.${domain}`] },
        { type: 'AAAA', names: [domain, `www.${domain}`] },
        { type: 'CNAME', names: [domain, `www.${domain}`] }
    ];

    for (const candidate of candidates) {
        for (const name of candidate.names) {
            const record = await queryDnsRecord(client, zoneId, name, candidate.type);
            if (record) {
                return record;
            }
        }
    }

    throw new Error(`DNS record for ${domain} not found in Cloudflare`);
}

function buildRecordPayload({ domain, subdomain, originRecord }) {
    const fqdn = `${subdomain}.${domain}`;

    let type = 'CNAME';
    let content = originRecord.content;

    if (originRecord.type === 'A' || originRecord.type === 'AAAA') {
        type = originRecord.type;
    } else if (originRecord.type === 'CNAME') {
        type = 'CNAME';
    } else {
        content = domain;
    }

    if (type === 'CNAME' && /^[0-9.]+$/.test(content)) {
        content = domain;
    }

    return {
        type,
        name: fqdn,
        content,
        ttl: originRecord.ttl || 1,
        proxied: typeof originRecord.proxied === 'boolean' ? originRecord.proxied : true
    };
}

async function createDnsRecord(client, zoneId, payload, domainLabel) {
    try {
        const response = await client('POST', `/zones/${zoneId}/dns_records`, payload);
        return response?.result;
    } catch (error) {
        throw wrapStageError(domainLabel, 'create dns record', error);
    }
}

async function deleteDnsRecord(client, zoneId, recordId, domainLabel) {
    try {
        await client('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
    } catch (error) {
        if (error?.status === 404 || error?.statusCode === 404) {
            return;
        }
        throw wrapStageError(domainLabel, 'delete dns record', error);
    }
}

async function createSubdomainRecord({ domain, subdomain }) {
    const domainLabel = `${subdomain}.${domain}`;

    const { client, zone } = await resolveClientAndZone(domain);
    const originRecord = await findOriginRecord(client, zone.id, domain);
    const payload = buildRecordPayload({ domain, subdomain, originRecord });
    const created = await createDnsRecord(client, zone.id, payload, domainLabel);

    const rollback = async () => {
        await deleteDnsRecord(client, zone.id, created.id, domainLabel);
    };

    return {
        document: {
            subdomain,
            domain,
            fqdn: created.name,
            zoneId: zone.id,
            zoneName: zone.name,
            dnsRecordId: created.id,
            dnsRecordType: created.type,
            dnsContent: created.content,
            ttl: created.ttl,
            proxied: Boolean(created.proxied)
        },
        rollback
    };
}

async function deleteCloudflareRecord(entry) {
    const { client } = await resolveClientAndZone(entry.domain);
    await deleteDnsRecord(client, entry.zoneId, entry.dnsRecordId, entry.fqdn);
}

async function recreateSubdomainRecord(entry, newSubdomain) {
    const { client, zone } = await resolveClientAndZone(entry.domain);
    const originRecord = await findOriginRecord(client, zone.id, entry.domain);
    const payload = buildRecordPayload({ domain: entry.domain, subdomain: newSubdomain, originRecord });
    const newRecord = await createDnsRecord(client, zone.id, payload, `${newSubdomain}.${entry.domain}`);

    try {
        await deleteDnsRecord(client, entry.zoneId, entry.dnsRecordId, entry.fqdn);
    } catch (error) {
        try {
            await deleteDnsRecord(client, zone.id, newRecord.id, `${newSubdomain}.${entry.domain}`);
        } catch (cleanupError) {
            console.error('Failed to rollback new DNS record:', cleanupError.message || cleanupError);
        }
        throw error;
    }

    return {
        subdomain: newSubdomain,
        domain: entry.domain,
        fqdn: newRecord.name,
        zoneId: zone.id,
        zoneName: zone.name,
        dnsRecordId: newRecord.id,
        dnsRecordType: newRecord.type,
        dnsContent: newRecord.content,
        ttl: newRecord.ttl,
        proxied: Boolean(newRecord.proxied)
    };
}

module.exports = {
    sanitizeSubdomain,
    normalizeDomain,
    parseDomainsInput,
    createSubdomainRecord,
    deleteCloudflareRecord,
    recreateSubdomainRecord
};
