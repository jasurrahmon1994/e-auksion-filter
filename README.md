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

## Deploy To Render

This repo includes `render.yaml` for a Render web service.

1. Push the repo to GitHub/GitLab.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Use the default commands from `render.yaml`:
   - Build command: `npm install`
   - Start command: `npm start`

The server reads `process.env.PORT`, which Render provides for web services.

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
