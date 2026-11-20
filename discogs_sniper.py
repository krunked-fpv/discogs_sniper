print(">>> Discogs Sniper starting...", flush=True)

import argparse
import json
import logging
import os
import random
import re
import smtplib
import sys
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

# =====================================================================
# CONFIGURATION
# =====================================================================
DISCOGS_BASE = "https://www.discogs.com"
WANTLIST_URL = (
    DISCOGS_BASE
    + "/shop/mywants/?formatDescription=LP&formatName=Vinyl&shipsFrom=United+States&sort=listedNewest"
)

EMAIL_ADDRESS = "alexgoresch@gmail.com"
CC_EMAIL_ADDRESS = "mleven42@gmail.com"
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "ftisgicszgoyjhdb")

NTFY_BASE = "https://ntfy.sh"
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")

BASE_DIR = Path(__file__).parent.resolve()
SEED_FILE = BASE_DIR / "seed_snapshot.json"
LEGACY_SEEN_FILE = BASE_DIR / "seen_listings.json"
PROFILE_DIR = BASE_DIR / "chrome_discogs_profile"
LOG_FILE = BASE_DIR / "sniper.log"
MAX_HISTORY = 2000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)


# =====================================================================
# UNIFIED SEED_LISTINGS INPUT / OUTPUT STORAGE
# =====================================================================
def cleanup_legacy_files():
    if LEGACY_SEEN_FILE.exists():
        try:
            LEGACY_SEEN_FILE.unlink()
            logging.info(f"Removed legacy {LEGACY_SEEN_FILE.name}; using {SEED_FILE.name} exclusively.")
        except Exception as e:
            logging.warning(f"Could not remove legacy {LEGACY_SEEN_FILE.name}: {e}")


def load_seed_listings() -> dict:
    """Loads the previous run's seed_listings dictionary from seed_snapshot.json."""
    if not SEED_FILE.exists() or SEED_FILE.stat().st_size == 0:
        return {}
    try:
        data = json.loads(SEED_FILE.read_text(encoding="utf-8").strip())
        if isinstance(data, dict) and "items" in data and isinstance(data["items"], dict):
            return data["items"]
        if isinstance(data, dict):
            return data
    except Exception as e:
        logging.warning(f"Could not parse {SEED_FILE.name}: {e}")
    return {}


def save_seed_listings(current_listings: dict, previous_listings: dict = None):
    """
    Writes the current run's listings first (in exact 0..N top-to-bottom order),
    followed by historical listings from previous runs so items shifting onto Page 1
    after a sale do not trigger false alerts.
    """
    merged = {}
    for item_id, item_data in current_listings.items():
        merged[item_id] = item_data

    if previous_listings:
        for item_id, item_data in previous_listings.items():
            if item_id not in merged:
                merged[item_id] = item_data

    keys = list(merged.keys())[:MAX_HISTORY]
    trimmed = {k: merged[k] for k in keys}

    payload = {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "live_page_count": len(current_listings),
        "total_tracked": len(trimmed),
        "items": trimmed,
    }
    SEED_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


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
            .map(p => p.replace(/\s+/g, ''))
            .filter(p => p !== '$0.00' && p !== '$99.99' && p !== '$100.00' || true);

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

        // 5. Seller & Listed Age
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

        // 6. Release URL & Comment
        let releaseUrl = '';
        const relEl = row.querySelector('a[href*="/release/"]');
        if (relEl) {
            releaseUrl = relEl.href.split('?')[0];
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


def extract_seed_listings(page) -> dict:
    """
    Scrolls through the virtualized desktop list so all 25 rows mount,
    collects every row by its exact data-index (0..24), and returns an ordered
    dict keyed by item ID matching the seed_listings structure.
    """
    collected_by_index = {}

    # Scroll top-to-bottom in increments to harvest all virtualized rows
    scroll_positions = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200]
    for pos in scroll_positions:
        page.evaluate(f"window.scrollTo(0, {pos});")
        page.wait_for_timeout(250)
        batch = page.evaluate(EXTRACT_VISIBLE_DESKTOP_ROWS_JS)
        for item in batch:
            idx = item["data_index"]
            if idx not in collected_by_index:
                collected_by_index[idx] = item

    # Return to top of page
    page.evaluate("window.scrollTo(0, 0);")

    # Sort strictly by data_index (0 = #1 newest listing on page)
    ordered_rows = [collected_by_index[k] for k in sorted(collected_by_index.keys())]

    now_iso = datetime.now().isoformat(timespec="seconds")
    seed_listings = {}
    for row in ordered_rows:
        item_id = row["id"]
        if item_id not in seed_listings:
            seed_listings[item_id] = {
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
                "release_url": row["release_url"],
                "raw_description": row["raw_description"],
                "seeded_at": now_iso,
            }

    return seed_listings


def fetch_release_stats_in_browser(context, release_url: str) -> dict:
    stats = {"low": "N/A", "median": "N/A", "high": "N/A"}
    if not release_url:
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
        logging.warning(f"Could not fetch release stats: {e}")
    finally:
        stats_page.close()
    return stats


# =====================================================================
# ALERTS (GMAIL IMPORTANT + CC MARISA + OPTIONAL NTFY PUSH)
# =====================================================================
def send_alerts(item: dict, stats: dict):
    subject = f"NEW HIT * {item['title']} ({item['total_price']})"

    if NTFY_TOPIC:
        try:
            requests.post(
                f"{NTFY_BASE}/{NTFY_TOPIC}",
                data=(
                    f"{item['variant']} | Media: {item['media_condition']} / Sleeve: {item['sleeve_condition']}\n"
                    f"Total: {item['total_price']} (Median: {stats['median']})"
                ).encode("utf-8"),
                headers={
                    "Title": subject,
                    "Priority": "urgent",
                    "Tags": "cd,rotating_light",
                    "Click": item["item_url"],
                },
                timeout=5,
            )
        except Exception as e:
            logging.warning(f"ntfy push failed: {e}")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = EMAIL_ADDRESS
    msg["To"] = EMAIL_ADDRESS
    msg["Cc"] = CC_EMAIL_ADDRESS
    msg["X-Priority"] = "1"
    msg["X-MSMail-Priority"] = "High"
    msg["Importance"] = "High"
    msg["Priority"] = "urgent"

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
        <h2 style="margin-bottom: 5px;">{item['title']}</h2>
        <p style="margin-top: 0; color: #555;">
            <strong>Variant:</strong> {item['variant']} &nbsp;|&nbsp; <strong>Listing ID:</strong> #{item['id']}
        </p>
        <div style="margin: 18px 0;">
            <a href="{item['item_url']}" style="background-color: #0066cc; color: white; padding: 12px 18px; text-decoration: none; font-weight: bold; border-radius: 5px; margin-right: 10px;">
                VIEW LISTING (#{item['id']})
            </a>
            <a href="{item['add_to_cart_url']}" style="background-color: #28a745; color: white; padding: 12px 18px; text-decoration: none; font-weight: bold; border-radius: 5px;">
                1-CLICK ADD TO CART ({item['total_price']})
            </a>
        </div>
        <table style="border-collapse: collapse; width: 100%; max-width: 580px; margin-top: 15px;">
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>List / Total Shipped</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>{item['list_price']}</strong> ({item['total_price']} total)</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Discogs Low / Median / High</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{stats['low']} / <strong>{stats['median']}</strong> / {stats['high']}</td>
            </tr>
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Condition</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">Media: <strong>{item['media_condition']}</strong> | Sleeve: <strong>{item['sleeve_condition']}</strong></td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Seller</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">{item['seller_info']} ({item.get('listed_age', '')})</td>
            </tr>
            <tr style="background-color: #f4f4f4;">
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Direct Listing URL</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><a href="{item['item_url']}">{item['item_url']}</a></td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Release Page</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;"><a href="{item['release_url']}">{item['release_url']}</a></td>
            </tr>
        </table>
        <p style="font-size: 12px; color: #666; margin-top: 15px;">Seller Notes: {item['raw_description']}</p>
    </body>
    </html>
    """

    msg.attach(MIMEText(html_body, "html", "utf-8"))

    recipients = [EMAIL_ADDRESS, CC_EMAIL_ADDRESS]
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(EMAIL_ADDRESS, GMAIL_APP_PASSWORD.replace(" ", ""))
        server.sendmail(EMAIL_ADDRESS, recipients, msg.as_string())

    logging.info(f"ALERT SENT -> {subject} | CC: {CC_EMAIL_ADDRESS} | Listing URL: {item['item_url']}")


# =====================================================================
# SNAPSHOT & SELF-DIFF CHECK CYCLE
# =====================================================================
def run_check_on_page(context, page, test_latest: bool = False, force_reseed: bool = False):
    try:
        cdp = context.new_cdp_session(page)
        cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        cdp.send("Page.setWebLifecycleState", {"state": "active"})
    except Exception:
        pass

    logging.info("Loading Discogs Wantlist in Chrome...")
    page.goto(WANTLIST_URL, wait_until="domcontentloaded", timeout=35000)

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

    # 1. Build current seed_listings dict in exact 0..24 order
    current_listings = extract_seed_listings(page)
    if not current_listings:
        logging.error(f"Extracted 0 listings. Page Title: '{page.title()}'")
        return

    ordered_items = list(current_listings.values())
    top3 = " | ".join(
        [f"#{x['rank']}: {x['title']} ({x['total_price']}) [ID:{x['id']}]" for x in ordered_items[:3]]
    )
    logging.info(f"Parsed {len(current_listings)} listings in exact order. Top 3 -> {top3}")

    # 2. Load previous run's seed_listings dict
    previous_listings = load_seed_listings()

    # 3. Initial Seed or Forced Reseed
    if force_reseed or not previous_listings:
        save_seed_listings(current_listings, previous_listings if not force_reseed else None)
        logging.info(f"[SEED GENERATED] Wrote {len(current_listings)} ordered items to {SEED_FILE.name}.")

        if test_latest:
            top_item = ordered_items[0]
            logging.info(f"[TEST MODE] Sending test alert for #1 Top Item: {top_item['title']} [ID:{top_item['id']}]...")
            stats = fetch_release_stats_in_browser(context, top_item["release_url"])
            send_alerts(top_item, stats)
        return

    # 4. Diff current_listings against previous_listings
    diff_hits = [
        item for item_id, item in current_listings.items()
        if item_id not in previous_listings
    ]

    if diff_hits:
        logging.info(f"[DELTA: {len(diff_hits)} NEW HIT(S)] Sending alerts...")
        for item in reversed(diff_hits):
            stats = fetch_release_stats_in_browser(context, item["release_url"])
            send_alerts(item, stats)
    else:
        logging.info(
            f"[DELTA: 0 NEW] All {len(current_listings)} current items match {SEED_FILE.name} "
            f"({len(previous_listings)} tracked)."
        )
        if test_latest:
            top_item = ordered_items[0]
            logging.info(f"[TEST MODE] Sending test alert for #1 Top Item: {top_item['title']} [ID:{top_item['id']}]...")
            stats = fetch_release_stats_in_browser(context, top_item["release_url"])
            send_alerts(top_item, stats)

    # 5. Save current_listings as the new seed_snapshot.json for the next run
    save_seed_listings(current_listings, previous_listings)


# =====================================================================
# MAIN ENTRYPOINT
# =====================================================================
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--login", action="store_true")
    parser.add_argument("--reseed", action="store_true")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()

    cleanup_legacy_files()

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
            page.goto(WANTLIST_URL)
            input("\n>>> Confirm your Wantlist is visible and sorted by 'Listed Newest', then press ENTER here...")
        elif args.daemon:
            logging.info("Starting continuous daemon loop (45-75s jitter)...")
            while True:
                try:
                    run_check_on_page(context, page)
                except Exception as e:
                    logging.error(f"Check failed: {e}")
                time.sleep(random.randint(45, 75))
        else:
            run_check_on_page(context, page, test_latest=args.test, force_reseed=args.reseed)

        context.close()


if __name__ == "__main__":
    main()