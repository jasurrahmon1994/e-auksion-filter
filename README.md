# E-AUKSION Local Filter

Dependency-free local viewer for public E-AUKSION lot data.

## Run

```powershell
node .\server.js
```

Then open:

```text
http://localhost:5177
```

## Update Sharq Candidates

When `reports\All.xlsx` changes, regenerate the Sharq possible later-auction data:

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_sharq_candidates.py
```

The script reads the `All` and `OnSale` sheets and writes `public\sharq-candidates.json`, which the Sharq map loads on refresh.

## Update Sharq On-Sale Flat Details

When the `OnSale` sheet in `reports\All.xlsx` changes, regenerate the flat-level analyzer data:

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_sharq_onsale_flats.py
```

The script writes `public\sharq-onsale-flats.json`. The Sharq flat analyzer uses this file for exact price, floor, area, rooms, auction end, and lot-number details when a code such as `46A/4/25` is currently on sale.

## Update New Tashkent Map Context

If you refresh the official New Tashkent GeoJSON/KMZ data into `reports\newtashkent-kmz-data.json`, regenerate the compact browser context:

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_newtashkent_context.py
```

The script writes `public\newtashkent-context.json`, which the Sharq workspace uses for official map links, planning-area counts, and nearby land-use context.

To regenerate the rough per-lot official planning context for Sharq Bahori:

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_sharq_official_lot_context.py
```

The script writes `public\sharq-official-lot-context.json`. It uses the Yandex Sharq Bahori point and broad bounds plus the current Sharq overview markers, so treat per-lot coordinates as planning-context estimates rather than exact survey positions.

## Deploy To Render

This repo includes `render.yaml` for a Render web service.

1. Push the repo to GitHub/GitLab.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Use the default commands from `render.yaml`:
   - Build command: `npm install`
   - Start command: `npm start`

The server reads `process.env.PORT`, which Render provides for web services.

## New Lot Telegram Notifications

The server can poll for newly listed Sharq Bahori lots and post a Telegram message for each one found.

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Message the bot (or add it to a group) and find your chat ID, e.g. via `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Set these environment variables before starting the server:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `NEW_LOT_POLL_INTERVAL_MS` (optional, default `300000` = 5 minutes)

The first poll after startup only records the currently listed lots as a baseline (no messages sent). Every poll after that sends a message for each lot that wasn't seen before, with the lot name, rooms, area, price, and price per square meter. Lots are identified by their apartment code (e.g. `44B/2/52`), not the numeric lot ID, since an unsold lot gets a new ID when E-AUKSION relists it. Seen apartment codes are cached in `reports/seen-sharq-lots.json`.

You can trigger a check immediately (without waiting for the interval) with:

```powershell
Invoke-RestMethod -Uri "http://localhost:5177/api/check-new-lots" -Method POST
```

## Notes

- The local server proxies requests to `https://e-auksion.uz/api/front/lots`.
- It computes the required `zz_md5` request signature used by the public website.
- Defaults are set to the page you asked about: `group=41`, `category=169`.
- This relies on E-AUKSION internal frontend endpoints, not a documented public API.

## Features

- Table and card views.
- Load all pages for the current search.
- Optional detail enrichment for building lot, floor/storey, area, rooms, and handover/completion term.
- Local filtering by text, price, and applications.
- Completed status filtering.
- Date presets: today, this month, last month, last 90 days.
- Result summary stats.
- JSON and CSV export.
- Copy filtered lot links.
- Saved searches in browser localStorage.
- Optional auto refresh with a last-updated timestamp.
