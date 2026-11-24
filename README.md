# ESST Football Tournament

A football tournament website: players, teams, league calendar, standings, match reports, a FIFA-style formation editor,
follow system and chat (private, team group chat, voice notes, photos, shared matches/players/teams).
One small Node server serves the website and the API; **all data lives in Railway PostgreSQL** (photos, logos, voice notes and
chat images included). No Supabase, Firebase, Cloudinary, S3 or CDN. The only dependency is `pg`.

## Put it online on Railway (about 5 minutes)

1. Upload this folder to a GitHub repository (keep the folders as they are).
2. Railway → **New Project → Deploy from GitHub repo** → pick it.
3. In the same project: **+ New → Database → Add PostgreSQL**.
4. Web service → **Variables** → add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`
   (use the real name of your database service if it is not "Postgres").
5. Web service → **Settings → Networking → Generate Domain**, then open the address.

On every start the server creates or updates the tables by itself (**Deploy Logs** should end with `[db] ready`).
Migrations are idempotent: they never delete data and are safe on an empty or an existing database. No demo data is created.

### Check the database once (strongly recommended)
The SQL in `migrations/` could not be executed on a real PostgreSQL while the project was written
(no PostgreSQL was available). Run this once, from your computer or the Railway shell:

    npm install
    DATABASE_URL="postgres://..." npm run verify-db

It runs everything inside a transaction that is rolled back (your data is not touched), runs all migrations twice,
checks every table/function exists, runs smoke queries, checks that visitors cannot read the private chat tables and
that team chats follow the roster. Each check prints PASS / FAIL. Send me any FAIL line and I fix it.
(Railway: Postgres service → *Connect* → copy the **public** connection URL for use from your computer.)

## Open it by double-click (no hosting needed for the pages)
`index.html` also works from a file. Open `config.js` once and paste your Railway address:

    window.ESST_CONFIG = { API_BASE: "https://your-app.up.railway.app" };   // no slash at the end

On Railway itself leave `API_BASE` empty. The site uses hash links (`#/chat`), the login token is sent in the
`Authorization` header (no cookies), and scripts are plain `<script>` tags (no modules), so `file://` works.

## The super admin (only one exists)
1. Register like any player and log in.
2. **Settings → Tournament admin** → type the admin password → *Activate*.
3. The shield icon in the header opens the admin area (teams, league launch/rebuild, schedule, results, requests, hand-over).
4. To change the password: in Railway set `SUPER_ADMIN_PASSWORD_HASH` (preferred; format `scrypt$salt$hash`)
   or `SUPER_ADMIN_PASSWORD`, then redeploy. The password is never stored or shown in clear text.
5. **Admin → Hand over the super admin role** gives the role to another player (type `HANDOVER`); you become a normal member.

The server checks every permission itself; hidden buttons are never the protection.

## Optional variables
`JWT_SECRET` (32+ characters; otherwise a random one is created and kept in the database), `PORT` (Railway sets it).

## Chat in short
- Real time = Server-Sent Events. If the connection cannot be kept open the page polls every 5 seconds instead.
- Limits: 2000 characters per message, voice notes up to 2 minutes (3.5 MB), photos are shrunk in the browser to about 1280 px JPEG.
- Voice recording needs a secure page (https, or a file opened locally) and the microphone permission.
- Messages can only be deleted by their sender. A blocked person cannot send messages either way.

## Tests
    node --test test/*.test.js        # unit + server tests (no database needed)
    npm run verify-db                 # needs DATABASE_URL, see above
The browser suites (s3 … s9, with a fake API server and a real headless Chrome) live in the separate `esst-test-harness` folder.

## Folder map
    server.js  auth.js  rest.js  db.js  media.js  chat.js  league.js  leagueapi.js  util.js   server (Node, only dependency: pg)
    schema.sql  indexes.sql  migrations/001..004, 099   database (099_permissions.sql must stay LAST)
    index.html  config.js  css/  assets/ (inline Lucide icons)   website shell
    js/core/    util, i18n, api, session, ui, router, forms, media, pickers, league, chat (live delivery), ...
    js/pages/   one file per area (auth, profile, teams, league, formation, search, chat, admin, settings, misc)
    js/i18n/    en.js  fr.js  ar.js (every text exists in all three; test/i18n.test.js enforces it)
    scripts/verify-db.js   real-database check
    test/       unit and server tests

## Not included
Password reset by e-mail (no mail service is allowed), FIFA-style attribute numbers (only real recorded data is shown),
push notifications when the site is closed.
