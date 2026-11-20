#!/usr/bin/env python3
"""Discogs Sniper v2.0 — Hybrid Official Discogs REST API v2.0 + In-Origin GraphQL + Virtual DOM Sniper."""

import argparse
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import json
import logging
import os
from pathlib import Path
import random
import re
import smtplib
import sys
import time
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None  # type: ignore

# =====================================================================
# CONFIGURATION & PATHS
# =====================================================================
SNIPER_VERSION = "2.0.0"
DISCOGS_BASE = "https://www.discogs.com"
DISCOGS_API_BASE = "https://api.discogs.com"
USER_AGENT = f"KrunkedDiscogsSniper/{SNIPER_VERSION} +https://github.com/krunked-fpv/discogs_sniper"

DEFAULT_WANTLIST_URL = (
    DISCOGS_BASE
    + "/shop/mywants/?formatDescription=LP&formatName=Vinyl&shipsFrom=United+States&sort=listedNewest"
)

BASE_DIR = Path(__file__).parent.resolve()
SEED_FILE = BASE_DIR / "seed_snapshot.json"
LEGACY_SEEN_FILE = BASE_DIR / "seen_listings.json"
CONFIG_FILE = BASE_DIR / "sniper_config.json"
PROFILE_DIR = BASE_DIR / "chrome_discogs_profile"
LOG_FILE = BASE_DIR / "sniper.log"
LOCK_FILE = BASE_DIR / "sniper.lock"
DATA_DIR = BASE_DIR / "data"
RELEASES_CACHE_FILE = DATA_DIR / "releases_cache.json"
VAULT_CROSSREF_FILE = DATA_DIR / "vault_crossref.json"
SIBLING_COLLECTION_DIR = Path(r"C:\DiscogsCollection\discogs_collection")

MAX_HISTORY = 2000
LOCK_STALE_SECONDS = 180

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)


# =====================================================================
# CREDENTIAL & CONFIG AUTO-DISCOVERY (.env + Windows HKCU Registry)
# =====================================================================
def sanitize_token(raw_token: str | None) -> str:
    """Strips control chars, quotes, and prefixes from a Discogs Personal Access Token."""
    if not raw_token:
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f-\x9f]+", "", str(raw_token)).strip().strip("\"'` ")
    for prefix in ("DISCOGS_TOKEN=", "Discogs token=", "token=", "Bearer "):
        if cleaned.lower().startswith(prefix.lower()):
            cleaned = cleaned[len(prefix) :].strip().strip("\"'` ")
    return re.sub(r"[^A-Za-z0-9._\-]", "", cleaned)


def sanitize_username(raw_user: str | None, default: str = "krunked") -> str:
    if not raw_user:
        return default
    cleaned = re.sub(r"[\x00-\x1f\x7f-\x9f]+", "", str(raw_user)).strip().strip("\"'` ")
    return cleaned or default


def parse_dotenv_file(dotenv_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not dotenv_path.exists():
        return values
    try:
        for line in dotenv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            values[k.strip()] = v.strip().strip("\"'` ")
    except Exception:
        pass
    return values


def query_windows_env_var(var_name: str) -> str:
    """Reads an environment variable from Windows HKCU/HKLM Registry (or PowerShell under WSL)."""
    if os.name == "nt":
        try:
            import winreg

            for hive, subkey in (
                (winreg.HKEY_CURRENT_USER, "Environment"),
                (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
            ):
                try:
                    with winreg.OpenKey(hive, subkey, 0, winreg.KEY_READ) as key:
                        val, _ = winreg.QueryValueEx(key, var_name)
                        if val:
                            return str(val).strip()
                except Exception:
                    pass
        except Exception:
            pass
    else:
        try:
            import subprocess

            for ps_bin in ("powershell.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"):
                try:
                    res = subprocess.run(
                        [
                            ps_bin,
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            f"[Environment]::GetEnvironmentVariable('{var_name}', 'User')",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=3,
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        return res.stdout.strip()
                except Exception:
                    pass
        except Exception:
            pass
    return ""


def load_sniper_config() -> dict[str, Any]:
    default_cfg: dict[str, Any] = {
        "schema_version": SNIPER_VERSION,
        "discogs_username": "krunked",
        "wantlist_url": DEFAULT_WANTLIST_URL,
        "relist_deduplication": {
            "enabled": True,
            "cooldown_days": 7,
            "consolidate_multi_copy_batches": True,
            "price_drop_override_usd": 1.0,
            "price_drop_override_pct": 3.0,
        },
        "collection_vault_bridge": {
            "enabled": True,
            "suppress_exact_owned_alerts": False,
            "local_collection_path": str(SIBLING_COLLECTION_DIR / "data" / "collection.json"),
        },
        "filters": {
            "min_media_condition": "VG+",
            "min_sleeve_condition": "Any",
            "max_total_price_usd": None,
            "muted_sellers": [],
            "price_drop_only_sellers": ["recordmule"],
            "target_prices_by_release": {},
        },
        "alerts": {
            "email_to": "alexgoresch@gmail.com",
            "email_cc": "mleven42@gmail.com",
            "ntfy_base": "https://ntfy.sh",
            "auto_rebuild_static_dashboard": True,
        },
    }
    if CONFIG_FILE.exists():
        try:
            user_cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(user_cfg, dict):
                for k, v in user_cfg.items():
                    if isinstance(v, dict) and isinstance(default_cfg.get(k), dict):
                        default_cfg[k].update(v)
                    else:
                        default_cfg[k] = v
        except Exception as e:
            logging.warning(f"Could not parse {CONFIG_FILE.name}: {e}")
    return default_cfg


def resolve_runtime_credentials(
    cli_token: str | None = None,
    cli_username: str | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Resolves Discogs API + SMTP + ntfy credentials from CLI, env, .env, sibling collection .env, or Windows Registry."""
    cfg = config or load_sniper_config()
    dotenv_vars: dict[str, str] = {}
    for candidate in (
        SIBLING_COLLECTION_DIR / ".env",
        Path.cwd() / ".env",
        BASE_DIR / ".env",
    ):
        dotenv_vars.update(parse_dotenv_file(candidate))

    def get_var(keys: tuple[str, ...], default: str = "") -> str:
        for k in keys:
            val = os.getenv(k) or dotenv_vars.get(k)
            if val:
                return val.strip()
        for k in keys:
            reg_val = query_windows_env_var(k)
            if reg_val:
                return reg_val
        return default

    raw_token = cli_token or get_var(("DISCOGS_TOKEN", "DISCOGS_API_TOKEN"))
    token = sanitize_token(raw_token)

    raw_user = cli_username or get_var(("DISCOGS_USERNAME", "DISCOGS_USER"), cfg.get("discogs_username", "krunked"))
    username = sanitize_username(raw_user, default="krunked")

    alerts_cfg = cfg.get("alerts") or {}
    email_to = get_var(("EMAIL_ADDRESS", "SNIPER_EMAIL_TO"), alerts_cfg.get("email_to", "alexgoresch@gmail.com"))
    email_cc = get_var(("CC_EMAIL_ADDRESS", "SNIPER_EMAIL_CC"), alerts_cfg.get("email_cc", "mleven42@gmail.com"))
    gmail_app_password = get_var(("GMAIL_APP_PASSWORD",), "")
    ntfy_topic = get_var(("NTFY_TOPIC",), "")
    ntfy_base = get_var(("NTFY_BASE",), alerts_cfg.get("ntfy_base", "https://ntfy.sh"))

    return {
        "discogs_token": token,
        "discogs_username": username,
        "email_to": email_to,
        "email_cc": email_cc,
        "gmail_app_password": gmail_app_password,
        "ntfy_topic": ntfy_topic,
        "ntfy_base": ntfy_base,
    }


# =====================================================================
# SINGLE-INSTANCE ATOMIC FILE LOCK (PREVENTS OVERLAPPING TASK COLLISIONS)
# =====================================================================
class SingleInstanceLock:
    """Prevents two overlapping Task Scheduler / console runs from colliding on chrome_discogs_profile/."""

    def __init__(self, lock_path: Path, stale_seconds: int = LOCK_STALE_SECONDS):
        self.lock_path = lock_path
        self.stale_seconds = stale_seconds
        self.acquired = False

    def __enter__(self):
        if self.lock_path.exists():
            try:
                age = time.time() - self.lock_path.stat().st_mtime
                info = json.loads(self.lock_path.read_text(encoding="utf-8"))
                old_pid = info.get("pid")
                if age < self.stale_seconds:
                    logging.warning(
                        f"Another Discogs Sniper instance (PID {old_pid}, age {age:.0f}s) is active. Exiting cleanly."
                    )
                    return self
                logging.info(f"Evicting stale lock file from PID {old_pid} ({age:.0f}s old).")
            except Exception:
                pass
        try:
            self.lock_path.write_text(
                json.dumps({"pid": os.getpid(), "started_at": datetime.now().isoformat(timespec="seconds")}),
                encoding="utf-8",
            )
            self.acquired = True
        except Exception as e:
            logging.warning(f"Could not write lock file: {e}")
            self.acquired = True
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.acquired and self.lock_path.exists():
            try:
                self.lock_path.unlink()
            except Exception:
                pass


# =====================================================================
# OFFICIAL DISCOGS REST API v2.0 CLIENT (https://api.discogs.com)
# =====================================================================
class DiscogsAPIClient:
    """
    Authenticated client for the official Discogs REST API v2.0 (https://www.discogs.com/developers).
    Provides zero-browser-tab release stats, condition-matched price suggestions, per-listing JSON enrichment,
    and Wantlist / Collection Vault synchronization.
    """

    CONDITION_KEY_MAP = {
        "M": "Mint (M)",
        "MINT": "Mint (M)",
        "MINT (M)": "Mint (M)",
        "NM": "Near Mint (NM or M-)",
        "M-": "Near Mint (NM or M-)",
        "NEAR MINT": "Near Mint (NM or M-)",
        "NEAR MINT (NM OR M-)": "Near Mint (NM or M-)",
        "VG+": "Very Good Plus (VG+)",
        "VERY GOOD PLUS": "Very Good Plus (VG+)",
        "VERY GOOD PLUS (VG+)": "Very Good Plus (VG+)",
        "VG": "Very Good (VG)",
        "VERY GOOD": "Very Good (VG)",
        "VERY GOOD (VG)": "Very Good (VG)",
        "G+": "Good Plus (G+)",
        "GOOD PLUS (G+)": "Good Plus (G+)",
        "G": "Good (G)",
        "GOOD (G)": "Good (G)",
        "F": "Fair (F)",
        "FAIR (F)": "Fair (F)",
        "P": "Poor (P)",
        "POOR (P)": "Poor (P)",
    }

    def __init__(self, token: str = "", username: str = "krunked"):
        self.token = sanitize_token(token)
        self.username = sanitize_username(username)
        self.headers: dict[str, str] = {
            "Accept": "application/vnd.discogs.v2.discogs+json",
            "User-Agent": USER_AGENT,
        }
        if self.token:
            self.headers["Authorization"] = f"Discogs token={self.token}"
        self.ratelimit_remaining = 60
        self._releases_cache: dict[str, Any] | None = None

    @property
    def is_authenticated(self) -> bool:
        return bool(self.token)

    def _load_releases_cache(self) -> dict[str, Any]:
        if self._releases_cache is not None:
            return self._releases_cache
        if RELEASES_CACHE_FILE.exists():
            try:
                self._releases_cache = json.loads(RELEASES_CACHE_FILE.read_text(encoding="utf-8"))
                if isinstance(self._releases_cache, dict):
                    return self._releases_cache
            except Exception:
                pass
        self._releases_cache = {}
        return self._releases_cache

    def _save_releases_cache(self) -> None:
        if self._releases_cache is None:
            return
        try:
            DATA_DIR.mkdir(exist_ok=True)
            RELEASES_CACHE_FILE.write_text(json.dumps(self._releases_cache, indent=2), encoding="utf-8")
        except Exception as e:
            logging.debug(f"Could not save releases cache: {e}")

    def _get(self, path: str, params: dict[str, Any] | None = None, timeout: int = 12) -> dict[str, Any] | None:
        if self.ratelimit_remaining <= 2:
            time.sleep(1.5)
        url = f"{DISCOGS_API_BASE}{path}" if path.startswith("/") else path
        if params:
            qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            if qs:
                url = f"{url}{'&' if '?' in url else '?'}{qs}"
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers=self.headers, method="GET")
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    rem = resp.headers.get("X-Discogs-Ratelimit-Remaining")
                    if rem and str(rem).isdigit():
                        self.ratelimit_remaining = int(rem)
                    raw = resp.read().decode("utf-8", errors="replace")
                    return json.loads(raw)
            except urllib.error.HTTPError as he:
                if he.code == 429 and attempt == 0:
                    logging.warning("Discogs API rate limit reached (429); pausing 5s...")
                    time.sleep(5)
                    continue
                logging.debug(f"Discogs API GET {path} returned HTTP {he.code}")
                break
            except Exception as e:
                logging.debug(f"Discogs API request error on {path}: {e}")
                break
        return None

    def get_identity(self) -> dict[str, Any] | None:
        """Calls GET /oauth/identity to verify the personal access token."""
        data = self._get("/oauth/identity")
        if data and data.get("username"):
            self.username = sanitize_username(str(data["username"]), default=self.username)
        return data

    def get_marketplace_stats(self, release_id: str) -> dict[str, Any]:
        """Calls GET /marketplace/stats/{release_id}?curr_abbr=USD for live lowest price & number for sale."""
        if not release_id or not release_id.isdigit():
            return {}
        data = self._get(f"/marketplace/stats/{release_id}", params={"curr_abbr": "USD"})
        if not data:
            return {}
        lowest = data.get("lowest_price")
        lowest_val = lowest.get("value") if isinstance(lowest, dict) else (lowest if isinstance(lowest, (int, float)) else None)
        return {
            "num_for_sale": data.get("num_for_sale"),
            "lowest_price_usd": float(lowest_val) if lowest_val is not None else None,
            "blocked_from_sale": bool(data.get("blocked_from_sale", False)),
        }

    def get_price_suggestions(self, release_id: str) -> dict[str, float]:
        """
        Calls GET /marketplace/price_suggestions/{release_id} (requires DISCOGS_TOKEN).
        Returns a dictionary mapping Goldmine condition labels (e.g. 'Near Mint (NM or M-)') to suggested USD price.
        """
        if not self.is_authenticated or not release_id or not release_id.isdigit():
            return {}
        data = self._get(f"/marketplace/price_suggestions/{release_id}")
        if not isinstance(data, dict):
            return {}
        out: dict[str, float] = {}
        for cond_label, price_obj in data.items():
            if isinstance(price_obj, dict) and price_obj.get("value") is not None:
                try:
                    out[cond_label] = round(float(price_obj["value"]), 2)
                except (TypeError, ValueError):
                    pass
        return out

    def get_listing_details(self, listing_id: str) -> dict[str, Any]:
        """Calls GET /marketplace/listings/{listing_id} for structured per-listing details."""
        if not listing_id or not listing_id.isdigit():
            return {}
        data = self._get(f"/marketplace/listings/{listing_id}", params={"curr_abbr": "USD"})
        if not isinstance(data, dict) or not data.get("id"):
            return {}
        seller = data.get("seller") or {}
        seller_stats = seller.get("stats") or {}
        rel = data.get("release") or {}
        comm = (rel.get("stats") or {}).get("community") or {}
        images = rel.get("images") or []
        cover = images[0].get("uri") if images and isinstance(images[0], dict) else rel.get("thumbnail", "")

        return {
            "status": data.get("status", "For Sale"),
            "posted": data.get("posted", ""),
            "allow_offers": bool(data.get("allow_offers", False)),
            "ships_from": data.get("ships_from", ""),
            "comments": data.get("comments", ""),
            "seller_rating": seller_stats.get("rating", ""),
            "seller_stars": seller_stats.get("stars"),
            "seller_total_ratings": seller_stats.get("total"),
            "in_wantlist": comm.get("in_wantlist"),
            "in_collection": comm.get("in_collection"),
            "cover_image": cover,
        }

    def get_release_metadata(self, release_id: str) -> dict[str, Any]:
        """Calls GET /releases/{release_id} with persistent local caching in data/releases_cache.json."""
        if not release_id or not release_id.isdigit():
            return {}
        cache = self._load_releases_cache()
        if release_id in cache:
            return cache[release_id]

        data = self._get(f"/releases/{release_id}", params={"curr_abbr": "USD"})
        if not isinstance(data, dict) or not data.get("id"):
            return {}

        images = data.get("images") or []
        cover = images[0].get("uri") if images and isinstance(images[0], dict) else data.get("thumb", "")
        comm = data.get("community") or {}
        rating = comm.get("rating") or {}
        formats = data.get("formats") or []
        fmt_parts = []
        for f in formats:
            if isinstance(f, dict):
                descs = ", ".join(f.get("descriptions") or [])
                text = (f.get("text") or "").strip()
                fmt_parts.append(", ".join(x for x in (f.get("name", ""), descs, text) if x))

        summary = {
            "release_id": str(data["id"]),
            "master_id": data.get("master_id"),
            "title": data.get("title", ""),
            "year": data.get("year"),
            "country": data.get("country", ""),
            "format_summary": " / ".join(fmt_parts),
            "cover_image": cover,
            "thumb": data.get("thumb", ""),
            "community_have": comm.get("have", 0),
            "community_want": comm.get("want", 0),
            "rating_average": rating.get("average", 0),
            "rating_count": rating.get("count", 0),
            "lowest_price": data.get("lowest_price"),
            "num_for_sale": data.get("num_for_sale"),
            "cached_at": datetime.now().isoformat(timespec="seconds"),
        }
        cache[release_id] = summary
        self._save_releases_cache()
        return summary

    def fetch_wantlist_ids(self) -> list[str]:
        """Fetches all release IDs currently on the user's Discogs Wantlist via GET /users/{username}/wants."""
        ids: list[str] = []
        page = 1
        while True:
            data = self._get(f"/users/{self.username}/wants", params={"page": page, "per_page": 100})
            if not isinstance(data, dict):
                break
            wants = data.get("wants") or []
            for w in wants:
                if isinstance(w, dict) and w.get("id"):
                    ids.append(str(w["id"]))
            pagination = data.get("pagination") or {}
            if page >= int(pagination.get("pages", 1)):
                break
            page += 1
        return ids

    def remove_from_wantlist(self, release_id: str) -> bool:
        """Removes a release from the user's Discogs Wantlist via DELETE /users/{username}/wants/{release_id}."""
        if not self.is_authenticated:
            return False
        try:
            req = urllib.request.Request(
                f"{DISCOGS_API_BASE}/users/{self.username}/wants/{release_id}",
                headers=self.headers,
                method="DELETE",
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                return resp.status in (204, 200)
        except urllib.error.HTTPError as he:
            return he.code == 404
        except Exception as e:
            logging.warning(f"Could not delete release {release_id} from wantlist: {e}")
            return False


# =====================================================================
# COLLECTION VAULT BRIDGE & RELEASE ENRICHMENT
# =====================================================================
def load_vault_lookup() -> tuple[dict[str, Any], dict[str, list[Any]], dict[str, str], dict[str, str]]:
    """Loads Alex's 159-LP Collection Vault cross-reference (and live sibling collection.json if present)."""
    owned_by_rid: dict[str, Any] = {}
    owned_by_album: dict[str, list[Any]] = {}
    cdn_by_rid: dict[str, str] = {}
    cdn_by_album: dict[str, str] = {}

    if VAULT_CROSSREF_FILE.exists():
        try:
            vc = json.loads(VAULT_CROSSREF_FILE.read_text(encoding="utf-8"))
            owned_by_rid.update(vc.get("owned_releases") or {})
            owned_by_album.update(vc.get("owned_albums") or {})
            cdn_by_rid.update(vc.get("cdn_covers_by_rid") or {})
            cdn_by_album.update(vc.get("cdn_covers_by_album") or {})
        except Exception:
            pass

    live_col_path = SIBLING_COLLECTION_DIR / "data" / "collection.json"
    if live_col_path.exists():
        try:
            col = json.loads(live_col_path.read_text(encoding="utf-8"))
            for r in col.get("records", []):
                rid = str(r["release_id"])
                imgs = r.get("images") or {}
                cover = imgs.get("cover_image_url") or imgs.get("remote_pressing_image_url") or ""
                entry = {
                    "release_id": rid,
                    "artist": r.get("artist", ""),
                    "title": r.get("title", ""),
                    "format_string": r.get("format_string", ""),
                    "estimated_value_usd": r.get("estimated_value_usd", 0),
                    "date_added": r.get("date_added", ""),
                    "media_condition": r.get("media_condition", "NM"),
                    "cover_image_url": cover,
                }
                owned_by_rid[rid] = entry
                if cover:
                    cdn_by_rid.setdefault(rid, cover)
                a_norm = re.sub(r"\s*\(\d+\)", "", r.get("artist", "").lower().strip())
                t_norm = re.sub(r"\s*\(\d+\)", "", r.get("title", "").lower().strip())
                ak = f"{a_norm} - {t_norm}"
                owned_by_album.setdefault(ak, [entry])
                if cover:
                    cdn_by_album.setdefault(ak, cover)
        except Exception:
            pass

    return owned_by_rid, owned_by_album, cdn_by_rid, cdn_by_album


def parse_usd_float(val: Any) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    m = re.search(r"([\d,]+\.\d{2}|\d+)", str(val))
    return float(m.group(1).replace(",", "")) if m else 0.0


def fetch_release_stats_in_browser(context, release_url: str) -> dict[str, str]:
    """Legacy fallback: opens release_url in a temporary tab only if the Discogs API is unreachable."""
    stats = {"low": "N/A", "median": "N/A", "high": "N/A"}
    if not release_url or context is None:
        return stats
    stats_page = context.new_page()
    try:
        stats_page.goto(release_url, wait_until="domcontentloaded", timeout=15000)
        text = stats_page.locator("body").inner_text()
        low_m = re.search(r"Low[:\s]+(\$[\d,]+\.\d{2})", text)
        med_m = re.search(r"Median[:\s]+(\$[\d,]+\.\d{2})", text)
        high_m = re.search(r"High[:\s]+(\$[\d,]+\.\d{2})", text)
        if low_m:
            stats["low"] = low_m.group(1)
        if med_m:
            stats["median"] = med_m.group(1)
        if high_m:
            stats["high"] = high_m.group(1)
    except Exception as e:
        logging.warning(f"Could not fetch release stats in browser: {e}")
    finally:
        stats_page.close()
    return stats


def enrich_item_with_api_and_vault(
    api_client: DiscogsAPIClient,
    context,
    item: dict[str, Any],
    vault_data: tuple[dict[str, Any], dict[str, list[Any]], dict[str, str], dict[str, str]],
) -> dict[str, Any]:
    """
    Enriches a hit using the official Discogs REST API v2.0 (Price Suggestions, Marketplace Stats,
    Listing Details, Release Metadata) + Collection Vault ownership status, without opening a browser tab
    whenever the API responds.
    """
    owned_by_rid, owned_by_album, cdn_by_rid, cdn_by_album = vault_data
    rel_url = item.get("release_url", "")
    m_rel = re.search(r"/release/(\d+)", rel_url)
    release_id = m_rel.group(1) if m_rel else ""
    listing_id = str(item.get("id", ""))
    norm_title = re.sub(r"\s*\(\d+\)", "", item.get("title", "").lower().strip())

    stats: dict[str, Any] = {
        "low": "N/A",
        "median": "N/A",
        "high": "N/A",
        "condition_suggested_price": "N/A",
        "condition_suggested_usd": 0.0,
        "condition_matched_grade": DiscogsAPIClient.CONDITION_KEY_MAP.get(
            (item.get("media_condition") or "NM").upper().strip(), "Near Mint (NM or M-)"
        ),
        "num_for_sale": None,
        "lowest_for_sale": "N/A",
        "allow_offers": bool(item.get("allow_offers", False)),
        "seller_rating": item.get("seller_rating", ""),
        "seller_total_ratings": item.get("seller_total_ratings"),
        "community_have": None,
        "community_want": None,
        "cover_image": item.get("cover_image") or cdn_by_rid.get(release_id) or cdn_by_album.get(norm_title) or "",
        "vault_status": "MISSING_GRAIL",
        "vault_badge": "🎯 MISSING GRAIL (Not in Collection Vault)",
        "deal_verdict": "",
        "api_enriched": False,
    }

    # 1. Check Collection Vault Ownership
    if release_id and release_id in owned_by_rid:
        owned = owned_by_rid[release_id]
        stats["vault_status"] = "ALREADY_OWNED"
        stats["vault_badge"] = f"✅ ALREADY IN VAULT ({owned.get('format_string', 'Exact Pressing Owned')})"
        if owned.get("estimated_value_usd"):
            stats["median"] = f"${float(owned['estimated_value_usd']):.2f}"
    elif norm_title in owned_by_album:
        owned = owned_by_album[norm_title][0]
        stats["vault_status"] = "VARIANT_UPGRADE"
        stats["vault_badge"] = f"🌈 VARIANT HUNTER (You own: {owned.get('format_string', 'Another Pressing')})"
        if owned.get("estimated_value_usd"):
            stats["median"] = f"${float(owned['estimated_value_usd']):.2f}"

    # 2. Query Official Discogs REST API v2.0
    if release_id:
        mkt_stats = api_client.get_marketplace_stats(release_id)
        if mkt_stats:
            stats["api_enriched"] = True
            stats["num_for_sale"] = mkt_stats.get("num_for_sale")
            if mkt_stats.get("lowest_price_usd") is not None:
                stats["lowest_for_sale"] = f"${mkt_stats['lowest_price_usd']:.2f}"
                if stats["low"] == "N/A":
                    stats["low"] = stats["lowest_for_sale"]

        suggestions = api_client.get_price_suggestions(release_id)
        if suggestions:
            stats["api_enriched"] = True
            target_grade = stats["condition_matched_grade"]
            sugg_val = suggestions.get(target_grade) or suggestions.get("Near Mint (NM or M-)")
            if sugg_val:
                stats["condition_suggested_usd"] = sugg_val
                stats["condition_suggested_price"] = f"${sugg_val:.2f}"
            vals = sorted(v for v in suggestions.values() if v > 0)
            if vals:
                stats["low"] = f"${vals[0]:.2f}"
                stats["high"] = f"${vals[-1]:.2f}"
                if stats["median"] == "N/A":
                    med_v = suggestions.get("Very Good Plus (VG+)") or suggestions.get("Near Mint (NM or M-)") or vals[len(vals) // 2]
                    stats["median"] = f"${med_v:.2f}"

        rel_meta = api_client.get_release_metadata(release_id)
        if rel_meta:
            stats["api_enriched"] = True
            if not stats["cover_image"] and rel_meta.get("cover_image"):
                stats["cover_image"] = rel_meta["cover_image"]
            stats["community_have"] = rel_meta.get("community_have")
            stats["community_want"] = rel_meta.get("community_want")

    if listing_id:
        listing_detail = api_client.get_listing_details(listing_id)
        if listing_detail:
            stats["api_enriched"] = True
            stats["allow_offers"] = listing_detail.get("allow_offers", stats["allow_offers"])
            if listing_detail.get("seller_rating"):
                stats["seller_rating"] = listing_detail["seller_rating"]
            if listing_detail.get("seller_total_ratings"):
                stats["seller_total_ratings"] = listing_detail["seller_total_ratings"]
            if not stats["cover_image"] and listing_detail.get("cover_image"):
                stats["cover_image"] = listing_detail["cover_image"]
            if listing_detail.get("in_wantlist") is not None:
                stats["community_want"] = listing_detail["in_wantlist"]
            if listing_detail.get("in_collection") is not None:
                stats["community_have"] = listing_detail["in_collection"]

    # 3. Fallback to in-browser release tab ONLY if API didn't yield Low/Median/High
    if stats["median"] == "N/A" and context is not None and rel_url:
        browser_stats = fetch_release_stats_in_browser(context, rel_url)
        for k in ("low", "median", "high"):
            if stats[k] == "N/A" and browser_stats.get(k) != "N/A":
                stats[k] = browser_stats[k]

    # 4. Compute Deal Verdict vs Condition Suggested / Median
    total_usd = parse_usd_float(item.get("total_price"))
    benchmark_usd = stats["condition_suggested_usd"] or parse_usd_float(stats["median"])
    if total_usd > 0 and benchmark_usd > 0:
        delta_pct = ((total_usd - benchmark_usd) / benchmark_usd) * 100.0
        if delta_pct <= -15:
            stats["deal_verdict"] = f"🔥 GRAIL STEAL ({delta_pct:+.0f}% vs {item.get('media_condition', 'NM')} value)"
        elif delta_pct <= -2:
            stats["deal_verdict"] = f"💎 BELOW MARKET ({delta_pct:+.0f}% vs {item.get('media_condition', 'NM')} value)"
        elif delta_pct <= 12:
            stats["deal_verdict"] = f"✅ FAIR MARKET ({delta_pct:+.0f}%)"
        else:
            stats["deal_verdict"] = f"⚠️ PREMIUM ({delta_pct:+.0f}% above benchmark)"

    item["api_stats"] = {
        "low": stats["low"],
        "median": stats["median"],
        "high": stats["high"],
        "condition_suggested_price": stats["condition_suggested_price"],
        "num_for_sale": stats["num_for_sale"],
        "lowest_for_sale": stats["lowest_for_sale"],
        "allow_offers": stats["allow_offers"],
        "seller_rating": stats["seller_rating"],
        "community_have": stats["community_have"],
        "community_want": stats["community_want"],
        "cover_image": stats["cover_image"],
        "vault_status": stats["vault_status"],
        "deal_verdict": stats["deal_verdict"],
    }
    return stats


# =====================================================================
# UNIFIED SEED_LISTINGS & RELIST LEDGER PERSISTENCE
# =====================================================================
def cleanup_legacy_files():
    if LEGACY_SEEN_FILE.exists():
        try:
            LEGACY_SEEN_FILE.unlink()
            logging.info(f"Removed legacy {LEGACY_SEEN_FILE.name}; using {SEED_FILE.name} exclusively.")
        except Exception as e:
            logging.warning(f"Could not remove legacy {LEGACY_SEEN_FILE.name}: {e}")


def load_seed_snapshot() -> tuple[dict[str, Any], dict[str, Any]]:
    """Loads (previous_listings, relist_ledger) from seed_snapshot.json."""
    if not SEED_FILE.exists() or SEED_FILE.stat().st_size == 0:
        return {}, {}
    try:
        data = json.loads(SEED_FILE.read_text(encoding="utf-8").strip())
        if isinstance(data, dict) and "items" in data and isinstance(data["items"], dict):
            items = data["items"]
            ledger = data.get("relist_ledger") or build_relist_ledger(items)
            return items, ledger
        if isinstance(data, dict):
            return data, build_relist_ledger(data)
    except Exception as e:
        logging.warning(f"Could not parse {SEED_FILE.name}: {e}")
    return {}, {}


def load_seed_listings() -> dict[str, Any]:
    items, _ = load_seed_snapshot()
    return items


def build_relist_ledger(items: dict[str, Any], existing_ledger: dict[str, Any] | None = None) -> dict[str, Any]:
    """Maintains a rolling ledger of (release_id::seller::media_condition) -> price & alert history."""
    ledger: dict[str, Any] = dict(existing_ledger or {})
    for item_id, item in reversed(list(items.items())):
        rel_url = item.get("release_url", "")
        m = re.search(r"/release/(\d+)", rel_url)
        rid = m.group(1) if m else "unknown"
        seller = (item.get("seller_info") or "US Seller").strip().lower()
        cond = (item.get("media_condition") or "NM").strip().upper()
        fp = f"{rid}::{seller}::{cond}"
        price_usd = parse_usd_float(item.get("total_price")) or parse_usd_float(item.get("list_price"))
        ts = item.get("seeded_at") or datetime.now().isoformat(timespec="seconds")

        if fp not in ledger:
            ledger[fp] = {
                "release_id": rid,
                "title": item.get("title", ""),
                "seller": item.get("seller_info", ""),
                "media_condition": cond,
                "last_price_usd": price_usd,
                "lowest_price_usd": price_usd,
                "highest_price_usd": price_usd,
                "last_seen_at": ts,
                "total_relists_seen": 1,
                "last_listing_id": str(item_id),
            }
        else:
            entry = ledger[fp]
            entry["last_price_usd"] = price_usd
            if price_usd > 0:
                entry["lowest_price_usd"] = min(entry.get("lowest_price_usd", price_usd), price_usd)
                entry["highest_price_usd"] = max(entry.get("highest_price_usd", price_usd), price_usd)
            entry["last_seen_at"] = ts
            if str(item_id) != entry.get("last_listing_id"):
                entry["total_relists_seen"] = int(entry.get("total_relists_seen", 1)) + 1
                entry["last_listing_id"] = str(item_id)
    return ledger


def save_seed_listings(
    current_listings: dict[str, Any],
    previous_listings: dict[str, Any] | None = None,
    relist_ledger: dict[str, Any] | None = None,
):
    """
    Writes the current run's listings first (in exact 0..N top-to-bottom order),
    followed by historical listings from previous runs capped at MAX_HISTORY = 2000,
    plus the v2.0 relist_ledger for semantic auto-relist deduplication.
    """
    merged: dict[str, Any] = {}
    for item_id, item_data in current_listings.items():
        merged[item_id] = item_data

    if previous_listings:
        for item_id, item_data in previous_listings.items():
            if item_id not in merged:
                merged[item_id] = item_data

    keys = list(merged.keys())[:MAX_HISTORY]
    trimmed = {k: merged[k] for k in keys}
    updated_ledger = build_relist_ledger(trimmed, relist_ledger)

    payload = {
        "schema_version": SNIPER_VERSION,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "live_page_count": len(current_listings),
        "total_tracked": len(trimmed),
        "relist_fingerprints_tracked": len(updated_ledger),
        "items": trimmed,
        "relist_ledger": updated_ledger,
    }
    SEED_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


# =====================================================================
# SMART RELIST & MULTI-COPY DEDUPLICATION ENGINE ("RECORDMULE SLAYER")
# =====================================================================
def evaluate_and_filter_hits(
    diff_hits: list[dict[str, Any]],
    relist_ledger: dict[str, Any],
    config: dict[str, Any],
    vault_owned_by_rid: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Filters and groups raw diff_hits:
      1. Collapses same-batch multi-copy drops from the same seller into 1 grouped alert.
      2. Suppresses auto-relist spam from the same seller/release/condition within cooldown_days
         UNLESS the total shipped price dropped by >= price_drop_override_usd or price_drop_override_pct.
      3. Enforces muted_sellers, price_drop_only_sellers (e.g. 'recordmule'), and max_total_price_usd.
    Returns (actionable_hits, suppressed_hits).
    """
    dedup_cfg = config.get("relist_deduplication") or {}
    filters_cfg = config.get("filters") or {}
    vault_cfg = config.get("collection_vault_bridge") or {}

    dedup_enabled = bool(dedup_cfg.get("enabled", True))
    cooldown_days = int(dedup_cfg.get("cooldown_days", 7))
    consolidate_batches = bool(dedup_cfg.get("consolidate_multi_copy_batches", True))
    drop_usd_thresh = float(dedup_cfg.get("price_drop_override_usd", 1.0))
    drop_pct_thresh = float(dedup_cfg.get("price_drop_override_pct", 3.0))

    muted_sellers = {s.lower().strip() for s in (filters_cfg.get("muted_sellers") or [])}
    price_drop_only_sellers = {s.lower().strip() for s in (filters_cfg.get("price_drop_only_sellers") or [])}
    max_price = filters_cfg.get("max_total_price_usd")
    suppress_owned = bool(vault_cfg.get("suppress_exact_owned_alerts", False))

    # Step 1: Group multi-copy hits within the same run (oldest to newest)
    batch_groups: dict[str, dict[str, Any]] = {}
    ordered_hits: list[dict[str, Any]] = []

    for item in reversed(diff_hits):
        rel_url = item.get("release_url", "")
        m = re.search(r"/release/(\d+)", rel_url)
        rid = m.group(1) if m else "unknown"
        seller_low = (item.get("seller_info") or "US Seller").strip().lower()
        cond = (item.get("media_condition") or "NM").strip().upper()
        total_usd = parse_usd_float(item.get("total_price")) or parse_usd_float(item.get("list_price"))
        fp = f"{rid}::{seller_low}::{cond}"
        batch_key = f"{fp}::{total_usd:.2f}"

        item_copy = dict(item)
        item_copy["release_id"] = rid
        item_copy["fingerprint"] = fp
        item_copy["total_price_usd"] = total_usd
        item_copy["batch_copy_count"] = 1
        item_copy["batch_listing_ids"] = [str(item["id"])]

        if consolidate_batches and batch_key in batch_groups:
            existing = batch_groups[batch_key]
            existing["batch_copy_count"] += 1
            existing["batch_listing_ids"].append(str(item["id"]))
        else:
            batch_groups[batch_key] = item_copy
            ordered_hits.append(item_copy)

    # Step 2: Evaluate each grouped hit against relist ledger, seller rules, and Vault rules
    actionable: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []
    now_dt = datetime.now()

    for hit in ordered_hits:
        rid = hit["release_id"]
        seller_low = (hit.get("seller_info") or "").strip().lower()
        fp = hit["fingerprint"]
        total_usd = hit["total_price_usd"]

        if seller_low in muted_sellers:
            hit["suppression_reason"] = f"Seller '{hit.get('seller_info')}' is in muted_sellers"
            suppressed.append(hit)
            continue

        if max_price is not None and total_usd > float(max_price):
            hit["suppression_reason"] = f"Total price ${total_usd:.2f} exceeds max_total_price_usd (${float(max_price):.2f})"
            suppressed.append(hit)
            continue

        if suppress_owned and rid in vault_owned_by_rid:
            hit["suppression_reason"] = f"Release {rid} is already owned in Collection Vault (suppress_exact_owned_alerts=true)"
            suppressed.append(hit)
            continue

        prior = relist_ledger.get(fp)
        if dedup_enabled and prior:
            prior_low = float(prior.get("lowest_price_usd") or prior.get("last_price_usd") or total_usd)
            prior_last = float(prior.get("last_price_usd") or total_usd)
            price_drop_usd = round(prior_last - total_usd, 2)
            price_drop_pct = round((price_drop_usd / prior_last) * 100.0, 1) if prior_last > 0 else 0.0
            is_significant_drop = price_drop_usd >= drop_usd_thresh or price_drop_pct >= drop_pct_thresh

            within_cooldown = True
            last_seen_str = prior.get("last_seen_at", "")
            if last_seen_str:
                try:
                    last_dt = datetime.fromisoformat(last_seen_str)
                    within_cooldown = (now_dt - last_dt) <= timedelta(days=cooldown_days)
                except Exception:
                    within_cooldown = True

            if is_significant_drop:
                hit["is_price_drop_hit"] = True
                hit["previous_price_usd"] = prior_last
                hit["price_drop_usd"] = price_drop_usd
                hit["price_drop_pct"] = price_drop_pct
                actionable.append(hit)
                continue

            if within_cooldown or seller_low in price_drop_only_sellers:
                hit["suppression_reason"] = (
                    f"Auto-relist by {hit.get('seller_info')} at ${total_usd:.2f} "
                    f"(previously seen {prior.get('total_relists_seen', 1)}x at ${prior_last:.2f}, no price drop)"
                )
                suppressed.append(hit)
                continue

        actionable.append(hit)

    return actionable, suppressed


# =====================================================================
# IN-BROWSER EXTRACTOR (SCOPED TO DESKTOP VIRTUAL LIST & DATA-INDEX)
# =====================================================================
EXTRACT_VISIBLE_DESKTOP_ROWS_JS = r"""
() => {
    const desktopRoot = document.querySelector('div[data-test="desktop-layout"]') || document;
    const indexNodes = Array.from(desktopRoot.querySelectorAll('div[data-index]'));

    const rows = [];
    for (const indexNode of indexNodes) {
        const dataIndex = parseInt(indexNode.getAttribute('data-index'), 10);
        if (Number.isNaN(dataIndex)) continue;

        const row = indexNode.querySelector('div[data-test="list-item-desktop"]') || indexNode;

        // 1. Extract exact 10-digit Listing ID from /shop/item/<id>, /sell/item/<id>, or /sell/cart/?add=<id>
        let itemId = '';
        const itemLink = row.querySelector('a[href*="/shop/item/"], a[href*="/sell/item/"]');
        if (itemLink) {
            const m = itemLink.href.match(/\/(?:shop|sell)\/item\/(\d+)/);
            if (m) itemId = m[1];
        }
        if (!itemId) {
            const cartLink = row.querySelector('a[href*="/sell/cart"]');
            if (cartLink) {
                const m = cartLink.href.match(/[?&]add=(\d+)/);
                if (m) itemId = m[1];
            }
        }
        if (!itemId) continue;

        // 2. Title, Artist, and Variant
        let title = 'Unknown Title';
        const titleEl = row.querySelector('a.text-brand-textLink[href*="/item/"]') || itemLink;
        if (titleEl && titleEl.textContent.trim()) {
            title = titleEl.textContent.trim();
        }

        let artist = '';
        const artistEl = row.querySelector('a[href*="/artist/"]');
        if (artistEl && artistEl.textContent.trim()) {
            artist = artistEl.textContent.trim();
        }

        const fullTitle = (artist && !title.toLowerCase().includes(artist.toLowerCase()))
            ? `${artist} - ${title}`
            : title;

        let variant = 'LP, Vinyl';
        const copyParas = Array.from(row.querySelectorAll('p.brand-item-copy.truncate, p.brand-item-copy'));
        for (const p of copyParas) {
            const t = p.textContent.trim();
            if (t && !p.querySelector('a') && !t.startsWith('Ships from') && !t.startsWith('Condition') && !t.startsWith('*')) {
                variant = t;
                break;
            }
        }

        // 3. Prices (List price + Total shipped price)
        const text = (row.innerText || row.textContent || '').trim();
        const priceMatches = (text.match(/\$\s*[\d,]+\.\d{2}/g) || [])
            .map(p => p.replace(/\s+/g, ''));

        let listPrice = '';
        const boldPriceEl = row.querySelector('span.font-bold');
        if (boldPriceEl && boldPriceEl.textContent.includes('$')) {
            listPrice = boldPriceEl.textContent.trim();
        } else if (priceMatches.length > 0) {
            listPrice = priceMatches[0];
        }

        let totalPrice = listPrice;
        const priceContainer = boldPriceEl ? boldPriceEl.parentElement : null;
        if (priceContainer) {
            const containerPrices = (priceContainer.textContent.match(/\$\s*[\d,]+\.\d{2}/g) || [])
                .map(p => p.replace(/\s+/g, ''));
            if (containerPrices.length > 0) {
                listPrice = containerPrices[0];
                totalPrice = containerPrices[containerPrices.length - 1];
            }
        }
        if (!listPrice) continue;

        // 4. Media & Sleeve Condition
        const condBadges = Array.from(row.querySelectorAll('span[class*="bg-condition-"] p'));
        const mediaCond = condBadges[0] ? condBadges[0].textContent.trim() : 'See Listing';
        const sleeveCond = condBadges[1] ? condBadges[1].textContent.trim() : 'See Listing';

        // 5. Seller, Rating, Make Offer & Listed Age
        let seller = 'US Seller';
        const sellerEl = row.querySelector('a[href*="/seller/"]');
        if (sellerEl && sellerEl.textContent.trim()) {
            seller = sellerEl.textContent.trim();
        }

        let listedAge = '';
        const ageBtn = row.querySelector('button[data-slot="tooltip-trigger"]');
        if (ageBtn && ageBtn.textContent.trim()) {
            listedAge = ageBtn.textContent.trim();
        }

        const allowOffers = Array.from(row.querySelectorAll('button')).some(
            b => (b.textContent || '').toLowerCase().includes('make offer')
        );

        // 6. Release URL, Cover Thumbnail & Seller Comment
        let releaseUrl = '';
        const relEl = row.querySelector('a[href*="/release/"]');
        if (relEl) {
            releaseUrl = relEl.href.split('?')[0];
        }

        let coverImage = '';
        const imgEl = row.querySelector('img[src*="i.discogs.com"]');
        if (imgEl && imgEl.src) {
            coverImage = imgEl.src;
        }

        let sellerComment = '';
        const commentEl = row.querySelector('div.text-brand-textSecondary.brand-item-copy div.break-words:not([aria-hidden="true"])');
        if (commentEl && commentEl.textContent.trim()) {
            sellerComment = commentEl.textContent.trim();
        }

        rows.push({
            data_index: dataIndex,
            id: itemId,
            title: fullTitle,
            variant: variant,
            media_condition: mediaCond,
            sleeve_condition: sleeveCond,
            list_price: listPrice,
            total_price: totalPrice,
            seller_info: seller,
            listed_age: listedAge,
            allow_offers: allowOffers,
            cover_image: coverImage,
            item_url: `https://www.discogs.com/sell/item/${itemId}`,
            shop_item_url: `https://www.discogs.com/shop/item/${itemId}`,
            add_to_cart_url: `https://www.discogs.com/sell/cart/?add=${itemId}`,
            release_url: releaseUrl,
            raw_description: sellerComment || variant
        });
    }
    return rows;
}
"""


def parse_graphql_marketplace_edges(gql_payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extracts structured listing metadata from intercepted in-origin Discogs /graphql MarketplaceSearch payloads."""
    out: dict[str, dict[str, Any]] = {}
    try:
        edges = ((gql_payload.get("data") or {}).get("marketplaceSearch") or {}).get("edges") or []
        for idx, edge in enumerate(edges):
            node = (edge or {}).get("node") or {}
            item_id = str(node.get("id") or "")
            if not item_id:
                continue
            rel = node.get("release") or {}
            rid = rel.get("discogsId")
            img_edges = ((rel.get("images") or {}).get("edges")) or []
            thumb = ""
            if img_edges and isinstance(img_edges[0], dict):
                thumb = (((img_edges[0].get("node") or {}).get("thumbnail") or {}).get("webpUrl")) or ""
            seller_info = node.get("sellerInfo") or {}
            out[item_id] = {
                "graphql_index": idx,
                "allow_offers": bool(node.get("offerOk", False)),
                "listed_date_iso": node.get("listedDate", ""),
                "seller_rating": f"{float(seller_info['rating']):.1f}%" if seller_info.get("rating") else "",
                "seller_total_ratings": seller_info.get("ratingCount"),
                "release_id": str(rid) if rid else "",
                "cover_image": thumb,
            }
    except Exception:
        pass
    return out


def ensure_sorted_newest(page):
    """Ensures the desktop Sort dropdown is set to 'listedNewest'."""
    try:
        sort_select = page.locator('div[data-test="desktop-layout"] select[aria-labelledby="desktop-set-sort"]').first
        if sort_select.count() > 0:
            current_val = sort_select.input_value(timeout=3000)
            if current_val != "listedNewest":
                logging.info(f"Sort dropdown was '{current_val}'; switching to 'listedNewest'...")
                sort_select.select_option("listedNewest")
                page.wait_for_timeout(2000)
    except Exception as e:
        logging.debug(f"Sort check skipped: {e}")


def extract_seed_listings(page, graphql_enrichment: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """
    Scrolls through the virtualized desktop list so all 25 rows mount,
    collects every row by its exact data-index (0..24), merges any captured
    in-origin /graphql telemetry, and returns an ordered dict keyed by item ID.
    """
    collected_by_index: dict[int, dict[str, Any]] = {}
    gql_map = graphql_enrichment or {}

    scroll_positions = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200]
    for pos in scroll_positions:
        page.evaluate(f"window.scrollTo(0, {pos});")
        page.wait_for_timeout(250)
        batch = page.evaluate(EXTRACT_VISIBLE_DESKTOP_ROWS_JS)
        for item in batch:
            idx = item["data_index"]
            if idx not in collected_by_index:
                collected_by_index[idx] = item

    page.evaluate("window.scrollTo(0, 0);")
    ordered_rows = [collected_by_index[k] for k in sorted(collected_by_index.keys())]

    now_iso = datetime.now().isoformat(timespec="seconds")
    seed_listings: dict[str, Any] = {}
    for row in ordered_rows:
        item_id = row["id"]
        if item_id not in seed_listings:
            gql = gql_map.get(item_id) or {}
            rel_url = row["release_url"]
            if not rel_url and gql.get("release_id"):
                rel_url = f"https://www.discogs.com/release/{gql['release_id']}"

            entry: dict[str, Any] = {
                "rank": row["data_index"] + 1,
                "id": item_id,
                "title": row["title"],
                "variant": row["variant"],
                "media_condition": row["media_condition"],
                "sleeve_condition": row["sleeve_condition"],
                "list_price": row["list_price"],
                "total_price": row["total_price"],
                "seller_info": row["seller_info"],
                "listed_age": row["listed_age"],
                "item_url": row["item_url"],
                "add_to_cart_url": row["add_to_cart_url"],
                "release_url": rel_url,
                "raw_description": row["raw_description"],
                "seeded_at": now_iso,
            }
            if row.get("cover_image") or gql.get("cover_image"):
                entry["cover_image"] = row.get("cover_image") or gql.get("cover_image")
            if row.get("allow_offers") or gql.get("allow_offers"):
                entry["allow_offers"] = True
            if gql.get("seller_rating"):
                entry["seller_rating"] = gql["seller_rating"]
            seed_listings[item_id] = entry

    return seed_listings


# =====================================================================
# ALERTS (UPGRADED v2.0 GMAIL HTML + CC MARISA + OPTIONAL NTFY PUSH)
# =====================================================================
def send_alerts(item: dict[str, Any], stats: dict[str, Any], creds: dict[str, str]):
    is_price_drop = bool(item.get("is_price_drop_hit", False))
    batch_copies = int(item.get("batch_copy_count", 1))
    prefix = "PRICE DROP HIT *" if is_price_drop else "NEW HIT *"
    copy_tag = f" [{batch_copies}x Copies]" if batch_copies > 1 else ""
    subject = f"{prefix} {item['title']} ({item['total_price']}){copy_tag}"

    ntfy_topic = creds.get("ntfy_topic", "")
    ntfy_base = creds.get("ntfy_base", "https://ntfy.sh")
    if ntfy_topic:
        try:
            sugg_str = stats.get("condition_suggested_price", "N/A")
            body_bytes = (
                f"{stats.get('vault_badge', '')}\n"
                f"{item['variant']} | Media: {item['media_condition']} / Sleeve: {item['sleeve_condition']}\n"
                f"Total: {item['total_price']} (Suggested {item['media_condition']}: {sugg_str} | Median: {stats['median']})"
            ).encode("utf-8")
            req = urllib.request.Request(
                f"{ntfy_base}/{ntfy_topic}",
                data=body_bytes,
                headers={
                    "Title": subject,
                    "Priority": "urgent",
                    "Tags": "cd,rotating_light",
                    "Click": item["item_url"],
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5).close()
        except Exception as e:
            logging.warning(f"ntfy push failed: {e}")

    email_to = creds["email_to"]
    email_cc = creds["email_cc"]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = email_to
    msg["To"] = email_to
    msg["Cc"] = email_cc
    msg["X-Priority"] = "1"
    msg["X-MSMail-Priority"] = "High"
    msg["Importance"] = "High"
    msg["Priority"] = "urgent"

    cover_html = ""
    if stats.get("cover_image"):
        cover_html = (
            f'<img src="{stats["cover_image"]}" alt="Cover" '
            f'style="width: 88px; height: 88px; object-fit: cover; border-radius: 6px; '
            f'border: 1px solid #ddd; float: right; margin-left: 14px;" />'
        )

    price_drop_banner = ""
    if is_price_drop:
        prev_usd = item.get("previous_price_usd", 0.0)
        drop_usd = item.get("price_drop_usd", 0.0)
        drop_pct = item.get("price_drop_pct", 0.0)
        price_drop_banner = (
            f'<div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 10px 14px; '
            f'margin-bottom: 14px; color: #065f46; font-weight: bold;">'
            f'PRICE DROP DETECTED: Seller lowered total shipped price from ${prev_usd:.2f} to {item["total_price"]} '
            f'(-${drop_usd:.2f} / -{drop_pct:.1f}%)'
            f"</div>"
        )

    deal_verdict_row = ""
    if stats.get("deal_verdict"):
        deal_verdict_row = f"""
            <tr style="background-color: #fffbeb;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Sniper v2.0 Deal Verdict</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>{stats['deal_verdict']}</strong> &nbsp;|&nbsp; {stats.get('vault_badge', '')}</td>
            </tr>
        """

    sugg_label = stats.get("condition_matched_grade", item["media_condition"])
    sugg_val = stats.get("condition_suggested_price", "N/A")
    scarcity_parts = []
    if stats.get("num_for_sale") is not None:
        scarcity_parts.append(f"{stats['num_for_sale']} currently for sale (Lowest: {stats.get('lowest_for_sale', 'N/A')})")
    if stats.get("community_want") is not None and stats.get("community_have") is not None:
        scarcity_parts.append(f"{stats['community_want']} Want / {stats['community_have']} Have")
    scarcity_str = " &nbsp;|&nbsp; ".join(scarcity_parts) if scarcity_parts else "Live Marketplace Drop"

    offer_tag = " &nbsp;|&nbsp; <strong>Make Offer Enabled</strong>" if stats.get("allow_offers") else ""
    rating_tag = f" ({stats['seller_rating']})" if stats.get("seller_rating") else ""
    batch_ids_str = ", ".join(f"#{x}" for x in (item.get("batch_listing_ids") or [item["id"]]))

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111; max-width: 620px;">
        {price_drop_banner}
        <div style="overflow: hidden;">
            {cover_html}
            <h2 style="margin-bottom: 5px; margin-top: 0;">{item['title']}</h2>
            <p style="margin-top: 0; color: #555;">
                <strong>Variant:</strong> {item['variant']} &nbsp;|&nbsp; <strong>Listing ID(s):</strong> {batch_ids_str}
            </p>
        </div>
        <div style="margin: 18px 0;">
            <a href="{item['item_url']}" style="background-color: #0066cc; color: white; padding: 12px 18px; text-decoration: none; font-weight: bold; border-radius: 5px; margin-right: 10px; display: inline-block;">
                VIEW LISTING (#{item['id']})
            </a>
            <a href="{item['add_to_cart_url']}" style="background-color: #28a745; color: white; padding: 12px 18px; text-decoration: none; font-weight: bold; border-radius: 5px; display: inline-block;">
                1-CLICK ADD TO CART ({item['total_price']})
            </a>
        </div>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px; margin-top: 15px;">
            {deal_verdict_row}
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>List / Total Shipped</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>{item['list_price']}</strong> ({item['total_price']} total){offer_tag}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Discogs API Suggested ({sugg_label})</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>{sugg_val}</strong> &nbsp;(Range: {stats['low']} / <strong>{stats['median']}</strong> / {stats['high']})</td>
            </tr>
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Condition</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">Media: <strong>{item['media_condition']}</strong> | Sleeve: <strong>{item['sleeve_condition']}</strong></td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Seller</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{item['seller_info']}{rating_tag} ({item.get('listed_age', '')})</td>
            </tr>
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Scarcity &amp; Demand</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{scarcity_str}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Direct Listing URL</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><a href="{item['item_url']}">{item['item_url']}</a></td>
            </tr>
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Release Page</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><a href="{item['release_url']}">{item['release_url']}</a></td>
            </tr>
        </table>
        <p style="font-size: 12px; color: #666; margin-top: 15px;">Seller Notes: {item['raw_description']}</p>
    </body>
    </html>
    """

    msg.attach(MIMEText(html_body, "html", "utf-8"))

    recipients = [r for r in (email_to, email_cc) if r]
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(email_to, creds["gmail_app_password"].replace(" ", ""))
        server.sendmail(email_to, recipients, msg.as_string())

    logging.info(f"ALERT SENT -> {subject} | CC: {email_cc} | Listing URL: {item['item_url']}")


def trigger_dashboard_rebuild():
    """Recompiles data/sniper_state.json and index.html after new hits."""
    try:
        build_script = BASE_DIR / "scripts" / "build_dashboard.py"
        if build_script.exists():
            import subprocess

            subprocess.run([sys.executable, str(build_script)], cwd=str(BASE_DIR), timeout=20, check=False)
    except Exception as e:
        logging.debug(f"Static dashboard rebuild skipped: {e}")


# =====================================================================
# SNAPSHOT & SELF-DIFF CHECK CYCLE
# =====================================================================
def run_check_on_page(
    context,
    page,
    api_client: DiscogsAPIClient,
    config: dict[str, Any],
    creds: dict[str, str],
    test_latest: bool = False,
    force_reseed: bool = False,
):
    try:
        cdp = context.new_cdp_session(page)
        cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        cdp.send("Page.setWebLifecycleState", {"state": "active"})
    except Exception:
        pass

    wantlist_url = config.get("wantlist_url") or DEFAULT_WANTLIST_URL
    captured_graphql: dict[str, dict[str, Any]] = {}

    def on_response(response):
        try:
            if "/graphql" in response.url and response.status == 200:
                payload = response.json()
                captured_graphql.update(parse_graphql_marketplace_edges(payload))
        except Exception:
            pass

    page.on("response", on_response)

    logging.info("Loading Discogs Wantlist in Chrome...")
    page.goto(wantlist_url, wait_until="domcontentloaded", timeout=35000)

    try:
        page.wait_for_function(
            """() => {
                const root = document.querySelector('div[data-test="desktop-layout"]');
                return root && root.querySelectorAll('div[data-index] a[href*="/item/"]').length > 0;
            }""",
            timeout=20000,
        )
        page.wait_for_timeout(800)
    except Exception:
        logging.warning("Timed out waiting for desktop [data-index] rows; attempting extraction anyway...")

    ensure_sorted_newest(page)

    # 1. Build current seed_listings dict in exact 0..24 order (with self-healing retry if 0 rows mounted)
    current_listings = extract_seed_listings(page, graphql_enrichment=captured_graphql)
    if not current_listings:
        logging.warning("First extraction pass returned 0 rows; waiting 2.5s for virtual DOM hydration retry...")
        page.wait_for_timeout(2500)
        current_listings = extract_seed_listings(page, graphql_enrichment=captured_graphql)

    if not current_listings:
        logging.error(f"Extracted 0 listings. Page Title: '{page.title()}'")
        return

    ordered_items = list(current_listings.values())
    top3 = " | ".join(
        [f"#{x['rank']}: {x['title']} ({x['total_price']}) [ID:{x['id']}]" for x in ordered_items[:3]]
    )
    logging.info(
        f"Parsed {len(current_listings)} listings in exact order "
        f"(GraphQL nodes captured: {len(captured_graphql)}). Top 3 -> {top3}"
    )

    # 2. Load previous run's seed_listings dict & relist_ledger
    previous_listings, relist_ledger = load_seed_snapshot()
    vault_data = load_vault_lookup()
    owned_by_rid = vault_data[0]

    # 3. Initial Seed or Forced Reseed
    if force_reseed or not previous_listings:
        save_seed_listings(
            current_listings,
            previous_listings if not force_reseed else None,
            relist_ledger if not force_reseed else None,
        )
        logging.info(f"[SEED GENERATED] Wrote {len(current_listings)} ordered items to {SEED_FILE.name}.")

        if test_latest:
            top_item = ordered_items[0]
            logging.info(f"[TEST MODE] Sending test alert for #1 Top Item: {top_item['title']} [ID:{top_item['id']}]...")
            stats = enrich_item_with_api_and_vault(api_client, context, top_item, vault_data)
            send_alerts(top_item, stats, creds)
        if (config.get("alerts") or {}).get("auto_rebuild_static_dashboard", True):
            trigger_dashboard_rebuild()
        return

    # 4. Diff current_listings against previous_listings
    diff_hits = [
        item for item_id, item in current_listings.items()
        if item_id not in previous_listings
    ]

    if diff_hits:
        actionable_hits, suppressed_hits = evaluate_and_filter_hits(
            diff_hits, relist_ledger, config, owned_by_rid
        )
        for sup in suppressed_hits:
            logging.info(
                f"[RELIST SUPPRESSED] {sup['title']} ({sup['total_price']}) by {sup['seller_info']} "
                f"[ID:{sup['id']}] -> {sup.get('suppression_reason')}"
            )

        if actionable_hits:
            logging.info(
                f"[DELTA: {len(actionable_hits)} ACTIONABLE HIT(S) / {len(suppressed_hits)} SUPPRESSED] Sending alerts..."
            )
            for item in actionable_hits:
                stats = enrich_item_with_api_and_vault(api_client, context, item, vault_data)
                send_alerts(item, stats, creds)
        else:
            logging.info(
                f"[DELTA: {len(diff_hits)} RAW -> 0 ACTIONABLE ({len(suppressed_hits)} auto-relist/muted suppressed)]"
            )
    else:
        logging.info(
            f"[DELTA: 0 NEW] All {len(current_listings)} current items match {SEED_FILE.name} "
            f"({len(previous_listings)} tracked)."
        )
        if test_latest:
            top_item = ordered_items[0]
            logging.info(f"[TEST MODE] Sending test alert for #1 Top Item: {top_item['title']} [ID:{top_item['id']}]...")
            stats = enrich_item_with_api_and_vault(api_client, context, top_item, vault_data)
            send_alerts(top_item, stats, creds)

    # 5. Save current_listings + updated relist_ledger to seed_snapshot.json
    save_seed_listings(current_listings, previous_listings, relist_ledger)
    if diff_hits and (config.get("alerts") or {}).get("auto_rebuild_static_dashboard", True):
        trigger_dashboard_rebuild()


# =====================================================================
# CLI COMMANDS: --api-check & --prune-owned
# =====================================================================
def run_api_diagnostics(api_client: DiscogsAPIClient) -> int:
    print("=" * 72)
    print(f"  DISCOGS SNIPER v{SNIPER_VERSION} // OFFICIAL DISCOGS API & VAULT DIAGNOSTICS")
    print("=" * 72)
    owned_by_rid, owned_by_album, _, _ = load_vault_lookup()
    print(f"[*] Collection Vault Bridge : {len(owned_by_rid)} owned LPs ({len(owned_by_album)} distinct albums)")
    print(f"[*] Configured Username     : @{api_client.username}")
    token_status = (
        f"CONFIGURED ({len(api_client.token)} chars)"
        if api_client.is_authenticated
        else r"NOT FOUND (set DISCOGS_TOKEN in .env or HKCU\Environment)"
    )
    print(f"[*] Personal Access Token   : {token_status}")

    if api_client.is_authenticated:
        ident = api_client.get_identity()
        if ident:
            print(f"[ok] Authenticated via /oauth/identity as @{ident.get('username')} (ID: {ident.get('id')})")
            print(f"[ok] API Rate Limit Remaining: {api_client.ratelimit_remaining}/60 req/min")
        else:
            print("[warn] Could not reach api.discogs.com/oauth/identity (check network or token validity).")

    items, ledger = load_seed_snapshot()
    exact_overlaps = []
    for it in items.values():
        m = re.search(r"/release/(\d+)", it.get("release_url", ""))
        rid = m.group(1) if m else ""
        if rid in owned_by_rid and rid not in [x[0] for x in exact_overlaps]:
            exact_overlaps.append((rid, it.get("title", "")))

    print(f"[*] Snapshot Items Tracked  : {len(items)} listings ({len(ledger)} relist fingerprints)")
    print(f"[*] Exact Owned Pressings Still on Wantlist ({len(exact_overlaps)} releases):")
    for rid, ttl in exact_overlaps:
        print(f"    - Release #{rid:<10} : {ttl}")
    print("=" * 72)
    return 0


def run_prune_owned_wantlist(api_client: DiscogsAPIClient, dry_run: bool = False) -> int:
    owned_by_rid, _, _, _ = load_vault_lookup()
    items, _ = load_seed_snapshot()

    candidates: dict[str, str] = {}
    for it in items.values():
        m = re.search(r"/release/(\d+)", it.get("release_url", ""))
        rid = m.group(1) if m else ""
        if rid and rid in owned_by_rid:
            candidates[rid] = it.get("title", f"Release #{rid}")

    if api_client.is_authenticated:
        live_wants = api_client.fetch_wantlist_ids()
        for rid in live_wants:
            if rid in owned_by_rid and rid not in candidates:
                r_info = owned_by_rid[rid]
                candidates[rid] = f"{r_info.get('artist', '')} - {r_info.get('title', '')}"

    if not candidates:
        print("[ok] Zero exact-owned Collection Vault pressings found on your Wantlist.")
        return 0

    print(f"[*] Found {len(candidates)} exact-owned pressing(s) on your Discogs Wantlist:")
    for rid, ttl in sorted(candidates.items()):
        if dry_run or not api_client.is_authenticated:
            mode_lbl = "DRY-RUN" if dry_run else "NO-TOKEN PREVIEW"
            print(f"  [{mode_lbl}] Would DELETE /users/{api_client.username}/wants/{rid} -> {ttl}")
        else:
            ok = api_client.remove_from_wantlist(rid)
            status = "REMOVED" if ok else "FAILED"
            print(f"  [{status}] DELETE /users/{api_client.username}/wants/{rid} -> {ttl}")
            time.sleep(0.5)
    return 0


# =====================================================================
# MAIN ENTRYPOINT
# =====================================================================
def main():
    parser = argparse.ArgumentParser(description=f"Discogs Sniper v{SNIPER_VERSION}")
    parser.add_argument("--login", action="store_true", help="Open interactive browser to authenticate Discogs session")
    parser.add_argument("--reseed", action="store_true", help="Force baseline write to seed_snapshot.json")
    parser.add_argument("--test", action="store_true", help="Send a live test alert for the #1 top Wantlist item")
    parser.add_argument("--daemon", action="store_true", help="Run continuous in-process loop with 45-75s jitter")
    parser.add_argument("--api-check", action="store_true", help="Verify DISCOGS_TOKEN, rate limits, and Vault overlaps")
    parser.add_argument("--prune-owned", action="store_true", help="Remove exact-owned Vault pressings from Discogs Wantlist via API")
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without modifying Discogs Wantlist")
    parser.add_argument("--build-ui", action="store_true", help="Compile data/sniper_state.json and static index.html")
    parser.add_argument("--token", type=str, default=None, help="Explicit Discogs Personal Access Token override")
    parser.add_argument("--username", type=str, default=None, help="Explicit Discogs Username override")
    args = parser.parse_args()

    cleanup_legacy_files()
    config = load_sniper_config()
    creds = resolve_runtime_credentials(cli_token=args.token, cli_username=args.username, config=config)
    api_client = DiscogsAPIClient(token=creds["discogs_token"], username=creds["discogs_username"])

    if args.build_ui:
        trigger_dashboard_rebuild()
        return

    if args.api_check:
        sys.exit(run_api_diagnostics(api_client))

    if args.prune_owned:
        sys.exit(run_prune_owned_wantlist(api_client, dry_run=args.dry_run))

    with SingleInstanceLock(LOCK_FILE) as lock:
        if not lock.acquired:
            return

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(PROFILE_DIR),
                headless=False,
                viewport={"width": 1280, "height": 850},
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--window-position=-32000,-32000",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                ],
            )
            page = context.pages[0] if context.pages else context.new_page()

            if args.login:
                page.goto(config.get("wantlist_url") or DEFAULT_WANTLIST_URL)
                input("\n>>> Confirm your Wantlist is visible and sorted by 'Listed Newest', then press ENTER here...")
            elif args.daemon:
                logging.info("Starting continuous daemon loop (45-75s jitter)...")
                while True:
                    try:
                        run_check_on_page(context, page, api_client, config, creds)
                    except Exception as e:
                        logging.error(f"Check failed: {e}")
                    time.sleep(random.randint(45, 75))
            else:
                run_check_on_page(
                    context,
                    page,
                    api_client,
                    config,
                    creds,
                    test_latest=args.test,
                    force_reseed=args.reseed,
                )

            context.close()


if __name__ == "__main__":
    main()