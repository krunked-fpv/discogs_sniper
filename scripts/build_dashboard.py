#!/usr/bin/env python3
"""Deterministic Discogs Sniper v3.0 Analytics & Static Command Center Compiler (`build_dashboard.py`).

Compiles:
  - `seed_snapshot.json` (live & historical tracked Wantlist listings)
  - `data/log_forensics.json` + live `sniper.log` (5,600+ 5-minute run telemetry & alert timestamps)
  - `data/vault_crossref.json` + live `discogs_collection` (159-LP Collection Vault cross-reference)
  - `data/releases_cache.json` (optional cached Discogs API `/releases/{id}` & `/marketplace/price_suggestions/{id}`)
  - `sniper_config.json` (v2.0+ relist deduplication & filter configuration)

Produces:
  - `data/sniper_state.json` (enriched structured JSON dataset with Bundles, Haggle Intel & Wax Specs)
  - `src/styles.css` & `src/app.js` (concatenated from modular `src/styles/*.css` & `src/js/*.js`)
  - `index.html` (self-contained Static GitHub Pages Command Center assembled from `src/*`)
  - Optional `--stage-dir _site` clean static artifact directory for GitHub Pages
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import html
import json
import os
import pathlib
import re
import shutil
import statistics
import sys
from typing import Any

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name == "scripts" else SCRIPT_DIR

SEED_FILE = REPO_ROOT / "seed_snapshot.json"
LOG_FILE = REPO_ROOT / "sniper.log"
CONFIG_FILE = REPO_ROOT / "sniper_config.json"
DATA_DIR = REPO_ROOT / "data"
VAULT_CROSSREF_FILE = DATA_DIR / "vault_crossref.json"
LOG_FORENSICS_FILE = DATA_DIR / "log_forensics.json"
RELEASES_CACHE_FILE = DATA_DIR / "releases_cache.json"
WANTLIST_SYNC_FILE = DATA_DIR / "wantlist_sync.json"
SNIPER_STATE_FILE = DATA_DIR / "sniper_state.json"

SRC_DIR = REPO_ROOT / "src"
STYLES_DIR = SRC_DIR / "styles"
JS_DIR = SRC_DIR / "js"
TEMPLATE_HTML = SRC_DIR / "template.html"
STYLES_CSS = SRC_DIR / "styles.css"
APP_JS = SRC_DIR / "app.js"
OUTPUT_HTML = REPO_ROOT / "index.html"
SCHEMA_VERSION = "3.0.0"


def _atomic_write_text(target: pathlib.Path, content: str) -> None:
    """Atomically writes text via a PID-scoped temp file so concurrent readers never observe partial output."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.parent / f".{target.name}.{os.getpid()}.tmp"
    tmp_path.write_text(content, encoding="utf-8")
    tmp_path.replace(target)


def decode_html_entities(text: str | None, max_depth: int = 12) -> str:
    """Recursively decodes multi-escaped HTML entities (e.g. '&amp;amp;amp;#34;') until convergence."""
    if not text:
        return ""
    cur = str(text)
    if "&" not in cur:
        return cur
    for _ in range(max_depth):
        nxt = html.unescape(cur)
        if nxt == cur:
            break
        cur = nxt
    return cur


def normalize_album_key(raw_title: str) -> str:
    """Normalizes 'Artist (N) - Album ' into a consistent lowercase lookup key."""
    s = re.sub(r"\s*\(\d+\)", "", (raw_title or "").lower()).strip()
    s = re.sub(r"\s*[–—]\s*", " - ", s)
    s = re.sub(r"\s*-\s*", " - ", s, count=1)
    return re.sub(r"\s+", " ", s).strip()


def parse_usd(val: str | float | int | None) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    m = re.search(r"([\d,]+\.\d{2}|\d+)", str(val))
    if not m:
        return 0.0
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return 0.0


def format_usd(val: float | None) -> str:
    if val is None or val <= 0:
        return "N/A"
    return f"${val:,.2f}"


def parse_wax_shader(variant_str: str) -> dict[str, Any]:
    """Deterministically parses a Discogs pressing variant string into rich Canvas/SVG vinyl shader metadata."""
    v = (variant_str or "").lower()

    # Determine primary pattern (backward compatible with v2 tests)
    pattern = "solid"
    if "picture disc" in v:
        pattern = "picture"
    elif "splatter" in v or "confetti" in v:
        pattern = "splatter"
    elif "split" in v or "half" in v or "pinwheel" in v or "tri-color" in v:
        pattern = "split"
    elif "marble" in v or "swirl" in v or "galaxy" in v or "cloudy" in v:
        pattern = "marble"
    elif "smoke" in v or "haze" in v or "fog" in v or "cornetto" in v:
        pattern = "smoke"
    elif "clear" in v or "translucent" in v or "transparent" in v or "ice" in v or "glass" in v or "coke" in v:
        pattern = "translucent"

    # Richer subpattern for WebGL/Canvas2D procedural platter
    subpattern = pattern
    if "inside" in v or "color in color" in v or "color-in-color" in v or "cornetto" in v:
        subpattern = "cornetto"
    elif "starburst" in v or "sunburst" in v:
        subpattern = "starburst"
    elif "pinwheel" in v:
        subpattern = "pinwheel"
    elif "galaxy" in v or "cloudy" in v:
        subpattern = "galaxy"
    elif "swirl" in v:
        subpattern = "swirl"

    # Color palette matching
    color_rules = [
        (["ultra clear", "crystal clear", "clear"], "#d8e4ec", "#9bb4c4", "#00f0ff", "Ultra Clear"),
        (["black ice", "smoke", "grey", "gray", "silver"], "#374151", "#1f2937", "#9ca3af", "Black Ice / Smoke"),
        (["gold", "amber", "yellow", "honey", "mustard", "orange"], "#f59e0b", "#b45309", "#fde68a", "Amber Gold"),
        (["red", "crimson", "ruby", "blood", "oxblood", "burgundy", "maroon"], "#dc2626", "#7f1d1d", "#fca5a5", "Crimson Wax"),
        (["pink", "magenta", "rose", "neon coral"], "#ec4899", "#831843", "#fbcfe8", "Rose / Pink"),
        (["purple", "violet", "indigo", "lavender", "amethyst"], "#8b5cf6", "#4c1d95", "#ddd6fe", "Ultraviolet / Indigo"),
        (["blue", "cyan", "aqua", "teal", "turquoise", "cobalt", "navy", "sea"], "#0284c7", "#0c4a6e", "#7dd3fc", "Cobalt / Aqua"),
        (["green", "emerald", "mint", "forest", "olive", "lime", "coke bottle"], "#10b981", "#064e3b", "#a7f3d0", "Emerald / Mint"),
        (["bone", "cream", "white", "ivory", "milk", "pearl"], "#f3f0e6", "#d6d1c2", "#ffffff", "Bone / White"),
        (["brown", "tan", "copper", "bronze", "root beer"], "#92400e", "#451a03", "#fcd34d", "Bronze / Root Beer"),
    ]

    primary = "#181a1f"
    secondary = "#0d0f12"
    accent = "#00f0ff"
    tertiary = "#00f0ff"
    label_text = "180g Audiophile Black"

    matched_colors = []
    for keywords, c1, c2, c3, name in color_rules:
        if any(k in v for k in keywords):
            matched_colors.append((c1, c2, c3, name))

    if matched_colors:
        primary, secondary, accent, label_text = matched_colors[0]
        tertiary = accent
        if len(matched_colors) > 1:
            secondary = matched_colors[1][0]
            accent = matched_colors[1][2]
            tertiary = accent
            if len(matched_colors) > 2:
                accent = matched_colors[2][0]
                tertiary = matched_colors[2][0]

    # Extract concise variant callout
    clean_tokens = [
        t.strip()
        for t in (variant_str or "LP, Vinyl").split(",")
        if t.strip().lower() not in ("vinyl", "lp", "album", "stereo", "reissue", "repress", "limited edition")
    ]
    short_variant = ", ".join(clean_tokens[:3]) if clean_tokens else label_text
    seed = sum((i + 1) * ord(ch) for i, ch in enumerate(v)) % 2147483647

    return {
        "pattern": pattern,
        "subpattern": subpattern,
        "primary": primary,
        "secondary": secondary,
        "accent": accent,
        "tertiary": tertiary,
        "wax_name": short_variant,
        "is_etched": "etched" in v,
        "is_foil_sleeve": "foil" in v,
        "is_numbered": "numbered" in v,
        "is_180g": bool(re.search(r"180\s*g", v)),
        "rpm": 45 if "45 rpm" in v else 33,
        "seed": seed,
    }


def extract_collector_signals(raw_description: str, variant_str: str) -> dict[str, Any]:
    """Deduplicates raw_description == variant boilerplate and extracts structured collector signal badges."""
    raw_clean = decode_html_entities(raw_description).strip()
    var_clean = decode_html_entities(variant_str).strip()
    norm_raw = re.sub(r"\s+", " ", raw_clean.lower())
    norm_var = re.sub(r"\s+", " ", var_clean.lower())

    clean_seller_note = "" if (not raw_clean or norm_raw == norm_var) else raw_clean
    combined = f"{raw_clean} {var_clean}"

    badges: list[dict[str, str]] = []
    has_wear_warning = False

    signal_rules = [
        ("SIGNED", "SIGNED", "gold", r"\bsigned\b|autograph"),
        ("SEALED", "SEALED", "lime", r"\bsealed\b|unopened|factory packaging"),
        ("UNPLAYED", "UNPLAYED", "cyan", r"\bunplayed\b|never played"),
        ("HYPE_OBI", "HYPE / OBI", "cyan", r"hype sticker|\bobi\b"),
        ("NUMBERED", "NUMBERED", "violet", r"\bnumbered\b|#\d+\s*/\s*\d+"),
        ("FOIL", "FOIL JACKET", "magenta", r"\bfoil\b"),
        ("VMP", "CLUB / VMP", "amber", r"\bvmp\b|vinyl me|club edition"),
        ("SALE", "SALE", "lime", r"\d+%\s*off|\bsale\b"),
        ("WEAR_WARN", "JACKET WEAR", "crimson", r"seam split|shelf-wear|shelf wear|ring wear|corner bump|creased|\bwarp"),
    ]
    for sig_id, label, tone, regex in signal_rules:
        if re.search(regex, combined, re.I):
            badges.append({"id": sig_id, "label": label, "tone": tone})
            if sig_id == "WEAR_WARN":
                has_wear_warning = True

    return {
        "clean_seller_note": clean_seller_note,
        "collector_badges": badges,
        "has_wear_warning": has_wear_warning,
    }


def parse_shipping_policy(ships: list[float], notes: list[str], item_count: int) -> dict[str, Any]:
    """Infers combined shipping terms from listing shipping rates and seller comments."""
    max_ship = round(max(ships), 2) if ships else 0.0
    sum_ship = round(sum(ships), 2) if ships else 0.0
    notes_joined = " ".join(n for n in notes if n)

    if max_ship <= 0.0:
        return {
            "policy_type": "FREE_SHIPPING",
            "policy_label": "Confirmed Free US Shipping",
            "confirmed_policy": True,
            "bundled_shipping_usd": 0.0,
        }
    if re.search(r"flat\s*rate.*unlimited|unlimited\s*items", notes_joined, re.I):
        return {
            "policy_type": "FLAT_UNLIMITED",
            "policy_label": f"${max_ship:.2f} Flat-Rate Unlimited US Shipping",
            "confirmed_policy": True,
            "bundled_shipping_usd": max_ship,
        }

    if max_ship >= 3.0 and item_count > 1:
        est_combined = min(sum_ship, round(max_ship + 1.50 * (item_count - 1), 2))
        return {
            "policy_type": "COMBINED_ESTIMATE",
            "policy_label": f"Est. Combined Media Mail (${max_ship:.2f} + $1.50/LP)",
            "confirmed_policy": False,
            "bundled_shipping_usd": est_combined,
        }

    return {
        "policy_type": "COMBINED_ESTIMATE",
        "policy_label": f"Standard Per-Item Shipping (${sum_ship:.2f})",
        "confirmed_policy": False,
        "bundled_shipping_usd": sum_ship,
    }


def build_seller_bundles(deduped_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Detects sellers holding 2+ active Wantlist offerings and computes multi-LP shipping savings."""
    by_seller: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in deduped_rows:
        by_seller[r["seller_info"]].append(r)

    bundles: list[dict[str, Any]] = []
    bundle_by_seller: dict[str, dict[str, Any]] = {}

    for seller, rows in by_seller.items():
        if len(rows) < 2:
            continue
        ordered = sorted(rows, key=lambda x: (x["snapshot_order"], x["total_price_usd"]))
        ships = [float(x["shipping_price_usd"]) for x in ordered]
        notes = [x.get("raw_description", "") for x in ordered]
        pol = parse_shipping_policy(ships, notes, len(ordered))

        solo_list_sum = round(sum(float(x["list_price_usd"]) for x in ordered), 2)
        solo_shipping_usd = round(sum(ships), 2)
        solo_total_usd = round(sum(float(x["total_price_usd"]) for x in ordered), 2)
        bundled_ship = float(pol["bundled_shipping_usd"])
        shipping_saved_usd = max(0.0, round(solo_shipping_usd - bundled_ship, 2))
        bundled_total_usd = round(solo_total_usd - shipping_saved_usd, 2)
        avg_landed_per_lp_usd = round(bundled_total_usd / max(1, len(ordered)), 2)

        distinct_releases = len({x["release_id"] for x in ordered})
        allow_offers_count = sum(1 for x in ordered if x.get("allow_offers"))
        compact_items = [
            {
                "id": x["id"],
                "release_id": x["release_id"],
                "title": x["title"],
                "artist": x["artist"],
                "album": x["album"],
                "variant": x["variant"],
                "wax_name": (x.get("wax_shader") or {}).get("wax_name", x["variant"]),
                "media_condition": x["media_condition"],
                "sleeve_condition": x["sleeve_condition"],
                "list_price_usd": x["list_price_usd"],
                "shipping_price_usd": x["shipping_price_usd"],
                "total_price_usd": x["total_price_usd"],
                "allow_offers": bool(x.get("allow_offers")),
                "cover_image_url": x.get("cover_image_url", ""),
                "add_to_cart_url": x["add_to_cart_url"],
                "item_url": x["item_url"],
                "vault_status": x.get("vault_status", "MISSING_GRAIL"),
            }
            for x in ordered
        ]

        bundle_obj = {
            "seller": seller,
            "seller_url": f"https://www.discogs.com/seller/{seller}/profile",
            "seller_wantlist_url": f"https://www.discogs.com/seller/{seller}/profile?mywants=1",
            "item_count": len(ordered),
            "distinct_releases_count": distinct_releases,
            "allow_offers_count": allow_offers_count,
            "policy_type": pol["policy_type"],
            "policy_label": pol["policy_label"],
            "confirmed_policy": pol["confirmed_policy"],
            "solo_list_sum_usd": solo_list_sum,
            "solo_shipping_usd": solo_shipping_usd,
            "bundled_shipping_usd": bundled_ship,
            "solo_total_usd": solo_total_usd,
            "bundled_total_usd": bundled_total_usd,
            "shipping_saved_usd": shipping_saved_usd,
            "avg_landed_per_lp_usd": avg_landed_per_lp_usd,
            "items": compact_items,
        }
        bundles.append(bundle_obj)
        bundle_by_seller[seller.lower()] = bundle_obj

    bundles.sort(key=lambda b: (-b["shipping_saved_usd"], -b["item_count"], b["seller"].lower()))
    return bundles, bundle_by_seller


def compute_offer_strategy(row: dict[str, Any], bundle_info: dict[str, Any] | None = None) -> dict[str, Any]:
    """Computes condition-calibrated Make-Offer tiers & a polite collector negotiation pitch."""
    mkt = row.get("market_stats") or {}
    cond_suggested_usd = float(mkt.get("condition_suggested_usd") or 0.0)
    rel_med = float(mkt.get("observed_median_usd") or 0.0)
    distinct_seller_cnt = int(mkt.get("distinct_sellers_tracked") or 1)
    total_usd = float(row.get("total_price_usd") or 0.0)
    ship_usd = float(row.get("shipping_price_usd") or 0.0)
    list_usd = float(row.get("list_price_usd") or max(0.0, total_usd - ship_usd))

    if list_usd <= 0:
        return {
            "aggressive_offer_usd": 0.0,
            "recommended_offer_usd": 0.0,
            "instant_close_offer_usd": 0.0,
            "savings_vs_ask_usd": 0.0,
            "savings_pct": 0.0,
            "fair_item_target_usd": 0.0,
            "rationales": [],
            "buyer_pitch": "",
        }

    fair_shipped = (
        cond_suggested_usd
        if cond_suggested_usd > 0
        else (rel_med if distinct_seller_cnt >= 2 else total_usd * 0.92)
    )
    fair_list = max(5.0, fair_shipped - ship_usd)
    has_wear = bool(row.get("has_wear_warning"))
    relist_total = int(row.get("relist_group_total") or 1)
    wear_discount = 0.93 if has_wear else 1.0
    churn_discount = 0.95 if relist_total >= 3 else 1.0

    def _clamp(val: float, max_ratio: float) -> float:
        return round(max(list_usd * 0.58, min(list_usd * max_ratio, val)), 2)

    aggressive = _clamp(0.83 * fair_list * wear_discount * churn_discount, 0.85)
    recommended = _clamp(0.90 * fair_list * wear_discount, 0.91)
    instant_close = _clamp(0.95 * min(list_usd, fair_list), 0.95)
    if recommended < aggressive:
        recommended = aggressive
    if instant_close < recommended:
        instant_close = recommended

    savings_usd = max(0.0, round(list_usd - recommended, 2))
    savings_pct = round((savings_usd / list_usd) * 100.0, 1) if list_usd > 0 else 0.0

    rationales: list[str] = []
    if mkt.get("benchmark_verified") and cond_suggested_usd > 0:
        rationales.append(f"{row.get('media_condition', 'NM')} benchmark ${cond_suggested_usd:.2f} shipped")
    elif distinct_seller_cnt >= 2:
        rationales.append(f"{distinct_seller_cnt}-seller median ${rel_med:.2f} shipped")
    if has_wear:
        rationales.append("Jacket/sleeve wear noted (-7% factor)")
    if relist_total >= 3:
        rationales.append(f"Relisted {relist_total}x (-5% churn leverage)")
    if bundle_info and bundle_info.get("item_count", 0) >= 2:
        rationales.append(f"Seller holds {bundle_info['item_count']} Wantlist LPs (bundle leverage)")

    pitch_parts = [
        f"Hi {row.get('seller_info', 'there')}, I'm interested in your {row.get('media_condition', 'NM')}/{row.get('sleeve_condition', 'NM')} copy of {row.get('title', 'this LP')} (#{row.get('id', '')})."
    ]
    if has_wear:
        pitch_parts.append("I saw the sleeve/jacket notes in your listing and am happy with the media grade.")
    if mkt.get("benchmark_verified") and cond_suggested_usd > 0:
        pitch_parts.append(f"Based on recent {row.get('media_condition', 'NM')} comps around ${cond_suggested_usd:.2f} shipped, would you consider ${recommended:.2f} (+ shipping)?")
    else:
        pitch_parts.append(f"Would you consider an offer of ${recommended:.2f} (+ shipping) for a quick payment today?")
    if bundle_info and bundle_info.get("item_count", 0) >= 2:
        pitch_parts.append(f"I also spotted {bundle_info['item_count'] - 1} other LP(s) in your shop on my Wantlist if you combine shipping!")

    return {
        "aggressive_offer_usd": aggressive,
        "recommended_offer_usd": recommended,
        "instant_close_offer_usd": instant_close,
        "savings_vs_ask_usd": savings_usd,
        "savings_pct": savings_pct,
        "fair_item_target_usd": round(fair_list, 2),
        "rationales": rationales,
        "buyer_pitch": " ".join(pitch_parts),
    }


def condition_multiplier(media_cond: str) -> float:
    c = (media_cond or "").upper().strip()
    if c in ("M", "MINT", "MINT (M)"):
        return 1.15
    if c in ("NM", "M-", "NEAR MINT", "NEAR MINT (NM OR M-)"):
        return 1.00
    if c in ("VG+", "VERY GOOD PLUS", "VERY GOOD PLUS (VG+)"):
        return 0.82
    if c in ("VG", "VERY GOOD", "VERY GOOD (VG)"):
        return 0.65
    return 0.50


def condition_full_label(short_cond: str) -> str:
    c = (short_cond or "").upper().strip()
    mapping = {
        "M": "Mint (M)",
        "NM": "Near Mint (NM or M-)",
        "M-": "Near Mint (NM or M-)",
        "VG+": "Very Good Plus (VG+)",
        "VG": "Very Good (VG)",
        "G+": "Good Plus (G+)",
        "G": "Good (G)",
        "F": "Fair (F)",
        "P": "Poor (P)",
    }
    return mapping.get(c, short_cond or "Near Mint (NM or M-)")


def load_json_safe(path: pathlib.Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return default


def sync_live_wantlist_optional(username: str, token: str = "") -> dict[str, Any] | None:
    """Optional live Discogs Wantlist sync (used only when --sync-wantlist is passed, e.g. in CI)."""
    import urllib.parse
    import urllib.request

    user_q = urllib.parse.quote(username or "krunked", safe="")
    headers = {
        "Accept": "application/vnd.discogs.v2.discogs+json",
        "User-Agent": f"KrunkedDiscogsSniper/{SCHEMA_VERSION} +https://github.com/krunked-fpv/discogs_sniper",
    }
    clean_tok = (token or "").strip().strip("\"'` ")
    if clean_tok and not clean_tok.startswith("$env:"):
        headers["Authorization"] = f"Discogs token={clean_tok}"

    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    try:
        while True:
            url = f"https://api.discogs.com/users/{user_q}/wants?page={page}&per_page=100"
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
            if not isinstance(data, dict) or "wants" not in data:
                return None
            for w in data.get("wants") or []:
                raw_id = w.get("id") or (w.get("basic_information") or {}).get("id")
                if raw_id:
                    rid = str(raw_id)
                    if rid not in seen:
                        seen.add(rid)
                        ids.append(rid)
            pages = int((data.get("pagination") or {}).get("pages", 1) or 1)
            if page >= pages or page >= 20:
                break
            page += 1
        payload = {
            "schema_version": SCHEMA_VERSION,
            "username": username,
            "synced_at": datetime.now().isoformat(timespec="seconds"),
            "total_live_wants": len(ids),
            "live_want_release_ids": sorted(ids),
        }
        DATA_DIR.mkdir(exist_ok=True)
        WANTLIST_SYNC_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return payload
    except Exception:
        return None


def refresh_log_forensics(persist: bool = True) -> dict[str, Any]:
    """Reads `data/log_forensics.json` and merges any newer entries from live `sniper.log` if present."""
    base = load_json_safe(LOG_FORENSICS_FILE, {})
    if not LOG_FILE.exists():
        return base

    try:
        lines = LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return base

    if not lines:
        return base

    # Never overwrite richer committed telemetry with a shorter/rotated/test sniper.log
    base_lines = int(base.get("total_log_lines") or 0)
    if base_lines > 0 and len(lines) < base_lines:
        return base

    alert_timestamps = dict(base.get("alert_timestamps") or {})
    alert_history = []
    checks_by_day: Counter[str] = Counter()
    alerts_by_day: Counter[str] = Counter()
    alerts_by_hour: Counter[str] = Counter()
    errors_by_day: Counter[str] = Counter()

    total_checks = 0
    successful_parses = 0
    zero_listing_errors = 0
    timeout_warnings = 0
    relists_suppressed = 0
    first_ts = base.get("first_log_timestamp", "2026-11-06T21:10:24")
    last_ts = base.get("last_log_timestamp", "")

    for raw_line in lines:
        line = raw_line.strip()
        m_dt = re.match(r"^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})", line)
        day = m_dt.group(1) if m_dt else ""
        hr = m_dt.group(2) if m_dt else ""
        full_ts = f"{day}T{hr}:{m_dt.group(3)}:{m_dt.group(4)}" if m_dt else ""
        if full_ts:
            last_ts = full_ts

        if "Loading Discogs Wantlist" in line or "Checking Discogs Wantlist" in line:
            total_checks += 1
            if day:
                checks_by_day[day] += 1
        elif "Parsed " in line and " listings" in line:
            successful_parses += 1
        elif "Extracted 0 listings" in line:
            zero_listing_errors += 1
            if day:
                errors_by_day[day] += 1
        elif "Timed out waiting for desktop" in line:
            timeout_warnings += 1
        elif "[RELIST SUPPRESSED]" in line:
            relists_suppressed += 1
        elif "ALERT SENT ->" in line:
            if day:
                alerts_by_day[day] += 1
                alerts_by_hour[hr] += 1
            id_m = re.search(r"/sell/item/(\d+)", line)
            subj_m = re.search(r"ALERT SENT -> .*?\* (.*?) \(\$([\d,]+\.\d{2})\)", line)
            item_id = id_m.group(1) if id_m else ""
            if item_id and full_ts:
                alert_timestamps[item_id] = full_ts
            alert_history.append({
                "timestamp": full_ts,
                "item_id": item_id,
                "title": subj_m.group(1).strip() if subj_m else "",
                "total_price": f"${subj_m.group(2)}" if subj_m else "",
            })

    forensics = {
        "first_log_timestamp": first_ts,
        "last_log_timestamp": last_ts,
        "total_log_lines": len(lines),
        "total_checks": total_checks,
        "successful_parses": successful_parses,
        "zero_listing_errors": zero_listing_errors,
        "timeout_warnings": timeout_warnings,
        "relists_suppressed_in_log": relists_suppressed,
        "total_alerts_sent": len(alert_history),
        "hydration_success_rate_pct": round((successful_parses / max(1, total_checks)) * 100, 2),
        "checks_by_day": dict(sorted(checks_by_day.items())),
        "alerts_by_day": dict(sorted(alerts_by_day.items())),
        "alerts_by_hour": {f"{h:02d}": alerts_by_hour.get(f"{h:02d}", 0) for h in range(24)},
        "errors_by_day": dict(sorted(errors_by_day.items())),
        "alert_timestamps": alert_timestamps,
        "recent_alerts": alert_history[-100:],
    }
    if persist:
        DATA_DIR.mkdir(exist_ok=True)
        _atomic_write_text(LOG_FORENSICS_FILE, json.dumps(forensics, indent=2))
    return forensics


def build_sniper_state(
    wantlist_sync_override: dict[str, Any] | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Compiles the enriched Sniper v3.0 state from snapshot, forensics, Vault crossref, and wantlist sync."""
    snap = load_json_safe(SEED_FILE, {"items": {}})
    raw_items = snap.get("items", snap) if isinstance(snap, dict) else {}
    config = load_json_safe(CONFIG_FILE, {})
    forensics = refresh_log_forensics(persist=persist)
    vault = load_json_safe(VAULT_CROSSREF_FILE, {})
    api_cache = load_json_safe(RELEASES_CACHE_FILE, {})
    wantlist_sync = wantlist_sync_override if wantlist_sync_override is not None else load_json_safe(WANTLIST_SYNC_FILE, {})

    live_want_ids_set: set[str] | None = None
    if isinstance(wantlist_sync, dict) and isinstance(wantlist_sync.get("live_want_release_ids"), list):
        live_want_ids_set = {str(x) for x in wantlist_sync["live_want_release_ids"]}

    owned_releases: dict[str, Any] = vault.get("owned_releases") or {}
    raw_owned_albums: dict[str, list[Any]] = vault.get("owned_albums") or {}
    owned_albums: dict[str, list[Any]] = {}
    for k, val in raw_owned_albums.items():
        owned_albums[normalize_album_key(k)] = val
    # Ensure every owned_release is also cleanly indexed with normalized whitespace
    for rid_k, info in owned_releases.items():
        ak = normalize_album_key(f"{info.get('artist', '')} - {info.get('title', '')}")
        if ak and ak not in owned_albums:
            owned_albums[ak] = [info]

    cdn_by_rid: dict[str, str] = dict(vault.get("cdn_covers_by_rid") or {})
    cdn_by_album: dict[str, str] = {
        normalize_album_key(k): v for k, v in (vault.get("cdn_covers_by_album") or {}).items()
    }
    alert_timestamps: dict[str, str] = forensics.get("alert_timestamps") or {}

    # Pre-scan snapshot to recover top-level cover_image per release_id (so sibling items inherit real Discogs art)
    snapshot_covers_by_rid: dict[str, str] = {}
    for _, item in raw_items.items():
        rel_url = item.get("release_url", "")
        m_rel = re.search(r"/release/(\d+)", rel_url)
        rid = m_rel.group(1) if m_rel else ""
        cov = item.get("cover_image") or (item.get("api_stats") or {}).get("cover_image") or ""
        if rid and cov and rid not in snapshot_covers_by_rid:
            snapshot_covers_by_rid[rid] = cov

    # First pass: collect prices per release_id and per (release_id, seller, condition)
    prices_by_release: dict[str, list[float]] = defaultdict(list)
    items_by_fingerprint: dict[str, list[dict[str, Any]]] = defaultdict(list)
    items_by_release: dict[str, list[dict[str, Any]]] = defaultdict(list)

    parsed_rows: list[dict[str, Any]] = []
    live_page_count = int(snap.get("live_page_count", 25))
    for idx, (item_id, item) in enumerate(raw_items.items()):
        rel_url = item.get("release_url", "")
        m_rel = re.search(r"/release/(\d+)", rel_url)
        release_id = m_rel.group(1) if m_rel else "unknown"

        list_usd = parse_usd(item.get("list_price"))
        total_usd = parse_usd(item.get("total_price")) or list_usd
        ship_usd = max(0.0, round(total_usd - list_usd, 2))

        raw_title = decode_html_entities(item.get("title") or "Unknown Title").strip()
        if " - " in raw_title:
            artist_raw, album_raw = raw_title.split(" - ", 1)
        else:
            artist_raw, album_raw = raw_title, raw_title

        artist_clean = re.sub(r"\s*\(\d+\)$", "", artist_raw.strip()).strip()
        album_clean = album_raw.strip()
        norm_album_key = normalize_album_key(raw_title)

        seller = decode_html_entities(item.get("seller_info") or "US Seller").strip()
        media_cond = (item.get("media_condition") or "NM").strip()
        sleeve_cond = (item.get("sleeve_condition") or "NM").strip()
        alert_ts = alert_timestamps.get(str(item_id)) or item.get("seeded_at") or snap.get("updated_at") or ""
        api_stats = item.get("api_stats") or {}
        variant_str = decode_html_entities(item.get("variant") or "LP, Vinyl").strip()
        raw_desc_str = decode_html_entities(item.get("raw_description") or "").strip()
        signals = extract_collector_signals(raw_desc_str, variant_str)

        fp = f"{release_id}::{seller.lower()}::{media_cond.upper()}"

        row = {
            "snapshot_order": idx + 1,
            "rank": item.get("rank", idx + 1),
            "is_live_page1": idx < live_page_count,
            "id": str(item_id),
            "release_id": release_id,
            "title": raw_title,
            "artist": artist_clean,
            "album": album_clean,
            "norm_album_key": norm_album_key,
            "variant": variant_str,
            "wax_shader": parse_wax_shader(variant_str),
            "media_condition": media_cond,
            "media_condition_full": condition_full_label(media_cond),
            "sleeve_condition": sleeve_cond,
            "list_price": item.get("list_price", format_usd(list_usd)),
            "total_price": item.get("total_price", format_usd(total_usd)),
            "list_price_usd": list_usd,
            "total_price_usd": total_usd,
            "shipping_price_usd": ship_usd,
            "seller_info": seller,
            "seller_rating": item.get("seller_rating") or api_stats.get("seller_rating") or "",
            "allow_offers": bool(item.get("allow_offers") or api_stats.get("allow_offers")),
            "listed_age": item.get("listed_age", ""),
            "item_url": item.get("item_url", f"https://www.discogs.com/sell/item/{item_id}"),
            "add_to_cart_url": item.get("add_to_cart_url", f"https://www.discogs.com/sell/cart/?add={item_id}"),
            "release_url": rel_url or (f"https://www.discogs.com/release/{release_id}" if release_id != "unknown" else ""),
            "raw_description": raw_desc_str,
            "clean_seller_note": signals["clean_seller_note"],
            "collector_badges": signals["collector_badges"],
            "has_wear_warning": signals["has_wear_warning"],
            "seeded_at": item.get("seeded_at", ""),
            "alerted_at": alert_ts,
            "fingerprint": fp,
            "snapshot_cover_image": item.get("cover_image") or "",
            "api_stats": api_stats,
        }
        parsed_rows.append(row)
        if total_usd > 0:
            prices_by_release[release_id].append(total_usd)
        items_by_fingerprint[fp].append(row)
        items_by_release[release_id].append(row)

    # Second pass: compute relist history, price trajectories & genuine price drops
    relist_groups: dict[str, dict[str, Any]] = {}
    for fp, group_rows in items_by_fingerprint.items():
        # Sort chronologically by integer listing ID ascending (oldest listing ID first, newest last)
        chronological = sorted(group_rows, key=lambda r: int(r["id"]) if r["id"].isdigit() else 0)
        first_seen_price = chronological[0]["total_price_usd"]
        highest_seen_price = max(r["total_price_usd"] for r in chronological)
        lowest_seen_price = min(r["total_price_usd"] for r in chronological)

        running_high = 0.0
        for c_idx, r in enumerate(chronological):
            cur_p = r["total_price_usd"]
            r["relist_sequence_num"] = c_idx + 1
            r["relist_group_total"] = len(chronological)
            r["is_auto_relist"] = c_idx > 0
            r["is_latest_in_group"] = c_idx == (len(chronological) - 1)
            r["group_first_price_usd"] = first_seen_price
            r["group_highest_price_usd"] = highest_seen_price
            r["group_lowest_price_usd"] = lowest_seen_price

            # Genuine price drop: strictly cheaper than prior observed high (and not higher than immediately prior copy)
            prev_p = chronological[c_idx - 1]["total_price_usd"] if c_idx > 0 else cur_p
            drop_vs_prior_high = round(running_high - cur_p, 2) if c_idx > 0 and running_high > 0 else 0.0
            r["is_price_drop"] = c_idx > 0 and cur_p > 0 and cur_p <= prev_p and drop_vs_prior_high >= 1.0
            r["price_drop_usd"] = drop_vs_prior_high if r["is_price_drop"] else 0.0
            r["price_drop_pct"] = (
                round((drop_vs_prior_high / running_high) * 100, 1)
                if r["is_price_drop"] and running_high > 0
                else 0.0
            )
            if cur_p > running_high:
                running_high = cur_p

            if len(chronological) == 1:
                r["relist_behavior"] = "SINGLE_DROP"
            elif r["is_price_drop"]:
                r["relist_behavior"] = "GENUINE_CUT"
            elif highest_seen_price > lowest_seen_price:
                r["relist_behavior"] = "YOYO_BLUFF"
            else:
                r["relist_behavior"] = "FLATLINE_BOT"

            if r["is_latest_in_group"] and len(chronological) > 1:
                r["sibling_listing_ids"] = [x["id"] for x in reversed(chronological)]
                r["sibling_history"] = [
                    {
                        "id": x["id"],
                        "total_price": x["total_price"],
                        "total_price_usd": x["total_price_usd"],
                        "alerted_at": x["alerted_at"],
                        "item_url": x["item_url"],
                    }
                    for x in reversed(chronological)
                ]
                r["price_trajectory"] = [
                    {
                        "id": x["id"],
                        "price_usd": x["total_price_usd"],
                        "ts": x["alerted_at"],
                    }
                    for x in chronological
                ]
            else:
                r["sibling_listing_ids"] = [r["id"]]
                r["sibling_history"] = []
                r["price_trajectory"] = (
                    [{"id": r["id"], "price_usd": r["total_price_usd"], "ts": r["alerted_at"]}]
                    if r["is_latest_in_group"]
                    else []
                )

        relist_groups[fp] = {
            "fingerprint": fp,
            "release_id": chronological[-1]["release_id"],
            "title": chronological[-1]["title"],
            "seller": chronological[-1]["seller_info"],
            "media_condition": chronological[-1]["media_condition"],
            "count": len(chronological),
            "lowest_price_usd": lowest_seen_price,
            "highest_price_usd": highest_seen_price,
            "latest_id": chronological[-1]["id"],
            "latest_alerted_at": chronological[-1]["alerted_at"],
            "relist_behavior": chronological[-1]["relist_behavior"],
        }

    # Enrich each row with Vault ownership, Cover Art, and Authentic Market Benchmarks
    exact_owned_releases_map: dict[str, dict[str, Any]] = {}
    variant_upgrade_releases_map: dict[str, dict[str, Any]] = {}
    missing_grail_releases_set: set[str] = set()
    target_prices_map = (config.get("filters") or {}).get("target_prices_by_release") or {}

    for r in parsed_rows:
        rid = r["release_id"]
        norm_key = r["norm_album_key"]
        cached_api = api_cache.get(rid) or {}

        # 1. Cover Art Resolution (now properly honors snapshot top-level cover_image + sibling propagation!)
        cover_url = (
            r.pop("snapshot_cover_image", "")
            or r["api_stats"].get("cover_image")
            or cached_api.get("cover_image")
            or snapshot_covers_by_rid.get(rid)
            or cdn_by_rid.get(rid)
            or cdn_by_album.get(norm_key)
            or ""
        )
        r["cover_image_url"] = cover_url

        # 2. Collection Vault Ownership Resolution
        if rid in owned_releases:
            owned_info = owned_releases[rid]
            r["vault_status"] = "ALREADY_OWNED"
            r["vault_status_label"] = "ALREADY IN VAULT"
            r["vault_owned_detail"] = {
                "release_id": owned_info["release_id"],
                "format_string": owned_info["format_string"],
                "estimated_value_usd": owned_info["estimated_value_usd"],
                "date_added": owned_info["date_added"],
                "media_condition": owned_info["media_condition"],
                "pressing_image_url": owned_info.get("pressing_image_url", ""),
            }
            rel_rows = items_by_release[rid]
            in_live_p1 = any(x["is_live_page1"] for x in rel_rows)
            if live_want_ids_set is not None:
                live_status = "STILL_ON_WANTLIST" if rid in live_want_ids_set else "CLEARED_FROM_WANTLIST"
            else:
                live_status = "UNVERIFIED_SNAPSHOT"

            exact_owned_releases_map[rid] = {
                "release_id": rid,
                "title": r["title"],
                "artist": r["artist"],
                "album": r["album"],
                "variant": r["variant"],
                "cover_image_url": cover_url or owned_info.get("cover_image_url", ""),
                "pressing_image_url": owned_info.get("pressing_image_url", ""),
                "owned_format": owned_info["format_string"],
                "owned_condition": owned_info["media_condition"],
                "owned_date_added": owned_info["date_added"],
                "owned_value_usd": owned_info["estimated_value_usd"],
                "wantlist_hits_count": len(rel_rows),
                "in_live_page1": in_live_p1,
                "live_wantlist_status": live_status,
                "last_seen_alerted_at": max((x.get("alerted_at", "") for x in rel_rows), default=""),
                "lowest_sniped_usd": min(prices_by_release[rid]) if prices_by_release[rid] else r["total_price_usd"],
                "latest_listing_id": r["id"],
                "release_url": r["release_url"],
            }
        elif norm_key in owned_albums:
            owned_info = owned_albums[norm_key][0]
            r["vault_status"] = "VARIANT_UPGRADE"
            r["vault_status_label"] = "VARIANT HUNTER"
            r["vault_owned_detail"] = {
                "release_id": owned_info["release_id"],
                "format_string": owned_info["format_string"],
                "estimated_value_usd": owned_info["estimated_value_usd"],
                "date_added": owned_info["date_added"],
                "media_condition": owned_info["media_condition"],
                "pressing_image_url": owned_info.get("pressing_image_url", ""),
            }
            variant_upgrade_releases_map[rid] = {
                "wantlist_release_id": rid,
                "owned_release_id": owned_info["release_id"],
                "title": r["title"],
                "artist": r["artist"],
                "album": r["album"],
                "wantlist_variant": r["variant"],
                "wax_shader": r["wax_shader"],
                "owned_format": owned_info["format_string"],
                "owned_value_usd": owned_info["estimated_value_usd"],
                "cover_image_url": cover_url or owned_info.get("cover_image_url", ""),
                "pressing_image_url": owned_info.get("pressing_image_url", ""),
                "wantlist_hits_count": len(items_by_release[rid]),
                "in_live_page1": any(x["is_live_page1"] for x in items_by_release[rid]),
                "lowest_sniped_usd": min(prices_by_release[rid]) if prices_by_release[rid] else r["total_price_usd"],
                "release_url": r["release_url"],
            }
        else:
            r["vault_status"] = "MISSING_GRAIL"
            r["vault_status_label"] = "MISSING GRAIL"
            r["vault_owned_detail"] = None
            missing_grail_releases_set.add(rid)

        # 3. Release Price Dispersion & Authentic Market Benchmark
        # Deduplicate to 1 latest price per distinct seller so bot relists (e.g. 48x recordmule) never skew median
        rel_rows_all = items_by_release.get(rid) or [r]
        latest_price_by_seller: dict[str, tuple[int, float]] = {}
        for x in rel_rows_all:
            if x["total_price_usd"] <= 0:
                continue
            s_key = x["seller_info"].lower()
            lid_num = int(x["id"]) if str(x["id"]).isdigit() else 0
            prev_pair = latest_price_by_seller.get(s_key)
            if prev_pair is None or lid_num >= prev_pair[0]:
                latest_price_by_seller[s_key] = (lid_num, x["total_price_usd"])

        seller_dedup_prices = [pair[1] for pair in latest_price_by_seller.values()]
        rel_prices = prices_by_release.get(rid) or [r["total_price_usd"]]
        rel_low = min(seller_dedup_prices) if seller_dedup_prices else min(rel_prices)
        rel_high = max(seller_dedup_prices) if seller_dedup_prices else max(rel_prices)
        rel_med = round(statistics.median(seller_dedup_prices), 2) if seller_dedup_prices else round(statistics.median(rel_prices), 2)
        distinct_seller_cnt = len(seller_dedup_prices)

        vault_est = 0.0
        if r["vault_owned_detail"] and r["vault_owned_detail"].get("estimated_value_usd"):
            vault_est = float(r["vault_owned_detail"]["estimated_value_usd"])

        api_sugg = parse_usd((r["api_stats"] or {}).get("condition_suggested_price")) or parse_usd(
            cached_api.get("condition_suggested_price")
        )

        benchmark_verified = False
        if api_sugg > 0:
            cond_suggested_usd = api_sugg
            benchmark_source = "Discogs API /marketplace/price_suggestions"
            benchmark_verified = True
        elif vault_est > 0:
            cond_suggested_usd = round(vault_est * condition_multiplier(r["media_condition"]), 2)
            benchmark_source = "Collection Vault Median Valuation"
            benchmark_verified = True
        elif distinct_seller_cnt >= 2 and rel_high > rel_low:
            cond_suggested_usd = rel_med
            benchmark_source = f"Observed {distinct_seller_cnt}-Seller Market Median"
            benchmark_verified = False
        else:
            cond_suggested_usd = 0.0
            benchmark_source = "Unverified (Query Live API)"
            benchmark_verified = False

        r["market_stats"] = {
            "observed_low_usd": rel_low,
            "observed_median_usd": rel_med,
            "observed_high_usd": rel_high,
            "condition_suggested_usd": cond_suggested_usd,
            "condition_suggested_formatted": format_usd(cond_suggested_usd) if cond_suggested_usd > 0 else "Live API",
            "benchmark_source": benchmark_source,
            "benchmark_verified": benchmark_verified,
            "release_listings_tracked": len(rel_prices),
            "distinct_sellers_tracked": distinct_seller_cnt,
            "community_have": (r["api_stats"] or {}).get("community_have") or cached_api.get("community_have"),
            "community_want": (r["api_stats"] or {}).get("community_want") or cached_api.get("community_want"),
            "num_for_sale": (r["api_stats"] or {}).get("num_for_sale") or cached_api.get("num_for_sale"),
        }

        if cond_suggested_usd > 0 and r["total_price_usd"] > 0:
            delta_usd = round(r["total_price_usd"] - cond_suggested_usd, 2)
            delta_pct = round((delta_usd / cond_suggested_usd) * 100, 1)
            r["deal_delta_usd"] = delta_usd
            r["deal_delta_pct"] = delta_pct

            if delta_pct <= -15:
                score = 94
                tier = "STEAL"
                tier_label = f"STEAL ({delta_pct:+.0f}% vs {r['media_condition']})"
            elif delta_pct <= -3:
                score = 82
                tier = "GREAT_DEAL"
                tier_label = f"BELOW BENCHMARK ({delta_pct:+.0f}%)"
            elif delta_pct <= 12:
                score = 68
                tier = "FAIR_MARKET"
                tier_label = "FAIR MARKET"
            else:
                score = max(25, int(60 - delta_pct))
                tier = "ABOVE_MARKET"
                tier_label = f"PREMIUM ({delta_pct:+.0f}%)"
        else:
            r["deal_delta_usd"] = None
            r["deal_delta_pct"] = None
            score = 55
            tier = "UNRATED"
            tier_label = "UNRATED"

        if r["is_price_drop"]:
            score = min(98, score + 16)
        if r["allow_offers"]:
            score = min(98, score + 5)
        if r["vault_status"] == "MISSING_GRAIL":
            score = min(99, score + 4)

        r["deal_score"] = score
        r["deal_tier"] = tier
        r["deal_tier_label"] = tier_label

        # Target Price check (from config)
        raw_t_price = target_prices_map.get(rid)
        target_usd = parse_usd(raw_t_price) if raw_t_price else 0.0
        r["target_price_usd"] = target_usd if target_usd > 0 else None
        r["is_target_hit"] = bool(target_usd > 0 and r["total_price_usd"] > 0 and r["total_price_usd"] <= target_usd)

    missing_grail_releases_set -= set(exact_owned_releases_map) | set(variant_upgrade_releases_map)

    # 4. Seller Bundle Optimizer & Make-Offer Haggle Strategist
    deduped_rows = [r for r in parsed_rows if r["is_latest_in_group"]]
    seller_bundles, bundle_by_seller = build_seller_bundles(deduped_rows)
    for r in parsed_rows:
        b_info = bundle_by_seller.get(r["seller_info"].lower())
        r["seller_bundle_count"] = b_info["item_count"] if b_info else 1
        r["seller_bundle_savings_usd"] = b_info["shipping_saved_usd"] if b_info else 0.0
        r["offer_strategy"] = compute_offer_strategy(r, b_info)

    # Seller Forensics Leaderboard
    seller_stats_map: dict[str, dict[str, Any]] = {}
    for r in parsed_rows:
        s = r["seller_info"]
        st = seller_stats_map.setdefault(
            s,
            {
                "seller": s,
                "total_listings": 0,
                "unique_releases": set(),
                "auto_relists": 0,
                "price_drops": 0,
                "prices": [],
                "top_titles": Counter(),
                "seller_url": f"https://www.discogs.com/seller/{s}/profile",
            },
        )
        st["total_listings"] += 1
        st["unique_releases"].add(r["release_id"])
        if r["is_auto_relist"]:
            st["auto_relists"] += 1
        if r["is_price_drop"]:
            st["price_drops"] += 1
        st["prices"].append(r["total_price_usd"])
        st["top_titles"][r["title"]] += 1

    seller_leaderboard = []
    for s, st in sorted(seller_stats_map.items(), key=lambda kv: (-kv[1]["total_listings"], kv[0].lower())):
        total_l = st["total_listings"]
        uniq_r = len(st["unique_releases"])
        relists = st["auto_relists"]
        relist_rate = round((relists / max(1, total_l)) * 100, 1)
        top_title, top_title_cnt = st["top_titles"].most_common(1)[0]
        b_info = bundle_by_seller.get(s.lower())
        seller_leaderboard.append({
            "seller": s,
            "seller_url": st["seller_url"],
            "total_listings": total_l,
            "share_of_snapshot_pct": round((total_l / max(1, len(parsed_rows))) * 100, 1),
            "unique_releases": uniq_r,
            "auto_relists": relists,
            "relist_rate_pct": relist_rate,
            "price_drops": st["price_drops"],
            "avg_price_usd": round(statistics.mean(st["prices"]), 2) if st["prices"] else 0.0,
            "min_price_usd": min(st["prices"]) if st["prices"] else 0.0,
            "top_title": top_title,
            "top_title_count": top_title_cnt,
            "bundle_items": b_info["item_count"] if b_info else 1,
            "bundle_savings_usd": b_info["shipping_saved_usd"] if b_info else 0.0,
            "classification": (
                "AUTO-RELIST BOT"
                if relists >= 5 and relist_rate >= 50
                else ("HIGH-VOLUME DEALER" if total_l >= 4 else "INDIE / COLLECTOR")
            ),
        })

    # Top Churned Releases (Most Relisted)
    release_churn_leaderboard = []
    for rid, r_rows in sorted(items_by_release.items(), key=lambda kv: -len(kv[1]))[:15]:
        first_r = r_rows[0]
        sellers_cnt = Counter(x["seller_info"] for x in r_rows)
        top_s, top_s_cnt = sellers_cnt.most_common(1)[0]
        chrono_rel = sorted(r_rows, key=lambda x: int(x["id"]) if str(x["id"]).isdigit() else 0)
        release_churn_leaderboard.append({
            "release_id": rid,
            "title": first_r["title"],
            "variant": first_r["variant"],
            "cover_image_url": first_r["cover_image_url"],
            "total_listings": len(r_rows),
            "unique_sellers": len(sellers_cnt),
            "top_seller": top_s,
            "top_seller_count": top_s_cnt,
            "lowest_price_usd": min(x["total_price_usd"] for x in r_rows),
            "highest_price_usd": max(x["total_price_usd"] for x in r_rows),
            "vault_status": first_r["vault_status"],
            "release_url": first_r["release_url"],
            "price_points": [x["total_price_usd"] for x in chrono_rel[-12:]],
        })

    total_tracked = len(parsed_rows)
    total_auto_relists = sum(1 for r in parsed_rows if r["is_auto_relist"])
    unique_offerings = total_tracked - total_auto_relists
    recordmule_count = sum(1 for r in parsed_rows if r["seller_info"].lower() == "recordmule")
    exact_owned_in_page1 = sum(1 for x in exact_owned_releases_map.values() if x["in_live_page1"])
    live_exact_owned_count = (
        sum(1 for x in exact_owned_releases_map.values() if x["live_wantlist_status"] == "STILL_ON_WANTLIST")
        if live_want_ids_set is not None
        else None
    )
    max_listing_price = max((r["total_price_usd"] for r in parsed_rows), default=500.0)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "compiled_at": datetime.now().isoformat(timespec="seconds"),
        "snapshot_updated_at": snap.get("updated_at", ""),
        "discogs_username": config.get("discogs_username", "krunked"),
        "wantlist_url": config.get("wantlist_url", ""),
        "live_wantlist_sync": {
            "synced": live_want_ids_set is not None,
            "synced_at": wantlist_sync.get("synced_at", "") if isinstance(wantlist_sync, dict) else "",
            "total_live_wants": len(live_want_ids_set) if live_want_ids_set is not None else 0,
            "live_exact_owned_overlaps": live_exact_owned_count,
        },
        "summary": {
            "total_tracked_listings": total_tracked,
            "live_page1_count": live_page_count,
            "distinct_releases": len(items_by_release),
            "distinct_sellers": len(seller_stats_map),
            "unique_deduped_offerings": unique_offerings,
            "auto_relists_intercepted": total_auto_relists,
            "spam_reduction_pct": round((total_auto_relists / max(1, total_tracked)) * 100, 1),
            "recordmule_listings": recordmule_count,
            "recordmule_share_pct": round((recordmule_count / max(1, total_tracked)) * 100, 1),
            "price_drops_detected": sum(1 for r in deduped_rows if r["is_price_drop"]),
            "steals_and_deals_count": sum(
                1 for r in deduped_rows if r["deal_tier"] in ("STEAL", "GREAT_DEAL")
            ),
            "allow_offers_count": sum(1 for r in deduped_rows if r["allow_offers"]),
            "seller_bundles_count": len(seller_bundles),
            "max_bundle_savings_usd": max((b["shipping_saved_usd"] for b in seller_bundles), default=0.0),
            "total_bundle_savings_usd": round(sum(b["shipping_saved_usd"] for b in seller_bundles), 2),
            "target_hits_count": sum(1 for r in deduped_rows if r["is_target_hit"]),
            "bot_bluff_groups_count": sum(
                1 for r in deduped_rows if r["relist_behavior"] in ("YOYO_BLUFF", "FLATLINE_BOT")
            ),
            "max_listing_price_usd": max_listing_price,
            "missing_grails_releases": len(missing_grail_releases_set),
            "variant_upgrade_releases": len(variant_upgrade_releases_map),
            "exact_owned_releases": len(exact_owned_releases_map),
            "exact_owned_in_live_page1": exact_owned_in_page1,
            "live_exact_owned_overlaps": live_exact_owned_count,
            "vault_total_owned_lps": vault.get("total_owned_lps", 159),
            "vault_valuation": vault.get("profile_valuation", {}),
        },
        "config": config,
        "forensics": {
            "first_log_timestamp": forensics.get("first_log_timestamp"),
            "last_log_timestamp": forensics.get("last_log_timestamp"),
            "total_checks": forensics.get("total_checks", 5632),
            "successful_parses": forensics.get("successful_parses", 5565),
            "zero_listing_errors": forensics.get("zero_listing_errors", 40),
            "timeout_warnings": forensics.get("timeout_warnings", 42),
            "total_alerts_sent": forensics.get("total_alerts_sent", 225),
            "hydration_success_rate_pct": forensics.get("hydration_success_rate_pct", 98.81),
            "checks_by_day": forensics.get("checks_by_day", {}),
            "alerts_by_day": forensics.get("alerts_by_day", {}),
            "alerts_by_hour": forensics.get("alerts_by_hour", {}),
        },
        "seller_bundles": seller_bundles,
        "seller_leaderboard": seller_leaderboard,
        "release_churn_leaderboard": release_churn_leaderboard,
        "vault_bridge": {
            "exact_owned_on_wantlist": list(exact_owned_releases_map.values()),
            "variant_upgrades_on_wantlist": list(variant_upgrade_releases_map.values()),
        },
        "listings": parsed_rows,
    }

    if persist:
        DATA_DIR.mkdir(exist_ok=True)
        _atomic_write_text(SNIPER_STATE_FILE, json.dumps(payload, indent=2))
    return payload


def _read_modular_styles() -> str:
    """Reads modular `src/styles/*.css` in sorted order, falling back to `src/styles.css`."""
    if STYLES_DIR.exists():
        parts = sorted(STYLES_DIR.glob("*.css"))
        if parts:
            return "\n\n".join(p.read_text(encoding="utf-8") for p in parts)
    if STYLES_CSS.exists():
        return STYLES_CSS.read_text(encoding="utf-8")
    raise FileNotFoundError(f"Missing CSS source files in {SRC_DIR}")


def _read_modular_js() -> str:
    """Reads modular `src/js/*.js` in sorted order, wrapping cleanly if modular files are present."""
    if JS_DIR.exists():
        parts = sorted(JS_DIR.glob("*.js"))
        if parts:
            body = "\n\n".join(p.read_text(encoding="utf-8") for p in parts)
            return f"(() => {{\n  \"use strict\";\n\n{body}\n}})();\n"
    if APP_JS.exists():
        return APP_JS.read_text(encoding="utf-8")
    raise FileNotFoundError(f"Missing JS source files in {SRC_DIR}")


def compile_static_html(state: dict[str, Any], check_only: bool = False) -> pathlib.Path:
    """Compiles `src/template.html`, `src/styles*`, `src/js*`, and `state` into `index.html`."""
    if not TEMPLATE_HTML.exists():
        raise FileNotFoundError(f"Missing frontend template file: {TEMPLATE_HTML}")

    template = TEMPLATE_HTML.read_text(encoding="utf-8")
    styles = _read_modular_styles()
    app_js = _read_modular_js()
    # Escape </ and <!-- with RFC 8259 Unicode escapes so seller notes can never break out of <script>
    state_json = json.dumps(state, ensure_ascii=False).replace("</", "\\u003c/").replace("<!--", "\\u003c!--")

    compiled = (
        template.replace("/* __INJECT_STYLES_CSS__ */", styles)
        .replace("__INJECT_SNIPER_STATE_JSON__", state_json)
        .replace("// __INJECT_APP_JS__", app_js)
    )

    if not check_only:
        is_default_output = OUTPUT_HTML.resolve() == (REPO_ROOT / "index.html").resolve()
        if is_default_output and STYLES_DIR.exists() and any(STYLES_DIR.glob("*.css")):
            _atomic_write_text(STYLES_CSS, styles)
        if is_default_output and JS_DIR.exists() and any(JS_DIR.glob("*.js")):
            _atomic_write_text(APP_JS, app_js)
        _atomic_write_text(OUTPUT_HTML, compiled)
    return OUTPUT_HTML


def stage_pages_artifact(stage_dir: pathlib.Path) -> list[pathlib.Path]:
    """Stages only public static web assets into `stage_dir` (excluding `.env`, Python scripts, and logs)."""
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True, exist_ok=True)

    copied: list[pathlib.Path] = []
    nojekyll = stage_dir / ".nojekyll"
    nojekyll.write_text("", encoding="utf-8")
    copied.append(nojekyll)

    root_public_files = [
        "index.html",
        "manifest.webmanifest",
        "sw.js",
        "favicon.svg",
        "favicon.ico",
        "favicon-32x32.png",
        "apple-touch-icon.png",
    ]
    for name in root_public_files:
        src = REPO_ROOT / name
        if src.exists() and src.is_file():
            dst = stage_dir / name
            shutil.copy2(src, dst)
            copied.append(dst)

    stage_data = stage_dir / "data"
    stage_data.mkdir(exist_ok=True)
    public_data_files = [
        "sniper_state.json",
        "vault_crossref.json",
        "log_forensics.json",
        "releases_cache.json",
        "wantlist_sync.json",
    ]
    for name in public_data_files:
        src = DATA_DIR / name
        if src.exists() and src.is_file():
            dst = stage_data / name
            shutil.copy2(src, dst)
            copied.append(dst)

    return copied


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Compile Discogs Sniper v{SCHEMA_VERSION} State & Static Command Center")
    parser.add_argument("--state-only", action="store_true", help="Only build data/sniper_state.json")
    parser.add_argument("--check", action="store_true", help="Dry-run compilation integrity check")
    parser.add_argument(
        "--sync-wantlist",
        action="store_true",
        help="Attempt live GET /users/{username}/wants before compiling (uses DISCOGS_TOKEN if set)",
    )
    parser.add_argument(
        "--stage-dir",
        type=str,
        default=None,
        help="Stage clean GitHub Pages static web artifact directory (excludes .env & backend scripts)",
    )
    args = parser.parse_args()

    wantlist_sync = None
    if args.sync_wantlist and not args.check:
        cfg = load_json_safe(CONFIG_FILE, {})
        uname = os.getenv("DISCOGS_USERNAME") or cfg.get("discogs_username") or "krunked"
        tok = os.getenv("DISCOGS_TOKEN") or ""
        wantlist_sync = sync_live_wantlist_optional(uname, tok)
        if wantlist_sync:
            print(f"[ok] Synced live Discogs Wantlist for @{uname}: {wantlist_sync['total_live_wants']} releases")
        else:
            print("[info] Live Wantlist sync unavailable/skipped; using cached snapshot state.")

    state = build_sniper_state(wantlist_sync_override=wantlist_sync, persist=not args.check)
    s = state["summary"]
    print(
        f"[ok] Compiled data/sniper_state.json (v{SCHEMA_VERSION}): {s['total_tracked_listings']} tracked listings -> "
        f"{s['unique_deduped_offerings']} unique offerings ({s['auto_relists_intercepted']} auto-relists intercepted, "
        f"{s['spam_reduction_pct']}% noise reduction) | "
        f"Bundles: {s['seller_bundles_count']} (max save ${s['max_bundle_savings_usd']:.2f}) | "
        f"Vault: {s['exact_owned_releases']} snapshot owned ({s['exact_owned_in_live_page1']} on Live Page 1), "
        f"{s['variant_upgrade_releases']} variant targets, {s['missing_grails_releases']} missing grails."
    )

    if not args.state_only:
        has_css = (STYLES_DIR.exists() and any(STYLES_DIR.glob("*.css"))) or STYLES_CSS.exists()
        has_js = (JS_DIR.exists() and any(JS_DIR.glob("*.js"))) or APP_JS.exists()
        if TEMPLATE_HTML.exists() and has_css and has_js:
            out = compile_static_html(state, check_only=args.check)
            print(f"[ok] Compiled static GitHub Pages Command Center -> {out} ({out.stat().st_size:,} bytes)")
        else:
            print("[info] src/* files not yet created; skipped index.html compilation.")

    if args.stage_dir and not args.check:
        staged = stage_pages_artifact(pathlib.Path(args.stage_dir))
        print(f"[ok] Staged {len(staged)} clean static web asset(s) -> {args.stage_dir}")


if __name__ == "__main__":
    main()
