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
      if (pathname === '/admin' || pathname === '/admin/') {
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
          return handleCreateWriting(request, env);
        }

        // Single writing operations: /api/writings/:id
        const idMatch = pathname.match(/^\/api\/writings\/([a-zA-Z0-9_\-]+)$/);
        if (idMatch) {
          const id = idMatch[1];
          if (request.method === 'GET') {
            return handleGetWritingAdmin(id, env);
          }
          if (request.method === 'PUT') {
            return handleUpdateWriting(id, request, env);
          }
          if (request.method === 'DELETE') {
            return handleDeleteWriting(id, env);
          }
        }

        // Toggle publication status: /api/writings/:id/status
        const statusMatch = pathname.match(/^\/api\/writings\/([a-zA-Z0-9_\-]+)\/status$/);
        if (statusMatch && (request.method === 'PATCH' || request.method === 'POST')) {
          return handleToggleStatus(statusMatch[1], request, env);
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
      // 5. ROUTE: Public Poem & Writing Dynamic Pages (/poetry/:slug, /writing/:slug)
      // ------------------------------------------------------------------------
      const poemMatch = pathname.match(/^\/(?:poetry|writing|writings)\/([^\/]+)$/);
      if (poemMatch && request.method === 'GET') {
        const rawSlug = poemMatch[1];
        const slug = decodeURIComponent(rawSlug);
        return handlePublicPoemPage(slug, request, env);
      }

      // ------------------------------------------------------------------------
      // 6. ROUTE: Public Poetry Collection / Archive (/poetry, /writings)
      // ------------------------------------------------------------------------
      if ((pathname === '/poetry' || pathname === '/poetry/' || pathname === '/writings' || pathname === '/writings/') && request.method === 'GET') {
        return handlePublicArchivePage(request, env);
      }

      // ------------------------------------------------------------------------
      // 7. ROUTE: Static Assets (/, /style.css, /app.js, /ashabd_website_logo_pack/*)
      // ------------------------------------------------------------------------
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
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

async function ensureAdminUsersTable(db) {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
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

  const { password } = body;
  if (!password || password.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters long.' }, 400);
  }

  const salt = generateSalt();
  const hash = await hashPasswordWithSalt(password, salt);
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO admin_users (id, username, password_hash, salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('admin_primary', 'admin', hash, salt, now, now).run();

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
    return jsonResponse({
      authenticated: true,
      user: user.user,
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
   DATABASE & CONTENT MANAGEMENT HANDLERS (D1)
   ========================================================================== */

function checkDatabase(env) {
  const db = env.DB || env['ashabd-db'];
  if (!db) {
    throw new Error("Cloudflare D1 database binding ('ashabd-db' or 'DB') is missing. Please check your wrangler.jsonc or Cloudflare bindings.");
  }
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
  const db = checkDatabase(env);
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
  const db = checkDatabase(env);
  const writing = await db.prepare('SELECT * FROM writings WHERE id = ?').bind(id).first();
  if (!writing) {
    return jsonResponse({ error: 'Writing not found' }, 404);
  }
  return jsonResponse({ writing });
}

async function handleCreateWriting(request, env) {
  const db = checkDatabase(env);
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

async function handleUpdateWriting(id, request, env) {
  const db = checkDatabase(env);
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

  return jsonResponse({
    success: true,
    writing: { id, title, slug, status, updated_at: now, published_at: publishedAt }
  });
}

async function handleToggleStatus(id, request, env) {
  const db = checkDatabase(env);
  const body = await request.json();
  const nextStatus = body.status === 'Published' ? 'Published' : 'Draft';

  const existing = await db.prepare('SELECT id, published_at FROM writings WHERE id = ?').bind(id).first();
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

  return jsonResponse({ success: true, status: nextStatus, published_at: publishedAt });
}

async function handleDeleteWriting(id, env) {
  const db = checkDatabase(env);
  await db.prepare('DELETE FROM writings WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true, message: 'Writing deleted successfully.' });
}

/* ==========================================================================
   PUBLIC API & DYNAMIC SSR PAGES
   ========================================================================== */

async function handlePublicWritingsList(request, env) {
  if (!env.DB) {
    return jsonResponse({ writings: [] });
  }

  const { results: writings } = await env.DB.prepare(`
    SELECT id, title, slug, subtitle, content_type, tags, published_at
    FROM writings
    WHERE status = 'Published'
    ORDER BY published_at DESC
  `).all();

  return jsonResponse({ writings: writings || [] }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=300'
  });
}

/**
 * Public SSR Page for /poetry/:slug and /writing/:slug
 */
async function handlePublicPoemPage(slug, request, env) {
  if (!env.DB) {
    return new Response(renderNotFoundHtml('डेटाबेस कनेक्टेड नहीं है (Database not configured).'), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const writing = await env.DB.prepare(`
    SELECT * FROM writings WHERE slug = ? AND status = 'Published'
  `).bind(slug).first();

  if (!writing) {
    return new Response(renderNotFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const html = renderPoemHtml(writing);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=600'
    }
  });
}

/**
 * Public SSR Page for /poetry and /writings Archive
 */
async function handlePublicArchivePage(request, env) {
  if (!env.DB) {
    return new Response(renderArchiveHtml([]), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const { results: writings } = await env.DB.prepare(`
    SELECT id, title, slug, subtitle, content_type, tags, published_at
    FROM writings
    WHERE status = 'Published'
    ORDER BY published_at DESC
  `).all();

  const html = renderArchiveHtml(writings || []);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300'
    }
  });
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

function renderPoemHtml(poem) {
  const safeTitle = escapeHtml(poem.title);
  const safeSubtitle = poem.subtitle ? escapeHtml(poem.subtitle) : '';
  const safeContent = escapeHtml(poem.content);
  const safeType = escapeHtml(poem.content_type || 'Poetry');
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
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      min-height: 100vh;
      background: #ebdcb7;
      background-image:
        radial-gradient(ellipse 70% 60% at 50% 30%, #fbf5e8 0%, #f5ebd3 45%, rgba(240, 227, 201, 0.4) 80%, transparent 100%),
        radial-gradient(ellipse 48% 42% at 0% 0%, #2e1609 0%, #582b13 22%, #85451e 40%, rgba(133, 69, 30, 0.2) 65%, transparent 100%),
        radial-gradient(ellipse 52% 48% at 100% 100%, #241206 0%, #4e2510 25%, #7a3d1c 45%, rgba(122, 61, 28, 0.18) 70%, transparent 100%),
        radial-gradient(ellipse 42% 38% at 0% 100%, #391b0d 0%, #693418 20%, #944b24 38%, rgba(148, 75, 36, 0.15) 60%, transparent 100%),
        radial-gradient(ellipse 44% 40% at 100% 0%, #32180a 0%, #5e2c13 22%, #8a4520 42%, rgba(138, 69, 32, 0.18) 65%, transparent 100%);
      color: #24160c;
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, serif;
      position: relative;
      overflow-x: hidden;
      padding: 2.5rem 1.25rem 4rem;
    }

    /* Paper Grain Texture */
    .paper-grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
      opacity: 0.35;
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='agedPaperNoise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.055' numOctaves='5' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 0.45 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23agedPaperNoise)'/%3E%3C/svg%3E");
    }

    /* Outer Vignette */
    .vignette {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 45%, rgba(68, 34, 15, 0.24) 75%, rgba(36, 17, 7, 0.6) 94%, rgba(20, 9, 3, 0.85) 100%);
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
      border-bottom: 1px dashed rgba(78, 42, 20, 0.25);
    }

    .brand-back-link {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 1.35rem;
      color: #3b2010;
      text-decoration: none;
      letter-spacing: 0.05em;
      opacity: 0.78;
      transition: opacity 0.3s ease;
    }
    .brand-back-link:hover { opacity: 1; }

    .collection-link {
      font-size: 0.85rem;
      color: #5c351c;
      text-decoration: none;
      letter-spacing: 0.06em;
      opacity: 0.7;
      transition: opacity 0.3s ease;
    }
    .collection-link:hover { opacity: 1; color: #24160c; }

    /* Poem Header */
    .poem-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    .poem-type-badge {
      display: inline-block;
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #743f20;
      opacity: 0.75;
      margin-bottom: 0.8rem;
    }

    .poem-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', serif;
      font-size: clamp(2.2rem, 6vw, 3.4rem);
      line-height: 1.25;
      font-weight: 500;
      color: #24160c;
      margin-bottom: 0.8rem;
      letter-spacing: 0.04em;
      text-shadow: 0 1px 2px rgba(36, 22, 12, 0.25);
    }

    .poem-subtitle {
      font-size: 1.1rem;
      font-style: italic;
      color: #5a3219;
      opacity: 0.82;
      margin-bottom: 1rem;
    }

    .poem-meta {
      font-size: 0.82rem;
      color: #704022;
      opacity: 0.7;
      letter-spacing: 0.04em;
    }

    /* The Poem Body - Preserves Exact Stanzas & Blank Lines */
    .poem-content {
      font-size: clamp(1.15rem, 2.5vw, 1.35rem);
      line-height: 2.05;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: #20130a;
      letter-spacing: 0.02em;
      margin: 2.5rem 0 4rem;
      padding: 0 0.5rem;
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
      color: #5c351c;
      background: rgba(92, 53, 28, 0.07);
      padding: 0.2rem 0.6rem;
      border-radius: 2px;
      letter-spacing: 0.04em;
      opacity: 0.8;
    }

    /* Manuscript End Mark */
    .manuscript-colophon {
      text-align: center;
      margin-top: 3.5rem;
      padding-top: 2rem;
      border-top: 1px dashed rgba(78, 42, 20, 0.22);
    }

    .colophon-symbol {
      font-size: 1.2rem;
      color: #743f20;
      opacity: 0.5;
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
      color: #442a1a;
      text-decoration: none;
      opacity: 0.45;
      transition: opacity 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .ink-link:hover { opacity: 0.88; }

    @media (max-width: 600px) {
      body { padding: 1.5rem 1rem 3rem; }
      .poem-title { font-size: 2.1rem; }
      .poem-content { font-size: 1.15rem; line-height: 1.95; }
    }
  </style>
</head>
<body>
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <main class="manuscript-page">
    <nav class="marginalia-nav" aria-label="Navigation">
      <a href="/" class="brand-back-link" title="वापस अशब्द मुख्य पृष्ठ पर">अशब्द</a>
      <a href="/poetry" class="collection-link">रचना संग्रह ↗</a>
    </nav>

    <article>
      <header class="poem-header">
        <span class="poem-type-badge">${safeType}</span>
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
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      min-height: 100vh;
      background: #ebdcb7;
      background-image:
        radial-gradient(ellipse 70% 60% at 50% 30%, #fbf5e8 0%, #f5ebd3 45%, rgba(240, 227, 201, 0.4) 80%, transparent 100%),
        radial-gradient(ellipse 48% 42% at 0% 0%, #2e1609 0%, #582b13 22%, #85451e 40%, rgba(133, 69, 30, 0.2) 65%, transparent 100%),
        radial-gradient(ellipse 52% 48% at 100% 100%, #241206 0%, #4e2510 25%, #7a3d1c 45%, rgba(122, 61, 28, 0.18) 70%, transparent 100%);
      color: #24160c;
      font-family: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, serif;
      padding: 3rem 1.5rem 5rem;
    }

    .page-container {
      max-width: 680px;
      margin: 0 auto;
    }

    .archive-header {
      text-align: center;
      margin-bottom: 3.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px dashed rgba(78, 42, 20, 0.25);
    }

    .brand-title {
      font-family: 'Rozha One', 'Tiro Devanagari Hindi', serif;
      font-size: 2.8rem;
      color: #24160c;
      text-decoration: none;
      display: inline-block;
      margin-bottom: 0.5rem;
    }

    .archive-subtitle {
      font-size: 0.95rem;
      color: #5c351c;
      opacity: 0.75;
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
      border-bottom: 1px dotted rgba(78, 42, 20, 0.18);
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
      color: #22140a;
      margin-bottom: 0.35rem;
      transition: color 0.2s ease;
    }
    .writing-link:hover .writing-item-title { color: #5c2c12; }

    .writing-item-subtitle {
      font-size: 0.95rem;
      color: #58331d;
      opacity: 0.8;
      margin-bottom: 0.5rem;
    }

    .writing-item-meta {
      font-size: 0.78rem;
      color: #744222;
      opacity: 0.65;
      display: flex;
      gap: 0.8rem;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 1rem;
      color: #633b20;
      opacity: 0.75;
      font-size: 1.1rem;
      font-style: italic;
    }

    .back-home {
      display: block;
      text-align: center;
      margin-top: 4rem;
      font-size: 0.9rem;
      color: #5c351c;
      text-decoration: none;
      opacity: 0.7;
    }
    .back-home:hover { opacity: 1; }
  </style>
</head>
<body>
  <div class="page-container">
    <header class="archive-header">
      <a href="/" class="brand-title">अशब्द</a>
      <p class="archive-subtitle">प्रकाशित रचना संग्रह</p>
    </header>

    ${writings.length === 0 ? `
      <div class="empty-state">
        <p>अभी कोई रचना प्रकाशित नहीं है।</p>
        <p style="font-size: 0.85rem; margin-top: 0.5rem;">शब्द जल्द ही साकार होंगे...</p>
      </div>
    ` : `
      <ul class="writings-list">
        ${writings.map(w => `
          <li class="writing-item">
            <a href="/poetry/${encodeURIComponent(w.slug)}" class="writing-link">
              <h2 class="writing-item-title">${escapeHtml(w.title)}</h2>
              ${w.subtitle ? `<p class="writing-item-subtitle">${escapeHtml(w.subtitle)}</p>` : ''}
              <div class="writing-item-meta">
                <span>${escapeHtml(w.content_type || 'Poetry')}</span>
                <span>·</span>
                <time>${formatDate(w.published_at)}</time>
              </div>
            </a>
          </li>
        `).join('')}
      </ul>
    `}

    <a href="/" class="back-home">← मुख्य पृष्ठ पर वापस जाएं</a>
  </div>
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
  <style>
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ebdcb7;
      color: #24160c;
      font-family: 'Tiro Devanagari Hindi', Georgia, serif;
      text-align: center;
      padding: 2rem;
    }
    h1 { font-size: 2.8rem; margin-bottom: 0.8rem; font-weight: normal; }
    p { font-size: 1.15rem; color: #5c351c; margin-bottom: 2rem; opacity: 0.85; }
    a { color: #3b2010; text-decoration: underline; }
  </style>
</head>
<body>
  <div>
    <h1>४०४ — यह शब्द अभी मौन है</h1>
    <p>${customMessage || 'यह रचना उपलब्ध नहीं है या अभी एक अप्रकाशित विचार है।'}</p>
    <a href="/">← मुख्य पृष्ठ पर वापस लौटें</a>
  </div>
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
  <link rel="icon" type="image/x-icon" href="/ashabd_website_logo_pack/favicons_and_icons/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@400;500;600&family=Rozha+One&family=Tiro+Devanagari+Hindi&display=swap" rel="stylesheet">
  
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
      gap: 1rem;
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
  </style>
</head>
<body>

  <!-- ==================== AUTHENTICATION SCREEN ==================== -->
  <div id="authOverlay" class="auth-overlay">
    <div class="login-box">
      <h1 class="login-brand">अशब्द</h1>
      <p class="login-sub">प्रबंधन कक्ष — Administrator Login</p>

      <div id="setupNotice" class="notice-box" style="text-align: left;">
        <strong>⚙️ Setup Notice:</strong> Cloudflare secret <code>ADMIN_PASSWORD</code> is not yet configured. Please set it in Cloudflare Dashboard &gt; Worker &gt; Settings &gt; Variables and Secrets.
      </div>

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
      <button class="nav-btn active" onclick="switchTab('overview')">
        <span>📊 Overview</span>
      </button>
      <button class="nav-btn" onclick="switchTab('all-writings')">
        <span>📜 All Writings</span>
        <span class="nav-count" id="countAll">0</span>
      </button>
      <button class="nav-btn" onclick="openNewWriting()">
        <span>✍️ Add New Writing</span>
      </button>
      <button class="nav-btn" onclick="switchTab('published')">
        <span>🌐 Published</span>
        <span class="nav-count" id="countPub">0</span>
      </button>
      <button class="nav-btn" onclick="switchTab('drafts')">
        <span>📁 Drafts</span>
        <span class="nav-count" id="countDraft">0</span>
      </button>
      <button class="nav-btn" onclick="switchTab('settings')">
        <span>⚙️ Settings & D1</span>
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
            <option value="all">All Types</option>
            <option value="Poetry">कविता (Poetry)</option>
            <option value="Article">लेख (Article)</option>
            <option value="Story">कहानी (Story)</option>
            <option value="Essay">निबंध (Essay)</option>
            <option value="Diary">डायरी (Diary)</option>
            <option value="Other">अन्य (Other)</option>
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
                <label class="form-label" for="writingType">Content Type (रचना प्रकार)</label>
                <select id="writingType" class="select-input" style="width: 100%;">
                  <option value="Poetry">कविता (Poetry)</option>
                  <option value="Article">लेख (Article)</option>
                  <option value="Story">कहानी (Story)</option>
                  <option value="Essay">निबंध (Essay)</option>
                  <option value="Diary">डायरी (Diary)</option>
                  <option value="Other">अन्य (Other)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="writingTags">Tags (टैग - Comma separated)</label>
                <input type="text" id="writingTags" class="text-input" placeholder="हिंदी, कविता, दर्शन, मौन">
              </div>

              <div class="form-group">
                <label class="form-label" for="writingStatus">Status</label>
                <select id="writingStatus" class="select-input" style="width: 100%;">
                  <option value="Draft">Draft (ड्राफ्ट - निजी)</option>
                  <option value="Published">Published (सार्वजनिक रूप से प्रकाशित)</option>
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

            <div class="editor-actions">
              <button type="button" class="btn btn-outline" onclick="openPreview()">
                👁️ Preview on Website
              </button>
              <button type="submit" class="btn btn-accent" id="saveBtn">
                💾 Save Writing
              </button>
              <button type="button" class="btn btn-outline" onclick="switchTab('all-writings')">
                Cancel
              </button>
            </div>
          </div>
        </form>
      </section>

      <!-- VIEW 4: SETTINGS & D1 STATUS -->
      <section id="view-settings" class="view-section">
        <div class="section-header">
          <h2 class="section-title">Settings &amp; Database Status</h2>
        </div>

        <div class="editor-card" style="margin-bottom: 1.5rem;">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">Cloudflare D1 &amp; Secrets Checklist</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.7; margin-bottom: 1.25rem;">
            This admin dashboard connects directly to Cloudflare D1 for persistent storage and uses Cloudflare Secrets for administrator authentication.
          </p>

          <div style="background: rgba(0,0,0,0.25); padding: 1.2rem; border-radius: var(--radius); font-size: 0.85rem; line-height: 1.8;">
            <p>1. <strong>ADMIN_PASSWORD</strong>: Set your secret in Cloudflare Dashboard &gt; Workers &gt; Settings &gt; Variables and Secrets.</p>
            <p>2. <strong>D1 Database Binding</strong>: Ensure D1 database binding variable is named <code>DB</code>.</p>
            <p>3. <strong>Database Migration</strong>: Apply <code>migrations/0001_initial_schema.sql</code> via Cloudflare D1 console.</p>
          </div>
        </div>

        <div class="editor-card">
          <h3 style="margin-bottom: 0.8rem; font-size: 1.1rem;">Data Export</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Export all poems and writings as a JSON backup.</p>
          <button class="btn btn-outline" onclick="exportBackup()">📥 Download Backup (JSON)</button>
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
      <div id="prevContent" style="font-size: 1.25rem; line-height: 2.1; white-space: pre-wrap; color: #20130a; margin: 2rem 0;"></div>
      <div style="text-align: center; margin-top: 2rem; border-top: 1px dashed rgba(78, 42, 20, 0.25); padding-top: 1.5rem;">
        <button class="btn btn-accent" onclick="publishFromPreview()">Publish This Now</button>
        <button class="btn btn-outline" style="color: #24160c; border-color: rgba(36,22,12,0.3);" onclick="closePreview()">Close Preview</button>
      </div>
    </div>
  </div>

  <!-- Client-side Logic -->
  <script>
    let currentWritings = [];
    let currentFilterStatus = 'all';

    // Check Auth on Page Load
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            document.getElementById('authOverlay').style.display = 'none';
            loadWritings();
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
          loadWritings();
        } else {
          errBox.innerText = data.error || 'अमान्य पासवर्ड (Invalid password)';
          errBox.style.display = 'block';
          if (data.setup_needed) {
            document.getElementById('setupNotice').style.display = 'block';
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

    async function handleLogout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    }

    // Tab Navigation
    function switchTab(tab) {
      document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

      if (tab === 'overview') {
        document.getElementById('view-overview').classList.add('active');
        document.querySelector('.nav-btn:nth-child(1)').classList.add('active');
      } else if (tab === 'all-writings') {
        document.getElementById('view-list').classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'All Writings';
        document.getElementById('statusFilter').value = 'all';
        document.querySelector('.nav-btn:nth-child(2)').classList.add('active');
        loadWritings();
      } else if (tab === 'published') {
        document.getElementById('view-list').classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'Published Writings';
        document.getElementById('statusFilter').value = 'Published';
        document.querySelector('.nav-btn:nth-child(4)').classList.add('active');
        loadWritings();
      } else if (tab === 'drafts') {
        document.getElementById('view-list').classList.add('active');
        document.getElementById('listSectionTitle').innerText = 'Drafts';
        document.getElementById('statusFilter').value = 'Draft';
        document.querySelector('.nav-btn:nth-child(5)').classList.add('active');
        loadWritings();
      } else if (tab === 'editor') {
        document.getElementById('view-editor').classList.add('active');
        document.querySelector('.nav-btn:nth-child(3)').classList.add('active');
      } else if (tab === 'settings') {
        document.getElementById('view-settings').classList.add('active');
        document.querySelector('.nav-btn:nth-child(6)').classList.add('active');
      }
    }

    function openNewWriting() {
      document.getElementById('editWritingId').value = '';
      document.getElementById('editorTitle').innerText = 'Add New Writing';
      document.getElementById('writingTitle').value = '';
      document.getElementById('writingSubtitle').value = '';
      document.getElementById('writingSlug').value = '';
      document.getElementById('writingType').value = 'Poetry';
      document.getElementById('writingTags').value = '';
      document.getElementById('writingStatus').value = 'Draft';
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
          <td><span class="type-tag">\${escape(item.content_type || 'Poetry')}</span></td>
          <td>
            <span class="status-pill \${item.status === 'Published' ? 'published' : 'draft'}">
              \${item.status}
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">
            \${new Date(item.updated_at).toLocaleDateString()}
          </td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" onclick="editWriting('\${item.id}')" title="Edit">✏️</button>
              \${item.status === 'Published' ? \`
                <a href="/poetry/\${encodeURIComponent(item.slug)}" target="_blank" class="icon-btn" title="View Public Page">↗</a>
                <button class="icon-btn" onclick="toggleStatus('\${item.id}', 'Draft')" title="Unpublish">📁</button>
              \` : \`
                <button class="icon-btn" onclick="toggleStatus('\${item.id}', 'Published')" title="Publish">🌐</button>
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
          <td><span class="type-tag">\${escape(item.content_type || 'Poetry')}</span></td>
          <td><span class="status-pill \${item.status === 'Published' ? 'published' : 'draft'}">\${item.status}</span></td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">\${new Date(item.updated_at).toLocaleDateString()}</td>
          <td>
            <button class="icon-btn" onclick="editWriting('\${item.id}')" title="Edit">✏️</button>
            \${item.status === 'Published' ? \`<a href="/poetry/\${encodeURIComponent(item.slug)}" target="_blank" class="icon-btn" title="View Live">↗</a>\` : ''}
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
          document.getElementById('writingStatus').value = w.status || 'Draft';
          document.getElementById('writingContent').value = w.content || '';
          updateStats();
          switchTab('editor');
        }
      } catch (err) {
        alert('Failed to load writing for editing: ' + err.message);
      }
    }

    async function handleSaveWriting(e) {
      e.preventDefault();
      const id = document.getElementById('editWritingId').value;
      const isNew = !id;

      const payload = {
        title: document.getElementById('writingTitle').value.trim(),
        subtitle: document.getElementById('writingSubtitle').value.trim(),
        slug: document.getElementById('writingSlug').value.trim(),
        content_type: document.getElementById('writingType').value,
        tags: document.getElementById('writingTags').value.trim(),
        status: document.getElementById('writingStatus').value,
        content: document.getElementById('writingContent').value
      };

      const btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.innerText = 'सुरक्षित हो रहा है...';

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
          alert('रचना सुरक्षित कर दी गई (Writing saved successfully!)');
          loadWritings();
          switchTab('all-writings');
        } else {
          alert('Error: ' + (data.error || 'Failed to save'));
        }
      } catch (err) {
        alert('Save error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = '💾 Save Writing';
      }
    }

    async function toggleStatus(id, newStatus) {
      try {
        const res = await fetch(\`/api/writings/\${id}/status\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
          loadWritings();
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
        .replace(/[\s\t\n]+/g, '-')
        .replace(/[^\p{L}\p{N}\-_]/gu, '')
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
      // Auto-set title from filename if title field is empty
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
     * Pure browser client-side docx XML text extraction
     */
    async function extractDocxText(file) {
      const buffer = await file.arrayBuffer();
      const zip = new Uint8Array(buffer);

      // Search for word/document.xml in ZIP
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
      const targetBytes = new TextEncoder().encode(targetFilename);

      while (offset < bytes.length - 30) {
        // Local file header signature: 0x04034b50 ("PK\\x03\\x04")
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
              return raw; // Stored (no compression)
            } else if (compression === 8) {
              // Deflate compression - use Web Streams DecompressionStream
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

    function escape(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Initialize
    checkAuth();
  </script>
</body>
</html>`;
}
