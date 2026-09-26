#!/usr/bin/env node
// generate-manifest.js
// يبني ملف build/twa-manifest.json تلقائيًا من رابط أي PWA، بدون أي تفاعل (non-interactive).
// بيقرأ manifest.json الموقع نفسه (الاسم، الألوان، الأيقونة) وبيدمجه مع القيم يلي جايه
// من الـ workflow inputs (لو موجودة) لبناء ملف الإعداد الكامل يلي بيحتاجه bubblewrap.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function fetchJson(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https') ? https : http;
    lib
      .get(targetUrl, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return resolve(fetchJson(nextUrl, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`فشل تحميل ${targetUrl} - HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`ملف manifest.json غير صالح (JSON خاطئ) على ${targetUrl}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function toHex(color, fallback) {
  const c = (color || '').trim();
  if (!c) return fallback;
  return c.startsWith('#') ? c : `#${c}`;
}

function slugToPackageId(host) {
  // كل جزء بمعرف حزمة أندرويد لازم يبلش بحرف (مو رقم)، فمنعالج أي جزء
  // من النطاق يبلش برقم (مثال: نطاق "1.example.com") بإضافة حرف قبله.
  const parts = host.split('.').filter(Boolean).reverse();
  const safe = parts.map((p) => {
    let seg = p.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!seg) seg = 'x';
    if (/^[0-9]/.test(seg)) seg = `n${seg}`;
    return seg;
  });
  return ['app', ...safe].join('.');
}

function sanitizeName(raw, fallback) {
  const s = (raw || '').trim();
  return s || fallback;
}

async function main() {
  const pwaUrlInput = (process.env.PWA_URL || '').trim();
  if (!pwaUrlInput) {
    throw new Error('لازم تحدد pwa_url عند تشغيل الـ workflow');
  }

  const pwaUrl = new URL(pwaUrlInput.endsWith('/') ? pwaUrlInput : pwaUrlInput + '/');
  const manifestUrl = new URL('manifest.json', pwaUrl).toString();

  console.log(`جاري تحميل manifest.json من: ${manifestUrl}`);
  const webManifest = await fetchJson(manifestUrl);

  const name = sanitizeName(
    process.env.APP_NAME,
    webManifest.name || webManifest.short_name || pwaUrl.hostname
  );
  const launcherName = (webManifest.short_name || name).slice(0, 30);

  const packageId = sanitizeName(process.env.PACKAGE_ID, slugToPackageId(pwaUrl.hostname));

  const themeColor = toHex(process.env.THEME_COLOR, toHex(webManifest.theme_color, '#121212'));
  const backgroundColor = toHex(
    process.env.BACKGROUND_COLOR,
    toHex(webManifest.background_color, themeColor)
  );

  let iconUrl = null;
  if (Array.isArray(webManifest.icons) && webManifest.icons.length) {
    const sizeOf = (icon) => parseInt((icon.sizes || '0x0').split('x')[0], 10) || 0;
    const sorted = [...webManifest.icons].sort((a, b) => sizeOf(b) - sizeOf(a));
    iconUrl = new URL(sorted[0].src, pwaUrl).toString();
  }
  if (!iconUrl) {
    throw new Error(
      'ما لقيت أي أيقونة (icons) بملف manifest.json الخاص بالموقع - لازم تضيف أيقونة وحدة عالأقل مقاس 512x512 قبل المحاولة'
    );
  }

  let startUrl = '/';
  if (webManifest.start_url) {
    const resolved = new URL(webManifest.start_url, pwaUrl);
    startUrl = resolved.pathname + (resolved.search || '') + (resolved.hash || '');
  }

  const displayMode = (process.env.DISPLAY_MODE || 'fullscreen').trim() || 'fullscreen';

  const twaManifest = {
    packageId,
    host: pwaUrl.host,
    name,
    launcherName,
    display: displayMode,
    themeColor,
    navigationColor: themeColor,
    navigationColorDark: themeColor,
    backgroundColor,
    enableNotifications: false,
    startUrl,
    iconUrl,
    splashScreenFadeOutDuration: 300,
    signingKey: {
      path: './android.keystore',
      alias: 'androidkey',
    },
    appVersionName: '1.0.0',
    appVersionCode: 1,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: manifestUrl,
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: false,
    isChromeOSOnly: false,
    orientation: 'default',
    minSdkVersion: 21,
  };

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'twa-manifest.json'), JSON.stringify(twaManifest, null, 2));

  console.log('تم إنشاء build/twa-manifest.json بنجاح:');
  console.log(JSON.stringify(twaManifest, null, 2));
}

main().catch((err) => {
  console.error('خطأ:', err.message);
  process.exit(1);
});
