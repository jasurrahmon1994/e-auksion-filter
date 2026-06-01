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
