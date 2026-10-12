# Ashabd Gmail SMTP Relay

A secure, lightweight Node.js microservice that connects to **`smtp.gmail.com`** via SSL (Port 465) or STARTTLS (Port 587) using official Nodemailer. It allows your **Ashabd Cloudflare Worker** to dispatch emails from **`ashabdpoetry0@gmail.com`** without encountering serverless TCP socket restrictions or IP blocks from Google.

---

## Why is this Relay Useful?

Cloudflare Workers run in a serverless V8 isolate environment. While modern Cloudflare Workers support `cloudflare:sockets`, Google's `smtp.gmail.com` often limits or blocks direct SMTP socket connections originating from large public cloud and serverless IP pools. 

By hosting this lightweight Node.js relay on a platform like **Render**, **Railway**, **Fly.io**, or any standard VPS:
1. The relay maintains a standard, reliable TCP/TLS connection to `smtp.gmail.com`.
2. The Cloudflare Worker calls the relay securely over HTTPS (`POST https://your-relay-service.onrender.com/send`).
3. Authentication between the Worker and the Relay is protected by a Bearer token (`RELAY_SECRET`).
4. Your Gmail App Password (`APP_PASSWORD`) is stored securely in the relay's environment (or securely passed from Worker secrets).

---

## 1-Click / Fast Deployment (e.g. Render)

1. **Create a new Web Service** on [Render.com](https://render.com) (or Railway / Fly.io / VPS).
2. Connect this repository (`my-poetry`) and set **Root Directory** to `relay`.
3. Set **Runtime** to `Node` (or Docker).
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Configure **Environment Variables** in Render:
   - `GMAIL_USER`: `ashabdpoetry0@gmail.com`
   - `APP_PASSWORD`: Your 16-character Google App Password (e.g. `abcd efgh ijkl mnop` without spaces)
   - `RELAY_SECRET`: A strong random string of your choice (e.g. `ashabd_relay_sec_7f9b2c...`)
5. Deploy the service. Render will provide a URL like:
   `https://ashabd-relay.onrender.com`

---

## Connect to Cloudflare Worker

In your Cloudflare Worker (`my-poetry`), add these two secrets / variables:

1. `GMAIL_RELAY_URL`: `https://your-relay-domain.onrender.com/send`
2. `GMAIL_RELAY_SECRET`: The same secret you set as `RELAY_SECRET` in the relay.

Run via Wrangler:
```bash
npx wrangler secret put GMAIL_RELAY_URL
# Enter: https://your-relay-domain.onrender.com/send

npx wrangler secret put GMAIL_RELAY_SECRET
# Enter your secret token
```

---

## API Endpoints

- `GET /health`: Public health check.
- `GET /verify`: Authenticated test to verify Gmail SMTP credentials with Google.
- `POST /send`: Authenticated email dispatch endpoint.
