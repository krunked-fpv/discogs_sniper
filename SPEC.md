# Functional & Technical Specification — Discogs Sniper v3.0

> **Repository:** `https://github.com/krunked-fpv/discogs_sniper`
> **Live Site:** `https://krunked-fpv.github.io/discogs_sniper/`
> **Companion Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Design Contract:** [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)

---

## 1. Product Mission & Scope

Discogs Sniper monitors `@krunked`'s filtered Discogs Wantlist Marketplace (`LP`, `Vinyl`, `Ships From: United States`, `Sort: Listed Newest`) around the clock, filters out high-frequency mega-seller auto-relist spam (notably `recordmule`), cross-references every candidate pressing against the 159-LP sibling **Collection Vault** (`krunked-fpv/discogs_collection`), dispatches actionable high-priority alerts with 1-Click Add-to-Cart links, and compiles a zero-backend **GitHub Pages PWA Command Center** for crate auditioning, multi-LP bundle math, make-offer negotiation, relist forensics, and live Wantlist pruning.

---

## 2. Plane 1 Specification — Automated Harvester (`discogs_sniper.py`)

> **Governance Notice:** `discogs_sniper.py` is under **IRON LAW FREEZE**; this specification documents its authoritative runtime contract.

### 2.1 Execution Modes & CLI Interface
| CLI Flag | Behavior |
| :--- | :--- |
| `python discogs_sniper.py` | Single delta check (invoked every 5 minutes by Windows Task Scheduler `DiscogsSniper`). |
| `--login` | Opens visible persistent Chromium (`chrome_discogs_profile/`) to refresh Discogs login / Cloudflare cookies. |
| `--reseed` | Forces a clean baseline write to `seed_snapshot.json` without firing alerts. |
| `--test` | Enriches and sends a live test alert for the #1 top Wantlist item. |
| `--daemon` | Continuous foreground loop with `45–75s` randomized jitter. |
| `--api-check` | Verifies `DISCOGS_TOKEN` (`/oauth/identity`), API quota remaining, live Wantlist size, and exact-owned Vault overlaps; persists `data/wantlist_sync.json`. |
| `--prune-owned [--dry-run]` | Uses live `GET /users/{username}/wants` as sole source of truth and issues `DELETE /users/{username}/wants/{release_id}` ONLY for exact-owned pressings still on the live Wantlist; re-verifies post-prune and triggers UI rebuild. |
| `--build-ui` | Invokes `scripts/build_dashboard.py` directly without opening Playwright. |
| `--token <PAT> / --username <USER>` | Explicit credential overrides. |

### 2.2 Harvesting, Deduplication & Filtering Rules
1. **Dual-Engine Capture:** Intercepts `/graphql` (`MarketplaceSearch`) while scrolling virtualized desktop DOM across 8 positions (`0..4200px`), deduplicating by exact `data-index` (`0..24`) and preserving self-titled album prefixes (e.g., `"The Used - The Used"`). Retries once after `2.5s` if 0 rows mount.
2. **Multi-Copy Batch Consolidation:** Same-run hits sharing `(release_id, seller, media_condition, total_price_usd)` collapse into 1 alert carrying `batch_copy_count` and `batch_listing_ids[]`.
3. **Semantic Auto-Relist Suppression:**
   - Fingerprint: `"{release_id}::{seller.lower()}::{media_condition.upper()}"`.
   - Suppresses relists within `cooldown_days` (`7`) or from `price_drop_only_sellers` (`["recordmule"]`) **UNLESS** total shipped price dropped below `min(last_price_usd, lowest_price_usd)` by `>= price_drop_override_usd` (`$1.00`) OR `>= price_drop_override_pct` (`3.0%`).
   - Enforces `muted_sellers`, `max_total_price_usd`, and optional `suppress_exact_owned_alerts`.
4. **Alerts:** HTML email via Gmail SMTP SSL (`465`, `X-Priority: 1`, primary + CC) and optional `ntfy.sh` urgent push, with full `html.escape(..., quote=True)` sanitization and direct `VIEW LISTING` + `1-CLICK ADD TO CART` buttons.

---

## 3. Plane 2 Specification — Compiler (`scripts/build_dashboard.py`)

### 3.1 Compiler Inputs & Outputs
- **Inputs:** `seed_snapshot.json`, `sniper_config.json`, `data/log_forensics.json`, `sniper.log`, `data/vault_crossref.json`, `data/releases_cache.json`, optional `data/wantlist_sync.json`, `src/template.html`, `src/styles/*.css`, `src/js/*.js`.
- **Outputs:**
  - `data/sniper_state.json` (`schema_version: "3.0.0"`)
  - Concatenated `src/styles.css` and `src/app.js` (wrapped in an IIFE `"use strict"`)
  - Self-contained `index.html` with injected `/* __INJECT_STYLES_CSS__ */`, `__INJECT_SNIPER_STATE_JSON__` (RFC 8259 escaped), and `// __INJECT_APP_JS__`
  - Optional `_site/` clean static artifact via `--stage-dir _site`
- **Performance Budget:** `<0.15s–0.25s` offline build time on local workstation; zero network calls unless `--sync-wantlist` is passed.

### 3.2 Deterministic Analytics Engines
1. **Procedural Wax Shader Parser (`parse_wax_shader`):** Maps Discogs format/variant strings into `pattern` (`solid`, `picture`, `splatter`, `split`, `marble`, `smoke`, `translucent`), `subpattern` (`cornetto`, `starburst`, `pinwheel`, `galaxy`, `swirl`), 3-stop hex palette (`primary`, `secondary`, `accent`), `is_etched`, `is_foil_sleeve`, `is_numbered`, `is_180g`, `rpm` (`33`/`45`), and deterministic `seed`.
2. **HTML Entity Normalization & Collector Signal Extractor (`decode_html_entities` + `extract_collector_signals`):** Recursively converges N-layer HTML entities (up to 12 passes via stdlib `html.unescape`) on `raw_description`, `variant`, `title`, and `seller_info`, strips redundant boilerplate where `raw_description == variant` (`clean_seller_note = ""`), and extracts structured badges (`SIGNED`, `SEALED`, `UNPLAYED`, `HYPE_OBI`, `NUMBERED`, `FOIL`, `VMP`, `SALE`, `WEAR_WARN`).
3. **Authentic 3-Tier Benchmark & Deal Scoring:**
   - Precedence: Official Discogs API price suggestion -> Vault median × condition multiplier -> Per-seller deduplicated observed median (`>= 2` distinct sellers with price spread) -> `UNRATED`.
   - Tiers: `STEAL` (`<= -15%`), `GREAT_DEAL` (`<= -3%`), `FAIR_MARKET` (`<= +12%`), `ABOVE_MARKET` (`> +12%`), `UNRATED`. Score bonuses for genuine price drop (`+16`), Make Offer (`+5`), and Missing Grail (`+4`).
4. **Multi-LP Seller Bundle Optimizer (`build_seller_bundles`):** Groups sellers holding `>= 2` active deduped offerings, classifies shipping policies (`FREE_SHIPPING`, `FLAT_UNLIMITED`, `COMBINED_ESTIMATE`), and calculates `shipping_saved_usd`, `bundled_total_usd`, and `avg_landed_per_lp_usd`.
5. **Make-Offer Haggle Strategist (`compute_offer_strategy`):** Computes `aggressive_offer_usd <= recommended_offer_usd <= instant_close_offer_usd` clamped to `[58%, 95%]` of list price, factoring jacket wear (`-7%`), heavy relist churn `>= 3x` (`-5%`), and multi-LP bundle leverage, plus a copy-ready collector pitch.

---

## 4. Static Web Command Center Specification (6 Views + Modals + Audio)

### 4.1 Global Shell & 5-Channel Telemetry Ribbon
- **Sticky Hardware Header:** Brand mark + `KRUNKED // DISCOGS SNIPER`, live rig sync heartbeat badge (`#rig-heartbeat-btn`), 6-tab navigation rail (`Drop Radar`, `3D Crate`, `Alpha`, `Forensics`, `Vault`, `Remote`), background Hydrator pill, `⌘K` Command Palette trigger, Lighting Mode cycler (`U`), Connect API modal trigger, and external links to Discogs Wantlist + sibling **Vinyl Vault**.
- **5-Channel KPI Ribbon:** Clickable cards jumping straight to filtered views:
  1. `Active Offerings` (`#kpi-card-offerings`)
  2. `Sniper Alpha` (`#kpi-card-alpha`)
  3. `Relist Shield` (`#kpi-card-relists`)
  4. `Vault Showdown` (`#kpi-card-vault`)
  5. `Rig & Hydrator` (`#kpi-card-engine`)

### 4.2 Six Tactical Views
1. **`#view-radar` — Tactical Drop Radar:**
   - Instant search (`/`), dataset scope (`All Tracked` vs `Live Top-25`), layout density (`Cards` vs Bloomberg-style `Matrix` table), `Relist Shield` toggle (collapse same-seller relists), `Hide Sold` toggle, minimum media grade filter, 7 sort modes, 9 category filter chips (`ALL`, `MISSING_GRAIL`, `STEALS`, `PRICE_DROP`, `BUNDLE_READY`, `MAKE_OFFER`, `TARGET_HITS`, `VARIANT_UPGRADE`, `ALREADY_OWNED`), independent `Hide recordmule` toggle, and max-shipped price slider.
   - Cards feature tactile sleeve-peek colored vinyl rendering, collector badges, price-trajectory sparklines, expandable relist history drawers, 1-Click Add-to-Cart, 30s studio audio audition, quick inspect, and silent `IntersectionObserver` Token-Bucket API hydration cached in IndexedDB (`krunked_sniper_idb_v3`, 6h TTL).
2. **`#view-crate` — 3D Crate Digging & Direct-Drive Turntable Studio:**
   - Interactive 3D angled vinyl crate (`drag`, `wheel`, `slider`, arrow keys), category chips (`ALL`, `MISSING_GRAIL`, `VARIANT_UPGRADE`, `MAKE_OFFER`, `COLORED`), and **Grail Radio** auto-advance.
   - HiDPI Canvas2D procedural colored-vinyl platter (`#turntable-platter-canvas`), animated S-tonearm drop/lift, `33⅓` / `45 RPM`, `±8%` quartz pitch slider (`preservesPitch = false`), synthesized Web Audio crackle (`OFF` / `WARM` / `DUSTY`), and live 32-band FFT spectrum canvas (`#turntable-fft-canvas`).
3. **`#view-alpha` — Sniper Alpha:**
   - **Multi-Grail Seller Bundle Optimizer** with per-LP checkboxes recalculating live landed cost & multi-cart launch.
   - **Make-Offer Strategist Desk** with 3-tier offer targets, interactive slider, and 1-click buyer pitch copy.
   - **Target Snipe Watchlist (`target_prices_by_release`)** with instant 14-day snapshot backtesting.
4. **`#view-forensics` — Relist Forensics & Bot Weather:**
   - Live **Grail Weather Clock** detecting `01:00` and `12:00–13:59` mega-seller burst windows.
   - 24-hour alert histogram and 14-day Task Scheduler check volume chart (highlighting the 288 runs/day baseline & Nov 12 duplicate-trigger fix).
   - **Bluff Detector** (`Genuine Cuts` vs `Yo-Yo Bluffs` vs `Flatline Bots`), searchable seller leaderboard with live `Drop-Only` and `Mute` controls, and Top 15 Churned Releases with sparklines.
5. **`#view-vault` — Sibling Vault Split-Screen Showdown & Wantlist Pruner:**
   - Live fetch of `https://krunked-fpv.github.io/discogs_collection/data/collection.json` to compare owned **Shelf Pressing** vs **Market Target** side-by-side.
   - Live Wantlist overlap audit (`Sync Live Wantlist`, 1-click API prune `DELETE /users/{user}/wants/{id}`, copyable CLI command `python discogs_sniper.py --prune-owned`) separating active overlaps from collapsible historical archive (`CLEARED_FROM_WANTLIST`).
6. **`#view-rules` — Two-Way GitHub Remote Control, Discogs API & Rule Builder:**
   - Live repo snapshot pull from `raw.githubusercontent.com`, optional GitHub Fine-Grained PAT (`localStorage` only) to commit `sniper_config.json` to `main` and dispatch `static.yml`.
   - Live Discogs API identity verification (`/oauth/identity`), price suggestions test, Auto-Hydrate toggle, IndexedDB cache purge, and full `sniper_config.json` form builder with JSON preview/download/copy.

### 4.3 Modals, Bottom Audio Dock & Keyboard Shortcuts
- **Modals:** `#cmd-palette-backdrop` (`Ctrl/Cmd + K`), `#inspect-modal-backdrop` (Pressing Quick-Inspect + Haggle + Target Pin + Vault Photo Reference), `#api-modal-backdrop` (Quick Credential Connect).
- **Fixed Bottom Transport (`#audio-transport-bar`):** Persistent 30s studio preview player with cover art, EQ bars, play/pause, `33⅓`/`45` toggle, interactive scrubber, jump-to-Deck, and 1-Click Add-to-Cart.
- **Keyboard Shortcuts:** `J`/`K` focus card, `Space` audition 30s preview, `C` 1-Click Cart, `O` Inspect & Haggle, `T` Pin Target Price, `M` Mute Seller, `U` Cycle Lighting Mode, `/` Focus Search, `Ctrl/Cmd+K` Command Palette, `Esc` Close active modal/popover.

---

## 5. Verification & Acceptance Criteria

Every change to `discogs_sniper` MUST pass:
1. `python scripts/build_dashboard.py` exits `0` in `<0.5s` and emits zero unresolved template placeholders (`__INJECT_*`).
2. `python scripts/build_dashboard.py --check` exits `0`.
3. `python -m unittest discover -s tests -p "test_*.py" -v` passes 100% of unit, forensic, bundle, haggle, staging, and RFC 8259 escaping tests.
4. Browser verification at `http://localhost:8765` confirms zero console/page errors, clean mobile & desktop responsive layout, functioning lighting modes (`U`), Command Palette (`Ctrl+K`), all 6 views, and zero `OPTIONS` preflight failures on Discogs API requests.
5. `git diff --stat discogs_sniper.py` is empty (Iron Law Freeze) and `.env` is untracked in git while remaining intact on disk.
