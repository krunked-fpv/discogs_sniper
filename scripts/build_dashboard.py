#!/usr/bin/env python3
"""Deterministic Discogs Sniper v2.0 Analytics & Static Command Center Compiler (`build_dashboard.py`).

Compiles:
  - `seed_snapshot.json` (live & historical tracked Wantlist listings)
  - `data/log_forensics.json` + live `sniper.log` (5,600+ 5-minute run telemetry & alert timestamps)
  - `data/vault_crossref.json` + live `discogs_collection` (159-LP Collection Vault cross-reference)
  - `data/releases_cache.json` (optional cached Discogs API `/releases/{id}` & `/marketplace/price_suggestions/{id}`)
  - `sniper_config.json` (v2.0 relist deduplication & filter configuration)

Produces:
  - `data/sniper_state.json` (enriched structured JSON dataset)
  - `index.html` (self-contained Static GitHub Pages Command Center assembled from `src/*`)
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
import pathlib
import re
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
SNIPER_STATE_FILE = DATA_DIR / "sniper_state.json"

SRC_DIR = REPO_ROOT / "src"
TEMPLATE_HTML = SRC_DIR / "template.html"
STYLES_CSS = SRC_DIR / "styles.css"
APP_JS = SRC_DIR / "app.js"
OUTPUT_HTML = REPO_ROOT / "index.html"


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


def parse_wax_shader(variant_str: str) -> dict[str, str]:
    """Deterministically parses a Discogs pressing variant string into SVG vinyl disc colors & pattern."""
    v = (variant_str or "").lower()

    # Determine pattern
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

    # Color palette matching
    color_rules = [
        (["ultra clear", "crystal clear", "clear"], "#d8e4ec", "#9bb4c4", "#f0f7fa", "Ultra Clear"),
        (["black ice", "smoke", "grey", "gray", "silver"], "#374151", "#1f2937", "#9ca3af", "Black Ice / Smoke"),
        (["gold", "amber", "yellow", "honey", "mustard", "orange"], "#f59e0b", "#b45309", "#fde68a", "Amber Gold"),
        (["red", "crimson", "ruby", "blood", "oxblood", "burgundy", "maroon"], "#dc2626", "#7f1d1d", "#fca5a5", "Crimson Wax"),
        (["pink", "magenta", "rose", "neon coral"], "#ec4899", "#831843", "#fbcfe8", "Rose / Pink"),
        (["blue", "cyan", "aqua", "teal", "turquoise", "cobalt", "navy", "sea"], "#0284c7", "#0c4a6e", "#7dd3fc", "Cobalt / Aqua"),
        (["green", "emerald", "mint", "forest", "olive", "lime", "coke bottle"], "#10b981", "#064e3b", "#a7f3d0", "Emerald / Mint"),
        (["bone", "cream", "white", "ivory", "milk", "pearl"], "#f3f0e6", "#d6d1c2", "#ffffff", "Bone / White"),
        (["brown", "tan", "copper", "bronze", "root beer"], "#92400e", "#451a03", "#fcd34d", "Bronze / Root Beer"),
    ]

    primary = "#181a1f"
    secondary = "#0d0f12"
    accent = "#f59e0b"
    label_text = "180g Audiophile Black"

    matched_colors = []
    for keywords, c1, c2, c3, name in color_rules:
        if any(k in v for k in keywords):
            matched_colors.append((c1, c2, c3, name))

    if matched_colors:
        primary, secondary, accent, label_text = matched_colors[0]
        if len(matched_colors) > 1:
            secondary = matched_colors[1][0]
            accent = matched_colors[1][2]
            if len(matched_colors) > 2:
                accent = matched_colors[2][0]

    # Extract concise variant callout
    clean_tokens = [
        t.strip()
        for t in (variant_str or "LP, Vinyl").split(",")
        if t.strip().lower() not in ("vinyl", "lp", "album", "stereo", "reissue", "repress", "limited edition")
    ]
    short_variant = ", ".join(clean_tokens[:3]) if clean_tokens else label_text

    return {
        "pattern": pattern,
        "primary": primary,
        "secondary": secondary,
        "accent": accent,
        "wax_name": short_variant,
    }


def condition_multiplier(media_cond: str) -> float:
    c = (media_cond or "").upper().strip()
    if c in ("M", "MINT", "MINT (M)"):
        return 1.18
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


def refresh_log_forensics() -> dict[str, Any]:
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
    DATA_DIR.mkdir(exist_ok=True)
    LOG_FORENSICS_FILE.write_text(json.dumps(forensics, indent=2), encoding="utf-8")
    return forensics


def build_sniper_state() -> dict[str, Any]:
    """Compiles the enriched Sniper v2.0 state from snapshot, forensics, and Collection Vault crossref."""
    snap = load_json_safe(SEED_FILE, {"items": {}})
    raw_items = snap.get("items", snap) if isinstance(snap, dict) else {}
    config = load_json_safe(CONFIG_FILE, {})
    forensics = refresh_log_forensics()
    vault = load_json_safe(VAULT_CROSSREF_FILE, {})
    api_cache = load_json_safe(RELEASES_CACHE_FILE, {})

    owned_releases: dict[str, Any] = vault.get("owned_releases") or {}
    owned_albums: dict[str, list[Any]] = vault.get("owned_albums") or {}
    cdn_by_rid: dict[str, str] = vault.get("cdn_covers_by_rid") or {}
    cdn_by_album: dict[str, str] = vault.get("cdn_covers_by_album") or {}
    alert_timestamps: dict[str, str] = forensics.get("alert_timestamps") or {}

    # First pass: collect prices per release_id and per (release_id, seller, condition)
    prices_by_release: dict[str, list[float]] = defaultdict(list)
    items_by_fingerprint: dict[str, list[dict[str, Any]]] = defaultdict(list)
    items_by_release: dict[str, list[dict[str, Any]]] = defaultdict(list)

    parsed_rows: list[dict[str, Any]] = []
    for idx, (item_id, item) in enumerate(raw_items.items()):
        rel_url = item.get("release_url", "")
        m_rel = re.search(r"/release/(\d+)", rel_url)
        release_id = m_rel.group(1) if m_rel else "unknown"

        list_usd = parse_usd(item.get("list_price"))
        total_usd = parse_usd(item.get("total_price")) or list_usd
        ship_usd = max(0.0, round(total_usd - list_usd, 2))

        raw_title = item.get("title", "Unknown Title").strip()
        if " - " in raw_title:
            artist_raw, album_raw = raw_title.split(" - ", 1)
        else:
            artist_raw, album_raw = raw_title, raw_title

        artist_clean = re.sub(r"\s*\(\d+\)$", "", artist_raw.strip())
        album_clean = album_raw.strip()
        norm_album_key = re.sub(r"\s*\(\d+\)", "", raw_title.lower().strip())

        seller = (item.get("seller_info") or "US Seller").strip()
        media_cond = (item.get("media_condition") or "NM").strip()
        sleeve_cond = (item.get("sleeve_condition") or "NM").strip()
        alert_ts = alert_timestamps.get(str(item_id)) or item.get("seeded_at") or snap.get("updated_at") or ""

        fp = f"{release_id}::{seller.lower()}::{media_cond.upper()}"

        row = {
            "snapshot_order": idx + 1,
            "rank": item.get("rank", idx + 1),
            "is_live_page1": idx < int(snap.get("live_page_count", 25)),
            "id": str(item_id),
            "release_id": release_id,
            "title": raw_title,
            "artist": artist_clean,
            "album": album_clean,
            "norm_album_key": norm_album_key,
            "variant": item.get("variant", "LP, Vinyl"),
            "wax_shader": parse_wax_shader(item.get("variant", "")),
            "media_condition": media_cond,
            "media_condition_full": condition_full_label(media_cond),
            "sleeve_condition": sleeve_cond,
            "list_price": item.get("list_price", format_usd(list_usd)),
            "total_price": item.get("total_price", format_usd(total_usd)),
            "list_price_usd": list_usd,
            "total_price_usd": total_usd,
            "shipping_price_usd": ship_usd,
            "seller_info": seller,
            "listed_age": item.get("listed_age", ""),
            "item_url": item.get("item_url", f"https://www.discogs.com/sell/item/{item_id}"),
            "add_to_cart_url": item.get("add_to_cart_url", f"https://www.discogs.com/sell/cart/?add={item_id}"),
            "release_url": rel_url or (f"https://www.discogs.com/release/{release_id}" if release_id != "unknown" else ""),
            "raw_description": item.get("raw_description", ""),
            "seeded_at": item.get("seeded_at", ""),
            "alerted_at": alert_ts,
            "fingerprint": fp,
            "api_stats": item.get("api_stats") or {},
        }
        parsed_rows.append(row)
        if total_usd > 0:
            prices_by_release[release_id].append(total_usd)
        items_by_fingerprint[fp].append(row)
        items_by_release[release_id].append(row)

    # Second pass: compute relist history, price drops, Vault ownership, and deal scores
    relist_groups: dict[str, dict[str, Any]] = {}
    for fp, group_rows in items_by_fingerprint.items():
        # Sort chronologically by integer listing ID ascending (oldest listing ID first, newest last)
        chronological = sorted(group_rows, key=lambda r: int(r["id"]) if r["id"].isdigit() else 0)
        first_seen_price = chronological[0]["total_price_usd"]
        highest_seen_price = max(r["total_price_usd"] for r in chronological)
        lowest_seen_price = min(r["total_price_usd"] for r in chronological)

        for c_idx, r in enumerate(chronological):
            r["relist_sequence_num"] = c_idx + 1
            r["relist_group_total"] = len(chronological)
            r["is_auto_relist"] = c_idx > 0
            r["is_latest_in_group"] = c_idx == (len(chronological) - 1)
            r["group_first_price_usd"] = first_seen_price
            r["group_highest_price_usd"] = highest_seen_price
            r["group_lowest_price_usd"] = lowest_seen_price

            # Did the price drop vs earlier listings from this seller?
            price_drop_usd = round(highest_seen_price - r["total_price_usd"], 2)
            r["is_price_drop"] = c_idx > 0 and price_drop_usd >= 1.0
            r["price_drop_usd"] = price_drop_usd if r["is_price_drop"] else 0.0
            r["price_drop_pct"] = (
                round((price_drop_usd / highest_seen_price) * 100, 1)
                if r["is_price_drop"] and highest_seen_price > 0
                else 0.0
            )
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
            else:
                r["sibling_listing_ids"] = [r["id"]]
                r["sibling_history"] = []

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
        }

    # Enrich each row with Vault ownership, Cover Art, and Condition-Matched Market Benchmarks
    exact_owned_releases_map: dict[str, dict[str, Any]] = {}
    variant_upgrade_releases_map: dict[str, dict[str, Any]] = {}
    missing_grail_releases_set: set[str] = set()

    for r in parsed_rows:
        rid = r["release_id"]
        norm_key = r["norm_album_key"]
        cached_api = api_cache.get(rid) or {}

        # 1. Cover Art Resolution
        cover_url = (
            r["api_stats"].get("cover_image")
            or cached_api.get("cover_image")
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
                "wantlist_hits_count": len(items_by_release[rid]),
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
                "owned_format": owned_info["format_string"],
                "owned_value_usd": owned_info["estimated_value_usd"],
                "cover_image_url": cover_url or owned_info.get("cover_image_url", ""),
                "pressing_image_url": owned_info.get("pressing_image_url", ""),
                "wantlist_hits_count": len(items_by_release[rid]),
                "lowest_sniped_usd": min(prices_by_release[rid]) if prices_by_release[rid] else r["total_price_usd"],
                "release_url": r["release_url"],
            }
        else:
            r["vault_status"] = "MISSING_GRAIL"
            r["vault_status_label"] = "MISSING GRAIL"
            r["vault_owned_detail"] = None
            missing_grail_releases_set.add(rid)

        # 3. Release Price Dispersion & Condition-Matched Suggested Price Benchmark
        rel_prices = prices_by_release.get(rid) or [r["total_price_usd"]]
        rel_low = min(rel_prices)
        rel_high = max(rel_prices)
        rel_med = round(statistics.median(rel_prices), 2)

        # Anchor benchmark with Vault official valuation or API price suggestions if available
        vault_est = 0.0
        if r["vault_owned_detail"] and r["vault_owned_detail"].get("estimated_value_usd"):
            vault_est = float(r["vault_owned_detail"]["estimated_value_usd"])

        api_sugg = parse_usd((r["api_stats"] or {}).get("condition_suggested_price")) or parse_usd(
            cached_api.get("condition_suggested_price")
        )

        if api_sugg > 0:
            cond_suggested_usd = api_sugg
            benchmark_source = "Discogs API /marketplace/price_suggestions"
        elif vault_est > 0:
            cond_suggested_usd = round(vault_est * condition_multiplier(r["media_condition"]), 2)
            benchmark_source = "Discogs Collection Vault Median Valuation"
        else:
            # Estimate condition-adjusted benchmark from observed marketplace median + shipping buffer
            base_med = max(rel_med, r["list_price_usd"] * 1.08)
            cond_suggested_usd = round(base_med * condition_multiplier(r["media_condition"]), 2)
            benchmark_source = "Wantlist Condition-Adjusted Market Benchmark"

        r["market_stats"] = {
            "observed_low_usd": rel_low,
            "observed_median_usd": rel_med,
            "observed_high_usd": rel_high,
            "condition_suggested_usd": cond_suggested_usd,
            "condition_suggested_formatted": format_usd(cond_suggested_usd),
            "benchmark_source": benchmark_source,
            "release_listings_tracked": len(rel_prices),
        }

        delta_usd = round(r["total_price_usd"] - cond_suggested_usd, 2)
        delta_pct = round((delta_usd / cond_suggested_usd) * 100, 1) if cond_suggested_usd > 0 else 0.0
        r["deal_delta_usd"] = delta_usd
        r["deal_delta_pct"] = delta_pct

        # Compute Deal Score (0..100) and Deal Tier
        score = 65
        if delta_pct <= -15:
            score = 94
            tier = "STEAL"
            tier_label = f"STEAL ({delta_pct:+.0f}% vs {r['media_condition']})"
        elif delta_pct <= -3:
            score = 82
            tier = "GREAT_DEAL"
            tier_label = f"BELOW SUGGESTED ({delta_pct:+.0f}%)"
        elif delta_pct <= 12:
            score = 68
            tier = "FAIR_MARKET"
            tier_label = "FAIR MARKET"
        else:
            score = max(25, int(60 - delta_pct))
            tier = "ABOVE_MARKET"
            tier_label = f"PREMIUM ({delta_pct:+.0f}%)"

        if r["is_price_drop"]:
            score = min(98, score + 14)
        if r["vault_status"] == "MISSING_GRAIL":
            score = min(99, score + 4)

        r["deal_score"] = score
        r["deal_tier"] = tier
        r["deal_tier_label"] = tier_label

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
        })

    total_tracked = len(parsed_rows)
    total_auto_relists = sum(1 for r in parsed_rows if r["is_auto_relist"])
    unique_offerings = total_tracked - total_auto_relists
    recordmule_count = sum(1 for r in parsed_rows if r["seller_info"].lower() == "recordmule")

    payload = {
        "schema_version": "2.0.0",
        "compiled_at": datetime.now().isoformat(timespec="seconds"),
        "snapshot_updated_at": snap.get("updated_at", ""),
        "discogs_username": config.get("discogs_username", "krunked"),
        "wantlist_url": config.get("wantlist_url", ""),
        "summary": {
            "total_tracked_listings": total_tracked,
            "live_page1_count": int(snap.get("live_page_count", 25)),
            "distinct_releases": len(items_by_release),
            "distinct_sellers": len(seller_stats_map),
            "unique_deduped_offerings": unique_offerings,
            "auto_relists_intercepted": total_auto_relists,
            "spam_reduction_pct": round((total_auto_relists / max(1, total_tracked)) * 100, 1),
            "recordmule_listings": recordmule_count,
            "recordmule_share_pct": round((recordmule_count / max(1, total_tracked)) * 100, 1),
            "price_drops_detected": sum(1 for r in parsed_rows if r["is_price_drop"]),
            "steals_and_deals_count": sum(1 for r in parsed_rows if r["deal_tier"] in ("STEAL", "GREAT_DEAL")),
            "missing_grails_releases": len(missing_grail_releases_set),
            "variant_upgrade_releases": len(variant_upgrade_releases_map),
            "exact_owned_releases": len(exact_owned_releases_map),
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
        "seller_leaderboard": seller_leaderboard,
        "release_churn_leaderboard": release_churn_leaderboard,
        "vault_bridge": {
            "exact_owned_on_wantlist": list(exact_owned_releases_map.values()),
            "variant_upgrades_on_wantlist": list(variant_upgrade_releases_map.values()),
        },
        "listings": parsed_rows,
    }

    DATA_DIR.mkdir(exist_ok=True)
    SNIPER_STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def compile_static_html(state: dict[str, Any], check_only: bool = False) -> pathlib.Path:
    """Compiles `src/template.html`, `src/styles.css`, `src/app.js`, and `state` into `index.html`."""
    if not TEMPLATE_HTML.exists() or not STYLES_CSS.exists() or not APP_JS.exists():
        raise FileNotFoundError(
            f"Missing frontend source files in {SRC_DIR} (expected template.html, styles.css, app.js)"
        )

    template = TEMPLATE_HTML.read_text(encoding="utf-8")
    styles = STYLES_CSS.read_text(encoding="utf-8")
    app_js = APP_JS.read_text(encoding="utf-8")
    state_json = json.dumps(state, ensure_ascii=False)

    compiled = (
        template.replace("/* __INJECT_STYLES_CSS__ */", styles)
        .replace("__INJECT_SNIPER_STATE_JSON__", state_json)
        .replace("// __INJECT_APP_JS__", app_js)
    )

    if not check_only:
        OUTPUT_HTML.write_text(compiled, encoding="utf-8")
    return OUTPUT_HTML


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile Discogs Sniper v2.0 State & Static GitHub Pages Dashboard")
    parser.add_argument("--state-only", action="store_true", help="Only build data/sniper_state.json")
    parser.add_argument("--check", action="store_true", help="Dry-run compilation integrity check")
    args = parser.parse_args()

    state = build_sniper_state()
    s = state["summary"]
    print(
        f"[ok] Compiled data/sniper_state.json: {s['total_tracked_listings']} tracked listings -> "
        f"{s['unique_deduped_offerings']} unique offerings ({s['auto_relists_intercepted']} auto-relists intercepted, "
        f"{s['spam_reduction_pct']}% noise reduction) | "
        f"Vault overlaps: {s['exact_owned_releases']} exact owned, {s['variant_upgrade_releases']} variant upgrades, "
        f"{s['missing_grails_releases']} missing grails."
    )

    if not args.state_only:
        if TEMPLATE_HTML.exists() and STYLES_CSS.exists() and APP_JS.exists():
            out = compile_static_html(state, check_only=args.check)
            print(f"[ok] Compiled static GitHub Pages Command Center -> {out} ({out.stat().st_size:,} bytes)")
        else:
            print("[info] src/* files not yet created; skipped index.html compilation.")


if __name__ == "__main__":
    main()
