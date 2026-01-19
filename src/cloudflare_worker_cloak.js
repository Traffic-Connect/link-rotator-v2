const CLOAK_CONFIG = {};

const DEFAULT_ALLOWED_GEOS = ['IN', 'TR'];
const DEFAULT_ALLOW_DESKTOP = false;
const DEFAULT_ALLOW_VPN = false;
const DEFAULT_HIDE_SEO_TAGS = true;
const DEFAULT_ALLOW_RICH_RESULTS = false;

function getHostConfig(hostname) {
  const host = (hostname || '').toLowerCase().replace(/^www\./, '');
  return CLOAK_CONFIG[host] || CLOAK_CONFIG[`www.${host}`] || {};
}

function getAllowedGeos(cfg) {
  const list = Array.isArray(cfg.allowedGeos) ? cfg.allowedGeos : [];
  const normalized = list.map(code => (code || '').toUpperCase()).filter(Boolean);
  return normalized.length ? normalized : DEFAULT_ALLOWED_GEOS;
}

function getAllowDesktop(cfg) {
  return cfg.allowDesktop === true ? true : DEFAULT_ALLOW_DESKTOP;
}

function getAllowVpn(cfg) {
  return cfg.allowVpn === true ? true : DEFAULT_ALLOW_VPN;
}

function getHideSeoTags(cfg) {
  return cfg.hideSeoTags === false ? false : DEFAULT_HIDE_SEO_TAGS;
}

function getAllowRichResults(cfg) {
  return cfg.treatMarkupTestsAsGoogle === true ? true : DEFAULT_ALLOW_RICH_RESULTS;
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

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const cf = request.cf || {};
  const country = (cf.country || "").toUpperCase();
  const asOrg = (cf.asOrganization || "").toLowerCase(); // владелец IP (ASN)

  const hostname = new URL(request.url).hostname;
  const hostConfig = getHostConfig(hostname);
  const allowedGeos = getAllowedGeos(hostConfig);
  const allowDesktop = getAllowDesktop(hostConfig);
  const allowVpn = getAllowVpn(hostConfig);
  const hideSeoTags = getHideSeoTags(hostConfig);
  const allowRichResults = getAllowRichResults(hostConfig);

  const headers = request.headers;
  const uaHeader = headers.get("User-Agent") || "";
  const ua = uaHeader.toLowerCase();

  // ---------- 1. Реальный Googlebot (UA + org = Google) ----------
  const looksLikeGoogleUA =
    ua.includes("googlebot") ||
    ua.includes("adsbot-google") ||
    ua.includes("mediapartners-google");

  const ipBelongsToGoogle = asOrg.includes("google");

  const isRealGooglebot = looksLikeGoogleUA && ipBelongsToGoogle;
  const isMarkupTool = allowRichResults && looksLikeMarkupTest(ua);
  const effectiveGoogle = isRealGooglebot || isMarkupTool;

  // ---------- 2. Если НЕ Googlebot — режем по GEO / VPN / mobile ----------
  if (!effectiveGoogle) {
    const isAllowedGeo = allowedGeos.includes(country);

    // Только мобильные устройства
    const isMobile =
      ua.includes("android") ||
      ua.includes("iphone") ||
      ua.includes("ipad") ||
      ua.includes("ipod") ||
      ua.includes("mobile");

    // VPN / прокси / дата-центр по названию организации AS
    const vpnOrProxyKeywords = [
      "amazon", "aws",
      "google cloud",
      "microsoft", "azure",
      "digitalocean",
      "ovh",
      "hetzner",
      "contabo",
      "linode",
      "leaseweb",
      "m247",
      "choopa",
      "vultr",
      "data center",
      "datacenter",
      "hosting",
      "colo",
      "cloudflare",
      "akamai",
      "hivelocity",
      "gcore",
      "hostinger"
    ];

    let isVpnOrProxy = false;
    if (!asOrg) {
      // если org пустой — считаем это подозрительным
      isVpnOrProxy = true;
    } else {
      isVpnOrProxy = vpnOrProxyKeywords.some((kw) => asOrg.includes(kw));
    }

    const isAllowedHuman =
      isAllowedGeo &&
      (allowDesktop || isMobile) &&
      (allowVpn || !isVpnOrProxy);

    if (!isAllowedHuman) {
      // Все, кто не попадает под условия — видят заглушку
      const placeholderHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Service temporarily unavailable</title>
  <meta name="robots" content="noindex,nofollow" />
</head>
<body>
  <h2>Service temporarily unavailable</h2>
  <p>Please try again later.</p>
</body>
</html>`;

      return new Response(placeholderHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  // ---------- 3. Тут либо реальный Googlebot, либо разрешённый индиец/турок с мобайла ----------

  const response = await fetch(request);
  const contentType = response.headers.get("content-type") || "";

  // Не HTML — отдаём как есть (CSS/JS/картинки и т.д.)
  if (!contentType.includes("text/html")) {
    return response;
  }

  // ---------- 4. Для Googlebot HTML не трогаем ----------
  if (effectiveGoogle) {
    return response;
  }

  // ---------- 5. Для людей: прячем hreflang + canonical, добавляем self-canonical ----------
  if (!hideSeoTags) {
    return response;
  }

  const url = new URL(request.url);
  let html = await response.text();

  // Удаляем ВСЕ hreflang (link rel="alternate" hreflang="...")
  html = html.replace(
    /<link[^>]+rel=["']alternate["'][^>]*hreflang=["'][^"']*["'][^>]*>/gi,
    ""
  );

  // Удаляем ВСЕ canonical
  html = html.replace(
    /<link[^>]+rel=["']canonical["'][^>]*>/gi,
    ""
  );

  // Добавляем self-canonical: origin + pathname (без query)
  const selfCanonicalHref = `${url.origin}${url.pathname}`;
  const selfCanonicalTag = `<link rel="canonical" href="${selfCanonicalHref}" />\n`;

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${selfCanonicalTag}</head>`);
  } else {
    html = selfCanonicalTag + html;
  }

  return new Response(html, {
    status: response.status,
    headers: response.headers
  });
}
