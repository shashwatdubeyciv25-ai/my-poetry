/**
 * ==========================================================================
 * अशब्द (Ashabd.in) - Master Cloudflare Worker Edge Controller
 * Handles:
 *  1. Admin Authentication & Session Management (HMAC-SHA256 Web Crypto)
 *  2. Private Admin Dashboard API (D1 Database CRUD operations)
 *  3. Dynamic SSR for Public Poems & Writings (/poetry/:slug, /writing/:slug)
 *  4. Public Poetry Archive & Index (/poetry, /writings)
 *  5. Static Asset Passthrough via env.ASSETS (for /, style.css, app.js, etc.)
 * ==========================================================================
 */

export default {
  async fetch(request, env, ctx) {
    // Normalize D1 database binding so both 'ashabd-db' and 'DB' work seamlessly
    if (!env.DB && env['ashabd-db']) {
      env.DB = env['ashabd-db'];
    } else if (!env['ashabd-db'] && env.DB) {
      env['ashabd-db'] = env.DB;
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // ------------------------------------------------------------------------
      // 1. ROUTE: Admin Dashboard Page (/admin, /admin/)
      // ------------------------------------------------------------------------
      if (pathname === '/admin.html') {
        return Response.redirect(new URL('/admin', request.url), 302);
      }
      if (pathname === '/reset-password' || pathname === '/reset-password/') {
        const token = url.searchParams.get('token') || url.searchParams.get('reset_token');
        const redirectUrl = new URL('/admin', request.url);
        if (token) {
          redirectUrl.searchParams.set('reset_token', token);
        }
        return Response.redirect(redirectUrl, 302);
      }
      if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/analytics' || pathname === '/admin/analytics/') {
        return handleAdminPage(request, env);
      }

      // ------------------------------------------------------------------------
      // 2. ROUTE GROUP: Authentication APIs (/api/auth/*)
      // ------------------------------------------------------------------------
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }
      if (pathname === '/api/auth/setup' && request.method === 'POST') {
        return handleSetup(request, env);
      }
      if (pathname === '/api/auth/forgot-password' && request.method === 'POST') {
        return handleForgotPassword(request, env);
      }
      if (pathname === '/api/auth/verify-reset-token' && (request.method === 'POST' || request.method === 'GET')) {
        return handleVerifyResetToken(request, env);
      }
      if (pathname === '/api/auth/reset-password' && request.method === 'POST') {
        return handleResetPassword(request, env);
      }
      if (pathname === '/api/auth/update-email' && request.method === 'POST') {
        return handleUpdateEmail(request, env);
      }
      if (pathname === '/api/auth/change-password' && request.method === 'POST') {
        return handleChangePassword(request, env);
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return handleLogout(request);
      }
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return handleAuthCheck(request, env);
      }

      // ------------------------------------------------------------------------
      // 3. ROUTE GROUP: Admin Content Management APIs (/api/writings/*)
      // ------------------------------------------------------------------------
      if (pathname.startsWith('/api/writings')) {
        // Enforce strict authentication for all admin API endpoints
        const user = await getAuthenticatedUser(request, env);
        if (!user) {
          return jsonResponse({ error: 'Unauthorized: Administrator session required.' }, 401);
        }

        // List writings & stats
        if (pathname === '/api/writings' && request.method === 'GET') {
          return handleListWritingsAdmin(request, env);
        }

        // Create writing
        if (pathname === '/api/writings' && request.method === 'POST') {
          return handleCreateWriting(request, env, ctx);
        }

        // Single writing operations: /api/writings/:id
        const idMatch = pathname.match(/^\/api\/writings\/([a-zA-Z0-9_\-]+)$/);
        if (idMatch) {
          const id = idMatch[1];
          if (request.method === 'GET') {
            return handleGetWritingAdmin(id, env);
          }
          if (request.method === 'PUT') {
            return handleUpdateWriting(id, request, env, ctx);
          }
          if (request.method === 'DELETE') {
            return handleDeleteWriting(id, env);
          }
        }

        // Toggle publication status: /api/writings/:id/status
        const statusMatch = pathname.match(/^\/api\/writings\/([a-zA-Z0-9_\-]+)\/status$/);
        if (statusMatch && (request.method === 'PATCH' || request.method === 'POST')) {
          return handleToggleStatus(statusMatch[1], request, env, ctx);
        }

        return jsonResponse({ error: 'Endpoint not found' }, 404);
      }

      // ------------------------------------------------------------------------
      // 3b. ROUTE GROUP: Website Analytics APIs (/api/analytics/*)
      // ------------------------------------------------------------------------
      if (pathname === '/api/analytics/collect' && request.method === 'POST') {
        return handleAnalyticsCollect(request, env, ctx);
      }
      if (pathname === '/api/analytics/data' && request.method === 'GET') {
        return handleGetAnalyticsData(request, env);
      }
      if (pathname === '/api/analytics/test-ping' && request.method === 'POST') {
        return handleAnalyticsTestPing(request, env);
      }

      // ------------------------------------------------------------------------
      // 3c. ROUTE GROUP: Subscriber & Poem Notification System
      // ------------------------------------------------------------------------
      if (pathname === '/api/subscribers/subscribe' && request.method === 'POST') {
        return handleSubscribe(request, env);
      }
      if (pathname === '/verify-subscription' && request.method === 'GET') {
        return handleVerifySubscriptionPage(request, env);
      }
      if (pathname === '/unsubscribe' && request.method === 'GET') {
        return handleUnsubscribePage(request, env);
      }

      if (pathname.startsWith('/api/subscribers')) {
        const user = await getAuthenticatedUser(request, env);
        if (!user) {
          return jsonResponse({ error: 'Unauthorized: Administrator session required.' }, 401);
        }
        if (pathname === '/api/subscribers' && request.method === 'GET') {
          return handleListSubscribersAdmin(request, env);
        }
        if (pathname === '/api/subscribers/send-test-notification' && request.method === 'POST') {
          return handleSendTestPoemNotification(request, env);
        }
        const subIdMatch = pathname.match(/^\/api\/subscribers\/([a-zA-Z0-9_\-]+)$/);
        if (subIdMatch && request.method === 'DELETE') {
          return handleDeleteSubscriberAdmin(subIdMatch[1], env);
        }
        return jsonResponse({ error: 'Endpoint not found' }, 404);
      }

      // ------------------------------------------------------------------------
      // 4. ROUTE: Public API for Published Writings (/api/public/writings)
      // ------------------------------------------------------------------------
      if (pathname === '/api/public/writings' && request.method === 'GET') {
        return handlePublicWritingsList(request, env);
      }

      // ------------------------------------------------------------------------
      // 5. ROUTE: Public Poem & Writing Dynamic Pages (/poems/:slug, /poetry/:slug, /writing/:slug)
      // ------------------------------------------------------------------------
      const poemMatch = pathname.match(/^\/(?:poetry|poems|poem|writing|writings)\/([^\/]+)$/);
      if (poemMatch && request.method === 'GET') {
        const rawSlug = poemMatch[1];
        const slug = decodeURIComponent(rawSlug);
        return handlePublicPoemPage(slug, request, env);
      }

      // ------------------------------------------------------------------------
      // 6. ROUTE: Public Poetry Collection / Archive (/poems, /poetry, /writings)
      // ------------------------------------------------------------------------
      if ((pathname === '/poems' || pathname === '/poems/' || pathname === '/poetry' || pathname === '/poetry/' || pathname === '/writings' || pathname === '/writings/') && request.method === 'GET') {
        return handlePublicArchivePage(request, env);
      }

      // ------------------------------------------------------------------------
      // 7. ROUTE: Static Assets (/, /style.css, /app.js, /ashabd_website_logo_pack/*)
      // ------------------------------------------------------------------------
      if (env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(recordAnalyticsEvent(env.DB, {
              path: pathname,
              event_type: 'error_404',
              status_code: 404,
              referrer_source: getReferrerDetails(request.headers.get('referer')).source,
              referrer_host: getReferrerDetails(request.headers.get('referer')).host,
              is_bot: isBotRequest(request),
              visitor_id: await getAnonymousVisitorId(request, env)
            }));
          }
          return new Response(renderNotFoundHtml(), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return assetRes;
      }

      // Fallback if env.ASSETS is not configured
      return new Response('Ashabd (अशब्द) — Antique Poetry Manuscript', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });

    } catch (err) {
      console.error('Unhandled Worker error:', err);
      return new Response('500 Internal Server Error: ' + err.message, { status: 500 });
    }
  }
};

/* ==========================================================================
   AUTHENTICATION & SECURITY HELPERS
   ========================================================================== */

const SESSION_COOKIE_NAME = 'ashabd_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Derives a cryptographic HMAC key from a secret string
 */
async function getHmacKey(secret) {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Creates a signed JWT-style session token: base64(payload).signature
 */
async function createSessionToken(payload, secret) {
  const enc = new TextEncoder();
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = btoa(unescape(encodeURIComponent(payloadStr)));
  
  const key = await getHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies a signed session token
 */
async function verifySessionToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;

    const enc = new TextEncoder();
    const key = await getHmacKey(secret);

    // Reconstruct signature bytes
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
    if (!isValid) return null;

    const payloadStr = decodeURIComponent(escape(atob(payloadB64)));
    const payload = JSON.parse(payloadStr);

    if (payload.exp && payload.exp < Date.now()) {
      return null; // Expired session
    }

    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Returns the effective secret for signing (SESSION_SECRET or ADMIN_PASSWORD)
 */
function getEffectiveSecret(env) {
  return env.SESSION_SECRET || env.ADMIN_PASSWORD || 'ashabd_fallback_internal_secret_key_871923';
}

/**
 * Inspects incoming request cookie and verifies session
 */
async function getAuthenticatedUser(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const secret = getEffectiveSecret(env);
  return await verifySessionToken(token, secret);
}

function parseCookies(header) {
  const list = {};
  if (!header) return list;
  header.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/* ==========================================================================
   AUTH CONTROLLER HANDLERS (CLOUDFLARE SECRETS + D1 ADMIN USERS)
   ========================================================================== */

async function hashPasswordWithSalt(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(password + ':' + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRandomHexToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureAdminUsersTable(db) {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      email TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  try {
    await db.prepare(`ALTER TABLE admin_users ADD COLUMN email TEXT`).run();
  } catch (_) {
    // Column already exists or table was just created
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();

  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at)`).run();
  } catch (_) {}
}

let writingsTableEnsured = false;
async function ensureWritingsTable(db) {
  if (!db || writingsTableEnsured) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS writings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        subtitle TEXT,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'Poetry',
        tags TEXT,
        status TEXT NOT NULL DEFAULT 'Draft',
        cover_image_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER
      )
    `).run();
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_writings_status ON writings(status)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_writings_slug ON writings(slug)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_writings_published_at ON writings(published_at DESC)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_writings_updated_at ON writings(updated_at DESC)`).run();
    } catch (_) {}
    writingsTableEnsured = true;
  } catch (e) {
    console.warn('ensureWritingsTable notice:', e?.message || e);
  }
}

let subscribersTableEnsured = false;
async function ensureSubscribersTable(db) {
  if (!db || subscribersTableEnsured) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        verification_token_hash TEXT,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        referrer TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL,
        verified_at INTEGER,
        unsubscribed_at INTEGER
      )
    `).run();

    try {
      await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscribers_verification_token ON subscribers(verification_token_hash)`).run();
      await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_unsubscribe_token ON subscribers(unsubscribe_token)`).run();
    } catch (_) {}

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS poem_notifications (
        id TEXT PRIMARY KEY,
        writing_id TEXT NOT NULL,
        subscriber_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent',
        error_message TEXT,
        sent_at INTEGER NOT NULL
      )
    `).run();

    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_poem_notifications_writing ON poem_notifications(writing_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_poem_notifications_subscriber ON poem_notifications(subscriber_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_poem_notifications_sent_at ON poem_notifications(sent_at DESC)`).run();
    } catch (_) {}

    subscribersTableEnsured = true;
  } catch (e) {
    console.warn('ensureSubscribersTable notice:', e?.message || e);
  }
}

/* ==========================================================================
   WEBSITE ANALYTICS BACKEND (CLOUDFLARE EDGE & D1 ANALYTICS)
   ========================================================================== */

let analyticsTablesEnsured = false;
async function ensureAnalyticsTables(db) {
  if (!db || analyticsTablesEnsured) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        date TEXT NOT NULL,
        path TEXT NOT NULL,
        content_slug TEXT,
        content_type TEXT DEFAULT 'Page',
        event_type TEXT NOT NULL DEFAULT 'pageview',
        visitor_id TEXT NOT NULL,
        is_returning INTEGER NOT NULL DEFAULT 0,
        country TEXT DEFAULT 'XX',
        referrer_source TEXT DEFAULT 'direct',
        referrer_host TEXT DEFAULT 'direct',
        device_type TEXT DEFAULT 'desktop',
        browser TEXT DEFAULT 'Other',
        os TEXT DEFAULT 'Other',
        duration_seconds INTEGER DEFAULT 0,
        is_bot INTEGER DEFAULT 0,
        status_code INTEGER DEFAULT 200
      )
    `).run();

    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp DESC)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(date)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_path ON analytics_events(path)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_events(visitor_id, date)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_bot ON analytics_events(is_bot)`).run();
    } catch (_) {}
    analyticsTablesEnsured = true;
  } catch (e) {
    console.warn('ensureAnalyticsTables notice:', e?.message || e);
  }
}

async function getAnonymousVisitorId(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  const ua = request.headers.get('user-agent') || '';
  const dateStr = new Date().toISOString().slice(0, 10);
  const salt = env.ANALYTICS_SALT || 'ashabd-salt-2026-edge';
  const data = new TextEncoder().encode(`${ip}|${ua}|${salt}|${dateStr}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isBotRequest(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return 0;
  const botPattern = /bot|spider|crawler|crawling|slurp|bingbot|googlebot|yandex|duckduckbot|baiduspider|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkShare|W3C_Validator|whatsapp|telegrambot|applebot|petalbot|semrush|ahrefs/i;
  return botPattern.test(ua) ? 1 : 0;
}

function getClientDetails(request) {
  const ua = request.headers.get('user-agent') || '';
  let device_type = 'desktop';
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    device_type = 'tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|iemobile|kindle/i.test(ua)) {
    device_type = 'mobile';
  }

  let browser = 'Other';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/opera|opr/i.test(ua)) browser = 'Opera';

  let os = 'Other';
  if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { device_type, browser, os };
}

function getReferrerDetails(referrer) {
  if (!referrer) return { source: 'direct', host: 'direct' };
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    if (host.includes('ashabd.in')) return { source: 'internal', host: 'ashabd.in' };
    if (host.includes('instagram.com') || host.includes('l.instagram.com')) return { source: 'instagram', host: 'Instagram' };
    if (host.includes('t.co') || host.includes('twitter.com') || host.includes('x.com')) return { source: 'twitter', host: 'X (Twitter)' };
    if (host.includes('google.')) return { source: 'google', host: 'Google' };
    if (host.includes('bing.')) return { source: 'bing', host: 'Bing' };
    if (host.includes('duckduckgo.')) return { source: 'duckduckgo', host: 'DuckDuckGo' };
    if (host.includes('yahoo.')) return { source: 'yahoo', host: 'Yahoo' };
    if (host.includes('facebook.') || host.includes('fb.me') || host.includes('l.facebook.com')) return { source: 'facebook', host: 'Facebook' };
    if (host.includes('linkedin.')) return { source: 'linkedin', host: 'LinkedIn' };
    if (host.includes('reddit.')) return { source: 'reddit', host: 'Reddit' };
    if (host.includes('youtube.')) return { source: 'youtube', host: 'YouTube' };
    if (host.includes('pinterest.')) return { source: 'pinterest', host: 'Pinterest' };
    return { source: 'other', host };
  } catch {
    return { source: 'other', host: 'external' };
  }
}

async function recordAnalyticsEvent(db, event) {
  if (!db) return;
  try {
    await ensureAnalyticsTables(db);
    const id = (crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)));
    await db.prepare(`
      INSERT INTO analytics_events (
        id, timestamp, date, path, content_slug, content_type, event_type,
        visitor_id, is_returning, country, referrer_source, referrer_host,
        device_type, browser, os, duration_seconds, is_bot, status_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      event.timestamp || Date.now(),
      event.date || new Date().toISOString().slice(0, 10),
      event.path || '/',
      event.content_slug || null,
      event.content_type || 'Page',
      event.event_type || 'pageview',
      event.visitor_id || 'anon',
      event.is_returning ? 1 : 0,
      event.country || 'XX',
      event.referrer_source || 'direct',
      event.referrer_host || 'direct',
      event.device_type || 'desktop',
      event.browser || 'Other',
      event.os || 'Other',
      event.duration_seconds || 0,
      event.is_bot ? 1 : 0,
      event.status_code || 200
    ).run();
  } catch (err) {
    console.warn('recordAnalyticsEvent error:', err?.message || err);
  }
}

async function handleAnalyticsCollect(request, env, ctx) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    try {
      const text = await request.text();
      body = JSON.parse(text);
    } catch {}
  }

  const rawPath = body.path || '/';
  const path = rawPath.split('?')[0];
  if (path.startsWith('/admin') || path.startsWith('/api')) {
    return new Response(null, { status: 204 });
  }

  const timestamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const visitor_id = await getAnonymousVisitorId(request, env);
  const is_bot = isBotRequest(request);
  const client = getClientDetails(request);
  const country = request.headers.get('cf-ipcountry') || request.cf?.country || 'XX';
  const refDetails = getReferrerDetails(body.ref || request.headers.get('referer'));

  const slugMatch = path.match(/^\/(?:poems|poetry|writing|writings)\/([^\/]+)$/);
  const content_slug = slugMatch ? decodeURIComponent(slugMatch[1]) : null;

  const eventData = {
    timestamp,
    date,
    path,
    content_slug,
    content_type: content_slug ? 'Poetry' : 'Page',
    event_type: body.type || 'pageview',
    visitor_id,
    is_returning: !!body.is_returning,
    country,
    referrer_source: refDetails.source,
    referrer_host: refDetails.host,
    device_type: client.device_type,
    browser: client.browser,
    os: client.os,
    duration_seconds: parseInt(body.duration, 10) || 0,
    is_bot,
    status_code: 200
  };

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(recordAnalyticsEvent(env.DB, eventData));
  } else {
    await recordAnalyticsEvent(env.DB, eventData);
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

const COUNTRY_MAP = {
  IN: { name: 'India', flag: '🇮🇳' },
  US: { name: 'United States', flag: '🇺🇸' },
  GB: { name: 'United Kingdom', flag: '🇬🇧' },
  CA: { name: 'Canada', flag: '🇨🇦' },
  AU: { name: 'Australia', flag: '🇦🇺' },
  DE: { name: 'Germany', flag: '🇩🇪' },
  FR: { name: 'France', flag: '🇫🇷' },
  AE: { name: 'United Arab Emirates', flag: '🇦🇪' },
  SG: { name: 'Singapore', flag: '🇸🇬' },
  NP: { name: 'Nepal', flag: '🇳🇵' },
  PK: { name: 'Pakistan', flag: '🇵🇰' },
  BD: { name: 'Bangladesh', flag: '🇧🇩' },
  NL: { name: 'Netherlands', flag: '🇳🇱' },
  RU: { name: 'Russia', flag: '🇷🇺' },
  JP: { name: 'Japan', flag: '🇯🇵' },
  XX: { name: 'Unknown / Local', flag: '🌐' }
};

async function handleGetAnalyticsData(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized: Administrator session required.' }, 401);
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  await ensureAnalyticsTables(db);
  await ensureWritingsTable(db);

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '7d';
  const customStart = url.searchParams.get('startDate');
  const customEnd = url.searchParams.get('endDate');

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  let startMs = now - 7 * oneDayMs;
  let endMs = now;
  let prevStartMs = now - 14 * oneDayMs;
  let prevEndMs = startMs;
  let isHourly = false;

  if (period === 'today') {
    startMs = todayStartMs;
    endMs = now;
    prevStartMs = todayStartMs - oneDayMs;
    prevEndMs = todayStartMs;
    isHourly = true;
  } else if (period === 'yesterday') {
    startMs = todayStartMs - oneDayMs;
    endMs = todayStartMs;
    prevStartMs = todayStartMs - 2 * oneDayMs;
    prevEndMs = startMs;
    isHourly = true;
  } else if (period === '7d') {
    startMs = now - 7 * oneDayMs;
    endMs = now;
    prevStartMs = now - 14 * oneDayMs;
    prevEndMs = startMs;
  } else if (period === '30d') {
    startMs = now - 30 * oneDayMs;
    endMs = now;
    prevStartMs = now - 60 * oneDayMs;
    prevEndMs = startMs;
  } else if (period === '90d') {
    startMs = now - 90 * oneDayMs;
    endMs = now;
    prevStartMs = now - 180 * oneDayMs;
    prevEndMs = startMs;
  } else if (period === 'custom' && customStart && customEnd) {
    startMs = new Date(customStart + 'T00:00:00Z').getTime() || (now - 7 * oneDayMs);
    endMs = new Date(customEnd + 'T23:59:59Z').getTime() || now;
    const diff = endMs - startMs;
    prevStartMs = startMs - diff;
    prevEndMs = startMs;
  }

  // 1. Summary Counts for Current Period
  const currStats = await db.prepare(`
    SELECT
      COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as page_views,
      COUNT(DISTINCT visitor_id) as total_visitors,
      COUNT(DISTINCT visitor_id) as unique_visitors,
      COUNT(CASE WHEN event_type = 'read' THEN 1 END) as total_reads
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
  `).bind(startMs, endMs).first() || {};

  // Previous Period for Comparison
  const prevStats = await db.prepare(`
    SELECT
      COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as page_views,
      COUNT(DISTINCT visitor_id) as unique_visitors
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
  `).bind(prevStartMs, prevEndMs).first() || {};

  // Active Online Visitors (last 5 minutes = 300,000 ms)
  const activeOnline = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) as online
    FROM analytics_events
    WHERE timestamp >= ? AND is_bot = 0
  `).bind(now - 300000).first('online') || 0;

  // Multi-interval visitor breakdown
  const todayVisitors = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) as v, COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as p
    FROM analytics_events WHERE timestamp >= ? AND is_bot = 0
  `).bind(todayStartMs).first() || { v: 0, p: 0 };

  const last7dVisitors = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) as v, COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as p
    FROM analytics_events WHERE timestamp >= ? AND is_bot = 0
  `).bind(now - 7 * oneDayMs).first() || { v: 0, p: 0 };

  const last30dVisitors = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) as v, COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as p
    FROM analytics_events WHERE timestamp >= ? AND is_bot = 0
  `).bind(now - 30 * oneDayMs).first() || { v: 0, p: 0 };

  const allTimeStats = await db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) as v, COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as p
    FROM analytics_events WHERE is_bot = 0
  `).first() || { v: 0, p: 0 };

  // Content Counts from Writings Table
  const totalPoems = await db.prepare(`
    SELECT COUNT(*) as c FROM writings WHERE status = 'Published' AND (content_type = 'Poetry' OR content_type = 'कविता')
  `).first('c') || 0;

  const totalArticles = await db.prepare(`
    SELECT COUNT(*) as c FROM writings WHERE status = 'Published' AND content_type != 'Poetry' AND content_type != 'कविता'
  `).first('c') || 0;

  // 2. Traffic Trends Chart Data
  let chartPoints = [];
  if (isHourly) {
    const { results: hourlyRows } = await db.prepare(`
      SELECT CAST(strftime('%H', datetime(timestamp/1000, 'unixepoch')) AS INTEGER) as hour,
             COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
             COUNT(DISTINCT visitor_id) as visitors,
             COUNT(CASE WHEN event_type = 'read' THEN 1 END) as reads,
             COUNT(DISTINCT CASE WHEN is_returning = 1 THEN visitor_id END) as returning_visitors,
             COUNT(DISTINCT CASE WHEN is_returning = 0 THEN visitor_id END) as new_visitors
      FROM analytics_events
      WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).bind(startMs, endMs).all();

    const hourMap = {};
    for (const r of (hourlyRows || [])) hourMap[r.hour] = r;

    for (let h = 0; h < 24; h++) {
      const row = hourMap[h] || { pageviews: 0, visitors: 0, reads: 0, returning_visitors: 0, new_visitors: 0 };
      const label = `${h.toString().padStart(2, '0')}:00`;
      chartPoints.push({
        label,
        pageviews: row.pageviews || 0,
        visitors: row.visitors || 0,
        reads: row.reads || 0,
        returning_visitors: row.returning_visitors || 0,
        new_visitors: row.new_visitors || 0
      });
    }
  } else {
    const { results: dailyRows } = await db.prepare(`
      SELECT date,
             COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
             COUNT(DISTINCT visitor_id) as visitors,
             COUNT(CASE WHEN event_type = 'read' THEN 1 END) as reads,
             COUNT(DISTINCT CASE WHEN is_returning = 1 THEN visitor_id END) as returning_visitors,
             COUNT(DISTINCT CASE WHEN is_returning = 0 THEN visitor_id END) as new_visitors
      FROM analytics_events
      WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
      GROUP BY date
      ORDER BY date ASC
    `).bind(startMs, endMs).all();

    const dateMap = {};
    for (const r of (dailyRows || [])) dateMap[r.date] = r;

    const curDate = new Date(startMs);
    const stopDate = new Date(endMs);
    while (curDate <= stopDate) {
      const dStr = curDate.toISOString().slice(0, 10);
      const row = dateMap[dStr] || { pageviews: 0, visitors: 0, reads: 0, returning_visitors: 0, new_visitors: 0 };
      const dObj = new Date(dStr);
      const formattedLabel = dObj.toLocaleDateString('hi-IN', { day: 'numeric', month: 'short' });
      chartPoints.push({
        label: formattedLabel,
        date: dStr,
        pageviews: row.pageviews || 0,
        visitors: row.visitors || 0,
        reads: row.reads || 0,
        returning_visitors: row.returning_visitors || 0,
        new_visitors: row.new_visitors || 0
      });
      curDate.setDate(curDate.getDate() + 1);
    }
  }

  // 3. Resolve Content Titles from Writings Table
  const { results: allWritings } = await db.prepare(`
    SELECT title, slug, content_type, published_at FROM writings
  `).all();
  const writingMap = {};
  for (const w of (allWritings || [])) {
    writingMap[w.slug] = w;
  }

  // 4. Most Popular Pages / Content
  const { results: pageRows } = await db.prepare(`
    SELECT path, content_slug,
           COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as views,
           COUNT(DISTINCT visitor_id) as visitors,
           COUNT(CASE WHEN event_type = 'read' THEN 1 END) as reads,
           ROUND(AVG(CASE WHEN duration_seconds > 0 THEN duration_seconds END)) as avg_duration
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY path
    ORDER BY views DESC
    LIMIT 50
  `).bind(startMs, endMs).all();

  const totalPageViews = currStats.page_views || 1;
  const popularContent = (pageRows || []).map((row, idx) => {
    let title = row.path;
    let type = 'Page';
    let is_poem = false;

    if (row.content_slug && writingMap[row.content_slug]) {
      const wr = writingMap[row.content_slug];
      title = wr.title;
      type = wr.content_type || 'Poetry';
      is_poem = (type === 'Poetry' || type === 'कविता');
    } else if (row.path === '/') {
      title = 'Ashabd — Home Page';
      type = 'Landing Page';
    } else if (row.path === '/poems' || row.path === '/poetry' || row.path === '/writings') {
      title = 'Poetry Collection Archive';
      type = 'Collection';
    } else {
      const m = row.path.match(/^\/(?:poems|poetry|writing|writings)\/([^\/]+)$/);
      if (m && writingMap[decodeURIComponent(m[1])]) {
        const wr = writingMap[decodeURIComponent(m[1])];
        title = wr.title;
        type = wr.content_type || 'Poetry';
        is_poem = (type === 'Poetry' || type === 'कविता');
      }
    }

    const views = row.views || 0;
    const reads = row.reads || 0;
    const readRate = views > 0 ? Math.min(100, Math.round((reads / views) * 100)) : 0;
    const sharePct = totalPageViews > 0 ? Math.round((views / totalPageViews) * 1000) / 10 : 0;

    return {
      rank: idx + 1,
      path: row.path,
      title,
      content_type: type,
      is_poem,
      views,
      visitors: row.visitors || 0,
      reads,
      read_rate: readRate,
      avg_duration: row.avg_duration || 0,
      share_pct: sharePct
    };
  });

  // 5. Traffic Sources Breakdown
  const { results: sourceRows } = await db.prepare(`
    SELECT referrer_source, referrer_host, COUNT(*) as count
    FROM analytics_events
    WHERE is_bot = 0 AND event_type = 'pageview' AND timestamp >= ? AND timestamp <= ?
    GROUP BY referrer_source, referrer_host
    ORDER BY count DESC
  `).bind(startMs, endMs).all();

  const sourceCounts = {
    direct: 0,
    google: 0,
    instagram: 0,
    twitter: 0,
    search: 0,
    social: 0,
    other: 0
  };
  let totalSources = 0;

  for (const s of (sourceRows || [])) {
    const c = s.count || 0;
    totalSources += c;
    if (s.referrer_source === 'direct') sourceCounts.direct += c;
    else if (s.referrer_source === 'google') sourceCounts.google += c;
    else if (s.referrer_source === 'instagram') sourceCounts.instagram += c;
    else if (s.referrer_source === 'twitter') sourceCounts.twitter += c;
    else if (s.referrer_source === 'bing' || s.referrer_source === 'duckduckgo' || s.referrer_source === 'yahoo') sourceCounts.search += c;
    else if (s.referrer_source === 'facebook' || s.referrer_source === 'linkedin' || s.referrer_source === 'reddit' || s.referrer_source === 'youtube') sourceCounts.social += c;
    else sourceCounts.other += c;
  }

  // 6. Demographics
  const { results: countryRows } = await db.prepare(`
    SELECT country, COUNT(DISTINCT visitor_id) as visitors, COUNT(*) as views
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY country
    ORDER BY visitors DESC
    LIMIT 12
  `).bind(startMs, endMs).all();

  const countries = (countryRows || []).map(r => {
    const meta = COUNTRY_MAP[r.country] || { name: r.country, flag: '🌐' };
    return {
      code: r.country,
      name: meta.name,
      flag: meta.flag,
      visitors: r.visitors,
      views: r.views,
      pct: currStats.unique_visitors > 0 ? Math.round((r.visitors / currStats.unique_visitors) * 100) : 0
    };
  });

  const { results: deviceRows } = await db.prepare(`
    SELECT device_type, COUNT(DISTINCT visitor_id) as visitors
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY device_type
    ORDER BY visitors DESC
  `).bind(startMs, endMs).all();

  const { results: browserRows } = await db.prepare(`
    SELECT browser, COUNT(DISTINCT visitor_id) as visitors
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY browser
    ORDER BY visitors DESC
    LIMIT 6
  `).bind(startMs, endMs).all();

  const { results: osRows } = await db.prepare(`
    SELECT os, COUNT(DISTINCT visitor_id) as visitors
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY os
    ORDER BY visitors DESC
    LIMIT 6
  `).bind(startMs, endMs).all();

  const { results: returningRows } = await db.prepare(`
    SELECT is_returning, COUNT(DISTINCT visitor_id) as visitors
    FROM analytics_events
    WHERE is_bot = 0 AND timestamp >= ? AND timestamp <= ?
    GROUP BY is_returning
  `).bind(startMs, endMs).all();

  let newVisitors = 0, returningVisitors = 0;
  for (const r of (returningRows || [])) {
    if (r.is_returning === 1) returningVisitors += r.visitors;
    else newVisitors += r.visitors;
  }

  // 7. Poetry Engagement Stats
  const poemList = popularContent.filter(p => p.is_poem);
  const totalPoemViews = poemList.reduce((acc, p) => acc + p.views, 0);
  const totalPoemReads = poemList.reduce((acc, p) => acc + p.reads, 0);
  const avgPoemDuration = poemList.length > 0 ? Math.round(poemList.reduce((acc, p) => acc + (p.avg_duration || 0), 0) / poemList.length) : 0;

  // 8. Performance & Infrastructure Metrics
  const totalWorkerReqs = await db.prepare(`
    SELECT COUNT(*) as c FROM analytics_events WHERE timestamp >= ? AND timestamp <= ?
  `).bind(startMs, endMs).first('c') || 0;

  const botReqs = await db.prepare(`
    SELECT COUNT(*) as c FROM analytics_events WHERE is_bot = 1 AND timestamp >= ? AND timestamp <= ?
  `).bind(startMs, endMs).first('c') || 0;

  const { results: statusRows } = await db.prepare(`
    SELECT status_code, COUNT(*) as count
    FROM analytics_events
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY status_code
    ORDER BY count DESC
  `).bind(startMs, endMs).all();

  const { results: error404Rows } = await db.prepare(`
    SELECT path, COUNT(*) as count
    FROM analytics_events
    WHERE status_code = 404 AND timestamp >= ? AND timestamp <= ?
    GROUP BY path
    ORDER BY count DESC
    LIMIT 10
  `).bind(startMs, endMs).all();

  return jsonResponse({
    period,
    start_date: new Date(startMs).toISOString().slice(0, 10),
    end_date: new Date(endMs).toISOString().slice(0, 10),
    summary: {
      total_visitors: currStats.total_visitors || 0,
      unique_visitors: currStats.unique_visitors || 0,
      page_views: currStats.page_views || 0,
      active_online: activeOnline,
      total_published_poems: totalPoems,
      total_published_articles: totalArticles,
      growth: {
        visitors_pct: prevStats.unique_visitors ? Math.round(((currStats.unique_visitors - prevStats.unique_visitors) / prevStats.unique_visitors) * 100) : 0,
        pageviews_pct: prevStats.page_views ? Math.round(((currStats.page_views - prevStats.page_views) / prevStats.page_views) * 100) : 0
      },
      intervals: {
        today: { visitors: todayVisitors.v, views: todayVisitors.p },
        last_7d: { visitors: last7dVisitors.v, views: last7dVisitors.p },
        last_30d: { visitors: last30dVisitors.v, views: last30dVisitors.p },
        all_time: { visitors: allTimeStats.v, views: allTimeStats.p }
      }
    },
    chart_points: chartPoints,
    popular_content: popularContent,
    traffic_sources: {
      total: totalSources,
      counts: sourceCounts,
      top_hosts: sourceRows || []
    },
    demographics: {
      countries,
      devices: deviceRows || [],
      browsers: browserRows || [],
      os: osRows || [],
      visitors_ratio: {
        new_visitors: newVisitors,
        returning_visitors: returningVisitors
      }
    },
    poetry_engagement: {
      total_poem_views: totalPoemViews,
      total_poem_reads: totalPoemReads,
      read_conversion_rate: totalPoemViews > 0 ? Math.round((totalPoemReads / totalPoemViews) * 100) : 0,
      avg_duration_seconds: avgPoemDuration,
      top_read_poems: poemList.slice(0, 10)
    },
    performance: {
      total_worker_requests: totalWorkerReqs,
      human_requests: totalWorkerReqs - botReqs,
      bot_requests: botReqs,
      status_codes: statusRows || [],
      top_404_urls: error404Rows || []
    }
  });
}

async function handleAnalyticsTestPing(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized: Administrator session required.' }, 401);
  }
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  await ensureAnalyticsTables(db);
  const now = Date.now();
  const visitor_id = await getAnonymousVisitorId(request, env);
  const client = getClientDetails(request);
  const country = request.headers.get('cf-ipcountry') || request.cf?.country || 'IN';

  // Seed sample test visits
  await recordAnalyticsEvent(db, {
    timestamp: now,
    path: '/',
    event_type: 'pageview',
    visitor_id,
    country,
    referrer_source: 'direct',
    referrer_host: 'direct',
    device_type: client.device_type,
    browser: client.browser,
    os: client.os,
    duration_seconds: 40
  });

  await recordAnalyticsEvent(db, {
    timestamp: now + 500,
    path: '/poems',
    event_type: 'pageview',
    visitor_id,
    country,
    referrer_source: 'direct',
    referrer_host: 'direct',
    device_type: client.device_type,
    browser: client.browser,
    os: client.os,
    duration_seconds: 60
  });

  return jsonResponse({ success: true, message: 'Test visits recorded successfully' });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const { password } = body;
  if (!password) {
    return jsonResponse({ error: 'Password is required' }, 400);
  }

  let valid = false;

  // 1. Check Cloudflare environment secret ADMIN_PASSWORD if present
  if (env.ADMIN_PASSWORD) {
    if (timingSafeEqual(password, env.ADMIN_PASSWORD)) {
      valid = true;
    }
  }

  // 2. If not matched, check D1 admin_users table
  if (!valid && env.DB) {
    try {
      await ensureAdminUsersTable(env.DB);
      const user = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind('admin').first();
      if (user && user.password_hash && user.salt) {
        const inputHash = await hashPasswordWithSalt(password, user.salt);
        if (timingSafeEqual(inputHash, user.password_hash)) {
          valid = true;
        }
      }
    } catch (e) {
      console.error('D1 admin lookup error:', e);
    }
  }

  if (!valid) {
    // Check if system has no password configured at all
    let hasAnyPassword = !!env.ADMIN_PASSWORD;
    if (!hasAnyPassword && env.DB) {
      try {
        const count = await env.DB.prepare('SELECT COUNT(*) as count FROM admin_users').first('count');
        if (count > 0) hasAnyPassword = true;
      } catch (e) {}
    }

    if (!hasAnyPassword) {
      return jsonResponse({
        error: 'No administrator password has been set yet. Please complete initial setup.',
        needs_setup: true
      }, 400);
    }

    return jsonResponse({ error: 'Invalid administrator password (अमान्य पासवर्ड).' }, 401);
  }

  // Create session
  const payload = {
    user: 'admin',
    iat: Date.now(),
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  };

  const secret = getEffectiveSecret(env);
  const token = await createSessionToken(payload, secret);
  const cookieStr = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;

  return new Response(JSON.stringify({ success: true, message: 'Authenticated successfully.' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieStr
    }
  });
}

async function handleSetup(request, env) {
  if (!env.DB) {
    return jsonResponse({
      error: "Cloudflare D1 database binding 'DB' is required for initial setup. Please bind your D1 database in Cloudflare Settings > Bindings."
    }, 400);
  }

  await ensureAdminUsersTable(env.DB);
  const adminCount = await env.DB.prepare('SELECT COUNT(*) as count FROM admin_users').first('count');
  if (adminCount > 0 || env.ADMIN_PASSWORD) {
    return jsonResponse({ error: 'Setup has already been completed. Please log in.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const { password, email } = body;
  if (!password || password.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters long.' }, 400);
  }

  const salt = generateSalt();
  const hash = await hashPasswordWithSalt(password, salt);
  const now = Date.now();
  const adminEmail = (email && typeof email === 'string' && email.includes('@')) ? email.trim().toLowerCase() : (env.ADMIN_EMAIL || null);

  await env.DB.prepare(`
    INSERT INTO admin_users (id, username, password_hash, salt, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind('admin_primary', 'admin', hash, salt, adminEmail, now, now).run();

  // Create session
  const payload = {
    user: 'admin',
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000
  };

  const secret = getEffectiveSecret(env);
  const token = await createSessionToken(payload, secret);
  const cookieStr = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;

  return new Response(JSON.stringify({ success: true, message: 'Administrator initialized successfully.' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieStr
    }
  });
}

async function handleChangePassword(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!env.DB) {
    return jsonResponse({ error: 'D1 database binding DB is required to update password.' }, 400);
  }

  const body = await request.json();
  const { currentPassword, newPassword } = body;
  if (!newPassword || newPassword.length < 6) {
    return jsonResponse({ error: 'New password must be at least 6 characters.' }, 400);
  }

  await ensureAdminUsersTable(env.DB);
  const existing = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind('admin').first();
  if (existing) {
    const checkHash = await hashPasswordWithSalt(currentPassword, existing.salt);
    if (!timingSafeEqual(checkHash, existing.password_hash)) {
      return jsonResponse({ error: 'Current password does not match.' }, 400);
    }
  } else if (env.ADMIN_PASSWORD) {
    if (!timingSafeEqual(currentPassword, env.ADMIN_PASSWORD)) {
      return jsonResponse({ error: 'Current password does not match.' }, 400);
    }
  }

  const salt = generateSalt();
  const hash = await hashPasswordWithSalt(newPassword, salt);
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO admin_users (id, username, password_hash, salt, created_at, updated_at)
    VALUES ('admin_primary', 'admin', ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, updated_at = excluded.updated_at
  `).bind(hash, salt, now, now).run();

  return jsonResponse({ success: true, message: 'Password updated successfully.' });
}

async function handleLogout(request) {
  const cookieStr = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  return new Response(JSON.stringify({ success: true, message: 'Logged out successfully.' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieStr
    }
  });
}

async function handleAuthCheck(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (user) {
    let email = null;
    if (env.DB) {
      try {
        await ensureAdminUsersTable(env.DB);
        const adminRecord = await env.DB.prepare('SELECT email FROM admin_users WHERE username = ?').bind('admin').first();
        email = adminRecord?.email || env.ADMIN_EMAIL || null;
      } catch (_) {}
    } else {
      email = env.ADMIN_EMAIL || null;
    }

    return jsonResponse({
      authenticated: true,
      user: user.user,
      email,
      has_d1: !!env.DB,
      has_secret: !!env.ADMIN_PASSWORD
    });
  }

  // Not authenticated. Check if setup is needed
  let hasPassword = !!env.ADMIN_PASSWORD;
  if (!hasPassword && env.DB) {
    try {
      await ensureAdminUsersTable(env.DB);
      const adminCount = await env.DB.prepare('SELECT COUNT(*) as count FROM admin_users').first('count');
      if (adminCount > 0) {
        hasPassword = true;
      }
    } catch (e) {}
  }

  return jsonResponse({
    authenticated: false,
    needs_setup: !hasPassword,
    has_d1: !!env.DB,
    has_secret: !!env.ADMIN_PASSWORD
  });
}

/* ==========================================================================
   PASSWORD RECOVERY & RESET CONTROLLERS
   ========================================================================== */

async function handleForgotPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return jsonResponse({ error: 'Please enter a valid registered email address.' }, 400);
  }

  // Uniform response returned for both valid and invalid accounts to prevent user enumeration
  const genericResponse = {
    success: true,
    message: 'यदि इस ईमेल से कोई खाता मौजूद है, तो पासवर्ड रीसेट लिंक भेज दिया गया है। (If an account exists for this email, a password reset link has been sent.)'
  };

  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
  const db = env.DB || env['ashabd-db'];

  if (!db) {
    console.warn('[Ashabd Auth] Password reset requested, but D1 database is not bound.');
    return jsonResponse(genericResponse);
  }

  await ensureAdminUsersTable(db);

  // Rate limiting: check reset requests from this IP in the last 15 minutes
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  const recentAttempts = await db.prepare(`
    SELECT COUNT(*) as c FROM password_resets
    WHERE ip_address = ? AND created_at > ?
  `).bind(clientIp, fifteenMinutesAgo).first('c') || 0;

  if (recentAttempts >= 6) {
    console.warn(`[Ashabd Auth] Password reset rate limit exceeded for IP: ${clientIp}`);
    return jsonResponse(genericResponse);
  }

  // Look up admin by email in D1 table
  let matchedUser = await db.prepare(`
    SELECT id, username, email FROM admin_users
    WHERE LOWER(email) = ?
  `).bind(email).first();

  // If not found in column, check if matching env.ADMIN_EMAIL
  if (!matchedUser && env.ADMIN_EMAIL && env.ADMIN_EMAIL.trim().toLowerCase() === email) {
    matchedUser = await db.prepare(`SELECT id, username, email FROM admin_users WHERE username = 'admin'`).first();
    if (!matchedUser) {
      matchedUser = { id: 'admin_primary', username: 'admin', email: env.ADMIN_EMAIL.trim() };
    }
    try {
      await db.prepare(`UPDATE admin_users SET email = ? WHERE id = ? OR username = 'admin'`).bind(env.ADMIN_EMAIL.trim(), matchedUser.id).run();
    } catch (_) {}
  }

  if (matchedUser) {
    const rawToken = generateRandomHexToken(32);
    const tokenHash = await sha256Hex(rawToken);
    const resetId = `pr_${Date.now()}_${generateRandomHexToken(4)}`;
    const expiresAt = Date.now() + 60 * 60 * 1000; // 60 minutes expiry
    const now = Date.now();

    // Invalidate existing unused tokens for this user
    await db.prepare(`
      UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0
    `).bind(matchedUser.id).run();

    // Store new hashed token
    await db.prepare(`
      INSERT INTO password_resets (id, user_id, token_hash, ip_address, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).bind(resetId, matchedUser.id, tokenHash, clientIp, expiresAt, now).run();

    // Construct reset URL
    const reqUrl = new URL(request.url);
    const siteUrl = env.SITE_URL ? env.SITE_URL.replace(/\/+$/, '') : `${reqUrl.protocol}//${reqUrl.host}`;
    const resetUrl = `${siteUrl}/admin?reset_token=${rawToken}`;

    // Send transactional reset email
    try {
      await sendPasswordResetEmail(env, {
        to: email,
        resetUrl,
        expiresMinutes: 60
      });
    } catch (err) {
      console.error('[Ashabd Auth] Failed to dispatch password reset email:', err);
    }
  }

  return jsonResponse(genericResponse);
}

async function handleVerifyResetToken(request, env) {
  let token = null;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      token = body.token;
    } catch {}
  } else {
    const url = new URL(request.url);
    token = url.searchParams.get('token') || url.searchParams.get('reset_token');
  }

  if (!token) {
    return jsonResponse({ valid: false, error: 'Token is required' }, 400);
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ valid: false, error: 'Database unavailable' }, 500);
  }

  await ensureAdminUsersTable(db);
  const tokenHash = await sha256Hex(token);
  const record = await db.prepare(`
    SELECT id, expires_at, used FROM password_resets WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!record) {
    return jsonResponse({ valid: false, error: 'यह रीसेट लिंक अमान्य है (Invalid reset link).' }, 400);
  }
  if (record.used === 1) {
    return jsonResponse({ valid: false, error: 'यह रीसेट लिंक पहले ही उपयोग किया जा चुका है (This reset link has already been used).' }, 400);
  }
  if (record.expires_at < Date.now()) {
    return jsonResponse({ valid: false, error: 'यह रीसेट लिंक समाप्त हो चुका है (This reset link has expired).' }, 400);
  }

  return jsonResponse({ valid: true });
}

async function handleResetPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const { token, newPassword } = body;
  if (!token) {
    return jsonResponse({ error: 'Reset token is required.' }, 400);
  }
  if (!newPassword || newPassword.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters.' }, 400);
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  await ensureAdminUsersTable(db);
  const tokenHash = await sha256Hex(token);
  const record = await db.prepare(`
    SELECT id, user_id, expires_at, used FROM password_resets WHERE token_hash = ?
  `).bind(tokenHash).first();

  if (!record || record.used === 1 || record.expires_at < Date.now()) {
    return jsonResponse({ error: 'यह रीसेट लिंक अमान्य या समाप्त हो चुका है (Invalid or expired reset link).' }, 400);
  }

  // Mark current token as used immediately
  await db.prepare(`UPDATE password_resets SET used = 1 WHERE id = ?`).bind(record.id).run();

  // Invalidate any other tokens for this user
  await db.prepare(`UPDATE password_resets SET used = 1 WHERE user_id = ?`).bind(record.user_id).run();

  // Hash new password using existing salted SHA-256 scheme
  const salt = generateSalt();
  const hash = await hashPasswordWithSalt(newPassword, salt);
  const now = Date.now();

  await db.prepare(`
    INSERT INTO admin_users (id, username, password_hash, salt, created_at, updated_at)
    VALUES ('admin_primary', 'admin', ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, updated_at = excluded.updated_at
  `).bind(hash, salt, now, now).run();

  return jsonResponse({
    success: true,
    message: 'आपका पासवर्ड सफलतापूर्वक अपडेट कर दिया गया है। अब नए पासवर्ड के साथ लॉगिन करें। (Password reset successfully. You may now sign in with your new password.)'
  });
}

async function handleUpdateEmail(request, env) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized: Administrator session required.' }, 401);
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return jsonResponse({ error: 'Please provide a valid email address.' }, 400);
  }

  await ensureAdminUsersTable(db);
  const now = Date.now();

  await db.prepare(`
    UPDATE admin_users SET email = ?, updated_at = ? WHERE username = 'admin' OR id = ?
  `).bind(email, now, user.user || 'admin_primary').run();

  return jsonResponse({
    success: true,
    message: 'पुनर्प्राप्ति ईमेल सफलतापूर्वक अपडेट हो गया (Recovery email updated successfully).'
  });
}

/**
 * Unified Transactional Email Engine
 * Dispatches via Resend, SendGrid, or Postmark depending on configured Cloudflare secrets.
 */
async function sendTransactionalEmail(env, { to, subject, html, text }) {
  const senderEmail = env.EMAIL_FROM || 'Ashabd <noreply@ashabd.in>';

  // 1. Resend API
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: senderEmail,
        to: [to],
        subject,
        html,
        text: text || undefined
      })
    });
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`Resend API error (${res.status}): ${errTxt}`);
    }
    return { provider: 'resend', success: true };
  }

  // 2. SendGrid API
  if (env.SENDGRID_API_KEY) {
    const plainFrom = senderEmail.includes('<') ? senderEmail.replace(/.*<([^>]+)>.*/, '$1') : senderEmail;
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: plainFrom, name: 'Ashabd' },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    });
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`SendGrid API error (${res.status}): ${errTxt}`);
    }
    return { provider: 'sendgrid', success: true };
  }

  // 3. Postmark API
  if (env.POSTMARK_SERVER_TOKEN) {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        From: senderEmail,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text || undefined
      })
    });
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`Postmark API error (${res.status}): ${errTxt}`);
    }
    return { provider: 'postmark', success: true };
  }

  // Fallback: No email provider secret configured in Cloudflare environment secrets
  console.warn(`[Ashabd Email Simulation] No provider secret configured (RESEND_API_KEY, SENDGRID_API_KEY, or POSTMARK_SERVER_TOKEN). Simulated dispatch to ${to} for subject "${subject}".`);
  return { provider: 'none', success: true, simulated: true };
}

async function sendPasswordResetEmail(env, { to, resetUrl, expiresMinutes = 60 }) {
  const emailHtml = `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ashabd — पासवर्ड रीसेट</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f1115; color: #f5f2eb; margin: 0; padding: 24px; }
    .container { max-width: 540px; margin: 0 auto; background-color: #171a21; border: 1px solid rgba(212, 107, 36, 0.3); border-radius: 12px; padding: 32px 28px; }
    .brand { font-family: Georgia, serif; font-size: 32px; color: #d46b24; text-align: center; margin: 0 0 6px 0; letter-spacing: 1.5px; }
    .tagline { text-align: center; color: #a29d93; font-size: 13px; margin: 0 0 28px 0; text-transform: uppercase; letter-spacing: 1.5px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #f5f2eb; }
    .text { font-size: 14.5px; line-height: 1.65; color: #d1ccc2; margin-bottom: 20px; }
    .btn-wrap { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #d46b24; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 32px; border-radius: 6px; }
    .note { font-size: 12.5px; line-height: 1.6; color: #9c968a; background: rgba(0,0,0,0.35); padding: 14px; border-radius: 6px; border-left: 3px solid #d46b24; margin-top: 24px; }
    .url-fallback { word-break: break-all; color: #e6853d; font-size: 12px; margin-top: 8px; }
    .footer { text-align: center; font-size: 12px; color: #6d675e; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="brand">अशब्द</h1>
    <p class="tagline">प्रबंधन कक्ष — Administrator Security</p>
    
    <p class="greeting">नमस्ते (Greetings),</p>
    <p class="text">
      आपके <strong>अशब्द (Ashabd.in)</strong> व्यवस्थापक खाते के लिए पासवर्ड रीसेट का अनुरोध प्राप्त हुआ है। 
      नीचे दिए गए बटन पर क्लिक करके अपना नया पासवर्ड सेट करें:
    </p>
    
    <div class="btn-wrap">
      <a href="${resetUrl}" class="btn" target="_blank">पासवर्ड रीसेट करें (Reset Password)</a>
    </div>
    
    <div class="note">
      <strong>⚠️ सुरक्षा सूचना (Security Notice):</strong><br>
      • यह लिंक केवल <strong>${expiresMinutes} मिनट</strong> के लिए मान्य है और इसका उपयोग केवल एक बार किया जा सकता है।<br>
      • यदि आपने यह अनुरोध नहीं किया था, तो कृपया इस ईमेल को अनदेखा करें। आपका मौजूदा पासवर्ड पूरी तरह सुरक्षित है।
    </div>

    <p class="text" style="font-size: 12px; color: #8e887d; margin-top: 20px; margin-bottom: 4px;">
      यदि बटन काम नहीं कर रहा है, तो इस लिंक को कॉपी करके अपने ब्राउज़र में खोलें:
    </p>
    <p class="url-fallback">${resetUrl}</p>

    <div class="footer">
      © ${new Date().getFullYear()} अशब्द (Ashabd.in) • All rights reserved.
    </div>
  </div>
</body>
</html>`;

  return await sendTransactionalEmail(env, {
    to,
    subject: 'Ashabd (अशब्द) — पासवर्ड रीसेट अनुरोध (Password Reset)',
    html: emailHtml
  });
}

function renderSubscriptionVerificationEmailHtml({ verifyUrl }) {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ashabd — सदस्यता पुष्टि</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f1115; color: #f5f2eb; margin: 0; padding: 24px; }
    .container { max-width: 540px; margin: 0 auto; background-color: #171a21; border: 1px solid rgba(212, 107, 36, 0.35); border-radius: 12px; padding: 34px 28px; }
    .brand { font-family: Georgia, serif; font-size: 34px; color: #d46b24; text-align: center; margin: 0 0 6px 0; letter-spacing: 2px; }
    .tagline { text-align: center; color: #a29d93; font-size: 13px; margin: 0 0 28px 0; letter-spacing: 1.5px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #f5f2eb; }
    .text { font-size: 14.5px; line-height: 1.7; color: #d1ccc2; margin-bottom: 20px; }
    .btn-wrap { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #d46b24; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 34px; border-radius: 6px; box-shadow: 0 4px 12px rgba(212, 107, 36, 0.3); }
    .note { font-size: 12.5px; line-height: 1.6; color: #9c968a; background: rgba(0,0,0,0.35); padding: 14px; border-radius: 6px; border-left: 3px solid #d46b24; margin-top: 24px; }
    .url-fallback { word-break: break-all; color: #e6853d; font-size: 12px; margin-top: 8px; }
    .footer { text-align: center; font-size: 12px; color: #6d675e; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="brand">अशब्द</h1>
    <p class="tagline">काव्य-यात्रा • Poetry Subscription</p>
    
    <p class="greeting">नमस्ते (Greetings),</p>
    <p class="text">
      आपने <strong>अशब्द (Ashabd.in)</strong> पर नई कविताओं की सूचना प्राप्त करने के लिए सदस्यता का अनुरोध किया है।
      अपनी सदस्यता की पुष्टि करने के लिए नीचे दिए गए बटन पर क्लिक करें:
    </p>
    
    <div class="btn-wrap">
      <a href="${verifyUrl}" class="btn" target="_blank">सदस्यता की पुष्टि करें (Confirm Subscription)</a>
    </div>
    
    <div class="note">
      <strong>📜 सूचना (Notice):</strong><br>
      • यह सदस्यता पूरी तरह निःशुल्क है। आपको केवल तभी ईमेल प्राप्त होगा जब कोई नई कविता प्रकाशित होगी।<br>
      • कोई स्पैम नहीं। आप किसी भी समय एक क्लिक से सदस्यता समाप्त कर सकते हैं।<br>
      • यदि आपने यह अनुरोध नहीं किया था, तो कृपया इस ईमेल को अनदेखा करें।
    </div>

    <p class="text" style="font-size: 12px; color: #8e887d; margin-top: 20px; margin-bottom: 4px;">
      यदि बटन काम नहीं कर रहा है, तो इस लिंक को कॉपी करके अपने ब्राउज़र में खोलें:
    </p>
    <p class="url-fallback">${verifyUrl}</p>

    <div class="footer">
      © ${new Date().getFullYear()} अशब्द (Ashabd.in) • All rights reserved.
    </div>
  </div>
</body>
</html>`;
}

async function sendSubscriptionVerificationEmail(env, { to, verifyUrl }) {
  const html = renderSubscriptionVerificationEmailHtml({ verifyUrl });
  return await sendTransactionalEmail(env, {
    to,
    subject: 'Ashabd (अशब्द) — कविता सदस्यता पुष्टि (Confirm Subscription)',
    html
  });
}

function renderPoemNotificationEmailHtml({ poemTitle, subtitle, excerptHtml, readUrl, unsubscribeUrl }) {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ashabd — नवीन कविता: ${escapeHtml(poemTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f1115; color: #f5f2eb; margin: 0; padding: 24px; }
    .container { max-width: 540px; margin: 0 auto; background-color: #171a21; border: 1px solid rgba(212, 107, 36, 0.35); border-radius: 12px; padding: 34px 28px; }
    .brand { font-family: Georgia, serif; font-size: 34px; color: #d46b24; text-align: center; margin: 0 0 6px 0; letter-spacing: 2px; }
    .tagline { text-align: center; color: #a29d93; font-size: 13px; margin: 0 0 24px 0; letter-spacing: 1.5px; }
    .poem-box { background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(212, 107, 36, 0.25); border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px; }
    .poem-title { font-family: Georgia, serif; font-size: 24px; color: #fbf5e8; margin: 0 0 6px 0; }
    .poem-subtitle { font-size: 14px; color: #d46b24; margin: 0 0 18px 0; font-style: italic; }
    .poem-excerpt { font-size: 16px; line-height: 2.1; color: #ebdcb7; margin: 0 auto; white-space: pre-wrap; letter-spacing: 0.02em; font-family: 'Tiro Devanagari Hindi', Georgia, serif; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background-color: #d46b24; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 13px 34px; border-radius: 6px; box-shadow: 0 4px 12px rgba(212, 107, 36, 0.3); }
    .footer { text-align: center; font-size: 12px; color: #6d675e; margin-top: 28px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; line-height: 1.6; }
    .unsub-link { color: #8e887d; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="brand">अशब्द</h1>
    <p class="tagline">नवीन कविता • New Poem</p>

    <div class="poem-box">
      <h2 class="poem-title">${escapeHtml(poemTitle)}</h2>
      ${subtitle ? `<p class="poem-subtitle">${escapeHtml(subtitle)}</p>` : ''}
      <div class="poem-excerpt">${excerptHtml}</div>
    </div>

    <div class="btn-wrap">
      <a href="${readUrl}" class="btn" target="_blank">सम्पूर्ण कविता पढ़ें (Read Full Poem) ↗</a>
    </div>

    <div class="footer">
      आप यह संदेश प्राप्त कर रहे हैं क्योंकि आपने <strong>ashabd.in</strong> पर नई कविताओं की सूचना के लिए सदस्यता ली है।<br>
      <a href="${unsubscribeUrl}" class="unsub-link">सदस्यता समाप्त करें (Unsubscribe)</a> • © ${new Date().getFullYear()} अशब्द
    </div>
  </div>
</body>
</html>`;
}

function renderSubscriptionPageHtml({ title, heading, message, subtext, buttonText, buttonUrl }) {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>अशब्द — ${escapeHtml(title)}</title>
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-parchment: #ebdcb7;
      --bg-parchment-light: #fbf5e8;
      --bg-parchment-warm: #f5ebd3;
      --ink-primary: #221309;
      --ink-secondary: #562e17;
      --ink-muted: #743e1e;
      --accent: #d46b24;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--bg-parchment);
      color: var(--ink-primary);
      font-family: 'Tiro Devanagari Hindi', Georgia, serif;
      text-align: center;
      padding: 2rem 1rem;
      position: relative;
    }
    .parchment-bg {
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse 75% 65% at 50% 35%, var(--bg-parchment-light) 0%, var(--bg-parchment-warm) 50%, var(--bg-parchment) 100%);
      z-index: 0;
    }
    .grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      opacity: 0.22;
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='5'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .card {
      position: relative;
      z-index: 10;
      max-width: 520px;
      width: 100%;
      background: rgba(253, 248, 237, 0.9);
      border: 1px solid rgba(86, 46, 23, 0.25);
      border-radius: 8px;
      padding: 3rem 2rem;
      box-shadow: 0 10px 30px rgba(34, 19, 9, 0.15);
    }
    .brand {
      font-family: 'Rozha One', serif;
      font-size: 2.8rem;
      color: var(--ink-primary);
      text-decoration: none;
      display: inline-block;
      margin-bottom: 0.5rem;
    }
    h1 {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 1.8rem;
      margin-bottom: 1.2rem;
      color: var(--ink-secondary);
      font-weight: normal;
    }
    .message {
      font-size: 1.15rem;
      line-height: 1.7;
      color: var(--ink-primary);
      margin-bottom: 0.8rem;
    }
    .subtext {
      font-size: 0.95rem;
      color: var(--ink-muted);
      margin-bottom: 2rem;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      background: #2a1409;
      color: #fbf5e8;
      text-decoration: none;
      padding: 0.75rem 1.8rem;
      font-size: 0.95rem;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #44200e;
    }
    .extra-link {
      display: block;
      margin-top: 1.2rem;
      font-size: 0.85rem;
      color: var(--ink-muted);
      text-decoration: underline;
    }
    .extra-link:hover {
      color: var(--ink-primary);
    }
  </style>
</head>
<body>
  <div class="parchment-bg"></div>
  <div class="grain"></div>
  <main class="card">
    <a href="/" class="brand">अशब्द</a>
    <h1>${escapeHtml(heading)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    ${subtext ? `<p class="subtext">${escapeHtml(subtext)}</p>` : ''}
    <a href="${buttonUrl || '/'}" class="btn">${escapeHtml(buttonText || '← मुख्य पृष्ठ पर वापस लौटें')}</a>
    <a href="/poems" class="extra-link">रचना संग्रह देखें (Explore Poems Archive) ↗</a>
  </main>
  <script src="/analytics.js" defer></script>
</body>
</html>`;
}

function getSiteUrl(request, env) {
  if (env.SITE_URL) {
    return env.SITE_URL.replace(/\/+$/, '');
  }
  try {
    const reqUrl = new URL(request.url);
    return `${reqUrl.protocol}//${reqUrl.host}`;
  } catch (_) {
    return 'https://ashabd.in';
  }
}

async function handleSubscribe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request payload' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return jsonResponse({ error: 'Please provide a valid email address.' }, 400);
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ error: 'Database service is currently unavailable.' }, 503);
  }

  await ensureSubscribersTable(db);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;

  // Rate limiting by IP
  const recentCount = await db.prepare(`
    SELECT COUNT(*) as c FROM subscribers WHERE ip_address = ? AND created_at > ?
  `).bind(ip, fifteenMinutesAgo).first('c') || 0;

  if (recentCount >= 6) {
    return jsonResponse({ error: 'Too many subscription attempts from this network. Please try again later.' }, 429);
  }

  const existing = await db.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  const siteUrl = getSiteUrl(request, env);

  if (existing) {
    if (existing.status === 'active') {
      return jsonResponse({
        success: true,
        already_active: true,
        message: 'You are already subscribed to Ashabd (आप पहले से ही अशब्द से जुड़े हैं)।'
      });
    }

    // Pending or Unsubscribed - re-issue verification token
    const rawVerifyToken = generateRandomHexToken(32);
    const tokenHash = await sha256Hex(rawVerifyToken);
    const now = Date.now();

    await db.prepare(`
      UPDATE subscribers
      SET status = 'pending', verification_token_hash = ?, ip_address = ?, created_at = ?
      WHERE id = ?
    `).bind(tokenHash, ip, now, existing.id).run();

    const verifyUrl = `${siteUrl}/verify-subscription?token=${rawVerifyToken}`;
    try {
      await sendSubscriptionVerificationEmail(env, { to: email, verifyUrl });
    } catch (err) {
      console.error('[Ashabd Subscribe] Failed to dispatch verification email:', err);
    }

    return jsonResponse({
      success: true,
      pending: true,
      message: 'Please check your email to confirm your subscription (पुष्टि हेतु ईमेल चेक करें)।'
    });
  }

  // New subscriber
  const id = 'sub_' + Date.now().toString(36) + '_' + generateRandomHexToken(4);
  const rawVerifyToken = generateRandomHexToken(32);
  const tokenHash = await sha256Hex(rawVerifyToken);
  const unsubscribeToken = generateRandomHexToken(32);
  const now = Date.now();
  const referrer = request.headers.get('referer') || '';
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 255);

  await db.prepare(`
    INSERT INTO subscribers (id, email, status, verification_token_hash, unsubscribe_token, ip_address, referrer, user_agent, created_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).bind(id, email, tokenHash, unsubscribeToken, ip, referrer, userAgent, now).run();

  const verifyUrl = `${siteUrl}/verify-subscription?token=${rawVerifyToken}`;
  try {
    await sendSubscriptionVerificationEmail(env, { to: email, verifyUrl });
  } catch (err) {
    console.error('[Ashabd Subscribe] Failed to dispatch verification email:', err);
  }

  return jsonResponse({
    success: true,
    pending: true,
    message: 'Please check your inbox to confirm your subscription (पुष्टि हेतु ईमेल चेक करें)।'
  });
}

async function handleVerifySubscriptionPage(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response(renderSubscriptionPageHtml({
      title: 'अमान्य लिंक',
      heading: 'अमान्य पुष्टि लिंक',
      message: 'कोई सत्यापन टोकन प्रदान नहीं किया गया है।',
      subtext: 'No verification token was provided in the link.'
    }), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return new Response(renderSubscriptionPageHtml({
      title: 'त्रुटि',
      heading: 'सेवा अनुपलब्ध',
      message: 'डेटाबेस सेवा वर्तमान में उपलब्ध नहीं है। कृपया कुछ समय बाद पुनः प्रयास करें।',
      subtext: 'Database service is currently unavailable. Please try again in a few moments.'
    }), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  await ensureSubscribersTable(db);
  const tokenHash = await sha256Hex(token);

  const subscriber = await db.prepare(`
    SELECT * FROM subscribers WHERE verification_token_hash = ?
  `).bind(tokenHash).first();

  if (!subscriber) {
    return new Response(renderSubscriptionPageHtml({
      title: 'अमान्य या समाप्त लिंक',
      heading: 'यह पुष्टि लिंक समाप्त या उपयोग हो चुका है',
      message: 'यदि आप पहले ही पुष्टि कर चुके हैं, तो आपकी सदस्यता सक्रिय है। अन्यथा आप मुख्य पृष्ठ पर जाकर पुनः जुड़ सकते हैं।',
      subtext: 'This confirmation link has expired or has already been used. You can always re-subscribe on the Ashabd homepage.'
    }), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE subscribers
    SET status = 'active', verified_at = ?, verification_token_hash = NULL
    WHERE id = ?
  `).bind(now, subscriber.id).run();

  return new Response(renderSubscriptionPageHtml({
    title: 'सदस्यता पुष्टीकृत',
    heading: 'सदस्यता सफलतापूर्वक पुष्टीकृत!',
    message: 'अशब्द की काव्य-यात्रा में आपका स्वागत है। जब भी कोई नई कविता रची और प्रकाशित की जाएगी, आपको एक सुंदर संदेश प्राप्त होगा।',
    subtext: 'Subscription confirmed! You will receive a quiet note whenever a new poem arrives.',
    buttonText: '← मुख्य पृष्ठ पर जाएँ (Return to Home)',
    buttonUrl: '/'
  }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleUnsubscribePage(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response(renderSubscriptionPageHtml({
      title: 'अमान्य लिंक',
      heading: 'अमान्य सदस्यता समाप्ति लिंक',
      message: 'कोई अनसब्सक्राइब टोकन प्रदान नहीं किया गया है।',
      subtext: 'No unsubscribe token was provided in the link.'
    }), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return new Response(renderSubscriptionPageHtml({
      title: 'त्रुटि',
      heading: 'सेवा अनुपलब्ध',
      message: 'डेटाबेस सेवा वर्तमान में उपलब्ध नहीं है।',
      subtext: 'Database service is currently unavailable.'
    }), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  await ensureSubscribersTable(db);

  const subscriber = await db.prepare(`
    SELECT * FROM subscribers WHERE unsubscribe_token = ?
  `).bind(token).first();

  if (!subscriber) {
    return new Response(renderSubscriptionPageHtml({
      title: 'अमान्य लिंक',
      heading: 'अमान्य सदस्यता समाप्ति लिंक',
      message: 'यह लिंक मान्य नहीं है या सदस्यता पहले ही समाप्त की जा चुकी है।',
      subtext: 'This unsubscribe link is invalid or the subscription was already removed.'
    }), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const now = Date.now();
  await db.prepare(`
    UPDATE subscribers
    SET status = 'unsubscribed', unsubscribed_at = ?
    WHERE id = ?
  `).bind(now, subscriber.id).run();

  return new Response(renderSubscriptionPageHtml({
    title: 'सदस्यता समाप्त',
    heading: 'आपकी सदस्यता समाप्त कर दी गई है',
    message: 'आपको अब अशब्द की नई कविताओं की सूचना नहीं भेजी जाएगी। भविष्य में कभी भी आप मुख्य पृष्ठ के नोटिस बोर्ड से पुनः जुड़ सकते हैं।',
    subtext: 'You have been successfully unsubscribed from Ashabd poem notifications. You can rejoin anytime on the homepage notice board.',
    buttonText: '← मुख्य पृष्ठ पर लौटें',
    buttonUrl: '/'
  }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleListSubscribersAdmin(request, env) {
  const db = await checkDatabase(env);
  await ensureSubscribersTable(db);

  const totalCount = await db.prepare('SELECT COUNT(*) as count FROM subscribers').first('count') || 0;
  const activeCount = await db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").first('count') || 0;
  const pendingCount = await db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'pending'").first('count') || 0;
  const unsubscribedCount = await db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'unsubscribed'").first('count') || 0;
  const notifCount = await db.prepare("SELECT COUNT(*) as count FROM poem_notifications WHERE status = 'sent'").first('count') || 0;

  const { results: subscribers } = await db.prepare(`
    SELECT id, email, status, ip_address, created_at, verified_at, unsubscribed_at
    FROM subscribers
    ORDER BY created_at DESC
    LIMIT 300
  `).all();

  const { results: recentNotifications } = await db.prepare(`
    SELECT pn.id, pn.writing_id, pn.recipient_email, pn.status, pn.error_message, pn.sent_at, w.title as poem_title
    FROM poem_notifications pn
    LEFT JOIN writings w ON pn.writing_id = w.id
    ORDER BY pn.sent_at DESC
    LIMIT 30
  `).all();

  return jsonResponse({
    stats: {
      total: totalCount,
      active: activeCount,
      pending: pendingCount,
      unsubscribed: unsubscribedCount,
      notifications_sent: notifCount
    },
    subscribers: subscribers || [],
    recent_notifications: recentNotifications || []
  });
}

async function handleDeleteSubscriberAdmin(id, env) {
  const db = await checkDatabase(env);
  await ensureSubscribersTable(db);
  await db.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true, message: 'Subscriber deleted successfully.' });
}

async function handleSendTestPoemNotification(request, env) {
  const db = await checkDatabase(env);
  await ensureSubscribersTable(db);

  let body = {};
  try {
    body = await request.json();
  } catch {}

  let targetEmail = (body.email || '').trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes('@')) {
    const adminRecord = await db.prepare('SELECT email FROM admin_users WHERE username = ?').bind('admin').first();
    targetEmail = adminRecord?.email || env.ADMIN_EMAIL;
  }

  if (!targetEmail) {
    return jsonResponse({ error: 'Please specify a target email address or configure your administrator email in Settings.' }, 400);
  }

  const poem = await db.prepare(`
    SELECT id, title, slug, subtitle, content, content_type
    FROM writings
    WHERE status = 'Published' AND content_type = 'Poetry'
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT 1
  `).first() || {
    id: 'sample_poem',
    title: 'मौन के पदचाप',
    slug: 'maun-ke-padchaap',
    subtitle: 'एक अप्रकाशित विचार',
    content: 'शब्द जब मौन से संवाद करते हैं,\nतब कविता जन्म लेती है।\nअनकही बातें, अनसुलझे रहस्य,\nपन्नों पर स्याही बन बहते हैं।'
  };

  const siteUrl = getSiteUrl(request, env);
  const readUrl = `${siteUrl}/poems/${encodeURIComponent(poem.slug)}`;
  const unsubUrl = `${siteUrl}/unsubscribe?token=test_preview_token`;

  const lines = (poem.content || '').split('\n').map(l => l.trim()).filter(Boolean);
  const excerptLines = lines.slice(0, 6).join('<br>');

  const emailHtml = renderPoemNotificationEmailHtml({
    poemTitle: poem.title,
    subtitle: poem.subtitle,
    excerptHtml: excerptLines,
    readUrl,
    unsubscribeUrl: unsubUrl
  });

  try {
    const res = await sendTransactionalEmail(env, {
      to: targetEmail,
      subject: `[TEST PREVIEW] Ashabd (अशब्द) — नवीन कविता: ${poem.title}`,
      html: emailHtml
    });

    return jsonResponse({
      success: true,
      provider: res.provider,
      simulated: res.simulated,
      message: `परीक्षण सूचना ${targetEmail} पर भेज दी गई (${res.simulated ? 'सिम्युलेटेड - Provider secret not yet added' : 'सफलतापूर्वक प्रेषित'})!`
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to send test email: ${err.message}` }, 500);
  }
}

async function triggerPoemNotifications(env, poem, siteUrl) {
  const db = env.DB || env['ashabd-db'];
  if (!db || !poem) return;

  // Only trigger automatic notifications for poetry
  if (poem.content_type && poem.content_type !== 'Poetry') {
    return;
  }

  try {
    await ensureSubscribersTable(db);
    const { results: activeSubscribers } = await db.prepare(`
      SELECT id, email, unsubscribe_token FROM subscribers WHERE status = 'active'
    `).all();

    if (!activeSubscribers || activeSubscribers.length === 0) {
      return;
    }

    const poemTitle = poem.title || 'नवीन कविता';
    const poemSlug = poem.slug || '';
    const readUrl = `${siteUrl}/poems/${encodeURIComponent(poemSlug)}`;

    const lines = (poem.content || '').split('\n').map(l => l.trim()).filter(Boolean);
    const excerptLines = lines.slice(0, 6).join('<br>');

    for (const sub of activeSubscribers) {
      const alreadySent = await db.prepare(`
        SELECT id FROM poem_notifications WHERE writing_id = ? AND subscriber_id = ? AND status = 'sent'
      `).bind(poem.id, sub.id).first();

      if (alreadySent) continue;

      const unsubUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`;
      const emailHtml = renderPoemNotificationEmailHtml({
        poemTitle,
        subtitle: poem.subtitle,
        excerptHtml: excerptLines,
        readUrl,
        unsubscribeUrl: unsubUrl
      });

      const notifId = 'notif_' + Date.now().toString(36) + '_' + generateRandomHexToken(4);
      const now = Date.now();

      try {
        await sendTransactionalEmail(env, {
          to: sub.email,
          subject: `Ashabd (अशब्द) — नवीन कविता: ${poemTitle}`,
          html: emailHtml
        });

        await db.prepare(`
          INSERT INTO poem_notifications (id, writing_id, subscriber_id, recipient_email, status, error_message, sent_at)
          VALUES (?, ?, ?, ?, 'sent', NULL, ?)
        `).bind(notifId, poem.id, sub.id, sub.email, now).run();
      } catch (err) {
        console.error(`Failed to send poem notification to ${sub.email}:`, err);
        await db.prepare(`
          INSERT INTO poem_notifications (id, writing_id, subscriber_id, recipient_email, status, error_message, sent_at)
          VALUES (?, ?, ?, ?, 'failed', ?, ?)
        `).bind(notifId, poem.id, sub.id, sub.email, String(err.message || err).slice(0, 255), now).run();
      }
    }
  } catch (err) {
    console.error('triggerPoemNotifications error:', err);
  }
}

/* ==========================================================================
   DATABASE & CONTENT MANAGEMENT HANDLERS (D1)
   ========================================================================== */

async function checkDatabase(env) {
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    throw new Error("Cloudflare D1 database binding ('ashabd-db' or 'DB') is missing. Please check your wrangler.jsonc or Cloudflare bindings.");
  }
  await ensureWritingsTable(db);
  return db;
}

/**
 * Generates clean Unicode-safe slug from title
 */
function slugify(title) {
  let s = title
    .toLowerCase()
    .trim()
    .replace(/[\s\t\n]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '') // Preserves Hindi/Devanagari letters & numbers
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) {
    s = 'writing-' + Date.now().toString(36);
  }
  return s;
}

async function getUniqueSlug(db, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    let sql = 'SELECT id FROM writings WHERE slug = ?';
    let params = [slug];
    if (excludeId) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }
    const res = await db.prepare(sql).bind(...params).first();
    if (!res) return slug;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }
}

async function handleListWritingsAdmin(request, env) {
  const db = await checkDatabase(env);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status'); // 'all', 'Published', 'Draft'
  const typeFilter = url.searchParams.get('type');
  const search = url.searchParams.get('q');

  let whereClauses = [];
  let params = [];

  if (statusFilter && statusFilter !== 'all') {
    whereClauses.push('status = ?');
    params.push(statusFilter);
  }
  if (typeFilter && typeFilter !== 'all') {
    whereClauses.push('content_type = ?');
    params.push(typeFilter);
  }
  if (search && search.trim()) {
    whereClauses.push('(title LIKE ? OR tags LIKE ? OR subtitle LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Get writings
  const listSql = `
    SELECT id, title, slug, subtitle, content_type, tags, status, cover_image_key, created_at, updated_at, published_at
    FROM writings
    ${whereSql}
    ORDER BY updated_at DESC
  `;
  const { results: writings } = await db.prepare(listSql).bind(...params).all();

  // Get counts for dashboard overview
  const totalCount = await db.prepare('SELECT COUNT(*) as count FROM writings').first('count');
  const publishedCount = await db.prepare("SELECT COUNT(*) as count FROM writings WHERE status = 'Published'").first('count');
  const draftsCount = await db.prepare("SELECT COUNT(*) as count FROM writings WHERE status = 'Draft'").first('count');

  return jsonResponse({
    stats: {
      total: totalCount || 0,
      published: publishedCount || 0,
      drafts: draftsCount || 0
    },
    writings: writings || []
  });
}

async function handleGetWritingAdmin(id, env) {
  const db = await checkDatabase(env);
  const writing = await db.prepare('SELECT * FROM writings WHERE id = ?').bind(id).first();
  if (!writing) {
    return jsonResponse({ error: 'Writing not found' }, 404);
  }
  return jsonResponse({ writing });
}

async function handleCreateWriting(request, env, ctx) {
  const db = await checkDatabase(env);
  const body = await request.json();

  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  const contentType = body.content_type || 'Poetry';
  const subtitle = (body.subtitle || '').trim() || null;
  const tags = (body.tags || '').trim() || null;
  const status = body.status === 'Published' ? 'Published' : 'Draft';
  const coverImageKey = body.cover_image_key || null;

  if (!title) {
    return jsonResponse({ error: 'Title is required' }, 400);
  }
  if (!content) {
    return jsonResponse({ error: 'Content is required' }, 400);
  }

  const id = 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  const baseSlug = body.slug ? slugify(body.slug) : slugify(title);
  const uniqueSlug = await getUniqueSlug(db, baseSlug);

  const now = Date.now();
  const publishedAt = status === 'Published' ? (body.published_at ? Number(body.published_at) : now) : null;

  const insertSql = `
    INSERT INTO writings (id, title, slug, subtitle, content, content_type, tags, status, cover_image_key, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.prepare(insertSql).bind(
    id, title, uniqueSlug, subtitle, content, contentType, tags, status, coverImageKey, now, now, publishedAt
  ).run();

  // Automatic poem publication notification for active subscribers
  if (status === 'Published') {
    const siteUrl = getSiteUrl(request, env);
    const writingObj = { id, title, slug: uniqueSlug, subtitle, content, content_type: contentType };
    const task = triggerPoemNotifications(env, writingObj, siteUrl);
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(task);
    } else {
      task.catch(err => console.error('Notification dispatch error:', err));
    }
  }

  return jsonResponse({
    success: true,
    writing: {
      id,
      title,
      slug: uniqueSlug,
      status,
      published_at: publishedAt
    }
  }, 201);
}

async function handleUpdateWriting(id, request, env, ctx) {
  const db = await checkDatabase(env);
  const body = await request.json();

  const existing = await db.prepare('SELECT * FROM writings WHERE id = ?').bind(id).first();
  if (!existing) {
    return jsonResponse({ error: 'Writing not found' }, 404);
  }

  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  if (!title || !content) {
    return jsonResponse({ error: 'Title and content are required' }, 400);
  }

  const contentType = body.content_type || existing.content_type;
  const subtitle = body.subtitle !== undefined ? (body.subtitle ? body.subtitle.trim() : null) : existing.subtitle;
  const tags = body.tags !== undefined ? (body.tags ? body.tags.trim() : null) : existing.tags;
  const status = body.status === 'Published' ? 'Published' : 'Draft';
  const coverImageKey = body.cover_image_key !== undefined ? body.cover_image_key : existing.cover_image_key;

  let slug = existing.slug;
  if (body.slug && body.slug !== existing.slug) {
    slug = await getUniqueSlug(db, slugify(body.slug), id);
  }

  const now = Date.now();
  let publishedAt = existing.published_at;
  if (status === 'Published' && !publishedAt) {
    publishedAt = now;
  } else if (body.published_at) {
    publishedAt = Number(body.published_at);
  }

  const updateSql = `
    UPDATE writings
    SET title = ?, slug = ?, subtitle = ?, content = ?, content_type = ?, tags = ?, status = ?, cover_image_key = ?, updated_at = ?, published_at = ?
    WHERE id = ?
  `;

  await db.prepare(updateSql).bind(
    title, slug, subtitle, content, contentType, tags, status, coverImageKey, now, publishedAt, id
  ).run();

  // Automatic poem publication notification when transitioning to Published
  if (status === 'Published' && existing.status !== 'Published') {
    const siteUrl = getSiteUrl(request, env);
    const writingObj = { id, title, slug, subtitle, content, content_type: contentType };
    const task = triggerPoemNotifications(env, writingObj, siteUrl);
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(task);
    } else {
      task.catch(err => console.error('Notification dispatch error:', err));
    }
  }

  return jsonResponse({
    success: true,
    writing: { id, title, slug, status, updated_at: now, published_at: publishedAt }
  });
}

async function handleToggleStatus(id, request, env, ctx) {
  const db = await checkDatabase(env);
  const body = await request.json();
  const nextStatus = body.status === 'Published' ? 'Published' : 'Draft';

  const existing = await db.prepare('SELECT id, status, published_at FROM writings WHERE id = ?').bind(id).first();
  if (!existing) {
    return jsonResponse({ error: 'Writing not found' }, 404);
  }

  const now = Date.now();
  const publishedAt = nextStatus === 'Published' ? (existing.published_at || now) : existing.published_at;

  await db.prepare(`
    UPDATE writings 
    SET status = ?, published_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(nextStatus, publishedAt, now, id).run();

  // Automatic poem publication notification when transitioning to Published
  if (nextStatus === 'Published' && existing.status !== 'Published') {
    const writingObj = await db.prepare('SELECT id, title, slug, subtitle, content, content_type FROM writings WHERE id = ?').bind(id).first();
    if (writingObj) {
      const siteUrl = getSiteUrl(request, env);
      const task = triggerPoemNotifications(env, writingObj, siteUrl);
      if (ctx && ctx.waitUntil) {
        ctx.waitUntil(task);
      } else {
        task.catch(err => console.error('Notification dispatch error:', err));
      }
    }
  }

  return jsonResponse({ success: true, status: nextStatus, published_at: publishedAt });
}

async function handleDeleteWriting(id, env) {
  const db = await checkDatabase(env);
  await db.prepare('DELETE FROM writings WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true, message: 'Writing deleted successfully.' });
}

/* ==========================================================================
   PUBLIC API & DYNAMIC SSR PAGES
   ========================================================================== */

async function handlePublicWritingsList(request, env) {
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return jsonResponse({ writings: [] });
  }

  try {
    await ensureWritingsTable(db);
    const { results: writings } = await db.prepare(`
      SELECT id, title, slug, subtitle, content_type, tags, published_at, created_at
      FROM writings
      WHERE status = 'Published'
      ORDER BY COALESCE(published_at, created_at) DESC
    `).all();

    return jsonResponse({ writings: writings || [] }, 200, {
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
  } catch (err) {
    console.error('Public writings query error:', err);
    return jsonResponse({ writings: [] });
  }
}

/**
 * Public SSR Page for /poetry/:slug and /writing/:slug
 */
async function handlePublicPoemPage(slug, request, env) {
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return new Response(renderNotFoundHtml('डेटाबेस कनेक्टेड नहीं है (Database not configured).'), {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  try {
    await ensureWritingsTable(db);
    const writing = await db.prepare(`
      SELECT * FROM writings WHERE slug = ? AND status = 'Published'
    `).bind(slug).first();

    if (!writing) {
      return new Response(renderNotFoundHtml(), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    const html = renderPoemHtml(writing);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (err) {
    console.error('Public poem query error:', err);
    return new Response(renderNotFoundHtml('रचना लोड करने में समस्या आई।'), {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
}

/**
 * Public SSR Page for /poetry, /poems, and /writings Archive
 */
async function handlePublicArchivePage(request, env) {
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    return new Response(renderArchiveHtml([]), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }

  try {
    await ensureWritingsTable(db);
    const { results: writings } = await db.prepare(`
      SELECT id, title, slug, subtitle, content_type, tags, published_at, created_at
      FROM writings
      WHERE status = 'Published'
      ORDER BY COALESCE(published_at, created_at) DESC
    `).all();

    const html = renderArchiveHtml(writings || []);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (err) {
    console.error('Public archive query error:', err);
    return new Response(renderArchiveHtml([]), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
}

/* ==========================================================================
   PUBLIC ANIQUE MANUSCRIPT HTML TEMPLATES
   ========================================================================== */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString('hi-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatContentType(type) {
  if (!type || type.toLowerCase() === 'poetry') {
    return 'कविता';
  }
  return type;
}

function renderPoemHtml(poem) {
  const safeTitle = escapeHtml(poem.title);
  const safeSubtitle = poem.subtitle ? escapeHtml(poem.subtitle) : '';
  const safeContent = escapeHtml(poem.content);
  const safeType = escapeHtml(formatContentType(poem.content_type));
  const dateStr = formatDate(poem.published_at || poem.created_at);
  const tagsList = poem.tags ? poem.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — अशब्द</title>
  
  <meta name="description" content="${safeSubtitle || safeTitle} — अशब्द काव्य एवं रचना।">
  <meta name="theme-color" content="#2b180d">

  <!-- Open Graph / Social Sharing -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${safeTitle} — अशब्द">
  <meta property="og:description" content="${safeSubtitle || 'अशब्द — कविता एवं रचनाएं।'}">
  <meta property="og:url" content="https://ashabd.in/poetry/${encodeURIComponent(poem.slug)}">
  <meta property="og:image" content="https://ashabd.in/ashabd_website_logo_pack/social_media_and_og/og-banner-1200x630.jpg">
  
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@ashabd0">
  <meta name="twitter:title" content="${safeTitle} — अशब्द">
  <meta name="twitter:description" content="${safeSubtitle || 'अशब्द — कविता एवं रचनाएं।'}">

  <!-- Favicons -->
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/ashabd_website_logo_pack/favicons_and_icons/favicon-32x32.png">

  <!-- Classical Typography -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Devanagari:wght@400;500;600;700&family=Rozha+One&family=Tiro+Devanagari+Hindi:ital@0;1&family=Yatra+One&display=swap" rel="stylesheet">

  <style>
    :root {
      /* Background Parchment Palette */
      --bg-parchment: #ebdcb7;
      --bg-parchment-light: #fbf5e8;
      --bg-parchment-warm: #f5ebd3;
      --bg-parchment-deep: #1c0e07;

      /* Antique Ink Typography & Accents */
      --ink-primary: #221309;
      --ink-secondary: #562e17;
      --ink-muted: #743e1e;
      --ink-faint: rgba(78, 42, 20, 0.22);
      --ink-subtle: rgba(78, 42, 20, 0.12);
      --ink-hover: #120601;
      --ink-tag-bg: rgba(92, 53, 28, 0.08);

      /* Overlays & Atmosphere */
      --grain-opacity: 0.26;
      --vignette-inner: rgba(68, 34, 15, 0.22);
      --vignette-mid: rgba(36, 17, 7, 0.55);
      --vignette-edge: rgba(20, 9, 3, 0.82);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      min-height: 100vh;
      background-color: var(--bg-parchment);
      color: var(--ink-primary);
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, serif;
      position: relative;
      overflow-x: hidden;
      padding: 2.5rem 1.25rem 4rem;
    }

    /* Photographic Parchment Ground */
    .parchment-background {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background-color: var(--bg-parchment);
      background-image:
        url('/parchment_background.webp'),
        url('/parchment_background.jpg'),
        radial-gradient(ellipse 70% 60% at 50% 30%, var(--bg-parchment-light) 0%, var(--bg-parchment-warm) 45%, rgba(240, 227, 201, 0.4) 80%, transparent 100%);
      background-position: center center;
      background-size: cover;
      background-repeat: no-repeat;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: high-quality;
      z-index: 0;
      pointer-events: none;
    }

    /* Paper Grain Texture */
    .paper-grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      opacity: var(--grain-opacity);
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='agedPaperNoise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='5' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 0.45 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23agedPaperNoise)'/%3E%3C/svg%3E");
    }

    /* Outer Vignette */
    .vignette {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 48%, var(--vignette-inner) 74%, var(--vignette-mid) 92%, var(--vignette-edge) 100%);
      mix-blend-mode: multiply;
    }

    /* Content Layout */
    .manuscript-page {
      position: relative;
      z-index: 10;
      max-width: 680px;
      margin: 0 auto;
      padding: 1.5rem 1.5rem 3rem;
    }

    /* Top Navigation Marginalia */
    .marginalia-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3.5rem;
      padding-bottom: 0.8rem;
      border-bottom: 1px dashed var(--ink-faint);
    }

    .brand-back-link {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 1.35rem;
      color: var(--ink-primary);
      text-decoration: none;
      letter-spacing: 0.05em;
      opacity: 0.82;
      transition: opacity 0.3s ease, color 0.3s ease;
    }
    .brand-back-link:hover { opacity: 1; color: var(--ink-hover); }

    .collection-link {
      font-size: 0.85rem;
      color: var(--ink-secondary);
      text-decoration: none;
      letter-spacing: 0.06em;
      opacity: 0.75;
      transition: opacity 0.3s ease, color 0.3s ease;
    }
    .collection-link:hover { opacity: 1; color: var(--ink-hover); }

    /* Poem Header */
    .poem-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    .poem-type-badge {
      display: inline-block;
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', serif;
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-muted);
      opacity: 0.85;
      margin-bottom: 0.8rem;
    }

    .poem-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', serif;
      font-size: clamp(2.2rem, 6vw, 3.4rem);
      line-height: 1.25;
      font-weight: 500;
      color: var(--ink-primary);
      margin-bottom: 0.8rem;
      letter-spacing: 0.04em;
      text-shadow: 0 1px 2px rgba(34, 19, 9, 0.22);
    }

    .poem-subtitle {
      font-size: 1.1rem;
      font-style: italic;
      color: var(--ink-secondary);
      opacity: 0.85;
      margin-bottom: 1rem;
    }

    .poem-meta {
      font-size: 0.82rem;
      color: var(--ink-muted);
      opacity: 0.75;
      letter-spacing: 0.04em;
    }

    /* The Poem Body - Preserves Exact Stanzas & Blank Lines */
    .poem-content {
      font-size: clamp(1.15rem, 2.5vw, 1.35rem);
      line-height: 2.05;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--ink-primary);
      letter-spacing: 0.02em;
      margin: 2.5rem 0 4rem;
      padding: 0 0.5rem;
      text-align: center;
    }

    /* Tags */
    .tags-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
      margin-bottom: 3.5rem;
    }

    .ink-tag {
      font-size: 0.75rem;
      color: var(--ink-secondary);
      background: var(--ink-tag-bg);
      padding: 0.2rem 0.6rem;
      border-radius: 2px;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }

    /* Manuscript End Mark */
    .manuscript-colophon {
      text-align: center;
      margin-top: 3.5rem;
      padding-top: 2rem;
      border-top: 1px dashed var(--ink-faint);
    }

    .colophon-symbol {
      font-size: 1.2rem;
      color: var(--ink-muted);
      opacity: 0.6;
      margin-bottom: 1rem;
      display: block;
    }

    .social-links {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.85rem;
    }

    .ink-link {
      font-size: 0.82rem;
      color: var(--ink-secondary);
      text-decoration: none;
      opacity: 0.65;
      transition: opacity 0.3s ease, color 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .ink-link:hover { opacity: 1; color: var(--ink-primary); }

    @media (max-width: 600px) {
      body { padding: 1.5rem 1rem 3rem; }
      .poem-title { font-size: 2.1rem; }
      .poem-content { font-size: 1.15rem; line-height: 1.95; }
    }
  </style>
</head>
<body>
  <div class="parchment-background" aria-hidden="true"></div>
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <main class="manuscript-page">
    <nav class="marginalia-nav" aria-label="Navigation">
      <a href="/" class="brand-back-link" title="वापस अशब्द मुख्य पृष्ठ पर">अशब्द</a>
      <a href="/poems" class="collection-link">रचना संग्रह ↗</a>
    </nav>

    <article>
      <header class="poem-header">
        <span class="poem-type-badge" lang="hi">${safeType}</span>
        <h1 class="poem-title" lang="hi">${safeTitle}</h1>
        ${safeSubtitle ? `<p class="poem-subtitle">${safeSubtitle}</p>` : ''}
        <div class="poem-meta">
          <time>${dateStr}</time>
        </div>
      </header>

      <div class="poem-content" lang="hi">${safeContent}</div>

      ${tagsList.length > 0 ? `
      <div class="tags-container" aria-label="Tags">
        ${tagsList.map(t => `<span class="ink-tag">#${escapeHtml(t)}</span>`).join('')}
      </div>` : ''}

      <footer class="manuscript-colophon">
        <span class="colophon-symbol">❧</span>
        <div class="social-links">
          <a href="https://www.instagram.com/ashabd0/" target="_blank" rel="noopener noreferrer" class="ink-link">
            <span>Instagram: @ashabd0</span>
          </a>
          <span style="opacity:0.3;">·</span>
          <a href="https://x.com/ashabd0/" target="_blank" rel="noopener noreferrer" class="ink-link">
            <span>X: @ashabd0</span>
          </a>
        </div>
      </footer>
    </article>
  </main>
  <script src="/analytics.js" defer></script>
</body>
</html>`;
}

function renderArchiveHtml(writings) {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>रचना संग्रह — अशब्द</title>
  
  <meta name="description" content="अशब्द — प्रकाशित कविताओं और लेखों का संग्रह।">
  <meta name="theme-color" content="#2b180d">

  <!-- Favicons -->
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">

  <!-- Classical Typography -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Devanagari:wght@400;500;600&family=Rozha+One&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">

  <style>
    :root {
      /* Background Parchment Palette */
      --bg-parchment: #ebdcb7;
      --bg-parchment-light: #fbf5e8;
      --bg-parchment-warm: #f5ebd3;
      --bg-parchment-deep: #1c0e07;

      /* Antique Ink Typography & Accents */
      --ink-primary: #221309;
      --ink-secondary: #562e17;
      --ink-muted: #743e1e;
      --ink-faint: rgba(78, 42, 20, 0.22);
      --ink-subtle: rgba(78, 42, 20, 0.12);
      --ink-hover: #120601;

      /* Overlays & Atmosphere */
      --grain-opacity: 0.26;
      --vignette-inner: rgba(68, 34, 15, 0.22);
      --vignette-mid: rgba(36, 17, 7, 0.55);
      --vignette-edge: rgba(20, 9, 3, 0.82);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      min-height: 100vh;
      background-color: var(--bg-parchment);
      color: var(--ink-primary);
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, serif;
      position: relative;
      overflow-x: hidden;
      padding: 3rem 1.5rem 5rem;
    }

    /* Photographic Parchment Ground */
    .parchment-background {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background-color: var(--bg-parchment);
      background-image:
        url('/parchment_background.webp'),
        url('/parchment_background.jpg'),
        radial-gradient(ellipse 70% 60% at 50% 30%, var(--bg-parchment-light) 0%, var(--bg-parchment-warm) 45%, rgba(240, 227, 201, 0.4) 80%, transparent 100%);
      background-position: center center;
      background-size: cover;
      background-repeat: no-repeat;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: high-quality;
      z-index: 0;
      pointer-events: none;
    }

    /* Paper Grain Texture */
    .paper-grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      opacity: var(--grain-opacity);
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='agedPaperNoise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='5' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 0.45 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23agedPaperNoise)'/%3E%3C/svg%3E");
    }

    /* Outer Vignette */
    .vignette {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 48%, var(--vignette-inner) 74%, var(--vignette-mid) 92%, var(--vignette-edge) 100%);
      mix-blend-mode: multiply;
    }

    .page-container {
      position: relative;
      z-index: 10;
      max-width: 680px;
      margin: 0 auto;
    }

    .archive-header {
      text-align: center;
      margin-bottom: 3.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px dashed var(--ink-faint);
    }

    .brand-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 2.8rem;
      color: var(--ink-primary);
      text-decoration: none;
      display: inline-block;
      margin-bottom: 0.5rem;
      transition: color 0.3s ease;
    }
    .brand-title:hover {
      color: var(--ink-hover);
    }

    .archive-subtitle {
      font-size: 0.95rem;
      color: var(--ink-secondary);
      opacity: 0.82;
      letter-spacing: 0.08em;
    }

    .writings-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 1.8rem;
    }

    .writing-item {
      padding-bottom: 1.8rem;
      border-bottom: 1px dotted var(--ink-subtle);
      transition: transform 0.2s ease;
    }

    .writing-link {
      text-decoration: none;
      color: inherit;
      display: block;
    }

    .writing-item-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 1.6rem;
      color: var(--ink-primary);
      margin-bottom: 0.35rem;
      transition: color 0.2s ease;
    }
    .writing-link:hover .writing-item-title { color: var(--ink-secondary); }

    .writing-item-subtitle {
      font-size: 0.95rem;
      color: var(--ink-secondary);
      opacity: 0.85;
      margin-bottom: 0.5rem;
    }

    .writing-item-meta {
      font-size: 0.78rem;
      color: var(--ink-muted);
      opacity: 0.75;
      display: flex;
      gap: 0.8rem;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--ink-secondary);
      opacity: 0.85;
      font-size: 1.1rem;
      font-style: italic;
    }

    .back-home {
      display: block;
      text-align: center;
      margin-top: 4rem;
      font-size: 0.9rem;
      color: var(--ink-secondary);
      text-decoration: none;
      opacity: 0.75;
      transition: opacity 0.3s ease, color 0.3s ease;
    }
    .back-home:hover { opacity: 1; color: var(--ink-primary); }
  </style>
</head>
<body>
  <div class="parchment-background" aria-hidden="true"></div>
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <div class="page-container">
    <header class="archive-header">
      <a href="/" class="brand-title">अशब्द</a>
      <p class="archive-subtitle">प्रकाशित रचना संग्रह</p>
    </header>

    ${writings.length === 0 ? `
      <div class="empty-state">
        <p style="font-size: 1.25rem; margin-bottom: 0.5rem;">अभी कोई रचना प्रकाशित नहीं है।</p>
        <p style="font-size: 0.95rem; opacity: 0.8; margin-bottom: 1.5rem;">शब्द जल्द ही साकार होंगे...</p>
        <p style="font-size: 0.82rem; color: #7a4828; border: 1px dashed rgba(122, 72, 40, 0.4); padding: 0.8rem 1rem; border-radius: 6px; max-width: 440px; margin: 0 auto; line-height: 1.6;">
          🔒 <strong>कवि/लेखक के लिए:</strong> यदि आपने डैशबोर्ड में रचना सुरक्षित की है, तो सुनिश्चित करें कि उसका स्टेटस <strong>"Published"</strong> है। <a href="/admin" style="color: #4a2711; font-weight: bold; text-decoration: underline;">डैशबोर्ड खोलें ↗</a>
        </p>
      </div>
    ` : `
      <ul class="writings-list">
        ${writings.map(w => `
          <li class="writing-item">
            <a href="/poems/${encodeURIComponent(w.slug)}" class="writing-link">
              <h2 class="writing-item-title">${escapeHtml(w.title)}</h2>
              ${w.subtitle ? `<p class="writing-item-subtitle">${escapeHtml(w.subtitle)}</p>` : ''}
              <div class="writing-item-meta">
                <span>${escapeHtml(formatContentType(w.content_type))}</span>
                <span>·</span>
                <time>${formatDate(w.published_at || w.created_at)}</time>
              </div>
            </a>
          </li>
        `).join('')}
      </ul>
    `}

    <a href="/" class="back-home">← मुख्य पृष्ठ पर वापस जाएं</a>
  </div>
  <script src="/analytics.js" defer></script>
</body>
</html>`;
}

function renderNotFoundHtml(customMessage = null) {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>अशब्द — मौन</title>
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Background Parchment Palette */
      --bg-parchment: #ebdcb7;
      --bg-parchment-light: #fbf5e8;
      --bg-parchment-warm: #f5ebd3;
      --bg-parchment-deep: #1c0e07;

      /* Antique Ink Typography & Accents */
      --ink-primary: #221309;
      --ink-secondary: #562e17;
      --ink-muted: #743e1e;

      /* Overlays & Atmosphere */
      --grain-opacity: 0.26;
      --vignette-inner: rgba(68, 34, 15, 0.22);
      --vignette-mid: rgba(36, 17, 7, 0.55);
      --vignette-edge: rgba(20, 9, 3, 0.82);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--bg-parchment);
      color: var(--ink-primary);
      font-family: 'Tiro Devanagari Hindi', Georgia, serif;
      text-align: center;
      padding: 2rem;
      position: relative;
      overflow-x: hidden;
    }
    /* Photographic Parchment Ground */
    .parchment-background {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background-color: var(--bg-parchment);
      background-image:
        url('/parchment_background.webp'),
        url('/parchment_background.jpg'),
        radial-gradient(ellipse 70% 60% at 50% 30%, var(--bg-parchment-light) 0%, var(--bg-parchment-warm) 45%, rgba(240, 227, 201, 0.4) 80%, transparent 100%);
      background-position: center center;
      background-size: cover;
      background-repeat: no-repeat;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: high-quality;
      z-index: 0;
      pointer-events: none;
    }
    /* Paper Grain Texture */
    .paper-grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      opacity: var(--grain-opacity);
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='agedPaperNoise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='5' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 0.45 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23agedPaperNoise)'/%3E%3C/svg%3E");
    }
    /* Outer Vignette */
    .vignette {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 48%, var(--vignette-inner) 74%, var(--vignette-mid) 92%, var(--vignette-edge) 100%);
      mix-blend-mode: multiply;
    }
    .not-found-content {
      position: relative;
      z-index: 10;
      max-width: 540px;
    }
    h1 {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 2.8rem;
      margin-bottom: 0.8rem;
      font-weight: normal;
      color: var(--ink-primary);
    }
    p {
      font-size: 1.15rem;
      color: var(--ink-secondary);
      margin-bottom: 2rem;
      opacity: 0.85;
      line-height: 1.6;
    }
    a {
      color: var(--ink-secondary);
      text-decoration: underline;
      transition: color 0.2s ease;
    }
    a:hover {
      color: var(--ink-primary);
    }
  </style>
</head>
<body>
  <div class="parchment-background" aria-hidden="true"></div>
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>
  <div class="not-found-content">
    <h1>४०४ — यह शब्द अभी मौन है</h1>
    <p>${customMessage || 'यह रचना उपलब्ध नहीं है या अभी एक अप्रकाशित विचार है।'}</p>
    <a href="/">← मुख्य पृष्ठ पर वापस लौटें</a>
  </div>
  <script src="/analytics.js" defer></script>
</body>
</html>`;
}

/* ==========================================================================
   ADMIN DASHBOARD HTML CONTROLLER
   ========================================================================== */

async function handleAdminPage(request, env) {
  if (env.ASSETS) {
    try {
      const assetReq = new Request(new URL('/admin.html', request.url), request);
      const assetRes = await env.ASSETS.fetch(assetReq);
      if (assetRes.status === 200) {
        return new Response(assetRes.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          }
        });
      }
    } catch (e) {
      // Fallback to embedded HTML
    }
  }
  const html = getAdminDashboardHtml();
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

/**
 * Returns the complete single-page Admin Dashboard HTML, CSS, and JS
 */
function getAdminDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ashabd Admin — प्रबंधन कक्ष</title>
  
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@400;500;600&family=Rozha+One&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  
  <style>
    :root {
      --bg: #0f1115;
      --surface: #181b21;
      --surface-border: #262a33;
      --surface-hover: #21252e;
      --text-main: #f0f2f5;
      --text-muted: #8b949e;
      --accent: #d4a373;
      --accent-hover: #e0b080;
      --accent-dim: rgba(212, 163, 115, 0.12);
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
      --parchment-base: #ebdcb7;
      --radius: 8px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      background: var(--bg);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Top Bar */
    header.admin-bar {
      background: var(--surface);
      border-bottom: 1px solid var(--surface-border);
      padding: 0.85rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .brand-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 1.45rem;
      color: var(--accent);
      text-decoration: none;
      letter-spacing: 0.04em;
    }

    .brand-badge {
      font-size: 0.72rem;
      background: var(--surface-border);
      color: var(--text-muted);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: var(--surface-border);
      color: var(--text-main);
      border: 1px solid transparent;
      padding: 0.5rem 0.95rem;
      font-size: 0.85rem;
      border-radius: var(--radius);
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .btn:hover { background: var(--surface-hover); }

    .btn-accent {
      background: var(--accent);
      color: #1a0f05;
      font-weight: 600;
    }
    .btn-accent:hover { background: var(--accent-hover); }

    .btn-outline {
      background: transparent;
      border-color: var(--surface-border);
    }
    .btn-outline:hover { background: var(--surface-hover); border-color: var(--text-muted); }

    .btn-danger {
      background: rgba(248, 81, 73, 0.12);
      color: var(--danger);
      border-color: rgba(248, 81, 73, 0.3);
    }
    .btn-danger:hover { background: var(--danger); color: #fff; }

    /* Layout */
    .admin-container {
      display: flex;
      flex: 1;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
    }

    /* Sidebar Navigation */
    aside.sidebar {
      width: 240px;
      background: var(--surface);
      border-right: 1px solid var(--surface-border);
      padding: 1.5rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .nav-btn {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.65rem 0.95rem;
      color: var(--text-muted);
      border-radius: var(--radius);
      background: transparent;
      border: none;
      width: 100%;
      text-align: left;
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .nav-btn:hover { color: var(--text-main); background: var(--surface-hover); }
    .nav-btn.active { color: var(--accent); background: var(--accent-dim); font-weight: 600; }

    .nav-count {
      margin-left: auto;
      font-size: 0.72rem;
      background: var(--surface-border);
      padding: 0.15rem 0.45rem;
      border-radius: 10px;
      color: var(--text-muted);
    }

    /* Main Workspace */
    main.workspace {
      flex: 1;
      padding: 2rem 2.5rem;
      overflow-y: auto;
    }

    /* View Sections */
    .view-section { display: none; }
    .view-section.active { display: block; animation: fadeIn 0.2s ease; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* Typography & Headers */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.8rem;
    }

    .section-title {
      font-size: 1.45rem;
      font-weight: 600;
      color: var(--text-main);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2.2rem;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
    }

    .stat-label {
      font-size: 0.82rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.4rem;
    }

    .stat-value {
      font-size: 2.1rem;
      font-weight: 700;
      color: var(--text-main);
    }

    /* Filters Bar */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .search-input {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      color: var(--text-main);
      padding: 0.55rem 0.95rem;
      border-radius: var(--radius);
      font-size: 0.86rem;
      flex: 1;
      min-width: 200px;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }

    .select-input {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      color: var(--text-main);
      padding: 0.55rem 0.95rem;
      border-radius: var(--radius);
      font-size: 0.86rem;
      cursor: pointer;
    }
    .select-input:focus { outline: none; border-color: var(--accent); }

    /* Writings Table */
    .table-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    table.writings-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    table.writings-table th {
      background: rgba(0, 0, 0, 0.2);
      color: var(--text-muted);
      font-size: 0.76rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--surface-border);
    }

    table.writings-table td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--surface-border);
      font-size: 0.88rem;
    }

    table.writings-table tr:last-child td { border-bottom: none; }
    table.writings-table tr:hover td { background: var(--surface-hover); }

    .table-title {
      font-weight: 600;
      color: var(--text-main);
      display: block;
      margin-bottom: 0.25rem;
      font-family: 'Noto Serif Devanagari', 'Inter', serif;
    }

    .table-subtitle {
      font-size: 0.78rem;
      color: var(--text-muted);
      display: block;
    }

    .status-pill {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 600;
    }
    .status-pill.published { background: rgba(63, 185, 80, 0.15); color: var(--success); }
    .status-pill.draft { background: rgba(210, 153, 34, 0.15); color: var(--warning); }

    .type-tag {
      font-size: 0.75rem;
      background: var(--surface-border);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      color: var(--text-muted);
    }

    .row-actions {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .icon-btn:hover { color: var(--text-main); background: var(--surface-border); }
    .icon-btn.danger:hover { color: var(--danger); background: rgba(248, 81, 73, 0.12); }

    /* Editor Form */
    .editor-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 1.8rem;
    }

    .form-group {
      margin-bottom: 1.4rem;
    }

    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
    }

    label.form-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.45rem;
    }

    .text-input, textarea.form-textarea {
      width: 100%;
      background: #111418;
      border: 1px solid var(--surface-border);
      color: var(--text-main);
      padding: 0.75rem 1rem;
      border-radius: var(--radius);
      font-size: 0.92rem;
      font-family: inherit;
    }
    .text-input:focus, textarea.form-textarea:focus {
      outline: none;
      border-color: var(--accent);
    }

    textarea.form-textarea {
      min-height: 380px;
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, serif;
      font-size: 1.15rem;
      line-height: 1.95;
      white-space: pre-wrap;
      resize: vertical;
    }

    /* File Import Drag & Drop Zone */
    .drop-zone {
      border: 2px dashed var(--surface-border);
      border-radius: var(--radius);
      padding: 1.5rem;
      text-align: center;
      background: rgba(0, 0, 0, 0.15);
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 1.25rem;
    }
    .drop-zone:hover, .drop-zone.dragover {
      border-color: var(--accent);
      background: var(--accent-dim);
    }

    .drop-zone p {
      font-size: 0.86rem;
      color: var(--text-muted);
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .editor-stats {
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .editor-actions {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      margin-top: 1.8rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--surface-border);
    }

    /* Login Screen Modal */
    .auth-overlay {
      position: fixed;
      inset: 0;
      background: var(--bg);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .login-box {
      width: 100%;
      max-width: 400px;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 2.2rem;
      text-align: center;
    }

    .login-brand {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 2.4rem;
      color: var(--accent);
      margin-bottom: 0.4rem;
    }

    .login-sub {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 2rem;
    }

    /* Preview Modal (Antique Parchment Simulation) */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 500;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .modal-overlay.active { display: flex; }

    .preview-modal-content {
      width: 100%;
      max-width: 760px;
      max-height: 90vh;
      background: #ebdcb7;
      color: #24160c;
      border-radius: var(--radius);
      overflow-y: auto;
      padding: 3rem 2.5rem;
      position: relative;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', serif;
    }

    .preview-close-btn {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      background: rgba(45, 25, 12, 0.15);
      border: none;
      color: #24160c;
      font-size: 1.2rem;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      cursor: pointer;
    }

    .notice-box {
      background: rgba(210, 153, 34, 0.12);
      border: 1px solid rgba(210, 153, 34, 0.3);
      color: #e3b341;
      padding: 0.85rem 1.15rem;
      border-radius: var(--radius);
      font-size: 0.85rem;
      margin-bottom: 1.5rem;
      display: none;
    }

    @media (max-width: 820px) {
      .admin-container { flex-direction: column; }
      aside.sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--surface-border); flex-direction: row; overflow-x: auto; }
      main.workspace { padding: 1.25rem; }
      .nav-count { display: none; }
    }

    /* ==================== ANALYTICS DASHBOARD STYLING ==================== */
    .analytics-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .live-pill {
      display: inline-flex;
      align-items: center;
      background: rgba(63, 185, 80, 0.12);
      border: 1px solid rgba(63, 185, 80, 0.3);
      color: #3fb950;
      font-size: 0.76rem;
      font-weight: 600;
      padding: 0.2rem 0.65rem;
      border-radius: 999px;
      letter-spacing: 0.02em;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3fb950;
      display: inline-block;
      margin-right: 6px;
      box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7);
      animation: pulse-ring 2s infinite;
    }
    @keyframes pulse-ring {
      0% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(63, 185, 80, 0); }
      100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
    }
    .analytics-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .period-selector {
      display: inline-flex;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 3px;
      gap: 2px;
    }
    .period-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 0.4rem 0.75rem;
      border-radius: 5px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .period-btn:hover {
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.04);
    }
    .period-btn.active {
      background: var(--accent);
      color: #140b04;
      font-weight: 600;
    }
    .custom-date-box {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
      font-size: 0.85rem;
    }
    .custom-date-box label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--text-muted);
    }
    .date-input {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--surface-border);
      color: var(--text-main);
      padding: 0.35rem 0.6rem;
      border-radius: 4px;
      font-size: 0.82rem;
    }
    .dropdown-wrap {
      position: relative;
      display: inline-block;
    }
    .dropdown-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      z-index: 50;
      min-width: 170px;
      overflow: hidden;
    }
    .dropdown-menu button {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0.6rem 0.95rem;
      background: none;
      border: none;
      color: var(--text-main);
      font-size: 0.82rem;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .dropdown-menu button:hover {
      background: var(--surface-hover);
      color: var(--accent);
    }
    .analytics-info-banner {
      background: rgba(212, 163, 115, 0.07);
      border: 1px solid rgba(212, 163, 115, 0.22);
      border-radius: var(--radius);
      padding: 0.85rem 1.15rem;
      margin-bottom: 1.5rem;
      display: flex;
      gap: 0.85rem;
      font-size: 0.82rem;
      line-height: 1.6;
      color: var(--text-muted);
    }
    .analytics-info-banner strong {
      color: var(--text-main);
    }
    .stat-card-badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      margin-left: 0.4rem;
    }
    .badge-up { background: rgba(63, 185, 80, 0.15); color: #3fb950; }
    .badge-down { background: rgba(248, 81, 73, 0.15); color: #f85149; }
    .stat-subtext {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.35rem;
    }
    .interval-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 0.85rem;
      margin-bottom: 2rem;
    }
    .interval-box {
      background: rgba(0, 0, 0, 0.22);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 0.85rem 1rem;
    }
    .interval-box-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .interval-box-val {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .interval-box-sub {
      font-size: 0.74rem;
      color: var(--text-muted);
      margin-top: 0.2rem;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 980px) {
      .chart-grid { grid-template-columns: 1fr; }
    }
    .chart-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 1.25rem;
    }
    .chart-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .chart-canvas-wrap {
      position: relative;
      height: 290px;
      width: 100%;
    }
    .analytics-two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 980px) {
      .analytics-two-col { grid-template-columns: 1fr; }
    }
    .progress-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
      margin-bottom: 0.85rem;
      font-size: 0.85rem;
    }
    .progress-bar-wrap {
      flex: 1;
      height: 7px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 999px;
      overflow: hidden;
      margin: 0 0.5rem;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 999px;
      transition: width 0.4s ease;
    }
    .rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.08);
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .rank-badge.top-1 { background: rgba(212, 163, 115, 0.25); color: var(--accent); }
    .rank-badge.top-2 { background: rgba(192, 192, 192, 0.2); color: #d0d7de; }
    .rank-badge.top-3 { background: rgba(205, 127, 50, 0.2); color: #e09f67; }
    .filter-tab-bar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-tab-btn {
      background: none;
      border: 1px solid var(--surface-border);
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 0.35rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-tab-btn.active {
      background: rgba(212, 163, 115, 0.14);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .status-pill-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .status-pill-box {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      text-align: center;
    }
    .status-pill-code { font-size: 0.78rem; font-weight: 600; margin-bottom: 0.2rem; }
    .status-pill-val { font-size: 1.35rem; font-weight: 700; color: var(--text-main); }
    .device-bar-wrap {
      display: flex;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      margin: 1rem 0;
      background: rgba(255, 255, 255, 0.06);
    }
    .device-bar-segment {
      height: 100%;
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>

  <!-- ==================== AUTHENTICATION SCREEN ==================== -->
  <div id="authOverlay" class="auth-overlay">
    <!-- 1. Regular Login Box -->
    <div class="login-box" id="loginBox">
      <h1 class="login-brand">अशब्द</h1>
      <p class="login-sub">प्रबंधन कक्ष — Administrator Login</p>

      <form id="loginForm" onsubmit="handleLogin(event)">
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="adminPassword">Administrator Password</label>
          <input type="password" id="adminPassword" class="text-input" placeholder="पासवर्ड दर्ज करें" required autocomplete="current-password">
        </div>
        <button type="submit" id="loginBtn" class="btn btn-accent" style="width: 100%; justify-content: center; padding: 0.75rem;">
          प्रवेश करें (Sign In)
        </button>
      </form>
      <div id="loginError" style="color: var(--danger); font-size: 0.82rem; margin-top: 1rem; display: none;"></div>
      <div style="margin-top: 1.25rem; font-size: 0.84rem; text-align: center;">
        <a href="javascript:void(0)" onclick="showForgotPassword()" style="color: var(--accent); text-decoration: underline; font-weight: 500;">Forgot Password?</a>
      </div>
    </div>

    <!-- 1b. Forgot Password Recovery Box -->
    <div class="login-box" id="forgotBox" style="display: none; max-width: 440px;">
      <h1 class="login-brand">अशब्द</h1>
      <p class="login-sub">पासवर्ड पुनर्प्राप्ति — Forgot Password</p>

      <div class="notice-box" style="display: block; text-align: left; margin-bottom: 1.25rem; font-size: 0.84rem; line-height: 1.6;">
        अपने पंजीकृत व्यवस्थापक ईमेल को दर्ज करें। हम आपको पासवर्ड रीसेट करने के लिए एक सुरक्षित लिंक भेजेंगे।
      </div>

      <form id="forgotForm" onsubmit="handleForgotPassword(event)">
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="forgotEmail">Registered Email (पंजीकृत ईमेल)</label>
          <input type="email" id="forgotEmail" class="text-input" placeholder="admin@ashabd.in" required autocomplete="email">
        </div>
        <button type="submit" id="forgotBtn" class="btn btn-accent" style="width: 100%; justify-content: center; padding: 0.75rem;">
          रीसेट लिंक भेजें (Send Reset Link)
        </button>
      </form>
      <div id="forgotNotice" style="margin-top: 1rem; font-size: 0.84rem; display: none; line-height: 1.6; padding: 0.75rem 1rem; border-radius: var(--radius); text-align: left;"></div>
      <div style="margin-top: 1.25rem; font-size: 0.84rem; color: var(--text-muted); text-align: center;">
        <a href="javascript:void(0)" onclick="showLogin()" style="color: var(--accent); text-decoration: underline;">← वापस लॉगिन पर जाएँ (Back to Login)</a>
      </div>
    </div>

    <!-- 1c. New Password Reset Box -->
    <div class="login-box" id="resetBox" style="display: none; max-width: 440px;">
      <h1 class="login-brand">अशब्द</h1>
      <p class="login-sub">नया पासवर्ड सेट करें — Reset Password</p>

      <div id="resetStatusNotice" class="notice-box" style="display: block; text-align: left; margin-bottom: 1.25rem; font-size: 0.84rem; line-height: 1.6;">
        कृपया अपना नया सुरक्षित पासवर्ड दर्ज करें (Choose a strong password with at least 6 characters).
      </div>

      <form id="resetForm" onsubmit="handleResetPassword(event)">
        <input type="hidden" id="resetTokenInput" value="">
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="resetNewPassword">New Password (नया पासवर्ड)</label>
          <input type="password" id="resetNewPassword" class="text-input" placeholder="न्यूनतम 6 अक्षर (Min 6 chars)" minlength="6" required autocomplete="new-password">
        </div>
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="resetConfirmPassword">Confirm Password (पासवर्ड पुष्टि)</label>
          <input type="password" id="resetConfirmPassword" class="text-input" placeholder="पासवर्ड दोबारा दर्ज करें" minlength="6" required autocomplete="new-password">
        </div>
        <button type="submit" id="resetBtn" class="btn btn-accent" style="width: 100%; justify-content: center; padding: 0.75rem;">
          पासवर्ड अपडेट करें (Save New Password)
        </button>
      </form>
      <div id="resetError" style="color: var(--danger); font-size: 0.84rem; margin-top: 1rem; display: none;"></div>
      <div id="resetSuccess" style="color: var(--success); font-size: 0.84rem; margin-top: 1rem; display: none; line-height: 1.6;"></div>
      <div style="margin-top: 1.25rem; font-size: 0.84rem; color: var(--text-muted); text-align: center;">
        <a href="javascript:void(0)" onclick="showLogin()" style="color: var(--accent); text-decoration: underline;">← वापस लॉगिन पर जाएँ (Back to Login)</a>
      </div>
    </div>

    <!-- 2. First-Time Setup Box (Self-initializing via D1) -->
    <div class="login-box" id="setupBox" style="display: none; max-width: 440px;">
      <h1 class="login-brand">अशब्द</h1>
      <p class="login-sub">व्यवस्थापक पासवर्ड सेटअप (Initial Setup)</p>

      <div class="notice-box" style="display: block; text-align: left; margin-bottom: 1.25rem;">
        <strong>🌱 स्वागतम् (Welcome):</strong> Your dashboard is ready! Set your private administrator password below. It will be salted and saved securely in your D1 database.
      </div>

      <form id="setupForm" onsubmit="handleInitialSetup(event)">
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="newAdminPassword">Choose Password (नया पासवर्ड)</label>
          <input type="password" id="newAdminPassword" class="text-input" placeholder="न्यूनतम 6 अक्षर (Min 6 chars)" minlength="6" required autocomplete="new-password">
        </div>
        <div class="form-group" style="text-align: left;">
          <label class="form-label" for="confirmAdminPassword">Confirm Password (पुष्टि करें)</label>
          <input type="password" id="confirmAdminPassword" class="text-input" placeholder="पासवर्ड दोबारा दर्ज करें" minlength="6" required autocomplete="new-password">
        </div>
        <button type="submit" id="setupBtn" class="btn btn-accent" style="width: 100%; justify-content: center; padding: 0.75rem;">
          पासवर्ड सेट करें और शुरू करें (Initialize &amp; Log In)
        </button>
      </form>
      <div id="setupError" style="color: var(--danger); font-size: 0.82rem; margin-top: 1rem; display: none;"></div>
      <div style="margin-top: 1.25rem; font-size: 0.82rem; color: var(--text-muted); text-align: center;">
        पहले से पासवर्ड है? <a href="javascript:void(0)" onclick="showLogin()" style="color: var(--accent); text-decoration: underline;">साइन इन करें (Already set up? Sign in)</a>
      </div>
    </div>
  </div>

  <!-- ==================== MAIN DASHBOARD INTERFACE ==================== -->
  <header class="admin-bar">
    <div class="brand-wrap">
      <a href="/" target="_blank" class="brand-title" title="View Public Website">अशब्द</a>
      <span class="brand-badge">Admin</span>
    </div>
    <div class="header-actions">
      <a href="/" target="_blank" class="btn btn-outline" title="Open public site in new tab">
        <span>↗ ashabd.in</span>
      </a>
      <button class="btn btn-outline" onclick="handleLogout()" title="Log out">
        <span>प्रस्थान (Logout)</span>
      </button>
    </div>
  </header>

  <div class="admin-container">
    <aside class="sidebar">
      <button class="nav-btn active" id="btn-overview" onclick="switchTab('overview')">
        <span>📊 Overview</span>
      </button>
      <button class="nav-btn" id="btn-analytics" onclick="switchTab('analytics')">
        <span>📈 Website Analytics</span>
      </button>
      <button class="nav-btn" id="btn-all-writings" onclick="switchTab('all-writings')">
        <span>📜 All Writings</span>
        <span class="nav-count" id="countAll">0</span>
      </button>
      <button class="nav-btn" id="btn-new" onclick="openNewWriting()">
        <span>✍️ Add New Writing</span>
      </button>
      <button class="nav-btn" id="btn-published" onclick="switchTab('published')">
        <span>🌐 Published</span>
        <span class="nav-count" id="countPub">0</span>
      </button>
      <button class="nav-btn" id="btn-drafts" onclick="switchTab('drafts')">
        <span>📁 Drafts</span>
        <span class="nav-count" id="countDraft">0</span>
      </button>
      <button class="nav-btn" id="btn-subscribers" onclick="switchTab('subscribers')">
        <span>📬 Subscribers</span>
        <span class="nav-count" id="countSubscribers">0</span>
      </button>
      <button class="nav-btn" id="btn-settings" onclick="switchTab('settings')">
        <span>⚙️ Settings &amp; D1</span>
      </button>
    </aside>

    <main class="workspace">
      <!-- Alerts Banner -->
      <div id="dbAlert" class="notice-box"></div>

      <!-- VIEW 1: OVERVIEW -->
      <section id="view-overview" class="view-section active">
        <div class="section-header">
          <h2 class="section-title">Dashboard Overview</h2>
          <button class="btn btn-accent" onclick="openNewWriting()">+ Add New Writing</button>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Writings</div>
            <div class="stat-value" id="statTotal">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Published Works</div>
            <div class="stat-value" id="statPublished" style="color: var(--success);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Drafts</div>
            <div class="stat-value" id="statDrafts" style="color: var(--warning);">0</div>
          </div>
        </div>

        <div class="section-header" style="margin-top: 2rem;">
          <h3 style="font-size: 1.15rem;">Recent Writings</h3>
        </div>
        <div class="table-card">
          <table class="writings-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="recentTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">लोड हो रहा है (Loading)...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- VIEW 2: ALL WRITINGS / PUBLISHED / DRAFTS -->
      <section id="view-list" class="view-section">
        <div class="section-header">
          <h2 class="section-title" id="listSectionTitle">All Writings</h2>
          <button class="btn btn-accent" onclick="openNewWriting()">+ New Writing</button>
        </div>

        <div class="filter-bar">
          <input type="text" id="searchInput" class="search-input" placeholder="Search by title, tag, or subtitle..." oninput="debounceLoadWritings()">
          <select id="typeFilter" class="select-input" onchange="loadWritings()">
            <option value="all">सभी रचना प्रकार</option>
            <option value="Poetry">कविता</option>
            <option value="Article">लेख</option>
            <option value="Story">कहानी</option>
            <option value="Essay">निबंध</option>
            <option value="Diary">डायरी</option>
            <option value="Other">अन्य</option>
          </select>
          <select id="statusFilter" class="select-input" onchange="loadWritings()">
            <option value="all">All Status</option>
            <option value="Published">Published</option>
            <option value="Draft">Drafts</option>
          </select>
        </div>

        <div class="table-card">
          <table class="writings-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created / Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="writingsTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">लोड हो रहा है...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- VIEW 3: EDITOR (ADD / EDIT) -->
      <section id="view-editor" class="view-section">
        <div class="section-header">
          <h2 class="section-title" id="editorTitle">Add New Writing</h2>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-outline" onclick="switchTab('all-writings')">Back to List</button>
          </div>
        </div>

        <form id="writingForm" onsubmit="handleSaveWriting(event)">
          <input type="hidden" id="editWritingId" value="">

          <div class="editor-card">
            <!-- File Import Drag & Drop Zone -->
            <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
              <input type="file" id="fileInput" accept=".txt,.md,.docx" style="display: none;" onchange="handleFileSelect(event)">
              <p>📄 <strong>Click or Drag & Drop a file to import content</strong></p>
              <p style="font-size: 0.78rem; margin-top: 0.35rem;">Supports <code>.txt</code>, <code>.md</code>, and <code>.docx</code> (Word). Format &amp; stanzas are preserved.</p>
            </div>

            <div class="form-row">
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label" for="writingTitle">Title (शीर्षक) *</label>
                <input type="text" id="writingTitle" class="text-input" placeholder="उदा. मौन की गूंज" required oninput="autoGenerateSlug()">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="writingSubtitle">Subtitle (उपशीर्षक - Optional)</label>
                <input type="text" id="writingSubtitle" class="text-input" placeholder="संक्षिप्त विवरण या पंक्ति">
              </div>

              <div class="form-group">
                <label class="form-label" for="writingSlug">URL Slug (स्थायी पता)</label>
                <input type="text" id="writingSlug" class="text-input" placeholder="auto-generated-slug">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="writingType">रचना प्रकार</label>
                <select id="writingType" class="select-input" style="width: 100%;">
                  <option value="Poetry">कविता</option>
                  <option value="Article">लेख</option>
                  <option value="Story">कहानी</option>
                  <option value="Essay">निबंध</option>
                  <option value="Diary">डायरी</option>
                  <option value="Other">अन्य</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="writingTags">Tags (टैग - Comma separated)</label>
                <input type="text" id="writingTags" class="text-input" placeholder="हिंदी, कविता, दर्शन, मौन">
              </div>

              <div class="form-group">
                <label class="form-label" for="writingStatus">Status (स्थिति)</label>
                <select id="writingStatus" class="select-input" style="width: 100%;">
                  <option value="Published">🚀 Published (सार्वजनिक - ashabd.in/poems पर तुरंत लाइव दिखेगी)</option>
                  <option value="Draft">📁 Draft (निजी ड्राफ्ट - केवल डैशबोर्ड में रहेगी, वेबसाइट पर नहीं दिखेगी)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <div class="editor-toolbar">
                <label class="form-label" style="margin-bottom: 0;">Content (रचना पाठ) *</label>
                <div class="editor-stats">
                  <span id="wordCount">0 words</span> · <span id="lineCount">0 lines</span>
                </div>
              </div>
              <textarea id="writingContent" class="form-textarea" placeholder="यहाँ अपनी कविता या लेख लिखें... छंद और पंक्तियाँ ज्यों की त्यों सुरक्षित रहेंगी।" required oninput="updateStats()"></textarea>
            </div>

            <div class="editor-actions" style="flex-wrap: wrap; gap: 0.8rem;">
              <button type="button" class="btn btn-outline" onclick="openPreview()">
                👁️ Preview on Website
              </button>
              <button type="button" class="btn btn-outline" onclick="saveWritingWithStatus('Draft')" id="saveDraftBtn">
                📁 Save as Draft (ड्राफ्ट में रखें)
              </button>
              <button type="button" class="btn btn-accent" onclick="saveWritingWithStatus('Published')" id="savePublishBtn" style="font-weight: 600; padding: 0.6rem 1.4rem;">
                🚀 Publish Live (वेबसाइट पर प्रकाशित करें)
              </button>
              <button type="button" class="btn btn-outline" onclick="switchTab('all-writings')">
                Cancel
              </button>
            </div>
          </div>
        </form>
      </section>

      <!-- ==================== VIEW: WEBSITE ANALYTICS ==================== -->
      <section id="view-analytics" class="view-section">
        <!-- Top Analytics Header with Period & Actions -->
        <div class="analytics-header">
          <div class="analytics-title-wrap">
            <h2 class="section-title" style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <span>📈 Website Analytics</span>
              <span class="live-pill"><span class="pulse-dot"></span><span id="statActiveOnline">0</span> Online Now</span>
            </h2>
            <p style="font-size: 0.85rem; color: var(--text-muted);">
              Real-time readership engagement, visitor presence &amp; traffic analytics (Cloudflare Edge &amp; D1 Database)
            </p>
          </div>

          <div class="analytics-actions">
            <div class="period-selector" role="group" aria-label="Date Filter">
              <button class="period-btn" data-period="today" onclick="setAnalyticsPeriod('today')">Today</button>
              <button class="period-btn" data-period="yesterday" onclick="setAnalyticsPeriod('yesterday')">Yesterday</button>
              <button class="period-btn active" data-period="7d" onclick="setAnalyticsPeriod('7d')">7 Days</button>
              <button class="period-btn" data-period="30d" onclick="setAnalyticsPeriod('30d')">30 Days</button>
              <button class="period-btn" data-period="90d" onclick="setAnalyticsPeriod('90d')">90 Days</button>
              <button class="period-btn" data-period="custom" onclick="toggleCustomDateInputs()">Custom</button>
            </div>

            <button class="btn btn-outline btn-sm" id="btnRefreshAnalytics" onclick="refreshAnalytics()" title="Refresh Analytics">
              <span id="refreshIcon">🔄</span> Refresh
            </button>

            <div class="dropdown-wrap">
              <button class="btn btn-outline btn-sm" onclick="toggleExportMenu()" title="Download Analytics Report">
                <span>📥 Export Report ▾</span>
              </button>
              <div id="exportMenu" class="dropdown-menu" style="display: none;">
                <button onclick="exportAnalyticsReport('csv')">📄 CSV Spreadsheet (.csv)</button>
                <button onclick="exportAnalyticsReport('json')">📦 JSON Data (.json)</button>
              </div>
            </div>

            <button class="btn btn-outline btn-sm" onclick="triggerTestPing()" title="Record Test Visit">
              <span>🧪 Test Ping</span>
            </button>
          </div>
        </div>

        <!-- Custom Date Range Picker (Conditional) -->
        <div id="customDateRangeBox" class="custom-date-box" style="display: none;">
          <label>From: <input type="date" id="customStartDate" class="date-input"></label>
          <label>To: <input type="date" id="customEndDate" class="date-input"></label>
          <button class="btn btn-accent btn-sm" onclick="applyCustomDateRange()">Apply</button>
        </div>

        <!-- Privacy & Estimation Methodology Banner -->
        <div class="analytics-info-banner">
          <div style="font-size: 1.2rem;">🔒</div>
          <div>
            <strong>Privacy-Preserving &amp; Verified Analytics:</strong>
            <strong>Unique Visitors</strong> are calculated using a daily cryptographic hash (Salted Daily SHA-256). No individual IP addresses or personal data are ever stored.
            <strong>Page Views</strong> measure total page visits, while <strong>Verified Reads</strong> track readers who spent at least 15–20 seconds reading or scrolled past 50% of the content. Automated bots are isolated from human traffic metrics.
          </div>
        </div>

        <!-- Section 2: Top Overview Summary Cards (6 Cards) -->
        <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 1.5rem;">
          <div class="stat-card">
            <div class="stat-label">Total Visitors</div>
            <div class="stat-value" id="statTotalVisitors">0</div>
            <div class="stat-subtext" id="statVisitorsGrowth">vs. previous period</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">
              Unique Visitors
              <span title="Calculated via Salted Daily SHA-256 Hash" style="cursor: help; opacity: 0.7;">ℹ️</span>
            </div>
            <div class="stat-value" id="statUniqueVisitors" style="color: var(--accent);">0</div>
            <div class="stat-subtext">Distinct Individuals</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Page Views</div>
            <div class="stat-value" id="statTotalPageViews">0</div>
            <div class="stat-subtext" id="statPageviewsGrowth">Total pages read</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Currently Online</div>
            <div class="stat-value" style="color: #3fb950;">
              <span class="pulse-dot"></span><span id="statActiveOnlineCard">0</span>
            </div>
            <div class="stat-subtext">Active in last 5 minutes</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Published Poems</div>
            <div class="stat-value" id="statTotalPoems" style="color: #388bfd;">0</div>
            <div class="stat-subtext">Live poetry collection</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Published Articles &amp; Others</div>
            <div class="stat-value" id="statTotalArticles" style="color: #a371f7;">0</div>
            <div class="stat-subtext">Articles, essays &amp; diaries</div>
          </div>
        </div>

        <!-- Section 2b: Multi-Period Quick Strip (Today, 7d, 30d, All-Time) -->
        <div class="interval-strip">
          <div class="interval-box">
            <div class="interval-box-label">Today's Traffic</div>
            <div class="interval-box-val" id="stripTodayViews">0 Views</div>
            <div class="interval-box-sub" id="stripTodayVisitors">0 Visitors</div>
          </div>
          <div class="interval-box">
            <div class="interval-box-label">Last 7 Days</div>
            <div class="interval-box-val" id="strip7dViews">0 Views</div>
            <div class="interval-box-sub" id="strip7dVisitors">0 Visitors</div>
          </div>
          <div class="interval-box">
            <div class="interval-box-label">Last 30 Days</div>
            <div class="interval-box-val" id="strip30dViews">0 Views</div>
            <div class="interval-box-sub" id="strip30dVisitors">0 Visitors</div>
          </div>
          <div class="interval-box">
            <div class="interval-box-label">All-Time Total</div>
            <div class="interval-box-val" id="stripAllViews">0 Views</div>
            <div class="interval-box-sub" id="stripAllVisitors">0 Visitors</div>
          </div>
        </div>

        <!-- Section 3: Interactive Traffic Charts (Over Time + Visitor Ratio) -->
        <div class="chart-grid">
          <div class="chart-card">
            <div class="chart-card-header">
              <div>
                <h3 style="font-size: 1.05rem; font-weight: 600;">📊 Traffic Over Time</h3>
                <p style="font-size: 0.78rem; color: var(--text-muted);">Hourly &amp; daily trends for page views, unique visitors and verified reads</p>
              </div>
            </div>
            <div class="chart-canvas-wrap">
              <canvas id="trafficTrendChart"></canvas>
            </div>
          </div>

          <div class="chart-card">
            <div class="chart-card-header">
              <div>
                <h3 style="font-size: 1.05rem; font-weight: 600;">👥 Visitor Ratio</h3>
                <p style="font-size: 0.78rem; color: var(--text-muted);">New vs. returning visitors</p>
              </div>
            </div>
            <div class="chart-canvas-wrap" style="height: 230px;">
              <canvas id="visitorRatioChart"></canvas>
            </div>
            <div id="visitorRatioLegend" style="display: flex; justify-content: center; gap: 1.5rem; margin-top: 0.8rem; font-size: 0.82rem;">
              <span><span style="color: #d4a373;">●</span> New Visitors: <strong id="lblNewVisitors">0</strong></span>
              <span><span style="color: #3fb950;">●</span> Returning Visitors: <strong id="lblReturningVisitors">0</strong></span>
            </div>
          </div>
        </div>

        <!-- Section 4: Most Popular Poems & Pages -->
        <div class="editor-card" style="margin-bottom: 2rem;">
          <div class="chart-card-header" style="flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 600;">📖 Most Popular Content &amp; Pages</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted);">Most viewed and read content during the selected period</p>
            </div>
            <div class="filter-tab-bar" style="margin-bottom: 0;">
              <button class="filter-tab-btn active" data-filter="all" onclick="filterContentTable('all')">All</button>
              <button class="filter-tab-btn" data-filter="poems" onclick="filterContentTable('poems')">Poems Only</button>
              <button class="filter-tab-btn" data-filter="articles" onclick="filterContentTable('articles')">Articles &amp; Writings</button>
              <button class="filter-tab-btn" data-filter="pages" onclick="filterContentTable('pages')">Main Pages</button>
            </div>
          </div>

          <div class="table-card" style="border: none;">
            <table class="writings-table">
              <thead>
                <tr>
                  <th style="width: 48px;">#</th>
                  <th>Content / Page Title &amp; URL</th>
                  <th>Type</th>
                  <th style="text-align: right; cursor: pointer;" onclick="sortPopularContent('views')">Views ↕</th>
                  <th style="text-align: right; cursor: pointer;" onclick="sortPopularContent('reads')">Verified Reads ↕</th>
                  <th style="text-align: right;">Read Rate</th>
                  <th style="width: 140px;">Traffic Share</th>
                  <th style="text-align: center; width: 80px;">Action</th>
                </tr>
              </thead>
              <tbody id="popularContentTableBody">
                <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">Loading analytics data...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Section 5 & 6: Traffic Sources & Visitor Demographics (Two Column Layout) -->
        <div class="analytics-two-col">
          <!-- Column 1: Traffic Sources -->
          <div class="editor-card">
            <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem;">🌐 Traffic Sources &amp; Referrers</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">Where visitors are arriving from</p>

            <div id="sourcesContainer">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Column 2: Visitor Demographics -->
          <div class="editor-card">
            <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem;">🌍 Visitor Demographics &amp; Devices</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">Country origins, device types, and browsers</p>

            <h4 style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.6rem;">Top Countries</h4>
            <div id="countriesContainer" style="margin-bottom: 1.4rem;">
              <!-- Rendered dynamically -->
            </div>

            <h4 style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem;">Device Categories</h4>
            <div id="devicesContainer">
              <!-- Segmented bar -->
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.2rem;">
              <div>
                <h4 style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.5rem;">Top Browsers</h4>
                <div id="browsersContainer" style="font-size: 0.82rem;"></div>
              </div>
              <div>
                <h4 style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.5rem;">Operating Systems</h4>
                <div id="osContainer" style="font-size: 0.82rem;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 7 & 8: Poetry Engagement & Technical Performance -->
        <div class="analytics-two-col">
          <!-- Column 1: Poetry Engagement -->
          <div class="editor-card">
            <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem;">✒️ Poetry Engagement</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">Reader engagement and verification on poems</p>

            <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-bottom: 1.25rem;">
              <div class="interval-box">
                <div class="interval-box-label">Verified Reads</div>
                <div class="interval-box-val" id="statPoemReads" style="color: var(--accent);">0</div>
                <div class="interval-box-sub">Spent &ge;15s reading</div>
              </div>
              <div class="interval-box">
                <div class="interval-box-label">Poem Read Rate</div>
                <div class="interval-box-val" id="statPoemReadRate">0%</div>
                <div class="interval-box-sub">Views to read conversion</div>
              </div>
            </div>

            <h4 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.6rem;">Top Read Poems</h4>
            <div id="topReadPoemsList">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Column 2: Technical Performance & Broken Pages -->
          <div class="editor-card">
            <h3 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem;">⚡ Performance &amp; Broken Links</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.25rem;">Cloudflare Worker execution, HTTP status codes &amp; 404 errors</p>

            <div class="status-pill-grid">
              <div class="status-pill-box">
                <div class="status-pill-code" style="color: var(--success);">2xx Success</div>
                <div class="status-pill-val" id="statStatus2xx">0</div>
              </div>
              <div class="status-pill-box">
                <div class="status-pill-code" style="color: #388bfd;">3xx Redirect</div>
                <div class="status-pill-val" id="statStatus3xx">0</div>
              </div>
              <div class="status-pill-box">
                <div class="status-pill-code" style="color: var(--warning);">4xx Client Err</div>
                <div class="status-pill-val" id="statStatus4xx">0</div>
              </div>
              <div class="status-pill-box">
                <div class="status-pill-code" style="color: var(--danger);">5xx Server Err</div>
                <div class="status-pill-val" id="statStatus5xx">0</div>
              </div>
            </div>

            <div style="margin-bottom: 1.25rem; font-size: 0.83rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 0.75rem 1rem; border-radius: var(--radius); line-height: 1.6;">
              <div>🔹 Total Worker Requests: <strong id="statTotalRequests" style="color: var(--text-main);">0</strong></div>
              <div>🔹 Human Visits: <strong id="statHumanRequests" style="color: var(--text-main);">0</strong> · Filtered Bots: <strong id="statBotRequests" style="color: var(--text-main);">0</strong></div>
            </div>

            <h4 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.6rem;">Missing or Broken Pages (404 Not Found URLs)</h4>
            <div id="missingUrlsList" style="font-size: 0.82rem;">
              <!-- 404 URLs table -->
            </div>
          </div>
        </div>
      </section>

      <!-- VIEW 4: SETTINGS & D1 STATUS -->
      <section id="view-settings" class="view-section">
        <div class="section-header">
          <h2 class="section-title">Settings &amp; Database Status</h2>
        </div>

        <!-- Recovery Email Card -->
        <div class="editor-card" style="margin-bottom: 1.5rem;">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">📧 Registered Recovery Email (पुनर्प्राप्ति ईमेल)</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.2rem;">
            This email is used to receive password reset links if you ever forget your administrator password.
          </p>
          <form id="updateEmailForm" onsubmit="handleUpdateEmail(event)" style="max-width: 440px;">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" for="adminRecoveryEmail">Administrator Recovery Email</label>
              <input type="email" id="adminRecoveryEmail" class="text-input" placeholder="admin@ashabd.in" required autocomplete="email">
            </div>
            <button type="submit" id="updateEmailBtn" class="btn btn-accent">ईमेल सहेजें (Save Recovery Email)</button>
            <div id="updateEmailMsg" style="margin-top: 0.8rem; font-size: 0.85rem; display: none;"></div>
          </form>
        </div>

        <!-- Change Password Card -->
        <div class="editor-card" style="margin-bottom: 1.5rem;">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">🔐 Change Administrator Password (पासवर्ड बदलें)</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.2rem;">
            Update your administrator password securely in your Cloudflare D1 database.
          </p>
          <form id="changePasswordForm" onsubmit="handleChangePassword(event)" style="max-width: 440px;">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label" for="currentPass">Current Password (वर्तमान पासवर्ड)</label>
              <input type="password" id="currentPass" class="text-input" placeholder="वर्तमान पासवर्ड दर्ज करें" required autocomplete="current-password">
            </div>
            <div class="form-row" style="margin-bottom: 1.2rem;">
              <div class="form-group">
                <label class="form-label" for="newPass">New Password (नया पासवर्ड)</label>
                <input type="password" id="newPass" class="text-input" placeholder="न्यूनतम 6 अक्षर" minlength="6" required autocomplete="new-password">
              </div>
              <div class="form-group">
                <label class="form-label" for="confirmPass">Confirm (पुष्टि करें)</label>
                <input type="password" id="confirmPass" class="text-input" placeholder="दोबारा दर्ज करें" minlength="6" required autocomplete="new-password">
              </div>
            </div>
            <button type="submit" id="changePassBtn" class="btn btn-accent">पासवर्ड अपडेट करें (Update Password)</button>
            <div id="changePassMsg" style="margin-top: 0.8rem; font-size: 0.85rem; display: none;"></div>
          </form>
        </div>

        <div class="editor-card" style="margin-bottom: 1.5rem;">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">Cloudflare D1 &amp; Architecture Checklist</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.7; margin-bottom: 1.25rem;">
            This admin dashboard connects directly to Cloudflare D1 for persistent storage and uses salted SHA-256 password hashing stored in D1 (or optionally <code>ADMIN_PASSWORD</code> secret).
          </p>

          <div style="background: rgba(0,0,0,0.25); padding: 1.2rem; border-radius: var(--radius); font-size: 0.85rem; line-height: 1.8;">
            <p>1. <strong>D1 Database Binding</strong>: Ensure D1 database binding variable is named <code>DB</code> in <code>wrangler.jsonc</code>.</p>
            <p>2. <strong>Database Migration</strong>: Apply <code>migrations/0001_initial_schema.sql</code> via Cloudflare D1 console.</p>
            <p>3. <strong>Admin Setup</strong>: Once deployed, initialize your password directly at <code>ashabd.in/admin</code>.</p>
          </div>
        </div>

        <div class="editor-card">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">Data Export</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Export all poems and writings as a JSON backup.</p>
          <button class="btn btn-outline" onclick="exportBackup()">📥 Download Backup (JSON)</button>
        </div>
      </section>

      <!-- VIEW 5: SUBSCRIBERS & POEM NOTIFICATIONS -->
      <section id="view-subscribers" class="view-section">
        <div class="section-header">
          <div>
            <h2 class="section-title">Poem Subscribers &amp; Notifications</h2>
            <p style="color: var(--text-muted); font-size: 0.84rem; margin-top: 0.25rem;">3D Notice Board Audience &amp; Automated Delivery Log</p>
          </div>
          <div style="display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap;">
            <button class="btn btn-outline" onclick="openTestPoemModal()" title="Send test poem notification">
              <span>✉️ Send Test Notification</span>
            </button>
            <button class="btn btn-outline" onclick="loadSubscribers()" title="Refresh subscribers">
              <span>↻ Refresh</span>
            </button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Active Verified (सक्रिय)</div>
            <div class="stat-value" id="statActiveSubscribers" style="color: var(--success);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending Verification (प्रतीक्षारत)</div>
            <div class="stat-value" id="statPendingSubscribers" style="color: var(--warning);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Unsubscribed (समाप्त)</div>
            <div class="stat-value" id="statUnsubscribed" style="color: var(--text-muted);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Delivered (कुल प्रेषित)</div>
            <div class="stat-value" id="statTotalNotifications" style="color: var(--accent);">0</div>
          </div>
        </div>

        <div class="filter-bar">
          <input type="text" id="subscriberSearchInput" class="search-input" placeholder="Search by email..." oninput="filterSubscribers()">
          <select id="subscriberStatusFilter" class="select-input" onchange="filterSubscribers()">
            <option value="all">All Statuses (सभी स्थितियाँ)</option>
            <option value="active">Active Verified (सक्रिय)</option>
            <option value="pending">Pending Verification (प्रतीक्षारत)</option>
            <option value="unsubscribed">Unsubscribed (समाप्त)</option>
          </select>
        </div>

        <div class="table-card">
          <table class="writings-table">
            <thead>
              <tr>
                <th>Email Address</th>
                <th>Status</th>
                <th>Subscribed On</th>
                <th>Verified On</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="subscribersTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">लोड हो रहा है (Loading subscribers)...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="section-header" style="margin-top: 2.5rem;">
          <h3 style="font-size: 1.15rem;">Recent Notification Dispatches (हालिया प्रेषण लॉग)</h3>
        </div>
        <div class="table-card">
          <table class="writings-table">
            <thead>
              <tr>
                <th>Poem Title</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody id="notificationsLogTableBody">
              <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">कोई प्रेषण रिकॉर्ड नहीं (No notifications recorded yet)</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>

  <!-- ==================== PREVIEW MODAL (ANTIQUE PARCHMENT) ==================== -->
  <div id="previewModal" class="modal-overlay">
    <div class="preview-modal-content">
      <button class="preview-close-btn" onclick="closePreview()">&times;</button>
      <div style="text-align: center; margin-bottom: 2rem;">
        <span id="prevType" style="font-size: 0.75rem; letter-spacing: 0.1em; color: #743f20; text-transform: uppercase;"></span>
        <h1 id="prevTitle" style="font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif; font-size: 2.5rem; margin: 0.5rem 0; color: #24160c;"></h1>
        <p id="prevSubtitle" style="font-style: italic; color: #5a3219; font-size: 1.05rem;"></p>
        <span style="font-size: 0.8rem; color: #704022; opacity: 0.7;">Preview Mode</span>
      </div>
      <div id="prevContent" style="font-size: 1.25rem; line-height: 2.1; white-space: pre-wrap; color: #20130a; margin: 2rem 0; text-align: center;"></div>
      <div style="text-align: center; margin-top: 2rem; border-top: 1px dashed rgba(78, 42, 20, 0.25); padding-top: 1.5rem;">
        <button class="btn btn-accent" onclick="publishFromPreview()">Publish This Now</button>
        <button class="btn btn-outline" style="color: #24160c; border-color: rgba(36,22,12,0.3);" onclick="closePreview()">Close Preview</button>
      </div>
    </div>
  </div>

  <!-- ==================== POEM DETAIL INSPECTION MODAL ==================== -->
  <div id="poemDetailModal" class="modal-overlay">
    <div class="preview-modal-content" style="background: var(--surface); color: var(--text-main); border: 1px solid var(--surface-border); max-width: 680px; padding: 2.2rem;">
      <button class="preview-close-btn" style="color: var(--text-main); background: rgba(255,255,255,0.08);" onclick="closePoemDetailModal()">&times;</button>
      <div style="margin-bottom: 1.5rem;">
        <span id="pdmType" class="type-tag" style="margin-bottom: 0.5rem; display: inline-block;">Poetry</span>
        <h2 id="pdmTitle" style="font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif; font-size: 1.8rem; margin: 0.25rem 0 0.5rem; color: var(--accent);"></h2>
        <a id="pdmUrl" href="#" target="_blank" style="font-size: 0.82rem; color: #58a6ff; text-decoration: none;">/poems/... ↗</a>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;">
        <div class="interval-box">
          <div class="interval-box-label">Total Views</div>
          <div class="interval-box-val" id="pdmViews">0</div>
        </div>
        <div class="interval-box">
          <div class="interval-box-label">Verified Reads</div>
          <div class="interval-box-val" id="pdmReads" style="color: var(--accent);">0</div>
        </div>
        <div class="interval-box">
          <div class="interval-box-label">Read Rate</div>
          <div class="interval-box-val" id="pdmRate" style="color: #3fb950;">0%</div>
        </div>
      </div>

      <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--surface-border); border-radius: var(--radius); padding: 1.2rem; margin-bottom: 1.5rem;">
        <h4 style="font-size: 0.88rem; margin-bottom: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Verification &amp; Engagement Breakdown</h4>
        <div style="font-size: 0.84rem; line-height: 1.8; color: var(--text-main);">
          <div>⏱️ <strong>Average Reading Duration:</strong> <span id="pdmAvgDuration">--</span></div>
          <div>📜 <strong>Scroll Completion:</strong> Readers who scrolled over 50% of the content</div>
          <div>📊 <strong>Traffic Share:</strong> <span id="pdmShare">--%</span> of total poem traffic</div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
        <button class="btn btn-outline btn-sm" onclick="closePoemDetailModal()">Close</button>
        <a id="pdmLiveBtn" href="#" target="_blank" class="btn btn-accent btn-sm" style="text-decoration: none;">View Live on Website ↗</a>
      </div>
    </div>
  </div>

  <!-- ==================== TEST POEM NOTIFICATION MODAL ==================== -->
  <div id="testNotificationModal" class="modal-overlay">
    <div class="preview-modal-content" style="background: var(--surface); color: var(--text-main); border: 1px solid var(--surface-border); max-width: 500px; padding: 2rem;">
      <button class="preview-close-btn" style="color: var(--text-main); background: rgba(255,255,255,0.08);" onclick="closeTestPoemModal()">&times;</button>
      <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--text-main);">Send Test Poem Notification</h3>
      <p style="font-size: 0.84rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.25rem;">
        Dispatches a sample antique notification email to verify visual rendering and transactional email delivery.
      </p>

      <form id="testNotificationForm" onsubmit="submitTestPoemNotification(event)">
        <div class="form-group" style="text-align: left; margin-bottom: 1rem;">
          <label class="form-label" for="testNotificationEmail">Recipient Email Address (प्राप्तकर्ता ईमेल)</label>
          <input type="email" id="testNotificationEmail" class="text-input" placeholder="admin@ashabd.in" required autocomplete="email">
        </div>
        <div id="testNotificationFeedback" style="display: none; font-size: 0.84rem; line-height: 1.5; padding: 0.65rem 0.85rem; border-radius: var(--radius); margin-bottom: 1rem;"></div>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button type="button" class="btn btn-outline" onclick="closeTestPoemModal()">Cancel</button>
          <button type="submit" id="sendTestPoemBtn" class="btn btn-accent">Send Test Email</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Client-side Logic -->
  <script>
    let currentWritings = [];

    // Check Auth on Page Load
    async function checkAuth() {
      // Check for password reset token in URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const resetToken = urlParams.get('reset_token') || urlParams.get('token');
      if (resetToken) {
        showResetPassword(resetToken);
        try {
          const vRes = await fetch('/api/auth/verify-reset-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken })
          });
          const vData = await vRes.json();
          if (!vData.valid) {
            const errBox = document.getElementById('resetError');
            if (errBox) {
              errBox.innerText = vData.error || 'यह रीसेट लिंक समाप्त या अमान्य हो चुका है (Invalid or expired reset token).';
              errBox.style.display = 'block';
            }
          }
        } catch (_) {}
        return;
      }

      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            document.getElementById('authOverlay').style.display = 'none';
            if (data.email && document.getElementById('adminRecoveryEmail')) {
              document.getElementById('adminRecoveryEmail').value = data.email;
            }
            if (window.location.pathname === '/admin/analytics') {
              switchTab('analytics');
            } else {
              loadWritings();
            }
          } else if (data.needs_setup) {
            showSetup();
          } else {
            showLogin();
          }
        } else {
          showLogin();
        }
      } catch (e) {
        showLogin();
      }
    }

    function showLogin() {
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('loginBox').style.display = 'block';
      const sb = document.getElementById('setupBox');
      if (sb) sb.style.display = 'none';
      const fb = document.getElementById('forgotBox');
      if (fb) fb.style.display = 'none';
      const rb = document.getElementById('resetBox');
      if (rb) rb.style.display = 'none';
      const errBox = document.getElementById('loginError');
      if (errBox) errBox.style.display = 'none';
    }

    function showSetup() {
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('loginBox').style.display = 'none';
      const sb = document.getElementById('setupBox');
      if (sb) sb.style.display = 'block';
      const fb = document.getElementById('forgotBox');
      if (fb) fb.style.display = 'none';
      const rb = document.getElementById('resetBox');
      if (rb) rb.style.display = 'none';
      const errBox = document.getElementById('setupError');
      if (errBox) errBox.style.display = 'none';
    }

    function showForgotPassword() {
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('loginBox').style.display = 'none';
      const sb = document.getElementById('setupBox');
      if (sb) sb.style.display = 'none';
      const fb = document.getElementById('forgotBox');
      if (fb) fb.style.display = 'block';
      const rb = document.getElementById('resetBox');
      if (rb) rb.style.display = 'none';
      const notice = document.getElementById('forgotNotice');
      if (notice) notice.style.display = 'none';
      const emailInput = document.getElementById('forgotEmail');
      if (emailInput) {
        emailInput.value = '';
        setTimeout(() => emailInput.focus(), 50);
      }
    }

    function showResetPassword(token) {
      document.getElementById('authOverlay').style.display = 'flex';
      document.getElementById('loginBox').style.display = 'none';
      const sb = document.getElementById('setupBox');
      if (sb) sb.style.display = 'none';
      const fb = document.getElementById('forgotBox');
      if (fb) fb.style.display = 'none';
      const rb = document.getElementById('resetBox');
      if (rb) rb.style.display = 'block';
      const tokenInput = document.getElementById('resetTokenInput');
      if (tokenInput) tokenInput.value = token || '';
      const errBox = document.getElementById('resetError');
      if (errBox) errBox.style.display = 'none';
      const succBox = document.getElementById('resetSuccess');
      if (succBox) succBox.style.display = 'none';
      const form = document.getElementById('resetForm');
      if (form) form.style.display = 'block';
    }

    async function handleForgotPassword(e) {
      e.preventDefault();
      const email = (document.getElementById('forgotEmail').value || '').trim();
      const btn = document.getElementById('forgotBtn');
      const notice = document.getElementById('forgotNotice');

      if (!email) return;

      btn.disabled = true;
      btn.innerText = 'जाँच हो रही है... (Sending...)';
      notice.style.display = 'none';

      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();

        notice.style.display = 'block';
        notice.style.background = 'rgba(74, 222, 128, 0.12)';
        notice.style.border = '1px solid rgba(74, 222, 128, 0.3)';
        notice.style.color = '#4ade80';
        notice.innerText = data.message || 'यदि इस ईमेल से कोई खाता मौजूद है, तो पासवर्ड रीसेट लिंक भेज दिया गया है। (If an account exists for this email, a password reset link has been sent.)';
      } catch (err) {
        notice.style.display = 'block';
        notice.style.background = 'rgba(239, 68, 68, 0.12)';
        notice.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        notice.style.color = 'var(--danger)';
        notice.innerText = 'Network error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerText = 'रीसेट लिंक भेजें (Send Reset Link)';
      }
    }

    async function handleResetPassword(e) {
      e.preventDefault();
      const token = document.getElementById('resetTokenInput').value;
      const p1 = document.getElementById('resetNewPassword').value;
      const p2 = document.getElementById('resetConfirmPassword').value;
      const errBox = document.getElementById('resetError');
      const succBox = document.getElementById('resetSuccess');
      const btn = document.getElementById('resetBtn');
      const form = document.getElementById('resetForm');

      errBox.style.display = 'none';
      succBox.style.display = 'none';

      if (!token) {
        errBox.innerText = 'अमान्य या अनुपस्थित रीसेट टोकन (Missing or invalid reset token).';
        errBox.style.display = 'block';
        return;
      }

      if (p1 !== p2) {
        errBox.innerText = 'पासवर्ड मेल नहीं खाते (Passwords do not match).';
        errBox.style.display = 'block';
        return;
      }

      if (p1.length < 6) {
        errBox.innerText = 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए (Password must be at least 6 characters).';
        errBox.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'अपडेट हो रहा है... (Updating...)';

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword: p1 })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          form.style.display = 'none';
          succBox.innerHTML = '<strong>✅ सफलता (Success)!</strong><br>' +
            (data.message || 'पासवर्ड सफलतापूर्वक बदल दिया गया है (Password reset successfully).') +
            '<br><br><button class="btn btn-accent btn-sm" onclick="showLogin()" style="width: 100%; justify-content: center;">अब लॉगिन करें (Sign In Now)</button>';
          succBox.style.display = 'block';
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          errBox.innerText = data.error || 'पासवर्ड रीसेट करने में विफल (Failed to reset password).';
          errBox.style.display = 'block';
        }
      } catch (err) {
        errBox.innerText = 'Network error: ' + err.message;
        errBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerText = 'पासवर्ड अपडेट करें (Save New Password)';
      }
    }

    async function handleLogin(e) {
      e.preventDefault();
      const password = document.getElementById('adminPassword').value;
      const errBox = document.getElementById('loginError');
      const btn = document.getElementById('loginBtn');
      errBox.style.display = 'none';
      btn.disabled = true;
      btn.innerText = 'प्रवेश हो रहा है...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('authOverlay').style.display = 'none';
          if (window.location.pathname === '/admin/analytics') {
            switchTab('analytics');
          } else {
            loadWritings();
          }
        } else {
          errBox.innerText = data.error || 'अमान्य पासवर्ड (Invalid password)';
          errBox.style.display = 'block';
          if (data.needs_setup) {
            setTimeout(showSetup, 1200);
          }
        }
      } catch (err) {
        errBox.innerText = 'Network error: ' + err.message;
        errBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerText = 'प्रवेश करें (Sign In)';
      }
    }

    async function handleInitialSetup(e) {
      e.preventDefault();
      const p1 = document.getElementById('newAdminPassword').value;
      const p2 = document.getElementById('confirmAdminPassword').value;
      const errBox = document.getElementById('setupError');
      const btn = document.getElementById('setupBtn');

      errBox.style.display = 'none';
      if (p1 !== p2) {
        errBox.innerText = 'पासवर्ड मेल नहीं खाते (Passwords do not match). Please try again.';
        errBox.style.display = 'block';
        return;
      }
      if (p1.length < 6) {
        errBox.innerText = 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए (Password must be at least 6 characters).';
        errBox.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'सेट हो रहा है... (Initializing...)';

      try {
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: p1 })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          alert('🎉 व्यवस्थापक पासवर्ड सफलतापूर्वक सेट हो गया!\\n(Admin password initialized successfully!)');
          document.getElementById('authOverlay').style.display = 'none';
          loadWritings();
        } else {
          errBox.innerText = data.error || 'Setup failed';
          errBox.style.display = 'block';
        }
      } catch (err) {
        errBox.innerText = 'Network error: ' + err.message;
        errBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerText = 'पासवर्ड सेट करें और शुरू करें (Initialize & Log In)';
      }
    }

    async function handleChangePassword(e) {
      e.preventDefault();
      const currentPassword = document.getElementById('currentPass').value;
      const newPassword = document.getElementById('newPass').value;
      const confirmPassword = document.getElementById('confirmPass').value;
      const msgBox = document.getElementById('changePassMsg');
      const btn = document.getElementById('changePassBtn');

      msgBox.style.display = 'none';

      if (newPassword !== confirmPassword) {
        msgBox.innerText = 'नया पासवर्ड मेल नहीं खाता (New passwords do not match).';
        msgBox.style.color = 'var(--danger)';
        msgBox.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'अपडेट हो रहा है...';

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          msgBox.innerText = '✅ ' + (data.message || 'Password updated successfully!');
          msgBox.style.color = 'var(--success)';
          msgBox.style.display = 'block';
          document.getElementById('changePasswordForm').reset();
        } else {
          msgBox.innerText = '❌ ' + (data.error || 'Failed to update password');
          msgBox.style.color = 'var(--danger)';
          msgBox.style.display = 'block';
        }
      } catch (err) {
        msgBox.innerText = 'Network error: ' + err.message;
        msgBox.style.color = 'var(--danger)';
        msgBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerText = 'पासवर्ड अपडेट करें (Update Password)';
      }
    }

    async function handleUpdateEmail(e) {
      e.preventDefault();
      const email = (document.getElementById('adminRecoveryEmail').value || '').trim();
      const msg = document.getElementById('updateEmailMsg');
      const btn = document.getElementById('updateEmailBtn');
      msg.style.display = 'none';
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/update-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          msg.style.color = 'var(--success)';
          msg.innerText = '✅ ' + (data.message || 'Recovery email saved successfully.');
        } else {
          msg.style.color = 'var(--danger)';
          msg.innerText = '❌ ' + (data.error || 'Failed to update email.');
        }
      } catch (err) {
        msg.style.color = 'var(--danger)';
        msg.innerText = '❌ Network error: ' + err.message;
      } finally {
        msg.style.display = 'block';
        btn.disabled = false;
      }
    }

    async function handleLogout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    }

    // Tab Navigation
    function switchTab(tab) {
      document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

      if (tab === 'overview') {
        document.getElementById('view-overview')?.classList.add('active');
        document.getElementById('btn-overview')?.classList.add('active');
      } else if (tab === 'analytics') {
        document.getElementById('view-analytics')?.classList.add('active');
        document.getElementById('btn-analytics')?.classList.add('active');
        loadAnalyticsData();
      } else if (tab === 'all-writings') {
        document.getElementById('view-list')?.classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'All Writings';
        document.getElementById('statusFilter').value = 'all';
        document.getElementById('btn-all-writings')?.classList.add('active');
        loadWritings();
      } else if (tab === 'published') {
        document.getElementById('view-list')?.classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'Published Writings';
        document.getElementById('statusFilter').value = 'Published';
        document.getElementById('btn-published')?.classList.add('active');
        loadWritings();
      } else if (tab === 'drafts') {
        document.getElementById('view-list')?.classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'Drafts';
        document.getElementById('statusFilter').value = 'Draft';
        document.getElementById('btn-drafts')?.classList.add('active');
        loadWritings();
      } else if (tab === 'editor') {
        document.getElementById('view-editor')?.classList.add('active');
        document.getElementById('btn-new')?.classList.add('active');
      } else if (tab === 'subscribers') {
        document.getElementById('view-subscribers')?.classList.add('active');
        document.getElementById('btn-subscribers')?.classList.add('active');
        loadSubscribers();
      } else if (tab === 'settings') {
        document.getElementById('view-settings')?.classList.add('active');
        document.getElementById('btn-settings')?.classList.add('active');
      }

      // History navigation synchronization
      try {
        if (tab === 'analytics') {
          if (window.location.pathname !== '/admin/analytics') {
            history.pushState({ tab: 'analytics' }, '', '/admin/analytics');
          }
        } else {
          if (window.location.pathname === '/admin/analytics') {
            history.pushState({ tab }, '', '/admin');
          }
        }
      } catch (_) {}
    }

    window.addEventListener('popstate', (e) => {
      if (window.location.pathname === '/admin/analytics' || (e.state && e.state.tab === 'analytics')) {
        switchTab('analytics');
      } else {
        switchTab('overview');
      }
    });

    function openNewWriting() {
      document.getElementById('editWritingId').value = '';
      document.getElementById('editorTitle').innerText = 'Add New Writing';
      document.getElementById('writingTitle').value = '';
      document.getElementById('writingSubtitle').value = '';
      document.getElementById('writingSlug').value = '';
      document.getElementById('writingType').value = 'Poetry';
      document.getElementById('writingTags').value = '';
      document.getElementById('writingStatus').value = 'Published';
      document.getElementById('writingContent').value = '';
      updateStats();
      switchTab('editor');
    }

    let debounceTimer;
    function debounceLoadWritings() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadWritings, 250);
    }

    async function loadWritings() {
      const q = document.getElementById('searchInput')?.value || '';
      const type = document.getElementById('typeFilter')?.value || 'all';
      const status = document.getElementById('statusFilter')?.value || 'all';

      try {
        const url = new URL('/api/writings', window.location.origin);
        if (q) url.searchParams.set('q', q);
        if (type !== 'all') url.searchParams.set('type', type);
        if (status !== 'all') url.searchParams.set('status', status);

        const res = await fetch(url);
        if (res.status === 401) {
          showLogin();
          return;
        }

        const data = await res.json();
        if (data.error && data.error.includes('D1 database')) {
          document.getElementById('dbAlert').innerHTML = '⚠️ <strong>D1 Database required:</strong> ' + data.error;
          document.getElementById('dbAlert').style.display = 'block';
        }

        currentWritings = data.writings || [];
        updateCounters(data.stats || {});
        renderTable(currentWritings);
        renderRecent(currentWritings.slice(0, 5));
      } catch (err) {
        console.error('Failed to load writings:', err);
      }
    }

    function updateCounters(stats) {
      document.getElementById('statTotal').innerText = stats.total || 0;
      document.getElementById('statPublished').innerText = stats.published || 0;
      document.getElementById('statDrafts').innerText = stats.drafts || 0;
      document.getElementById('countAll').innerText = stats.total || 0;
      document.getElementById('countPub').innerText = stats.published || 0;
      document.getElementById('countDraft').innerText = stats.drafts || 0;
    }

    function renderTable(items) {
      const tbody = document.getElementById('writingsTableBody');
      if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">कोई रचना नहीं मिली (No writings found).</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(item => \`
        <tr>
          <td>
            <span class="table-title">\${escape(item.title)}</span>
            \${item.subtitle ? \`<span class="table-subtitle">\${escape(item.subtitle)}</span>\` : ''}
          </td>
          <td><span class="type-tag">\${escape(formatTypeDisplay(item.content_type))}</span></td>
          <td>
            <span class="status-pill \${item.status === 'Published' ? 'published' : 'draft'}">
              \${item.status === 'Published' ? '✓ Published (लाइव)' : '📁 Draft (निजी)'}
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">
            \${new Date(item.updated_at).toLocaleDateString()}
          </td>
          <td>
            <div class="row-actions" style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <button class="icon-btn" onclick="editWriting('\${item.id}')" title="Edit Writing">✏️</button>
              \${item.status === 'Published' ? \`
                <a href="/poems/\${encodeURIComponent(item.slug)}" target="_blank" class="btn btn-outline" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; text-decoration: none;" title="View Live on Website">👁️ View ↗</a>
                <button class="icon-btn" onclick="toggleStatus('\${item.id}', 'Draft')" title="Move to Drafts">📁</button>
              \` : \`
                <button class="btn btn-accent" onclick="toggleStatus('\${item.id}', 'Published')" style="padding: 0.25rem 0.65rem; font-size: 0.78rem; font-weight: 600;" title="Publish Live to Website immediately">🚀 Publish Live</button>
              \`}
              <button class="icon-btn danger" onclick="deleteWriting('\${item.id}', '\${escape(item.title)}')" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }

    function renderRecent(items) {
      const tbody = document.getElementById('recentTableBody');
      if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">अभी कोई रचना नहीं है।</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(item => \`
        <tr>
          <td><span class="table-title">\${escape(item.title)}</span></td>
          <td><span class="type-tag">\${escape(formatTypeDisplay(item.content_type))}</span></td>
          <td>
            <span class="status-pill \${item.status === 'Published' ? 'published' : 'draft'}">
              \${item.status === 'Published' ? '✓ Published (लाइव)' : '📁 Draft'}
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">\${new Date(item.updated_at).toLocaleDateString()}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <button class="icon-btn" onclick="editWriting('\${item.id}')" title="Edit">✏️</button>
              \${item.status === 'Published' ? \`
                <a href="/poems/\${encodeURIComponent(item.slug)}" target="_blank" class="btn btn-outline" style="padding: 0.2rem 0.55rem; font-size: 0.75rem; text-decoration: none;" title="View Live">👁️ View ↗</a>
              \` : \`
                <button class="btn btn-accent" onclick="toggleStatus('\${item.id}', 'Published')" style="padding: 0.2rem 0.55rem; font-size: 0.75rem; font-weight: 600;" title="Publish Live to Website">🚀 Publish Live</button>
              \`}
            </div>
          </td>
        </tr>
      \`).join('');
    }

    async function editWriting(id) {
      try {
        const res = await fetch('/api/writings/' + id);
        const data = await res.json();
        if (data.writing) {
          const w = data.writing;
          document.getElementById('editWritingId').value = w.id;
          document.getElementById('editorTitle').innerText = 'Edit Writing: ' + w.title;
          document.getElementById('writingTitle').value = w.title || '';
          document.getElementById('writingSubtitle').value = w.subtitle || '';
          document.getElementById('writingSlug').value = w.slug || '';
          document.getElementById('writingType').value = w.content_type || 'Poetry';
          document.getElementById('writingTags').value = w.tags || '';
          document.getElementById('writingStatus').value = w.status || 'Published';
          document.getElementById('writingContent').value = w.content || '';
          updateStats();
          switchTab('editor');
        }
      } catch (err) {
        alert('Failed to load writing for editing: ' + err.message);
      }
    }

    async function saveWritingWithStatus(forcedStatus) {
      if (forcedStatus) {
        document.getElementById('writingStatus').value = forcedStatus;
      }
      return handleSaveWriting();
    }

    async function handleSaveWriting(e) {
      if (e && e.preventDefault) e.preventDefault();

      const title = document.getElementById('writingTitle').value.trim();
      const content = document.getElementById('writingContent').value.trim();
      const status = document.getElementById('writingStatus').value;

      if (!title) {
        alert('कृपया शीर्षक (Title) दर्ज करें।');
        document.getElementById('writingTitle').focus();
        return;
      }
      if (!content) {
        alert('कृपया रचना पाठ (Content) दर्ज करें।');
        document.getElementById('writingContent').focus();
        return;
      }

      const id = document.getElementById('editWritingId').value;
      const isNew = !id;

      const payload = {
        title,
        subtitle: document.getElementById('writingSubtitle').value.trim(),
        slug: document.getElementById('writingSlug').value.trim(),
        content_type: document.getElementById('writingType').value,
        tags: document.getElementById('writingTags').value.trim(),
        status,
        content
      };

      const savePublishBtn = document.getElementById('savePublishBtn');
      const saveDraftBtn = document.getElementById('saveDraftBtn');
      if (savePublishBtn) savePublishBtn.disabled = true;
      if (saveDraftBtn) saveDraftBtn.disabled = true;

      try {
        const url = isNew ? '/api/writings' : '/api/writings/' + id;
        const method = isNew ? 'POST' : 'PUT';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const itemSlug = data.writing?.slug || payload.slug;
          if (status === 'Published') {
            alert(\`🎉 सफलता! आपकी रचना वेबसाइट पर प्रकाशित (Publish) हो गई है!\\n(Published live on website!)\\n\\nवेबसाइट पर देखने के लिए:\\nhttps://ashabd.in/poems/\${encodeURIComponent(itemSlug)}\`);
          } else {
            alert(\`📁 रचना ड्राफ्ट (Draft) के रूप में सुरक्षित हो गई है।\\n(Saved as private draft.)\\n\\n⚠️ ध्यान दें: यह वेबसाइट पर तब तक नहीं दिखेगी जब तक आप इसे "Publish Live" नहीं करते।\`);
          }
          await loadWritings();
          switchTab(status === 'Published' ? 'published' : 'drafts');
        } else {
          alert('❌ सुरक्षित करने में त्रुटि: ' + (data.error || 'Failed to save'));
        }
      } catch (err) {
        alert('Save error: ' + err.message);
      } finally {
        if (savePublishBtn) savePublishBtn.disabled = false;
        if (saveDraftBtn) saveDraftBtn.disabled = false;
      }
    }

    async function toggleStatus(id, newStatus) {
      try {
        const res = await fetch(\`/api/writings/\${id}/status\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (newStatus === 'Published') {
            alert('🎉 रचना सफलतापूर्वक प्रकाशित कर दी गई है!\\nअब यह ashabd.in/poems पर लाइव दिखाई देगी।');
          } else {
            alert('📁 रचना ड्राफ्ट में बदल दी गई है (अब यह वेबसाइट पर छिपी रहेगी)।');
          }
          await loadWritings();
        } else {
          alert('Status update failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        alert('Status update failed: ' + e.message);
      }
    }

    async function deleteWriting(id, title) {
      if (!confirm(\`क्या आप निश्चित रूप से "\${title}" को स्थायी रूप से हटाना चाहते हैं?\\n(Are you sure you want to permanently delete this writing?)\`)) {
        return;
      }
      try {
        const res = await fetch('/api/writings/' + id, { method: 'DELETE' });
        if (res.ok) {
          loadWritings();
        } else {
          alert('Failed to delete writing.');
        }
      } catch (e) {
        alert('Delete failed: ' + e.message);
      }
    }

    // Auto-generate slug from title
    function autoGenerateSlug() {
      const editId = document.getElementById('editWritingId').value;
      if (editId) return; // Do not overwrite existing slug when editing
      const title = document.getElementById('writingTitle').value;
      let slug = title.toLowerCase().trim()
        .replace(/[\\s\\t\\n]+/g, '-')
        .replace(/[^\\p{L}\\p{N}\\-_]/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      document.getElementById('writingSlug').value = slug;
    }

    function updateStats() {
      const text = document.getElementById('writingContent').value || '';
      const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
      const lines = text ? text.split('\\n').length : 0;
      document.getElementById('wordCount').innerText = words + ' words';
      document.getElementById('lineCount').innerText = lines + ' lines';
    }

    // ==================== FILE IMPORT (.txt, .md, .docx) ====================
    async function handleFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      await processUploadedFile(file);
    }

    // Drag and drop handlers
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        await processUploadedFile(e.dataTransfer.files[0]);
      }
    });

    async function processUploadedFile(file) {
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith('.txt') || name.endsWith('.md')) {
          const text = await file.text();
          populateImportedContent(file.name, text);
        } else if (name.endsWith('.docx')) {
          const text = await extractDocxText(file);
          populateImportedContent(file.name, text);
        } else {
          alert('असमर्थित फ़ाइल प्रारूप (Unsupported file format). Please upload a .txt, .md, or .docx file.');
        }
      } catch (err) {
        alert('File import failed: ' + err.message);
      }
    }

    function populateImportedContent(fileName, text) {
      if (!document.getElementById('writingTitle').value) {
        const cleanName = fileName.replace(/\\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        document.getElementById('writingTitle').value = cleanName;
        autoGenerateSlug();
      }
      document.getElementById('writingContent').value = text;
      updateStats();
      alert('फ़ाइल सामग्री आयातित कर दी गई (File content imported successfully!)');
    }

    /**
     * Browser-based docx XML text extraction using DecompressionStream
     */
    async function extractDocxText(file) {
      const buffer = await file.arrayBuffer();
      const zip = new Uint8Array(buffer);

      const xmlData = await findAndDecompressZipEntry(zip, 'word/document.xml');
      if (!xmlData) {
        throw new Error('word/document.xml not found inside .docx archive.');
      }

      const xmlText = new TextDecoder('utf-8').decode(xmlData);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const paragraphs = xmlDoc.getElementsByTagName('w:p');
      const lines = [];

      for (let p of paragraphs) {
        const texts = p.getElementsByTagName('w:t');
        let line = '';
        for (let t of texts) {
          line += t.textContent;
        }
        lines.push(line);
      }
      return lines.join('\\n');
    }

    async function findAndDecompressZipEntry(bytes, targetFilename) {
      let offset = 0;
      while (offset < bytes.length - 30) {
        if (bytes[offset] === 0x50 && bytes[offset+1] === 0x4b && bytes[offset+2] === 0x03 && bytes[offset+3] === 0x04) {
          const compression = bytes[offset + 8] | (bytes[offset + 9] << 8);
          const compressedSize = (bytes[offset + 18]) | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
          const fnLen = bytes[offset + 26] | (bytes[offset + 27] << 8);
          const extraLen = bytes[offset + 28] | (bytes[offset + 29] << 8);

          const fnBytes = bytes.slice(offset + 30, offset + 30 + fnLen);
          const fn = new TextDecoder().decode(fnBytes);

          const dataStart = offset + 30 + fnLen + extraLen;
          const dataEnd = dataStart + compressedSize;

          if (fn === targetFilename) {
            const raw = bytes.slice(dataStart, dataEnd);
            if (compression === 0) {
              return raw;
            } else if (compression === 8) {
              const ds = new DecompressionStream('deflate-raw');
              const res = await new Response(raw).body.pipeThrough(ds);
              return new Uint8Array(await new Response(res).arrayBuffer());
            }
          }
          offset = dataEnd;
        } else {
          offset++;
        }
      }
      return null;
    }

    // ==================== PREVIEW MODAL ====================
    function openPreview() {
      const title = document.getElementById('writingTitle').value || 'शीर्षक';
      const subtitle = document.getElementById('writingSubtitle').value || '';
      const type = document.getElementById('writingType').value || 'Poetry';
      const content = document.getElementById('writingContent').value || '(रचना पाठ खाली है)';

      document.getElementById('prevTitle').innerText = title;
      document.getElementById('prevSubtitle').innerText = subtitle;
      document.getElementById('prevType').innerText = type;
      document.getElementById('prevContent').innerText = content;

      document.getElementById('previewModal').classList.add('active');
    }

    function closePreview() {
      document.getElementById('previewModal').classList.remove('active');
    }

    function publishFromPreview() {
      closePreview();
      document.getElementById('writingStatus').value = 'Published';
      document.getElementById('writingForm').requestSubmit();
    }

    // ==================== BACKUP EXPORT ====================
    async function exportBackup() {
      try {
        const res = await fetch('/api/writings');
        const data = await res.json();
        const json = JSON.stringify(data.writings || [], null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ashabd-writings-backup-' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Export failed: ' + e.message);
      }
    }

    const TYPE_HINDI_MAP = {
      'Poetry': 'कविता',
      'Article': 'लेख',
      'Story': 'कहानी',
      'Essay': 'निबंध',
      'Diary': 'डायरी',
      'Other': 'अन्य'
    };

    function formatTypeDisplay(t) {
      return TYPE_HINDI_MAP[t] || t || 'कविता';
    }

    function escape(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ==================== WEBSITE ANALYTICS ENGINE ====================
    let currentAnalyticsData = null;
    let currentPeriod = '7d';
    let popularFilter = 'all';
    let sortField = 'views';
    let sortDesc = true;
    let trafficTrendChartInstance = null;
    let visitorRatioChartInstance = null;

    function setAnalyticsPeriod(period) {
      currentPeriod = period;
      document.querySelectorAll('.period-btn').forEach(btn => {
        if (btn.dataset.period === period) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      const customBox = document.getElementById('customDateRangeBox');
      if (period === 'custom') {
        if (customBox) customBox.style.display = 'flex';
      } else {
        if (customBox) customBox.style.display = 'none';
        loadAnalyticsData();
      }
    }

    function toggleCustomDateInputs() {
      const customBox = document.getElementById('customDateRangeBox');
      if (!customBox) return;
      if (customBox.style.display === 'flex') {
        customBox.style.display = 'none';
      } else {
        customBox.style.display = 'flex';
        setAnalyticsPeriod('custom');
      }
    }

    function applyCustomDateRange() {
      const s = document.getElementById('customStartDate')?.value;
      const e = document.getElementById('customEndDate')?.value;
      if (!s || !e) {
        alert('Please select both start and end dates.');
        return;
      }
      if (s > e) {
        alert('Start date cannot be after end date.');
        return;
      }
      loadAnalyticsData();
    }

    function toggleExportMenu() {
      const menu = document.getElementById('exportMenu');
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
    }

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('exportMenu');
      if (menu && menu.style.display === 'block') {
        if (!e.target.closest('.dropdown-wrap')) {
          menu.style.display = 'none';
        }
      }
    });

    async function triggerTestPing() {
      try {
        const res = await fetch('/api/analytics/test-ping', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          alert('🧪 Test visit ping recorded successfully!\\n\\nRefreshing analytics data...');
          await loadAnalyticsData();
        } else {
          alert('Test ping failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Test ping error: ' + err.message);
      }
    }

    async function refreshAnalytics() {
      const icon = document.getElementById('refreshIcon');
      if (icon) icon.style.display = 'inline-block';
      await loadAnalyticsData();
    }

    async function loadAnalyticsData() {
      const refreshBtn = document.getElementById('btnRefreshAnalytics');
      if (refreshBtn) refreshBtn.disabled = true;

      try {
        let url = \`/api/analytics/data?period=\${encodeURIComponent(currentPeriod)}\`;
        if (currentPeriod === 'custom') {
          const s = document.getElementById('customStartDate')?.value;
          const e = document.getElementById('customEndDate')?.value;
          if (s && e) {
            url += \`&startDate=\${encodeURIComponent(s)}&endDate=\${encodeURIComponent(e)}\`;
          }
        }

        const res = await fetch(url);
        if (res.status === 401) {
          showLogin();
          return;
        }

        const data = await res.json();
        if (data.error) {
          console.error('Analytics load error:', data.error);
          return;
        }

        currentAnalyticsData = data;
        renderAnalyticsUI(data);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        if (refreshBtn) refreshBtn.disabled = false;
      }
    }

    function renderAnalyticsUI(data) {
      if (!data) return;

      const sum = data.summary || {};

      // 1. Overview Summary Cards
      const elTot = document.getElementById('statTotalVisitors');
      if (elTot) elTot.innerText = (sum.total_visitors || 0).toLocaleString();

      const elUniq = document.getElementById('statUniqueVisitors');
      if (elUniq) elUniq.innerText = (sum.unique_visitors || 0).toLocaleString();

      const elPv = document.getElementById('statTotalPageViews');
      if (elPv) elPv.innerText = (sum.page_views || 0).toLocaleString();
      
      const activeOnline = sum.active_online || 0;
      const elActive1 = document.getElementById('statActiveOnline');
      const elActive2 = document.getElementById('statActiveOnlineCard');
      if (elActive1) elActive1.innerText = activeOnline;
      if (elActive2) elActive2.innerText = activeOnline;

      const elPoems = document.getElementById('statTotalPoems');
      if (elPoems) elPoems.innerText = (sum.total_published_poems || 0).toLocaleString();

      const elArts = document.getElementById('statTotalArticles');
      if (elArts) elArts.innerText = (sum.total_published_articles || 0).toLocaleString();

      // Growth tags
      const vGrowth = sum.growth?.visitors_pct || 0;
      const pGrowth = sum.growth?.pageviews_pct || 0;
      const elVGrowth = document.getElementById('statVisitorsGrowth');
      const elPGrowth = document.getElementById('statPageviewsGrowth');

      if (elVGrowth) {
        elVGrowth.innerHTML = vGrowth !== 0
          ? \`<span class="stat-card-badge \${vGrowth > 0 ? 'badge-up' : 'badge-down'}">\${vGrowth > 0 ? '▲ +' : '▼ '}\${vGrowth}%</span> vs. previous period\`
          : \`Steady baseline\`;
      }
      if (elPGrowth) {
        elPGrowth.innerHTML = pGrowth !== 0
          ? \`<span class="stat-card-badge \${pGrowth > 0 ? 'badge-up' : 'badge-down'}">\${pGrowth > 0 ? '▲ +' : '▼ '}\${pGrowth}%</span> vs. previous period\`
          : \`Total page views recorded\`;
      }

      // 2. Multi-Period Interval Strip
      const intervals = sum.intervals || {};
      const formatInterval = (obj) => {
        const views = (obj?.views || 0).toLocaleString();
        const visitors = (obj?.visitors || 0).toLocaleString();
        return { views: \`\${views} Views\`, visitors: \`\${visitors} Visitors\` };
      };

      const tI = formatInterval(intervals.today);
      const elTv = document.getElementById('stripTodayViews');
      const elTu = document.getElementById('stripTodayVisitors');
      if (elTv) elTv.innerText = tI.views;
      if (elTu) elTu.innerText = tI.visitors;

      const sI = formatInterval(intervals.last_7d);
      const elSv = document.getElementById('strip7dViews');
      const elSu = document.getElementById('strip7dVisitors');
      if (elSv) elSv.innerText = sI.views;
      if (elSu) elSu.innerText = sI.visitors;

      const mI = formatInterval(intervals.last_30d);
      const elMv = document.getElementById('strip30dViews');
      const elMu = document.getElementById('strip30dVisitors');
      if (elMv) elMv.innerText = mI.views;
      if (elMu) elMu.innerText = mI.visitors;

      const aI = formatInterval(intervals.all_time);
      const elAv = document.getElementById('stripAllViews');
      const elAu = document.getElementById('stripAllVisitors');
      if (elAv) elAv.innerText = aI.views;
      if (elAu) elAu.innerText = aI.visitors;

      // 3. Render Charts
      renderTrafficChart(data.chart_points || []);
      renderRatioChart(data.demographics?.visitors_ratio || {});

      // 4. Popular Content Table
      renderPopularContentTable();

      // 5. Traffic Sources Breakdown
      renderTrafficSources(data.traffic_sources || {});

      // 6. Demographics
      renderDemographics(data.demographics || {});

      // 7. Poetry Engagement
      renderPoetryEngagement(data.poetry_engagement || {});

      // 8. Performance & Errors
      renderPerformanceMetrics(data.performance || {});
    }

    // ==================== TRAFFIC CHARTS ====================
    function renderTrafficChart(points) {
      const ctx = document.getElementById('trafficTrendChart');
      if (!ctx || typeof Chart === 'undefined') return;

      if (trafficTrendChartInstance) {
        trafficTrendChartInstance.destroy();
      }

      const labels = points.map(p => p.label);
      const pageviews = points.map(p => p.pageviews);
      const visitors = points.map(p => p.visitors);
      const reads = points.map(p => p.reads);

      trafficTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Page Views',
              data: pageviews,
              borderColor: '#d4a373',
              backgroundColor: 'rgba(212, 163, 115, 0.14)',
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointBackgroundColor: '#d4a373',
              pointRadius: points.length > 30 ? 0 : 3,
              pointHoverRadius: 5
            },
            {
              label: 'Unique Visitors',
              data: visitors,
              borderColor: '#3fb950',
              backgroundColor: 'rgba(63, 185, 80, 0.08)',
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointBackgroundColor: '#3fb950',
              pointRadius: points.length > 30 ? 0 : 3,
              pointHoverRadius: 5
            },
            {
              label: 'Verified Reads',
              data: reads,
              borderColor: '#58a6ff',
              borderDash: [5, 5],
              fill: false,
              tension: 0.35,
              borderWidth: 2,
              pointBackgroundColor: '#58a6ff',
              pointRadius: points.length > 30 ? 0 : 3,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: '#c9d1d9',
                boxWidth: 12,
                font: { size: 12 }
              }
            },
            tooltip: {
              backgroundColor: '#161b22',
              titleColor: '#f0f6fc',
              bodyColor: '#c9d1d9',
              borderColor: '#30363d',
              borderWidth: 1,
              padding: 10
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8b949e', maxRotation: 45, font: { size: 11 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8b949e', precision: 0, font: { size: 11 } }
            }
          }
        }
      });
    }

    function renderRatioChart(ratio) {
      const ctx = document.getElementById('visitorRatioChart');
      if (!ctx || typeof Chart === 'undefined') return;

      if (visitorRatioChartInstance) {
        visitorRatioChartInstance.destroy();
      }

      const newV = ratio.new_visitors || 0;
      const retV = ratio.returning_visitors || 0;

      const lblNew = document.getElementById('lblNewVisitors');
      const lblRet = document.getElementById('lblReturningVisitors');
      if (lblNew) lblNew.innerText = newV.toLocaleString();
      if (lblRet) lblRet.innerText = retV.toLocaleString();

      const total = newV + retV;
      const dataValues = total > 0 ? [newV, retV] : [1, 0];
      const backgroundColors = total > 0 ? ['#d4a373', '#3fb950'] : ['rgba(255,255,255,0.1)', 'transparent'];

      visitorRatioChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['New Visitors', 'Returning Visitors'],
          datasets: [{
            data: dataValues,
            backgroundColor: backgroundColors,
            borderColor: '#181b21',
            borderWidth: 3,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#161b22',
              titleColor: '#f0f6fc',
              bodyColor: '#c9d1d9',
              borderColor: '#30363d',
              borderWidth: 1,
              callbacks: {
                label: function(item) {
                  if (total === 0) return ' No data yet';
                  const val = item.raw || 0;
                  const pct = Math.round((val / total) * 100);
                  return \` \${item.label}: \${val} (\${pct}%)\`;
                }
              }
            }
          }
        }
      });
    }

    // ==================== POPULAR CONTENT TABLE ====================
    function filterContentTable(filter) {
      popularFilter = filter;
      document.querySelectorAll('.filter-tab-btn').forEach(btn => {
        if (btn.dataset.filter === filter) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      renderPopularContentTable();
    }

    function sortPopularContent(field) {
      if (sortField === field) {
        sortDesc = !sortDesc;
      } else {
        sortField = field;
        sortDesc = true;
      }
      renderPopularContentTable();
    }

    function renderPopularContentTable() {
      const tbody = document.getElementById('popularContentTableBody');
      if (!tbody || !currentAnalyticsData) return;

      let list = (currentAnalyticsData.popular_content || []).slice();

      // Filter
      if (popularFilter === 'poems') {
        list = list.filter(item => item.is_poem);
      } else if (popularFilter === 'articles') {
        list = list.filter(item => !item.is_poem && item.path !== '/' && item.path !== '/poems' && item.path !== '/writings');
      } else if (popularFilter === 'pages') {
        list = list.filter(item => item.path === '/' || item.path === '/poems' || item.path === '/writings' || !item.is_poem);
      }

      // Sort
      list.sort((a, b) => {
        const valA = a[sortField] || 0;
        const valB = b[sortField] || 0;
        return sortDesc ? (valB - valA) : (valA - valB);
      });

      if (list.length === 0) {
        tbody.innerHTML = \`<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No content visits recorded in this period.</td></tr>\`;
        return;
      }

      tbody.innerHTML = list.map((item, idx) => {
        const rankClass = idx === 0 ? 'top-1' : (idx === 1 ? 'top-2' : (idx === 2 ? 'top-3' : ''));
        const safePath = escape(item.path);
        const safeTitle = escape(item.title);
        return \`
          <tr>
            <td><span class="rank-badge \${rankClass}">\${idx + 1}</span></td>
            <td>
              <strong style="color: var(--text-main); font-size: 0.9rem;">\${safeTitle}</strong>
              <div style="font-size: 0.76rem; margin-top: 2px;">
                <a href="\${safePath}" target="_blank" style="color: #58a6ff; text-decoration: none;">\${safePath} ↗</a>
              </div>
            </td>
            <td><span class="type-tag">\${escape(formatTypeDisplay(item.content_type))}</span></td>
            <td style="text-align: right; font-weight: 600;">\${(item.views || 0).toLocaleString()}</td>
            <td style="text-align: right; color: var(--accent); font-weight: 600;">\${(item.reads || 0).toLocaleString()}</td>
            <td style="text-align: right;">
              <span class="status-pill published" style="font-size: 0.74rem; padding: 0.15rem 0.5rem;">\${item.read_rate}%</span>
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                <div class="progress-bar-wrap" style="margin: 0; flex: 1;">
                  <div class="progress-bar-fill" style="width: \${Math.min(100, item.share_pct)}%;"></div>
                </div>
                <span style="font-size: 0.72rem; color: var(--text-muted); min-width: 32px; text-align: right;">\${item.share_pct}%</span>
              </div>
            </td>
            <td style="text-align: center;">
              <button class="btn btn-outline btn-sm" style="padding: 0.2rem 0.55rem; font-size: 0.75rem;" onclick="inspectPoemDetails('\${safePath}')" title="Detailed Analysis">
                Details ℹ️
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    // ==================== POEM DETAIL MODAL ====================
    function inspectPoemDetails(path) {
      if (!currentAnalyticsData) return;
      const item = (currentAnalyticsData.popular_content || []).find(p => p.path === path);
      if (!item) return;

      const elType = document.getElementById('pdmType');
      if (elType) elType.innerText = formatTypeDisplay(item.content_type);
      
      const elTitle = document.getElementById('pdmTitle');
      if (elTitle) elTitle.innerText = item.title;
      
      const link = document.getElementById('pdmUrl');
      if (link) {
        link.href = item.path;
        link.innerText = item.path + ' ↗';
      }

      const elViews = document.getElementById('pdmViews');
      if (elViews) elViews.innerText = (item.views || 0).toLocaleString();

      const elReads = document.getElementById('pdmReads');
      if (elReads) elReads.innerText = (item.reads || 0).toLocaleString();

      const elRate = document.getElementById('pdmRate');
      if (elRate) elRate.innerText = \`\${item.read_rate || 0}%\`;

      const avgDur = item.avg_duration || 0;
      const durStr = avgDur >= 60 ? \`\${Math.floor(avgDur/60)}m \${avgDur%60}s\` : \`\${avgDur}s\`;
      const elDur = document.getElementById('pdmAvgDuration');
      if (elDur) elDur.innerText = durStr;

      const elShare = document.getElementById('pdmShare');
      if (elShare) elShare.innerText = \`\${item.share_pct || 0}%\`;

      const liveBtn = document.getElementById('pdmLiveBtn');
      if (liveBtn) liveBtn.href = item.path;

      const modal = document.getElementById('poemDetailModal');
      if (modal) modal.classList.add('active');
    }

    function closePoemDetailModal() {
      const modal = document.getElementById('poemDetailModal');
      if (modal) modal.classList.remove('active');
    }

    // ==================== TRAFFIC SOURCES ====================
    function renderTrafficSources(sources) {
      const container = document.getElementById('sourcesContainer');
      if (!container) return;

      const total = sources.total || 0;
      const counts = sources.counts || {};

      const sourceList = [
        { key: 'direct', label: 'Direct Traffic / Bookmarks', count: counts.direct || 0, icon: '🔗' },
        { key: 'google', label: 'Google Search', count: counts.google || 0, icon: '🔍' },
        { key: 'instagram', label: 'Instagram (@ashabd0)', count: counts.instagram || 0, icon: '📸' },
        { key: 'twitter', label: 'X / Twitter (@ashabd0)', count: counts.twitter || 0, icon: '🐦' },
        { key: 'search', label: 'Search Engines (Bing, DDG, Yahoo)', count: counts.search || 0, icon: '🔎' },
        { key: 'social', label: 'Social Media (FB, LinkedIn, Reddit, YT)', count: counts.social || 0, icon: '👥' },
        { key: 'other', label: 'Other Referrers', count: counts.other || 0, icon: '🌐' }
      ];

      if (total === 0) {
        container.innerHTML = \`<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem;">No traffic sources recorded in this period.</p>\`;
        return;
      }

      container.innerHTML = sourceList.map(s => {
        const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
        return \`
          <div class="progress-row">
            <span style="display: flex; align-items: center; gap: 0.4rem; min-width: 190px;">
              <span>\${s.icon}</span>
              <span>\${escape(s.label)}</span>
            </span>
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width: \${pct}%;"></div>
            </div>
            <span style="font-weight: 600; min-width: 50px; text-align: right;">\${s.count.toLocaleString()}</span>
            <span style="color: var(--text-muted); font-size: 0.75rem; min-width: 38px; text-align: right;">\${pct}%</span>
          </div>
        \`;
      }).join('');
    }

    // ==================== DEMOGRAPHICS ====================
    function renderDemographics(demo) {
      // Countries
      const cContainer = document.getElementById('countriesContainer');
      if (cContainer) {
        const countries = demo.countries || [];
        if (countries.length === 0) {
          cContainer.innerHTML = \`<div style="font-size: 0.82rem; color: var(--text-muted);">No country data available.</div>\`;
        } else {
          cContainer.innerHTML = countries.map(c => \`
            <div class="progress-row" style="margin-bottom: 0.5rem;">
              <span style="display: flex; align-items: center; gap: 0.4rem; min-width: 140px;">
                <span>\${c.flag}</span>
                <span>\${escape(c.name)}</span>
              </span>
              <div class="progress-bar-wrap">
                <div class="progress-bar-fill" style="width: \${c.pct}%; background: #3fb950;"></div>
              </div>
              <span style="font-weight: 600; min-width: 40px; text-align: right;">\${c.visitors}</span>
              <span style="color: var(--text-muted); font-size: 0.75rem; min-width: 34px; text-align: right;">\${c.pct}%</span>
            </div>
          \`).join('');
        }
      }

      // Devices Segmented Bar
      const dContainer = document.getElementById('devicesContainer');
      if (dContainer) {
        const devices = demo.devices || [];
        const totalDev = devices.reduce((acc, d) => acc + d.visitors, 0);

        let mobileCount = 0, desktopCount = 0, tabletCount = 0;
        for (const d of devices) {
          if (d.device_type === 'mobile') mobileCount += d.visitors;
          else if (d.device_type === 'desktop') desktopCount += d.visitors;
          else if (d.device_type === 'tablet') tabletCount += d.visitors;
        }

        const mPct = totalDev > 0 ? Math.round((mobileCount / totalDev) * 100) : 0;
        const dPct = totalDev > 0 ? Math.round((desktopCount / totalDev) * 100) : 0;
        const tPct = totalDev > 0 ? (100 - mPct - dPct) : 0;

        dContainer.innerHTML = \`
          <div class="device-bar-wrap">
            <div class="device-bar-segment" style="width: \${mPct}%; background: #d4a373;" title="Mobile: \${mPct}%"></div>
            <div class="device-bar-segment" style="width: \${dPct}%; background: #388bfd;" title="Desktop: \${dPct}%"></div>
            <div class="device-bar-segment" style="width: \${tPct}%; background: #a371f7;" title="Tablet: \${tPct}%"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
            <span><span style="color: #d4a373;">●</span> Mobile: <strong>\${mPct}%</strong> (\${mobileCount})</span>
            <span><span style="color: #388bfd;">●</span> Desktop: <strong>\${dPct}%</strong> (\${desktopCount})</span>
            <span><span style="color: #a371f7;">●</span> Tablet: <strong>\${tPct}%</strong> (\${tabletCount})</span>
          </div>
        \`;
      }

      // Browsers
      const bContainer = document.getElementById('browsersContainer');
      if (bContainer) {
        const browsers = demo.browsers || [];
        if (browsers.length === 0) {
          bContainer.innerHTML = \`<span style="color: var(--text-muted);">No data available</span>\`;
        } else {
          bContainer.innerHTML = browsers.map(b => \`
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
              <span>\${escape(b.browser)}</span>
              <strong>\${b.visitors}</strong>
            </div>
          \`).join('');
        }
      }

      // OS
      const oContainer = document.getElementById('osContainer');
      if (oContainer) {
        const osList = demo.os || [];
        if (osList.length === 0) {
          oContainer.innerHTML = \`<span style="color: var(--text-muted);">No data available</span>\`;
        } else {
          oContainer.innerHTML = osList.map(o => \`
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.35rem;">
              <span>\${escape(o.os)}</span>
              <strong>\${o.visitors}</strong>
            </div>
          \`).join('');
        }
      }
    }

    // ==================== POETRY ENGAGEMENT ====================
    function renderPoetryEngagement(pe) {
      const elReads = document.getElementById('statPoemReads');
      if (elReads) elReads.innerText = (pe.total_poem_reads || 0).toLocaleString();

      const elRate = document.getElementById('statPoemReadRate');
      if (elRate) elRate.innerText = \`\${pe.read_conversion_rate || 0}%\`;

      const topList = document.getElementById('topReadPoemsList');
      if (!topList) return;

      const poems = pe.top_read_poems || [];
      if (poems.length === 0) {
        topList.innerHTML = \`<p style="font-size: 0.82rem; color: var(--text-muted);">No poem reads recorded in this period.</p>\`;
        return;
      }

      topList.innerHTML = poems.slice(0, 5).map((p, idx) => \`
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
          <div>
            <strong style="color: var(--text-main);">\${idx + 1}. \${escape(p.title)}</strong>
            <div style="font-size: 0.74rem; color: var(--text-muted);">
              \${p.views} views · Read rate: \${p.read_rate}%
            </div>
          </div>
          <span class="status-pill published" style="font-size: 0.76rem;">
            \${(p.reads || 0)} Reads
          </span>
        </div>
      \`).join('');
    }

    // ==================== PERFORMANCE & ERRORS ====================
    function renderPerformanceMetrics(perf) {
      const elReqs = document.getElementById('statTotalRequests');
      if (elReqs) elReqs.innerText = (perf.total_worker_requests || 0).toLocaleString();

      const elHum = document.getElementById('statHumanRequests');
      if (elHum) elHum.innerText = (perf.human_requests || 0).toLocaleString();

      const elBot = document.getElementById('statBotRequests');
      if (elBot) elBot.innerText = (perf.bot_requests || 0).toLocaleString();

      const codes = perf.status_codes || [];
      let c2xx = 0, c3xx = 0, c4xx = 0, c5xx = 0;
      for (const row of codes) {
        const code = parseInt(row.status_code, 10);
        if (code >= 200 && code < 300) c2xx += row.count;
        else if (code >= 300 && code < 400) c3xx += row.count;
        else if (code >= 400 && code < 500) c4xx += row.count;
        else if (code >= 500) c5xx += row.count;
      }

      const el2xx = document.getElementById('statStatus2xx');
      if (el2xx) el2xx.innerText = c2xx.toLocaleString();

      const el3xx = document.getElementById('statStatus3xx');
      if (el3xx) el3xx.innerText = c3xx.toLocaleString();

      const el4xx = document.getElementById('statStatus4xx');
      if (el4xx) el4xx.innerText = c4xx.toLocaleString();

      const el5xx = document.getElementById('statStatus5xx');
      if (el5xx) el5xx.innerText = c5xx.toLocaleString();

      const missingList = document.getElementById('missingUrlsList');
      if (missingList) {
        const urls = perf.top_404_urls || [];
        if (urls.length === 0) {
          missingList.innerHTML = \`<span style="color: var(--success); font-size: 0.82rem;">✅ No 404 broken links recorded (All clean)!</span>\`;
        } else {
          missingList.innerHTML = urls.map(u => \`
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <code style="color: var(--danger); font-size: 0.78rem;">\${escape(u.path)}</code>
              <span class="status-pill draft" style="font-size: 0.72rem;">\${u.count} errors</span>
            </div>
          \`).join('');
        }
      }
    }

    // ==================== EXPORT REPORTS (CSV / JSON) ====================
    function exportAnalyticsReport(format) {
      if (!currentAnalyticsData) {
        alert('Analytics data is still loading. Please wait.');
        return;
      }

      const period = currentAnalyticsData.period || currentPeriod;
      const dateStr = new Date().toISOString().slice(0, 10);
      toggleExportMenu();

      if (format === 'json') {
        const jsonStr = JSON.stringify(currentAnalyticsData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`ashabd-analytics-\${period}-\${dateStr}.json\`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'csv') {
        const sum = currentAnalyticsData.summary || {};
        let csvContent = '\\uFEFF';
        csvContent += \`Ashabd Website Analytics Report\\n\`;
        csvContent += \`Period,\${period}\\n\`;
        csvContent += \`Date,\${dateStr}\\n\\n\`;

        csvContent += \`--- Overview ---\\n\`;
        csvContent += \`Metric,Value\\n\`;
        csvContent += \`Total Visitors,\${sum.total_visitors || 0}\\n\`;
        csvContent += \`Unique Visitors,\${sum.unique_visitors || 0}\\n\`;
        csvContent += \`Total Page Views,\${sum.page_views || 0}\\n\`;
        csvContent += \`Total Published Poems,\${sum.total_published_poems || 0}\\n\`;
        csvContent += \`Total Published Articles,\${sum.total_published_articles || 0}\\n\\n\`;

        csvContent += \`--- Most Popular Content & Pages ---\\n\`;
        csvContent += \`Rank,Title,URL,Type,Views,Verified Reads,Read Rate (%),Share (%)\\n\`;

        for (const item of (currentAnalyticsData.popular_content || [])) {
          const rowTitle = \`"\${(item.title || '').replace(/"/g, '""')}"\`;
          const rowPath = \`"\${(item.path || '').replace(/"/g, '""')}"\`;
          const rowType = \`"\${(item.content_type || '').replace(/"/g, '""')}"\`;
          csvContent += \`\${item.rank},\${rowTitle},\${rowPath},\${rowType},\${item.views},\${item.reads},\${item.read_rate}%,\${item.share_pct}%\\n\`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`ashabd-analytics-\${period}-\${dateStr}.csv\`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }

    // ==================== SUBSCRIBER MANAGEMENT ====================
    let allSubscribers = [];

    async function loadSubscribers() {
      const tbody = document.getElementById('subscribersTableBody');
      const logBody = document.getElementById('notificationsLogTableBody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">लोड हो रहा है (Loading subscribers)...</td></tr>';

      try {
        const res = await fetch('/api/subscribers');
        if (!res.ok) throw new Error('Failed to fetch subscribers');
        const data = await res.json();

        // Update stats
        if (data.stats) {
          document.getElementById('statActiveSubscribers').innerText = data.stats.active || 0;
          document.getElementById('statPendingSubscribers').innerText = data.stats.pending || 0;
          document.getElementById('statUnsubscribed').innerText = data.stats.unsubscribed || 0;
          document.getElementById('statTotalNotifications').innerText = data.stats.notifications_sent || 0;
          const countBadge = document.getElementById('countSubscribers');
          if (countBadge) countBadge.innerText = data.stats.active || 0;
        }

        allSubscribers = data.subscribers || [];
        renderSubscribersTable(allSubscribers);
        renderNotificationLogs(data.recent_notifications || []);
      } catch (err) {
        if (tbody) tbody.innerHTML = \`<tr><td colspan="5" style="text-align: center; color: var(--danger);">Error loading subscribers: \${escape(err.message)}</td></tr>\`;
      }
    }

    function renderSubscribersTable(list) {
      const tbody = document.getElementById('subscribersTableBody');
      if (!tbody) return;

      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">अभी कोई सदस्य नहीं है (No subscribers found)</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(sub => {
        let statusBadge = '';
        if (sub.status === 'active') {
          statusBadge = '<span class="status-tag status-published">Active (सक्रिय)</span>';
        } else if (sub.status === 'pending') {
          statusBadge = '<span class="status-tag status-draft">Pending (प्रतीक्षारत)</span>';
        } else {
          statusBadge = '<span class="status-tag" style="background: rgba(138,138,138,0.15); color: #888; border-color: rgba(138,138,138,0.3);">Unsubscribed</span>';
        }

        const createdDate = sub.created_at ? new Date(sub.created_at).toLocaleDateString('hi-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '--';
        const verifiedDate = sub.verified_at ? new Date(sub.verified_at).toLocaleDateString('hi-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : (sub.status === 'active' ? '✓ Verified' : '--');

        return \`
          <tr>
            <td style="font-weight: 500; color: var(--text-main); font-family: monospace; font-size: 0.88rem;">\${escape(sub.email)}</td>
            <td>\${statusBadge}</td>
            <td style="color: var(--text-muted); font-size: 0.82rem;">\${createdDate}</td>
            <td style="color: var(--text-muted); font-size: 0.82rem;">\${verifiedDate}</td>
            <td>
              <button class="action-btn" onclick="deleteSubscriber('\${escape(sub.id)}', '\${escape(sub.email)}')" title="Remove subscriber" style="color: var(--danger);">
                🗑️
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function renderNotificationLogs(logs) {
      const logBody = document.getElementById('notificationsLogTableBody');
      if (!logBody) return;

      if (!logs || logs.length === 0) {
        logBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">कोई प्रेषण रिकॉर्ड नहीं (No notifications recorded yet)</td></tr>';
        return;
      }

      logBody.innerHTML = logs.map(log => {
        const sentDate = log.sent_at ? new Date(log.sent_at).toLocaleString('hi-IN', { dateStyle: 'short', timeStyle: 'short' }) : '--';
        const statusBadge = log.status === 'sent'
          ? '<span style="color: #3fb950; font-weight: 600; font-size: 0.8rem;">✓ Sent</span>'
          : \`<span style="color: var(--danger); font-weight: 600; font-size: 0.8rem;">✕ Failed (\${escape(log.error_message || '')})</span>\`;

        return \`
          <tr>
            <td style="font-weight: 500; color: var(--text-main);">\${escape(log.poem_title || log.writing_id)}</td>
            <td style="color: var(--text-muted); font-family: monospace; font-size: 0.82rem;">\${escape(log.recipient_email)}</td>
            <td>\${statusBadge}</td>
            <td style="color: var(--text-muted); font-size: 0.82rem;">\${sentDate}</td>
          </tr>
        \`;
      }).join('');
    }

    function filterSubscribers() {
      const search = (document.getElementById('subscriberSearchInput')?.value || '').trim().toLowerCase();
      const status = document.getElementById('subscriberStatusFilter')?.value || 'all';

      const filtered = allSubscribers.filter(sub => {
        const matchSearch = !search || sub.email.toLowerCase().includes(search);
        const matchStatus = status === 'all' || sub.status === status;
        return matchSearch && matchStatus;
      });

      renderSubscribersTable(filtered);
    }

    async function deleteSubscriber(id, email) {
      if (!confirm(\`Are you sure you want to remove subscriber \${email}?\`)) {
        return;
      }
      try {
        const res = await fetch(\`/api/subscribers/\${id}\`, { method: 'DELETE' });
        if (res.ok) {
          loadSubscribers();
        } else {
          const data = await res.json();
          alert('Failed to delete subscriber: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      }
    }

    function openTestPoemModal() {
      const modal = document.getElementById('testNotificationModal');
      const emailInput = document.getElementById('testNotificationEmail');
      const feedback = document.getElementById('testNotificationFeedback');
      if (feedback) feedback.style.display = 'none';
      if (modal) modal.classList.add('active');
      if (emailInput) {
        const recoveryEmail = document.getElementById('adminRecoveryEmail')?.value;
        if (recoveryEmail) emailInput.value = recoveryEmail;
        setTimeout(() => emailInput.focus(), 60);
      }
    }

    function closeTestPoemModal() {
      const modal = document.getElementById('testNotificationModal');
      if (modal) modal.classList.remove('active');
    }

    async function submitTestPoemNotification(e) {
      if (e && e.preventDefault) e.preventDefault();
      const emailInput = document.getElementById('testNotificationEmail');
      const feedback = document.getElementById('testNotificationFeedback');
      const btn = document.getElementById('sendTestPoemBtn');

      if (!emailInput || !feedback || !btn) return;

      const email = emailInput.value.trim();
      if (!email) return;

      btn.disabled = true;
      btn.innerText = 'Sending...';
      feedback.style.display = 'none';

      try {
        const res = await fetch('/api/subscribers/send-test-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();

        feedback.style.display = 'block';
        if (res.ok && data.success) {
          feedback.style.background = 'rgba(63, 185, 80, 0.14)';
          feedback.style.border = '1px solid rgba(63, 185, 80, 0.3)';
          feedback.style.color = '#3fb950';
          feedback.innerText = '✅ ' + (data.message || 'Test notification dispatched successfully!');
        } else {
          feedback.style.background = 'rgba(248, 81, 73, 0.14)';
          feedback.style.border = '1px solid rgba(248, 81, 73, 0.3)';
          feedback.style.color = 'var(--danger)';
          feedback.innerText = '❌ ' + (data.error || 'Failed to dispatch test notification.');
        }
      } catch (err) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(248, 81, 73, 0.14)';
        feedback.style.border = '1px solid rgba(248, 81, 73, 0.3)';
        feedback.style.color = 'var(--danger)';
        feedback.innerText = '❌ Network error: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerText = 'Send Test Email';
      }
    }

    // Initialize
    checkAuth();
  </script>
</body>
</html>
`;
}
