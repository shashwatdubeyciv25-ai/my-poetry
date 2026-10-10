# अशब्द (Ashabd.in) — Poetry Platform & Admin CMS

> **अशब्द** — An antique manuscript experience & personal poetry platform.

A minimalist, atmospheric, centuries-old aged parchment website bearing the sacred word **अशब्द**, integrated with a private content-management dashboard and dynamic poetry publishing engine powered by **Cloudflare Workers** and **Cloudflare D1**.

---

## 📜 Public Website Experience

- **Homepage (`https://ashabd.in/`)**:
  - Pure, minimalist antique manuscript page displaying strictly the word **अशब्द** centered on weathered parchment.
  - Procedurally generated organic canvas (water tide-lines, creases, cellulose fibers, foxing oxidation spots, edge scorches, and candlelight breathing illumination).
  - Classical Devanagari typography (`Rozha One`, `Tiro Devanagari Hindi`) with walnut gall ink bleed.
  - Understated monochromatic social links to [@ashabd0](https://www.instagram.com/ashabd0/) on Instagram and X at the foot of the page.
  - Strict `100vw × 100vh` zero-scroll experience.

- **Poem Pages (`https://ashabd.in/poetry/:slug`)**:
  - Dynamically rendered on Cloudflare Workers in the authentic Ashabd antique parchment aesthetic.
  - Preserves poem title, subtitle, date, tags, and exact stanza formatting/line breaks.
  - Dynamic Open Graph and Twitter Card tags for rich sharing on WhatsApp and social media.

- **Poetry Archive (`https://ashabd.in/poetry`)**:
  - Public collection and index of all published poems and writings.

---

## ✍️ Admin Dashboard (`https://ashabd.in/admin`)

A private, secure content-management system for writing, editing, and publishing poems:

1. **Dashboard Overview**:
   - Live statistics: Total Writings, Published Works, Active Drafts.
   - Recent activity list with one-click actions.
2. **Editor & File Importer**:
   - Write directly in Hindi (Devanagari) or English with preserved stanza formatting.
   - **File Import**: Drag & drop or select `.txt`, `.md`, or `.docx` (Word) files with automatic client-side text and paragraph extraction.
   - Auto-generated Unicode-safe URL slugs (e.g. `ashabd.in/poetry/your-title`).
   - Fields: Title, Subtitle, Type (`Poetry`, `Article`, `Story`, `Essay`, `Diary`, `Other`), Tags, Status (`Draft` / `Published`).
3. **Antique Manuscript Preview**:
   - Realistic preview modal showing exactly how the poem will render on the public website before publishing.
4. **Manage Writings**:
   - Search by title, tag, or subtitle.
   - Filter by publication status and content type.
   - Edit, Preview, Publish/Unpublish, and Delete (with confirmation).
5. **Security**:
   - Zero hardcoded passwords or secrets in code or repository.
   - Server-side cryptographic authentication using Web Crypto HMAC-SHA256 session tokens.
   - Protected API endpoints (`/api/writings/*`) — drafts and admin data are strictly hidden from unauthenticated visitors.

---

## ⚙️ Cloudflare Setup Guide

To connect the database and activate administrator authentication, follow these 2 simple steps in your Cloudflare Dashboard:

### Step 1: Create Cloudflare D1 Database

1. In the **Cloudflare Dashboard**, navigate to **Workers & Pages** > **D1 SQL Database**.
2. Click **Create database**, name it `ashabd-db`, and click **Create**.
3. In your Worker's settings (**Workers & Pages** > your `ashabd` worker > **Settings** > **Bindings**):
   - Click **Add binding** > select **D1 Database**.
   - **Variable name**: `DB` *(must be named `DB`)*.
   - **Database**: Select `ashabd-db`.
4. Apply database schema:
   - Go to your D1 database (`ashabd-db`) in the Cloudflare Dashboard > **Console** tab.
   - Copy the SQL from [`migrations/0001_initial_schema.sql`](migrations/0001_initial_schema.sql) and click **Execute**.

### Step 2: Set Administrator Password Secret

1. In the **Cloudflare Dashboard**, navigate to **Workers & Pages** > your `ashabd` worker > **Settings** > **Variables and Secrets**.
2. Under **Secrets**, click **Add secret**:
   - **Variable name**: `ADMIN_PASSWORD`
   - **Value**: Enter your chosen strong administrator password.
3. (Optional) Add `SESSION_SECRET`:
   - **Variable name**: `SESSION_SECRET`
   - **Value**: Any long random string (e.g. 64 characters) used for session signature.
4. Click **Deploy / Save**.

---

## 🚀 Deployment

- **Hosting**: Cloudflare Workers with Static Assets
- **Domain**: [ashabd.in](https://ashabd.in)
- **Source of Truth**: GitHub `main` branch
- Any commit pushed to `main` automatically deploys via Cloudflare's Git integration.
