# Discogs Sniper v3.0 — Obsidian Turntable & Tactical Command Center

> **Outsmart the relist bots. Snipe true Wantlist grails with live API hydration, 3D turntable auditioning, multi-LP bundle math, and two-way GitHub remote control.**  
> A hybrid Python + Official Discogs REST API v2.0 (`https://api.discogs.com`) + Playwright automation engine (`C:\discogs_sniper`) paired with a zero-dependency **Static GitHub Pages PWA Command Center** ([`index.html`](index.html)). Monitors your filtered Discogs Wantlist Marketplace every 5 minutes, intercepts in-origin `/graphql` (`MarketplaceSearch`) payloads alongside the virtualized desktop DOM, eliminates daily auto-relist spam (*"The `recordmule` Slayer"*), cross-references your 159-LP [Discogs Collection Vault (`krunked-fpv/discogs_collection`)](https://github.com/krunked-fpv/discogs_collection), and dispatches high-priority HTML alerts with **1-Click Add-to-Cart** links.

![Version](https://img.shields.io/badge/version-v3.0.0-00f0ff?style=for-the-badge)
![Discogs API](https://img.shields.io/badge/Discogs_REST_API-v2.0_Token--Bucket-39ff88?style=for-the-badge)
![Engine](https://img.shields.io/badge/engine-GraphQL_%2B_Playwright_CDP-b829ff?style=for-the-badge&logo=playwright)
![PWA](https://img.shields.io/badge/GitHub_Pages-Installable_PWA-ff007a?style=for-the-badge&logo=github)

---

## What's New in `v3.0.0` — Reimagined GitHub Pages Experience

### 1. Six Tactical Views & Three Hardware Lighting Profiles (`U`)
Switch seamlessly between **NEON Telemetry**, **UV Blacklight Overdrive**, and **Vacuum Tube Amp** (`U` shortcut) across six dedicated stations:
1. **Drop Radar (`#view-radar`):**
   - **Cards vs. Matrix Tape Layout:** Toggle between holographic vinyl sleeve cards and a high-density Bloomberg-style ticker table with inline price-trajectory sparklines.
   - **Zero-Click Token-Bucket Background Hydrator + IndexedDB Cache:** Uses `IntersectionObserver` + rate-limit-safe pacing (`1.25s` w/ token, `3.1s` anonymous, auto-backoff on `429`) to silently enrich visible cards with `/marketplace/price_suggestions`, market stats, and live `For Sale` vs. `Sold (404)` detection (`Hide Sold` toggle).
   - **Collector Signal Extraction:** Suppresses redundant `raw_description == variant` boilerplate and surfaces crisp badges (`SIGNED`, `SEALED`, `UNPLAYED`, `HYPE / OBI`, `NUMBERED`, `FOIL JACKET`, `CLUB / VMP`, `JACKET WEAR`).
   - **Keyboard-Driven Workflow:** `J`/`K` focus cards, `Space` spin 30s audio, `C` 1-Click Cart, `O` Inspect & Haggle, `T` Pin Target Price, `M` Mute Seller, `/` Search, and `Cmd/Ctrl+K` Command Palette.
2. **3D Crate Digging & Direct-Drive Turntable Studio (`#view-crate`):**
   - Interactive CSS 3D angled record crate with drag/wheel/slider/arrow scrubbing and **Grail Radio Auto-DJ** continuous auditioning.
   - HiDPI **Canvas2D procedural colored-vinyl shaders** (`splatter`, `split`, `cornetto`, `starburst`, `pinwheel`, `marble`, `galaxy`, `smoke`, `translucent`, `etched`) with rotating anisotropic groove sheen, gimbal S-tonearm needle drop, `33⅓` vs `45 RPM`, `±8%` Quartz Pitch slider, toggleable synthesized vinyl crackle (`OFF` / `WARM` / `DUSTY`), and a live 32-band **Web Audio API FFT spectrum visualizer**.
3. **Sniper Alpha (`#view-alpha`):**
   - **Multi-Grail Seller Bundle Optimizer:** Detects sellers holding 2+ Wantlist LPs (16+ bundles including `recordmule`'s `$7.50 Flat-Rate Unlimited`, `JerseyRecs`'s `Free US Shipping`, and `QuickRecords`'s 5-LP cluster) with live interactive per-LP checkboxes, recalculated landed cost, multi-cart launcher, and copyable shipping inquiry.
   - **Make-Offer Haggle Desk:** Computes `Aggressive`, `Recommended`, and `Instant Close` item offers from condition-graded market comps, seller churn leverage, and jacket-wear notes—plus an interactive slider and 1-click buyer pitch.
   - **Target Snipe Watchlist & 14-Day Backtester:** Pin max shipped USD targets (`target_prices_by_release`) and immediately backtest against 14-day snapshot history.
4. **Relist Forensics & Bot Weather (`#view-forensics`):**
   - Live **Grail Weather Clock** (detecting active `01:00` / `12:00–13:59` mega-seller bot burst windows vs. indie windows), **Bluff Detector** (`Genuine Cuts` vs `Yo-Yo Bluffs` vs `Flatline Bots`), 24h & 14-day `288/day` Task Scheduler histograms, searchable 88-seller leaderboard, and Top Churned Releases with sparklines.
5. **Vault Split-Screen Showdown & Wantlist Pruner (`#view-vault`):**
   - Fetches live [`krunked-fpv.github.io/discogs_collection/data/collection.json`](https://krunked-fpv.github.io/discogs_collection/data/collection.json) to compare your **Shelf Pressing** (CV disc photograph & `wax_spec`) side-by-side against **Market Target** pressings in a Variant Hunter split-screen, alongside live Wantlist overlap verification and pruning.
6. **Two-Way GitHub Remote Control & Rule Builder (`#view-rules`):**
   - **Engine Heartbeat Telemetry:** Displays live sync freshness for the local 5-minute Windows Task Scheduler rig.
   - **Remote Sync (`localStorage` PAT only):** Pull fresh `data/sniper_state.json` directly from GitHub `main`, commit updated `sniper_config.json` rules/mutes/target prices back to `main`, and trigger `workflow_dispatch` remotely.
   - **Clean Artifact Staging (`--stage-dir _site`) & Installable PWA:** `.github/workflows/static.yml` deploys strictly public web + PWA files (`index.html`, `manifest.webmanifest`, `sw.js`, icons, `data/*.json`), excluding `.env` and backend scripts.

---

## Core Local Engine (Protected & Unchanged)
- `discogs_sniper.py` preserves the Windows 11 Task Scheduler workflow (`setup_task.ps1`, `run_sniper.ps1`), persistent off-screen Playwright Chromium + in-origin `/graphql` + DOM harvesting, `SingleInstanceLock`, idempotent `seed_snapshot.json` / `relist_ledger` deduplication, Collection Vault cross-referencing, and Gmail SMTP / `ntfy.sh` alerting.

---

## Repository Structure (`C:\discogs_sniper`)

```text
discogs_sniper/
├── .github/
│   └── workflows/
│       └── static.yml                     # Builds (--sync-wantlist --stage-dir _site) & deploys clean PWA artifact
├── data/
│   ├── log_forensics.json                 # Parsed telemetry from 5,600+ checks & 225+ alerts in sniper.log
│   ├── sniper_state.json                  # Compiled v3.0.0 dataset: listings, bundles, haggle tiers & wax specs
│   ├── vault_crossref.json                # 159-LP Collection Vault cross-reference & Discogs CDN covers
│   └── wantlist_sync.json                 # (Optional/auto-generated) Verified live Wantlist snapshot from API sync
├── scripts/
│   └── build_dashboard.py                 # Fast zero-Node modular compiler: data/* + src/* -> index.html & _site/
├── src/
│   ├── styles/                            # Modular hardware CSS (01-tokens-chassis .. 04-alpha-vault-modals)
│   ├── js/                                # Modular ES6 frontend (00-core-state .. 07-modals-palette-boot)
│   ├── template.html                      # Modular HTML5 shell, 5-KPI ribbon, 6 tactical views & modals
│   ├── styles.css                         # Compiled stylesheet bundle
│   └── app.js                             # Compiled JS bundle
├── tests/
│   └── test_sniper_v2.py                  # Unit & forensic tests for engine, v3.0 alpha math, staging & escaping
├── manifest.webmanifest / sw.js           # Installable PWA manifest & offline-capable Service Worker
├── discogs_sniper.py                      # Core hybrid API + GraphQL + Playwright sniper engine
├── sniper_config.json                     # Declarative relist cooldown, price-drop, target price & seller rules
├── seed_snapshot.json                     # Unified 2,000-item rolling state snapshot + idempotent relist_ledger
├── index.html                             # Compiled self-contained GitHub Pages Command Center
├── setup_task.ps1 / run_sniper.ps1        # Windows Task Scheduler & foreground loop scripts
└── .env                                   # Local runtime credentials (excluded from _site Pages artifact)
```

---

## CLI Reference & Verification

| Command | Behavior |
| :--- | :--- |
| `python discogs_sniper.py` | **Standard Delta Run** (5-minute Task Scheduler cycle). |
| `python discogs_sniper.py --api-check` | **Official Discogs API & Live Vault Diagnostics.** |
| `python discogs_sniper.py --prune-owned` | **Live Wantlist Cleanup** (`DELETE /users/krunked/wants/{release_id}`). |
| `python scripts/build_dashboard.py` | **Compile v3.0 Command Center** (`data/sniper_state.json` + `index.html` in `<0.2s`). |
| `python scripts/build_dashboard.py --sync-wantlist --stage-dir _site` | **CI Production Build** with clean static staging (excludes `.env` & Python code). |
| `python -m unittest discover -s tests -p "test_*.py" -v` | **Run Complete Test Suite** (engine + compiler + staging + XSS escaping). |
