# AGENTS.md — Discogs Sniper Engineering & Governance Guide

> **Repo:** `https://github.com/krunked-fpv/discogs_sniper` | **Live PWA:** `https://krunked-fpv.github.io/discogs_sniper/`
> **Sibling Repo:** `https://github.com/krunked-fpv/discogs_collection` (`https://krunked-fpv.github.io/discogs_collection/`)
> **References:** [`ARCHITECTURE.md`](ARCHITECTURE.md) • [`SPEC.md`](SPEC.md) • [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md)

This repository implements a dual-plane vinyl Wantlist monitoring system: a local Windows 11 Playwright + Official Discogs REST API v2.0 harvester (`discogs_sniper.py`, running every 5 minutes via Task Scheduler) and a `<0.15s` offline Python static compiler (`scripts/build_dashboard.py`) producing a zero-backend GitHub Pages PWA (`index.html`).

---

## Quick-Start & Verification Commands

Run all commands from `C:\discogs_sniper`:

```powershell
# 1. Compile modular src/* + data/* -> data/sniper_state.json + index.html (<0.15s, offline)
python scripts/build_dashboard.py

# 2. Dry-run compiler integrity check (validates assembly without modifying disk)
python scripts/build_dashboard.py --check

# 3. CI production build + clean GitHub Pages artifact staging (_site/, excludes .env & Python)
python scripts/build_dashboard.py --sync-wantlist --stage-dir _site

# 4. Run full unit, forensic, bundle, haggle, staging & XSS escaping test suite
python -m unittest discover -s tests -p "test_*.py" -v

# 5. Start local static preview server for /browser visual & console QA
python -m http.server 8765

# 6. Verify Official Discogs REST API v2.0 token, rate limits & live Vault overlaps (read-only)
python discogs_sniper.py --api-check

# 7. Preview live Wantlist pruning without mutating Discogs (safe dry run)
python discogs_sniper.py --prune-owned --dry-run
```

---

## Non-Negotiable Iron Laws

1. **IRON LAW — Python Core Freeze (`discogs_sniper.py`):**
   - `discogs_sniper.py` is **FROZEN** in production. NEVER modify it unless explicitly instructed by the user to unfreeze it. Verify `git diff --stat discogs_sniper.py` is empty before finishing any task.
2. **IRON LAW — Live Runtime File Protection (5-Minute Windows Scheduled Task):**
   - A live Windows Scheduled Task (`DiscogsSniper`) runs every 5 minutes against `C:\discogs_sniper`.
   - NEVER delete, truncate, reset, lock, or hand-edit `.env`, `seed_snapshot.json`, `sniper_config.json`, `sniper.log`, `sniper.lock`, `chrome_discogs_profile/`, or `data/releases_cache.json`.
   - If removing `.env` from git tracking, use ONLY `git rm --cached .env` (NEVER `git rm .env`) and verify `Test-Path .env` remains `True` with unchanged byte size.
3. **IRON LAW — Never Edit Compiled Outputs Directly:**
   - NEVER hand-edit `index.html`, `src/styles.css`, or `src/app.js` — they are generated artifacts overwritten by `scripts/build_dashboard.py`.
   - Author frontend changes strictly in `src/template.html`, `src/styles/*.css`, and `src/js/*.js`, then recompile with `python scripts/build_dashboard.py`.
4. **IRON LAW — Sibling UI Token Parity (`discogs_collection`):**
   - Maintain visual kinship with `krunked-fpv/discogs_collection` (v6.0) as codified in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md): Studio Obsidian `#05060b` / `#0b0e16` / `#111524`, UV 395nm Blacklight (`body.uv-blacklight` / `body.mode-uv`), `Inter` + `Space Grotesk` + `JetBrains Mono`, `.machined-plinth` / `.anodized-panel` surfaces, fuchsia-violet-cyan active tabs, and sleeve-peek vinyl hover physics.
5. **IRON LAW — Zero-Preflight Browser `fetch()` to `api.discogs.com`:**
   - Browser calls to `https://api.discogs.com` MUST pass `?token=<encoded>` in the query string with **ZERO custom HTTP headers** (no `Authorization`, `User-Agent`, or custom `Accept`). Custom headers trigger CORS `OPTIONS` preflight blocks on GitHub Pages.
6. **IRON LAW — Authentic 3-Tier Market Benchmark Hierarchy:**
   - Never fabricate synthetic market valuations. Benchmarks MUST follow: **Tier 1:** Official Discogs API `/marketplace/price_suggestions` -> **Tier 2:** Collection Vault median × condition multiplier -> **Tier 3:** Per-seller deduplicated observed median (`>= 2` distinct sellers with price spread) -> **Fallback:** `UNRATED`.
7. **IRON LAW — RFC 8259 Escaping & Secret Isolation:**
   - Embedded JSON state MUST escape `</` (`\u003c/`) and `<!--` (`\u003c!--`). All untrusted marketplace strings MUST be escaped via `escapeHtml()` / `sanitizeHttpUrl()`.
   - Browser Discogs tokens and GitHub PATs stay strictly in `localStorage` — NEVER mirror credential keys into shadow cookies (`kv1_*`), compiled HTML, or committed files.
   - GitHub Pages staging (`--stage-dir _site`) MUST NEVER include `.env`, `discogs_sniper.py`, `sniper.log`, `sniper.lock`, or `chrome_discogs_profile/`.
8. **IRON LAW — Mandatory Test + Browser Verification Gate:**
   - No frontend, compiler, or CI change is complete until `python scripts/build_dashboard.py`, `python -m unittest discover -s tests -p "test_*.py" -v`, AND real browser inspection (`http://localhost:8765`, checking desktop + mobile layout, console errors, and interactive flows) all pass cleanly.

---

## Named Agent Callback Directory

Subagent definitions live in [`.agents/agents/`](.agents/agents/). Use these specialized roles to keep file ownership conflict-free:

### `@archivist` — Lead Architect, Cross-Repo Design Extractor & Governance Scribe
- **Owned Paths:** `ARCHITECTURE.md`, `AGENTS.md`, `SPEC.md`, `DESIGN_SYSTEM.md`, `.agents/agents/*.md`, `README.md`
- **Forbidden Paths:** `discogs_sniper.py`, `src/*`, `scripts/*`, `.github/*`, `tests/*`, `index.html`, runtime files
- **Invariants:** Root `AGENTS.md` has NO YAML frontmatter; every `.agents/agents/*.md` starts with valid YAML frontmatter (`name`, `description`, `subagent: true`); design tokens mirror `krunked-fpv/discogs_collection` v6.0 verbatim; zero secrets in docs.
- **Callback Example:**
  ```text
  @archivist Sync DESIGN_SYSTEM.md and ARCHITECTURE.md after discogs_collection updated its UV Blacklight shadow tokens, and confirm AGENTS.md still has no YAML frontmatter.
  ```

### `@engine-guard` — Compiler, Schema & Runtime Integrity Engineer
- **Owned Paths:** `scripts/build_dashboard.py` (compiler/analytics only), `data/sniper_state.json` (compiled output), `index.html` (compiled output via `build_dashboard.py`)
- **Forbidden Paths:** `discogs_sniper.py` (FROZEN), runtime files (`.env`, `seed_snapshot.json`, `sniper_config.json`, `sniper.log`, `sniper.lock`, `chrome_discogs_profile/`, `data/releases_cache.json`), `src/styles/*`, `.github/*`
- **Invariants:** `<0.15s` offline build speed; atomic writes (`_atomic_write_text`); exact 3-bucket Vault partition math; authentic 3-tier benchmark hierarchy; RFC 8259 `\u003c/` + `\u003c!--` script escaping; `--stage-dir _site` excludes `.env` and Python code.
- **Callback Example:**
  ```text
  @engine-guard Audit scripts/build_dashboard.py for double-escaped HTML entities in clean_seller_note, run python scripts/build_dashboard.py --check, and verify all tests in tests/test_sniper_v2.py pass.
  ```

### `@vault-styler` — Cross-Repo Visual Design & CSS Chassis Engineer
- **Owned Paths:** `src/styles/*.css`, `manifest.webmanifest` (theme color alignment), visual classes/tokens in `src/template.html` (coordinated with `@tactical-hud`)
- **Forbidden Paths:** `discogs_sniper.py`, `scripts/*`, `src/js/*`, `index.html` (direct edits), `src/styles.css` (direct edits), `.github/*`, runtime files
- **Invariants:** Exact token parity with `DESIGN_SYSTEM.md` & `discogs_collection` v6.0; `Inter` + `Space Grotesk` + `JetBrains Mono` typography; Studio Obsidian + UV 395nm Blacklight + optional Tube Amp parity; smooth sleeve-peek card hover physics; zero horizontal overflow on 375px mobile & 1440px desktop; `prefers-reduced-motion` support.
- **Callback Example:**
  ```text
  @vault-styler Align src/styles/01-tokens-chassis.css and 02-radar-cards.css with DESIGN_SYSTEM.md (.machined-plinth, .nav-tab-active fuchsia-violet-cyan gradient, and sleeve-peek hover physics), then compile via build_dashboard.py.
  ```

### `@tactical-hud` — Frontend Views, Audio/Turntable & Interactive Logic Engineer
- **Owned Paths:** `src/js/*.js`, `src/template.html` (markup & semantic hooks), `sw.js`
- **Forbidden Paths:** `discogs_sniper.py`, `scripts/*`, `src/styles/*`, `index.html` (direct edits), `src/app.js` (direct edits), `.github/*`, runtime files
- **Invariants:** Zero-preflight `?token=` `fetch()` to `api.discogs.com` (zero custom headers); token-bucket hydration (`1.25s` authed / `3.1s` anon / `429` cooldown); IndexedDB `krunked_sniper_idb_v3` 6h cache; zero-autoplay 30s audio previews; `escapeHtml()` & `sanitizeHttpUrl()` on all marketplace fields; credentials stay strictly in `localStorage` (never cookies).
- **Callback Example:**
  ```text
  @tactical-hud Wire cross-app Vinyl Vault nav links and ensure every seller note in 05-views-radar-crate.js and 07-modals-palette-boot.js decodes/escapes cleanly without double-escaping, keeping zero custom headers on api.discogs.com fetch().
  ```

### `@deploy-ops` — GitHub Pages CI/CD Workflow & Repo Hygiene Engineer
- **Owned Paths:** `.github/workflows/*.yml`, `.gitignore`
- **Forbidden Paths:** `discogs_sniper.py`, `src/*`, `scripts/*`, `tests/*`, docs, runtime files on disk
- **Invariants:** `.env` MUST stay untracked in git (`git ls-files .env` empty) while remaining intact on disk (`Test-Path .env` True); `.github/workflows/static.yml` uses official Pages v4/v5 actions, minimal Python deps (never installs Playwright in CI), graceful offline fallback when `DISCOGS_TOKEN` is absent, and deploys strictly from `--stage-dir _site`.
- **Callback Example:**
  ```text
  @deploy-ops Audit .github/workflows/static.yml and .gitignore to guarantee _site staging excludes .env and static.yml succeeds even without secrets.DISCOGS_TOKEN.
  ```

### `@chaos-qa` — Adversarial Test, Browser Verification & Regression Hunter
- **Owned Paths:** `tests/*.py`
- **Forbidden Paths:** `discogs_sniper.py`, `src/*`, `scripts/*`, `.github/*`, docs, runtime files
- **Invariants:** Dynamic snapshot-resilient assertions (never hardcode brittle live item counts that break after the next 5-minute cron run); verify RFC 8259 XSS payloads, relist-ledger idempotency, Yo-Yo bluff suppression, zero-preflight API calls, and live `/browser` visual/console checks across desktop (`1440×900`) and mobile (`390×844`) viewports.
- **Callback Example:**
  ```text
  @chaos-qa Run full unittest suite and launch local preview on port 8765 to verify all 6 views, UV lighting toggle, Ctrl+K palette, mobile responsiveness, and zero browser console errors.
  ```
