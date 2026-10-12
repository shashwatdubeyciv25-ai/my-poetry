/**
 * ============================================================================
 * Ashabd (अशब्द) — Secure Gmail SMTP Relay Microservice
 * ============================================================================
 * This relay connects to smtp.gmail.com (port 465 SSL or 587 STARTTLS) using
 * Nodemailer, allowing the Ashabd Cloudflare Worker to send authentic Gmail
 * notifications without running into serverless raw socket restrictions.
 *
 * Environment Variables:
 *  - GMAIL_USER: Sender Gmail address (default: "ashabdpoetry0@gmail.com")
 *  - APP_PASSWORD: 16-character Google App Password (without spaces)
 *  - RELAY_SECRET: Secret token required in "Authorization: Bearer <token>"
 *  - PORT: Server port (default: 3000)
 * ============================================================================
 */

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const GMAIL_USER = process.env.GMAIL_USER || 'ashabdpoetry0@gmail.com';
const RELAY_SECRET = process.env.RELAY_SECRET || process.env.GMAIL_RELAY_SECRET || '';

// Cached Nodemailer transporter
let transporter = null;

function getTransporter(customPass) {
  const pass = (customPass || process.env.APP_PASSWORD || '').replace(/\s+/g, '');
  if (!pass) return null;

  if (transporter && !customPass) {
    return transporter;
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL/TLS on port 465
    auth: {
      user: GMAIL_USER,
      pass: pass
    },
    tls: {
      rejectUnauthorized: true
    }
  });

  if (!customPass) {
    transporter = transport;
  }
  return transport;
}

// ----------------------------------------------------------------------------
// Middleware: Bearer Token Authentication
// ----------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!RELAY_SECRET) {
    // If no secret is configured, allow requests only in local dev
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({
        error: 'RELAY_SECRET environment variable is not configured on this relay server.'
      });
    }
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';

  if (!token || token !== RELAY_SECRET) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing relay authentication token.'
    });
  }

  next();
}

// ----------------------------------------------------------------------------
// Health Check Endpoint (public)
// ----------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ashabd-gmail-smtp-relay',
    sender: GMAIL_USER,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    authConfigured: Boolean(process.env.APP_PASSWORD),
    timestamp: new Date().toISOString()
  });
});

// ----------------------------------------------------------------------------
// SMTP Verification Endpoint (authenticated)
// ----------------------------------------------------------------------------
app.get('/verify', requireAuth, async (req, res) => {
  const mailer = getTransporter();
  if (!mailer) {
    return res.status(500).json({
      success: false,
      error: 'APP_PASSWORD is not configured on this relay server.'
    });
  }

  try {
    await mailer.verify();
    res.json({
      success: true,
      message: `SMTP connection to smtp.gmail.com:465 verified for ${GMAIL_USER}.`
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: `Gmail SMTP verification failed: ${err.message}`
    });
  }
});

// ----------------------------------------------------------------------------
// Email Dispatch Endpoint (authenticated)
// ----------------------------------------------------------------------------
app.post('/send', requireAuth, async (req, res) => {
  const { to, subject, html, text, from, replyTo, appPassword, gmailUser } = req.body;

  if (!to || !subject) {
    return res.status(400).json({
      error: 'Missing required fields: "to" and "subject" are required.'
    });
  }

  const senderUser = gmailUser || GMAIL_USER;
  const mailer = getTransporter(appPassword);

  if (!mailer) {
    return res.status(500).json({
      error: 'Gmail App Password is not configured on this relay server (missing APP_PASSWORD).'
    });
  }

  const fromAddress = from || `Ashabd <${senderUser}>`;
  const replyToAddress = replyTo || senderUser;

  const mailOptions = {
    from: fromAddress,
    to: Array.isArray(to) ? to.join(', ') : to,
    replyTo: replyToAddress,
    subject: subject,
    text: text || undefined,
    html: html || undefined
  };

  try {
    const info = await mailer.sendMail(mailOptions);
    return res.json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      response: info.response,
      provider: 'gmail_smtp_relay'
    });
  } catch (err) {
    console.error('[Gmail SMTP Relay Error]:', err.message);
    return res.status(502).json({
      success: false,
      error: `Gmail SMTP relay error: ${err.message}`,
      code: err.code || 'SMTP_ERROR'
    });
  }
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on Gmail SMTP relay.' });
});

app.listen(PORT, () => {
  console.log(`Ashabd Gmail SMTP Relay listening on port ${PORT}`);
  console.log(`Sender: ${GMAIL_USER} via smtp.gmail.com:465`);
});
