const DEFAULT_CFG = {
  webArchive: {
    // enabled: true,
    archiveUrl: "",
    moneyUrl: "",
    treatMarkupTestsAsGoogle: true,
  },
  googlebot: {
    verifyReverseDns: true,
    failOpenOnDnsError: true,
    rdnsCacheTtl: 600,
  },
  fetch: {
    maxRedirects: 6
  }
};

async function loadCfg(env, hostname) {
  let cfg = null;
  // try {
  //   // CLOAK_CFG was removed; config is embedded during upload
  //   cfg = null;
  // } catch (_) {}

  const merged = JSON.parse(JSON.stringify(DEFAULT_CFG));
  if (cfg && typeof cfg === "object") {
    for (const k of Object.keys(cfg)) {
      if (cfg[k] && typeof cfg[k] === "object" && merged[k]) {
        Object.assign(merged[k], cfg[k]);
      } else {
        merged[k] = cfg[k];
      }
    }
  }
  return merged;
}

function looksLikeGooglebotUa(ua) {
  ua = (ua || "").toLowerCase();
  return (
    ua.includes("googlebot") ||
    ua.includes("adsbot-google") ||
    ua.includes("mediapartners-google")
  );
}

function looksLikeMarkupTest(ua) {
  ua = (ua || "").toLowerCase();
  return (
    ua.includes("rich results") ||
    ua.includes("richresult") ||
    ua.includes("structured") ||
    ua.includes("schema") ||
    ua.includes("webmasters") ||
    ua.includes("google-inspectiontool") ||
    ua.includes("inspection tool") ||
    ua.includes("google page speed") ||
    ua.includes("lighthouse")
  );
}

async function dohResolve(name, type) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);

  const res = await fetch(url.toString(), {
    headers: { "accept": "application/dns-json" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });

  if (!res.ok) throw new Error("DoH failed");
  return res.json();
}

function ipToPtrName(ip) {
  if (ip.includes(".")) {
    return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  }
  if (ip.includes(":")) {
    const parts = ip.toLowerCase().split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    const full = [
      ...left,
      ...Array(Math.max(0, missing)).fill("0"),
      ...right
    ].map(x => x.padStart(4, "0")).join("");
    return full.split("").reverse().join(".") + ".ip6.arpa";
  }
  return null;
}

async function forwardHasIp(host, ip) {
  const ips = new Set();
  const a = await dohResolve(host, "A");
  for (const ans of (a.Answer || [])) if (ans.data) ips.add(ans.data);
  const aaaa = await dohResolve(host, "AAAA");
  for (const ans of (aaaa.Answer || [])) if (ans.data) ips.add(ans.data.toLowerCase());
  return ips.has(ip.toLowerCase());
}

async function verifyGooglebotByReverseDns(ip) {
  const ptrName = ipToPtrName(ip);
  if (!ptrName) return false;

  const ptr = await dohResolve(ptrName, "PTR");
  const hosts = (ptr.Answer || [])
    .map(a => (a.data || "").replace(/\.$/, ""))
    .filter(Boolean);

  if (hosts.length === 0) return false;

  const host = hosts[0].toLowerCase();
  if (!host.endsWith(".googlebot.com") && !host.endsWith(".google.com")) {
    return false;
  }
  return forwardHasIp(host, ip);
}

async function cachedVerifyGooglebot(ip, ttlSeconds) {
  const cacheKey = new Request(`https://rdns-cache.local/verify?ip=${encodeURIComponent(ip)}`);
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.text()) === "1";

  const ok = await verifyGooglebotByReverseDns(ip);
  await cache.put(cacheKey, new Response(ok ? "1" : "0", {
    headers: { "Cache-Control": `max-age=${Math.max(60, ttlSeconds || 600)}` }
  }));
  return ok;
}

function joinPaths(basePath, reqPath) {
  const a = (basePath || "/").replace(/\/+$/, "");
  const b = (reqPath || "/").replace(/^\/+/, "");
  return b ? `${a}/${b}` : `${a}/`;
}

async function fetchFollowRedirects(request, targetUrl, maxRedirects) {
  let currentUrl = new URL(targetUrl);
  let redirectsLeft = Math.max(0, maxRedirects || 0);

  let currentReq = new Request(currentUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: (request.method === "GET" || request.method === "HEAD") ? undefined : request.body,
    redirect: "manual",
  });

  while (true) {
    const resp = await fetch(currentReq);
    const status = resp.status;
    const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

    if (isRedirect) {
      if (redirectsLeft <= 0) return resp;
      const loc = resp.headers.get("Location");
      if (!loc) return resp;

      currentUrl = new URL(loc, currentUrl);
      redirectsLeft -= 1;

      const nextMethod = (status === 303) ? "GET" : currentReq.method;

      currentReq = new Request(currentUrl.toString(), {
        method: nextMethod,
        headers: request.headers,
        body: (nextMethod === "GET" || nextMethod === "HEAD") ? undefined : request.body,
        redirect: "manual",
      });
      continue;
    }
    return resp;
  }
}

async function fetchFromBase(request, baseUrl, maxRedirects) {
  const reqUrl = new URL(request.url);
  const base = new URL(baseUrl);

  base.pathname = joinPaths(base.pathname, reqUrl.pathname);
  base.search = reqUrl.search;

  const resp = await fetchFollowRedirects(request, base.toString(), maxRedirects);

  // Якщо сторінка не знайдена — віддаємо головну без редіректів
  if (resp.status === 404) {
    const root = new URL(baseUrl);
    root.pathname = "/";
    root.search = "";
    const rootResp = await fetchFollowRedirects(request, root.toString(), maxRedirects);
    const rootHeaders = new Headers(rootResp.headers);
    if (!rootHeaders.get("content-type")) {
      rootHeaders.set("content-type", "text/html; charset=utf-8");
    }
    rootHeaders.delete("location");
    return new Response(rootResp.body, { status: rootResp.status, headers: rootHeaders });
  }

  const headers = new Headers(resp.headers);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  headers.delete("location");

  return new Response(resp.body, { status: resp.status, headers });
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const hostname = url.hostname;
  const cfg = await loadCfg(null, hostname);

  // if (!cfg.webArchive?.enabled) return fetch(request);

  const ua = request.headers.get("User-Agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";

  const precheckGoogle = looksLikeGooglebotUa(ua);

  let isRealGooglebot = false;
  if (precheckGoogle && cfg.googlebot?.verifyReverseDns) {
    try {
      isRealGooglebot = await cachedVerifyGooglebot(ip, cfg.googlebot?.rdnsCacheTtl);
    } catch {
      isRealGooglebot = cfg.googlebot?.failOpenOnDnsError ? true : false;
    }
  }

  const isMarkupTool =
    !!cfg.webArchive?.treatMarkupTestsAsGoogle && looksLikeMarkupTest(ua);

  const showMoneySite = isRealGooglebot || isMarkupTool;
  const baseUrl = showMoneySite ? cfg.webArchive.moneyUrl : cfg.webArchive.archiveUrl;

  if (!baseUrl) {
    return new Response("Configuration error: archiveUrl or moneyUrl is empty", { status: 500 });
  }

  if (url.searchParams.get("debug") === "1") {
    return new Response(JSON.stringify({
      hostname,
      ip,
      precheckGoogle,
      isRealGooglebot,
      isMarkupTool,
      showMoneySite,
      chosenBaseUrl: baseUrl,
      ua
    }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return fetchFromBase(request, baseUrl, cfg.fetch?.maxRedirects);
}
