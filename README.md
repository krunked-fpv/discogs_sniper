# KRUNKED // DISCOGS SNIPER (v3.0)

> **Outsmart the relist bots. Snipe true Wantlist grails with live Discogs REST API v2.0 hydration, 3D turntable auditioning, multi-LP bundle math, and unified Obsidian Vinyl Suite styling.**

**[Launch Live Discogs Sniper PWA (krunked-fpv.github.io/discogs_sniper)](https://krunked-fpv.github.io/discogs_sniper/)** • **[Sibling Discogs Vinyl Vault (krunked-fpv.github.io/discogs_collection)](https://krunked-fpv.github.io/discogs_collection/)** • **[Architecture](ARCHITECTURE.md)** • **[Engineering & Agents](AGENTS.md)** • **[Specification](SPEC.md)** • **[Design System](DESIGN_SYSTEM.md)**

![Version](https://img.shields.io/badge/version-v3.0.0-22d3ee?style=for-the-badge)
![Discogs API](https://img.shields.io/badge/Discogs_REST_API-v2.0_Token--Bucket-10b981?style=for-the-badge)
![Engine](https://img.shields.io/badge/engine-GraphQL_%2B_Playwright_CDP-a855f7?style=for-the-badge&logo=playwright)
![Suite](https://img.shields.io/badge/Krunked_Vinyl_Suite-Obsidian_Anodized_PWA-c026d3?style=for-the-badge&logo=github)

---

## Unified Krunked Vinyl Suite Aesthetic (`discogs_collection` v6.0 Parity)

**Discogs Sniper** shares one cohesive dark-obsidian machined hardware design language with its sibling collection showcase, **[KRUNKED // DISCOGS VINYL VAULT (`krunked-fpv/discogs_collection`)](https://krunked-fpv.github.io/discogs_collection/)**:

- **Anodized Studio Chassis:** Brushed aluminum `.machined-plinth` panels (`#05060b` / `#0b0e16` / `#111524`), `.anodized-panel` recessed bays, fuchsia-violet-cyan active navigation gradients (`#c026d3 -> #7c3aed -> #06b6d4`), `Inter` + `Space Grotesk` + `JetBrains Mono` typography, and dynamic wax ambient lighting.
- **Suite Switcher & Lighting Modes (`U`):** Jump directly between **Collection Vault** and **Wantlist Sniper** from the sticky top bar, and cycle **Studio Obsidian**, **UV 395nm Blacklight** (`uv-blacklight`), and **Vacuum Tube Amp** lighting profiles.
- **Tactile Sleeve-Peek Vinyl Physics:** Hovering any Drop Radar card tilts the holographic album jacket while the procedural colored-vinyl pressing slides smoothly out of the sleeve.
- **Shadow-Cookie Preference Healing (`krunked-cookie-vault-v1`):** Mirrors non-sensitive UI preferences (lighting mode, filters, seller rules) across reloads via 400-day `kv1_*` cookies while strictly keeping `DISCOGS_TOKEN` and GitHub PATs inside browser `localStorage` only.

---

## Dual-Plane Architecture

1. **Plane 1 — Windows 11 5-Minute Harvester & Alert Engine (`discogs_sniper.py`):**
   - Runs every 5 minutes (`288 runs/day`) via Windows Task Scheduler (`setup_task.ps1` + windowless `pythonw.exe`) guarded by `SingleInstanceLock` (`sniper.lock`).
   - Uses persistent off-screen Playwright Chromium (`headless=False`, `--window-position=-32000,-32000`, CDP focus emulation) with a **Dual-Engine Harvester** merging in-origin `/graphql` (`MarketplaceSearch`) edges and scrolled virtualized desktop DOM rows.
   - Eliminates mega-seller auto-relist spam (*"The `recordmule` Slayer"*) via an idempotent `relist_ledger` (`release_id::seller::media_condition`) and `sniper_config.json`, cross-references your 159-LP Collection Vault, enriches via Official Discogs REST API v2.0, and sends high-priority HTML alerts (Gmail SMTP SSL + CC + optional `ntfy.sh`) with **1-Click Add-to-Cart** links.
2. **Plane 2 — `<0.15s` Offline Static Compiler & Zero-Backend GitHub Pages PWA (`scripts/build_dashboard.py`):**
   - Zero-Node Python compiler assembling `seed_snapshot.json`, `sniper_config.json`, `data/log_forensics.json`, `data/vault_crossref.json`, `data/releases_cache.json`, optional `data/wantlist_sync.json`, and modular `src/*` into `data/sniper_state.json`, self-contained `index.html` (with RFC 8259 `\u003c/` + `\u003c!--` script escaping and recursive HTML entity decoding), and clean `_site/` artifacts.
   - Deployed via a two-job (`build` -> `deploy`) GitHub Actions workflow (`.github/workflows/static.yml`) that stages strictly public web/PWA files and guarantees `.env` and backend scripts never enter Pages artifacts.

---

## Six Tactical Views

1. **Drop Radar (`#view-radar`):** Sleeve-peek vinyl cards + Bloomberg-style Matrix Tape, `Relist Shield`, `Hide Sold`, `Hide recordmule`, Collector Signal badges (`SIGNED`, `SEALED`, `HYPE / OBI`, `FOIL`, `JACKET WEAR`), authentic 3-tier market benchmarks, and zero-preflight `?token=` Token-Bucket Background API Hydration cached in IndexedDB (`6h` TTL).
2. **3D Crate & Direct-Drive Turntable Studio (`#view-crate`):** Tactile 3D angled crate flipper, **Grail Radio** continuous auditioning, HiDPI Canvas2D procedural colored-vinyl platter, S-tonearm needle drop, `33⅓` / `45 RPM`, `±8%` quartz pitch, synthesized vinyl crackle (`OFF` / `WARM` / `DUSTY`), and live 32-band Web Audio FFT spectrum visualizer (iTunes + Deezer JSONP 30s previews).
3. **Sniper Alpha (`#view-alpha`):** Multi-Grail Seller Bundle Optimizer (live per-LP landed shipping math), Make-Offer Haggle Desk (3-tier condition-calibrated targets + 1-click buyer pitch), and `target_prices_by_release` Watchlist with 14-day snapshot backtesting.
4. **Relist Forensics & Bot Weather (`#view-forensics`):** Live Grail Weather Clock (`01:00` / `12:00–13:59` mega-seller burst windows), 24h & 14-day Task Scheduler histograms (`288 runs/day` baseline), Bluff Detector (`Genuine Cuts` vs `Yo-Yo Bluffs` vs `Flatline Bots`), searchable seller leaderboard (`Drop-Only` / `Mute`), and Top 15 Churned Releases with sparklines.
5. **Vault Showdown & Wantlist Pruner (`#view-vault`):** Live fetches [`krunked-fpv.github.io/discogs_collection/data/collection.json`](https://krunked-fpv.github.io/discogs_collection/data/collection.json) for side-by-side Shelf Pressing vs. Market Target comparison, live Discogs Wantlist audit, and 1-click Wantlist overlap pruning.
6. **Two-Way GitHub Remote & Rule Builder (`#view-rules`):** Live rig heartbeat monitor, remote `sniper_state.json` pull, optional browser-only GitHub PAT commit for `sniper_config.json` + Pages workflow dispatch, live Discogs API console, and visual rule builder.

---

## Documentation & Governance

| Document | Purpose |
| :--- | :--- |
| **[`ARCHITECTURE.md`](ARCHITECTURE.md)** | Dual-plane topology (Mermaid diagram), sibling ecosystem bridge, exact JSON/storage contracts, and hard technical invariants. |
| **[`AGENTS.md`](AGENTS.md)** | Quick-start commands, non-negotiable Iron Laws (Python core freeze, runtime protection, zero-preflight API rule), and named agent callback directory. |
| **[`SPEC.md`](SPEC.md)** | Full functional & technical specification across Plane 1 CLI, Plane 2 compiler, all 6 web views, shortcuts, and verification gates. |
| **[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)** | Authoritative cross-repo visual contract aligned 1:1 with `krunked-fpv/discogs_collection` v6.0. |
| **[`.agents/agents/`](.agents/agents/)** | Role-scoped subagent definitions (`archivist`, `engine-guard`, `vault-styler`, `tactical-hud`, `deploy-ops`, `chaos-qa`). |

---

## Repository Structure (`C:\discogs_sniper`)

```text
discogs_sniper/
├── .agents/agents/                        # Role-scoped Antigravity subagent definitions (YAML frontmatter)
├── .github/workflows/static.yml           # Two-job (build -> deploy) GitHub Pages workflow with _site leak guard
├── data/
│   ├── log_forensics.json                 # Rolling telemetry from 5,600+ checks & 225+ alerts in sniper.log
│   ├── sniper_state.json                  # Compiled v3.0.0 dataset: listings, bundles, haggle tiers & wax specs
│   ├── vault_crossref.json                # 159-LP Collection Vault cross-reference & Discogs CDN covers
│   └── wantlist_sync.json                 # (Optional/auto-generated) Live Wantlist release ID snapshot
├── scripts/
│   └── build_dashboard.py                 # <0.15s zero-Node Python compiler: data/* + src/* -> index.html & _site/
├── src/
│   ├── styles/                            # Modular Obsidian hardware CSS (01-tokens-chassis .. 04-alpha-vault-modals)
│   ├── js/                                # Modular ES6 frontend (00-core-state .. 07-modals-palette-boot)
│   ├── template.html                      # Modular HTML5 shell, Suite Switcher, 5-KPI ribbon, 6 views & modals
│   ├── styles.css / app.js                # Compiled bundles (never edit directly; edit src/styles/* & src/js/*)
├── tests/
│   └── test_sniper_v2.py                  # Snapshot-resilient unit, forensic, alpha, staging & XSS escaping tests
├── ARCHITECTURE.md / AGENTS.md / SPEC.md / DESIGN_SYSTEM.md
├── manifest.webmanifest / sw.js           # Installable PWA manifest & offline-capable Service Worker
├── discogs_sniper.py                      # Core hybrid API + GraphQL + Playwright engine (IRON LAW FREEZE)
├── sniper_config.json / seed_snapshot.json
├── index.html                             # Compiled self-contained GitHub Pages PWA Command Center
└── setup_task.ps1 / run_sniper.ps1        # Windows Task Scheduler & foreground loop scripts
```

---

## CLI Reference & Verification

| Command | Behavior |
| :--- | :--- |
| `python scripts/build_dashboard.py` | **Compile Command Center** (`data/sniper_state.json` + `index.html` in `<0.15s`, offline). |
| `python scripts/build_dashboard.py --check` | **Dry-Run Compiler Integrity Check** without writing disk outputs. |
| `python scripts/build_dashboard.py --sync-wantlist --stage-dir _site` | **CI Production Build** with clean static staging (excludes `.env` & backend scripts). |
| `python -m unittest discover -s tests -p "test_*.py" -v` | **Run Complete Test Suite** (engine + compiler + staging + XSS escaping). |
| `python -m http.server 8765` | **Local Static Preview Server** for browser/PWA verification at `http://localhost:8765`. |
| `python discogs_sniper.py` | **Standard Delta Run** (5-minute Task Scheduler cycle). |
| `python discogs_sniper.py --api-check` | **Official Discogs API & Live Vault Diagnostics.** |
| `python discogs_sniper.py --prune-owned [--dry-run]` | **Live Wantlist Cleanup** (`DELETE /users/krunked/wants/{release_id}`). |
