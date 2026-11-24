import json
from pathlib import Path
import unittest

import discogs_sniper as sniper
from scripts import build_dashboard as builder

REPO_ROOT = Path(__file__).resolve().parent.parent


class TestDiscogsSniperV2(unittest.TestCase):
    def test_token_and_username_sanitization(self):
        self.assertEqual(
            sniper.sanitize_token('  "Discogs token=abc123XYZ_-\x16\n" '),
            "abc123XYZ_-",
        )
        self.assertEqual(sniper.sanitize_token("$env:DISCOGS_TOKEN"), "")
        self.assertEqual(sniper.sanitize_token("your_discogs_personal_access_token_here"), "")
        self.assertEqual(sniper.sanitize_username("  'krunked\n' "), "krunked")
        self.assertEqual(sniper.sanitize_username(""), "krunked")
        self.assertEqual(str(sniper.LOCAL_SNIPER_DIR), r"C:\discogs_sniper")
        self.assertEqual(str(sniper.SIBLING_COLLECTION_DIR), r"C:\Discogs_collection")

    def test_dotenv_expansion_and_materialization(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            env_p = Path(tmpdir) / ".env"
            env_p.write_text("DISCOGS_USERNAME=krunked\nDISCOGS_TOKEN=$env:DISCOGS_TOKEN\n", encoding="utf-8")
            old_val = os.environ.get("DISCOGS_TOKEN")
            try:
                os.environ["DISCOGS_TOKEN"] = "ValidTestDiscogsToken1234567890"
                parsed = sniper.parse_dotenv_file(env_p)
                self.assertEqual(parsed.get("DISCOGS_TOKEN"), "ValidTestDiscogsToken1234567890")
                ok = sniper.sync_resolved_token_to_local_dotenv("ValidTestDiscogsToken1234567890", env_path=env_p, force=True)
                self.assertTrue(ok)
                self.assertIn("DISCOGS_TOKEN=ValidTestDiscogsToken1234567890", env_p.read_text(encoding="utf-8"))
            finally:
                if old_val is None:
                    os.environ.pop("DISCOGS_TOKEN", None)
                else:
                    os.environ["DISCOGS_TOKEN"] = old_val

    def test_wax_shader_deterministic_parser(self):
        clear_wax = builder.parse_wax_shader("Stereo, Album, Limited Edition, Repress, LP, Ultra Clear")
        self.assertEqual(clear_wax["pattern"], "translucent")
        self.assertIn("Ultra Clear", clear_wax["wax_name"])

        splatter_wax = builder.parse_wax_shader("Vinyl, LP, Limited Edition, Pink With Black & White Splatter")
        self.assertEqual(splatter_wax["pattern"], "splatter")
        self.assertEqual(splatter_wax["primary"], "#ec4899")

        split_wax = builder.parse_wax_shader("2xLP, Half Bone / Half Red Split")
        self.assertEqual(split_wax["pattern"], "split")

    def test_relist_deduplication_and_price_drop_override(self):
        config = sniper.load_sniper_config()
        config["relist_deduplication"]["enabled"] = True
        config["relist_deduplication"]["cooldown_days"] = 7
        config["relist_deduplication"]["consolidate_multi_copy_batches"] = True
        config["relist_deduplication"]["price_drop_override_usd"] = 1.0
        config["relist_deduplication"]["price_drop_override_pct"] = 3.0
        config["filters"] = {
            "min_media_condition": "VG+",
            "min_sleeve_condition": "Any",
            "max_total_price_usd": None,
            "muted_sellers": [],
            "price_drop_only_sellers": ["recordmule"],
            "target_prices_by_release": {},
        }

        ledger = {
            "38857860::recordmule::M": {
                "release_id": "38857860",
                "title": "Dayseeker - Dark Sun",
                "seller": "recordmule",
                "media_condition": "M",
                "last_price_usd": 38.49,
                "lowest_price_usd": 38.49,
                "highest_price_usd": 44.49,
                "last_seen_at": "2026-11-19T13:38:50",
                "total_relists_seen": 47,
                "last_listing_id": "4498617398",
            }
        }

        # 1. Identical price relist from recordmule should be suppressed
        same_price_relist = [
            {
                "id": "4499999001",
                "title": "Dayseeker - Dark Sun",
                "media_condition": "M",
                "sleeve_condition": "NM",
                "list_price": "$30.99",
                "total_price": "$38.49",
                "seller_info": "recordmule",
                "release_url": "https://www.discogs.com/release/38857860",
            }
        ]
        actionable, suppressed = sniper.evaluate_and_filter_hits(same_price_relist, ledger, config, {})
        self.assertEqual(len(actionable), 0)
        self.assertEqual(len(suppressed), 1)

        # 2. Price drop relist ($38.49 -> $32.99) should override suppression and alert as PRICE DROP HIT!
        price_drop_relist = [
            {
                "id": "4499999002",
                "title": "Dayseeker - Dark Sun",
                "media_condition": "M",
                "sleeve_condition": "NM",
                "list_price": "$25.49",
                "total_price": "$32.99",
                "seller_info": "recordmule",
                "release_url": "https://www.discogs.com/release/38857860",
            }
        ]
        actionable_drop, suppressed_drop = sniper.evaluate_and_filter_hits(price_drop_relist, ledger, config, {})
        self.assertEqual(len(actionable_drop), 1)
        self.assertEqual(len(suppressed_drop), 0)
        self.assertTrue(actionable_drop[0].get("is_price_drop_hit"))
        self.assertAlmostEqual(actionable_drop[0].get("price_drop_usd"), 5.50, places=2)

        # 3. Multi-copy batch drop (3 identical copies from a new seller) should collapse into 1 grouped alert
        multi_copy_batch = [
            {
                "id": "4500000003",
                "title": "The Mars Volta - De-Loused In The Comatorium",
                "media_condition": "NM",
                "sleeve_condition": "NM",
                "list_price": "$50.00",
                "total_price": "$56.00",
                "seller_info": "IndieVinylShop",
                "release_url": "https://www.discogs.com/release/20767684",
            },
            {
                "id": "4500000002",
                "title": "The Mars Volta - De-Loused In The Comatorium",
                "media_condition": "NM",
                "sleeve_condition": "NM",
                "list_price": "$50.00",
                "total_price": "$56.00",
                "seller_info": "IndieVinylShop",
                "release_url": "https://www.discogs.com/release/20767684",
            },
            {
                "id": "4500000001",
                "title": "The Mars Volta - De-Loused In The Comatorium",
                "media_condition": "NM",
                "sleeve_condition": "NM",
                "list_price": "$50.00",
                "total_price": "$56.00",
                "seller_info": "IndieVinylShop",
                "release_url": "https://www.discogs.com/release/20767684",
            },
        ]
        actionable_batch, _ = sniper.evaluate_and_filter_hits(multi_copy_batch, ledger, config, {})
        self.assertEqual(len(actionable_batch), 1)
        self.assertEqual(actionable_batch[0]["batch_copy_count"], 3)
        self.assertEqual(len(actionable_batch[0]["batch_listing_ids"]), 3)

    def test_compiled_sniper_state_and_html_integrity(self):
        import re

        seed = json.loads((REPO_ROOT / "seed_snapshot.json").read_text(encoding="utf-8"))
        raw_items = seed.get("items", seed)
        expected_total = len(raw_items)

        vault = json.loads((REPO_ROOT / "data" / "vault_crossref.json").read_text(encoding="utf-8"))
        owned_releases = vault.get("owned_releases") or {}
        owned_album_keys = {builder.normalize_album_key(k) for k in (vault.get("owned_albums") or {})}
        for info in owned_releases.values():
            ak = builder.normalize_album_key(f"{info.get('artist', '')} - {info.get('title', '')}")
            if ak:
                owned_album_keys.add(ak)

        expected_distinct_rids: set[str] = set()
        expected_exact_owned: set[str] = set()
        expected_variant_upgrades: set[str] = set()
        for item in raw_items.values():
            m_rel = re.search(r"/release/(\d+)", item.get("release_url", ""))
            rid = m_rel.group(1) if m_rel else "unknown"
            expected_distinct_rids.add(rid)
            norm_key = builder.normalize_album_key((item.get("title") or "Unknown Title").strip())
            if rid in owned_releases:
                expected_exact_owned.add(rid)
            elif norm_key in owned_album_keys:
                expected_variant_upgrades.add(rid)
        expected_variant_upgrades -= expected_exact_owned
        expected_missing_grails = expected_distinct_rids - expected_exact_owned - expected_variant_upgrades

        state = builder.build_sniper_state(persist=False)
        summary = state["summary"]
        self.assertEqual(summary["total_tracked_listings"], expected_total)
        self.assertEqual(
            summary["unique_deduped_offerings"] + summary["auto_relists_intercepted"],
            summary["total_tracked_listings"],
        )
        self.assertEqual(summary["distinct_releases"], len(expected_distinct_rids))
        self.assertEqual(summary["exact_owned_releases"], len(expected_exact_owned))
        self.assertEqual(summary["variant_upgrade_releases"], len(expected_variant_upgrades))
        self.assertEqual(summary["missing_grails_releases"], len(expected_missing_grails))
        self.assertEqual(
            summary["exact_owned_releases"]
            + summary["variant_upgrade_releases"]
            + summary["missing_grails_releases"],
            summary["distinct_releases"],
        )
        self.assertEqual(len(state["vault_bridge"]["exact_owned_on_wantlist"]), summary["exact_owned_releases"])
        self.assertEqual(
            len(state["vault_bridge"]["variant_upgrades_on_wantlist"]),
            summary["variant_upgrade_releases"],
        )
        self.assertEqual(summary["seller_bundles_count"], len(state["seller_bundles"]))
        self.assertTrue(all(b["item_count"] >= 2 for b in state["seller_bundles"]))

        out_html = builder.compile_static_html(state, check_only=True)
        self.assertTrue(out_html.exists())
        html_text = out_html.read_text(encoding="utf-8")
        self.assertNotIn("__INJECT_STYLES_CSS__", html_text)
        self.assertNotIn("__INJECT_SNIPER_STATE_JSON__", html_text)
        self.assertNotIn("// __INJECT_APP_JS__", html_text)
        self.assertIn("DISCOGS SNIPER", html_text)
        self.assertIn("btn-sync-live-wantlist", html_text)
        self.assertIn("vault-live-sync-status", html_text)
        self.assertIn("turntable-platter-canvas", html_text)
        self.assertIn("cmd-palette-backdrop", html_text)
        self.assertIn("./manifest.webmanifest", html_text)

    def test_fetch_wantlist_ids_and_404_semantics(self):
        import io
        import urllib.error
        from unittest.mock import patch

        client = sniper.DiscogsAPIClient(token="ValidTestDiscogsToken1234567890", username="krunked")

        # 1. API failure on _get must return None (not empty list [])
        with patch.object(client, "_get", return_value=None):
            self.assertIsNone(client.fetch_wantlist_ids())

        # 2. Multi-page wantlist fetch deduplicates and parses IDs cleanly
        pages = [
            {"wants": [{"id": 111}, {"basic_information": {"id": 222}}], "pagination": {"pages": 2}},
            {"wants": [{"id": 222}, {"id": 333}], "pagination": {"pages": 2}},
        ]
        with patch.object(client, "_get", side_effect=pages):
            self.assertEqual(client.fetch_wantlist_ids(), ["111", "222", "333"])

        # 3. HTTP 404 on DELETE must report already_absent and NOT return True from remove_from_wantlist
        err_404 = urllib.error.HTTPError(
            url="https://api.discogs.com/users/krunked/wants/999",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=io.BytesIO(b'{"message": "Not Found"}'),
        )
        with patch("urllib.request.urlopen", side_effect=err_404):
            status, code, _ = client.remove_from_wantlist_detailed("999")
            self.assertEqual(status, "already_absent")
            self.assertEqual(code, 404)
            self.assertFalse(client.remove_from_wantlist("999"))

    def test_api_check_uses_live_wantlist_not_static_snapshot(self):
        import contextlib
        import io
        from unittest.mock import patch

        client = sniper.DiscogsAPIClient(token="ValidTestDiscogsToken1234567890", username="krunked")
        fixture_items = {
            "4490000001": {
                "title": "Currents - The Way It Ends",
                "release_url": "https://www.discogs.com/release/31082741",
            },
            "4498617398": {
                "title": "Dayseeker - Dark Sun",
                "release_url": "https://www.discogs.com/release/38857860",
            },
        }

        # Live wantlist has 0 owned overlaps even though snapshot fixture still has 1 historical owned item
        buf = io.StringIO()
        with (
            patch.object(client, "get_identity", return_value={"username": "krunked", "id": 32496351}),
            patch.object(client, "fetch_wantlist_ids", return_value=["99999991", "99999992"]),
            patch.object(sniper, "load_seed_snapshot", return_value=(fixture_items, {})),
            contextlib.redirect_stdout(buf),
        ):
            rc = sniper.run_api_diagnostics(client, token_source="test")
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("Live Discogs Wantlist   : 2 releases", out)
        self.assertIn("Exact Owned Pressings Still on Live Wantlist (0 releases):", out)
        self.assertIn("Historical Snapshot Note: 1 owned release(s) remain in seed_snapshot.json", out)

    def test_prune_owned_uses_live_wantlist_as_sole_source_of_truth(self):
        import contextlib
        import io
        from unittest.mock import patch

        client = sniper.DiscogsAPIClient(token="ValidTestDiscogsToken1234567890", username="krunked")

        # Case A: Live wantlist already clean -> must NOT send DELETE for stale snapshot items
        buf_clean = io.StringIO()
        with (
            patch.object(client, "get_identity", return_value={"username": "krunked", "id": 32496351}),
            patch.object(client, "fetch_wantlist_ids", return_value=["99999991"]),
            patch.object(client, "remove_from_wantlist_detailed") as mock_del,
            contextlib.redirect_stdout(buf_clean),
        ):
            rc = sniper.run_prune_owned_wantlist(client, dry_run=False)
        self.assertEqual(rc, 0)
        mock_del.assert_not_called()
        self.assertIn("Zero exact-owned Collection Vault pressings found on your live Discogs Wantlist", buf_clean.getvalue())

        # Case B: Live wantlist has 1 owned release -> deletes ONLY that 1 and verifies 0 remaining
        buf_one = io.StringIO()
        with (
            patch.object(client, "get_identity", return_value={"username": "krunked", "id": 32496351}),
            patch.object(client, "fetch_wantlist_ids", side_effect=[["31082741", "99999991"], ["99999991"]]),
            patch.object(client, "remove_from_wantlist_detailed", return_value=("removed", 204, "OK")) as mock_del,
            patch("time.sleep"),
            contextlib.redirect_stdout(buf_one),
        ):
            rc = sniper.run_prune_owned_wantlist(client, dry_run=False)
        self.assertEqual(rc, 0)
        mock_del.assert_called_once_with("31082741")
        out_one = buf_one.getvalue()
        self.assertIn("[REMOVED] DELETE /users/krunked/wants/31082741", out_one)
        self.assertIn("Live Wantlist verification: 0 exact-owned overlap(s) remaining", out_one)

    def test_relist_ledger_idempotency_no_count_inflation(self):
        items = {
            "4498617398": {
                "title": "Dayseeker - Dark Sun",
                "seller_info": "recordmule",
                "media_condition": "M",
                "total_price": "$38.49",
                "list_price": "$30.99",
                "release_url": "https://www.discogs.com/release/38857860",
                "seeded_at": "2026-11-19T13:38:50",
            },
            "4498617399": {
                "title": "Dayseeker - Dark Sun",
                "seller_info": "recordmule",
                "media_condition": "M",
                "total_price": "$44.49",
                "list_price": "$36.99",
                "release_url": "https://www.discogs.com/release/38857860",
                "seeded_at": "2026-11-18T13:30:00",
            },
        }
        fp = "38857860::recordmule::M"
        ledger1 = sniper.build_relist_ledger(items, None)
        ledger2 = sniper.build_relist_ledger(items, ledger1)
        ledger3 = sniper.build_relist_ledger(items, ledger2)

        # Repeated 5-minute saves must NEVER inflate total_relists_seen
        self.assertEqual(ledger1[fp]["total_relists_seen"], 2)
        self.assertEqual(ledger2[fp]["total_relists_seen"], 2)
        self.assertEqual(ledger3[fp]["total_relists_seen"], 2)
        self.assertEqual(ledger3[fp]["seen_listing_ids"], ["4498617398", "4498617399"])
        self.assertAlmostEqual(ledger3[fp]["lowest_price_usd"], 38.49, places=2)
        self.assertAlmostEqual(ledger3[fp]["highest_price_usd"], 44.49, places=2)

        # Adding a genuinely new 3rd listing ID increments count cleanly to 3
        items_plus_one = dict(items)
        items_plus_one["4499000001"] = {
            "title": "Dayseeker - Dark Sun",
            "seller_info": "recordmule",
            "media_condition": "M",
            "total_price": "$36.49",
            "list_price": "$28.99",
            "release_url": "https://www.discogs.com/release/38857860",
            "seeded_at": "2026-11-20T13:00:00",
        }
        ledger4 = sniper.build_relist_ledger(items_plus_one, ledger3)
        self.assertEqual(ledger4[fp]["total_relists_seen"], 3)
        self.assertAlmostEqual(ledger4[fp]["lowest_price_usd"], 36.49, places=2)

    def test_save_seed_listings_preserves_enrichment_and_seeded_at(self):
        import tempfile
        from unittest.mock import patch

        prev_items = {
            "4498617398": {
                "title": "Dayseeker - Dark Sun",
                "seller_info": "recordmule",
                "media_condition": "M",
                "total_price": "$38.49",
                "release_url": "https://www.discogs.com/release/38857860",
                "seeded_at": "2026-11-18T08:00:00",
                "cover_image": "https://i.discogs.com/example-cover.jpeg",
                "seller_rating": "99.8%",
                "api_stats": {"condition_suggested_usd": 39.0, "allow_offers": True},
            }
        }
        # Fresh Page 1 scrape of the same ongoing listing without API re-fetch
        current_items = {
            "4498617398": {
                "title": "Dayseeker - Dark Sun",
                "seller_info": "recordmule",
                "media_condition": "M",
                "total_price": "$38.49",
                "release_url": "https://www.discogs.com/release/38857860",
                "seeded_at": "2026-11-19T14:00:00",
            }
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_seed = Path(tmpdir) / "seed_snapshot.json"
            with patch.object(sniper, "SEED_FILE", tmp_seed):
                sniper.save_seed_listings(current_items, prev_items, {})
            saved = json.loads(tmp_seed.read_text(encoding="utf-8"))
            entry = saved["items"]["4498617398"]
            self.assertEqual(entry["seeded_at"], "2026-11-18T08:00:00")
            self.assertEqual(entry["cover_image"], "https://i.discogs.com/example-cover.jpeg")
            self.assertEqual(entry["seller_rating"], "99.8%")
            self.assertEqual(entry["api_stats"]["condition_suggested_usd"], 39.0)
            self.assertEqual(saved["schema_version"], sniper.SNIPER_VERSION)

    def test_price_drop_override_blocks_yoyo_bounce_spam(self):
        config = sniper.load_sniper_config()
        config["relist_deduplication"]["enabled"] = True
        config["relist_deduplication"]["cooldown_days"] = 7
        config["relist_deduplication"]["price_drop_override_usd"] = 1.0
        config["relist_deduplication"]["price_drop_override_pct"] = 3.0
        config["filters"] = {
            "min_media_condition": "VG+",
            "min_sleeve_condition": "Any",
            "max_total_price_usd": None,
            "muted_sellers": [],
            "price_drop_only_sellers": ["recordmule"],
            "target_prices_by_release": {},
        }

        # Seller oscillated up to $44.49 after previously listing at $38.49
        ledger = {
            "38857860::recordmule::M": {
                "release_id": "38857860",
                "title": "Dayseeker - Dark Sun",
                "seller": "recordmule",
                "media_condition": "M",
                "last_price_usd": 44.49,
                "lowest_price_usd": 38.49,
                "highest_price_usd": 44.49,
                "last_seen_at": "2026-11-19T13:38:50",
                "total_relists_seen": 48,
                "last_listing_id": "4498617398",
            }
        }
        # Relisting at $39.00 is below last_price ($44.49) but ABOVE lowest ($38.49) -> MUST be suppressed!
        yoyo_relist = [
            {
                "id": "4499999099",
                "title": "Dayseeker - Dark Sun",
                "media_condition": "M",
                "sleeve_condition": "NM",
                "list_price": "$31.50",
                "total_price": "$39.00",
                "seller_info": "recordmule",
                "release_url": "https://www.discogs.com/release/38857860",
            }
        ]
        actionable, suppressed = sniper.evaluate_and_filter_hits(yoyo_relist, ledger, config, {})
        self.assertEqual(len(actionable), 0)
        self.assertEqual(len(suppressed), 1)

    def test_dom_extractor_preserves_self_titled_artist_prefix(self):
        self.assertIn("alreadyPrefixed", sniper.EXTRACT_VISIBLE_DESKTOP_ROWS_JS)
        self.assertNotIn("title.toLowerCase().includes(artist.toLowerCase())", sniper.EXTRACT_VISIBLE_DESKTOP_ROWS_JS)

    def test_html_email_escaping_in_send_alerts(self):
        from unittest.mock import MagicMock, patch

        captured_messages: list[str] = []

        class FakeSMTP:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def login(self, user, pwd):
                pass

            def sendmail(self, sender, recipients, msg_str):
                captured_messages.append(msg_str)

        item = {
            "id": "4499999777",
            "title": 'Evil <script>alert("xss")</script> - Album',
            "variant": "LP, <img src=x onerror=alert(1)>",
            "media_condition": "NM",
            "sleeve_condition": "NM",
            "list_price": "$25.00",
            "total_price": "$30.00",
            "seller_info": "<b>bad_seller</b>",
            "listed_age": "1m ago",
            "item_url": "https://www.discogs.com/sell/item/4499999777",
            "add_to_cart_url": "https://www.discogs.com/sell/cart/?add=4499999777",
            "release_url": "https://www.discogs.com/release/123456",
            "raw_description": 'Mint copy "><svg onload=alert(1)>',
        }
        stats = {
            "low": "$20.00",
            "median": "$30.00",
            "high": "$40.00",
            "condition_suggested_price": "$32.00",
            "condition_matched_grade": "NM",
            "deal_verdict": "DEAL (-6%)",
            "vault_badge": "MISSING GRAIL",
        }
        creds = {
            "email_to": "test@example.com",
            "email_cc": "",
            "gmail_app_password": "xxxx yyyy zzzz wwww",
            "ntfy_topic": "",
        }
        with patch("smtplib.SMTP_SSL", FakeSMTP):
            sniper.send_alerts(item, stats, creds)

        self.assertEqual(len(captured_messages), 1)
        import email

        parsed_msg = email.message_from_string(captured_messages[0])
        html_parts = [
            part.get_payload(decode=True).decode("utf-8")
            for part in parsed_msg.walk()
            if part.get_content_type() == "text/html"
        ]
        self.assertEqual(len(html_parts), 1)
        html_body = html_parts[0]
        self.assertNotIn("<script>alert", html_body)
        self.assertNotIn("<svg onload=", html_body)
        self.assertIn("&lt;script&gt;", html_body)
        self.assertIn("&lt;b&gt;bad_seller&lt;/b&gt;", html_body)

    def test_build_sniper_state_v21_fixes_and_live_wantlist_sync(self):
        import re
        import tempfile
        from unittest.mock import patch

        self.assertEqual(builder.normalize_album_key("The Way It Ends "), "the way it ends")

        # Part A: Verify live snapshot structural & non-fabrication invariants without brittle item counts
        live_seed = json.loads((REPO_ROOT / "seed_snapshot.json").read_text(encoding="utf-8"))
        live_raw_items = live_seed.get("items", live_seed)
        rids_with_snapshot_cover = set()
        for it in live_raw_items.values():
            m_rel = re.search(r"/release/(\d+)", it.get("release_url", ""))
            cov = it.get("cover_image") or (it.get("api_stats") or {}).get("cover_image") or ""
            if m_rel and cov:
                rids_with_snapshot_cover.add(m_rel.group(1))

        state_live = builder.build_sniper_state(persist=False)
        self.assertEqual(state_live["schema_version"], "3.0.0")
        live_p1 = [x for x in state_live["listings"] if x["is_live_page1"]]
        expected_live_p1 = min(int(live_seed.get("live_page_count", 25)), len(state_live["listings"]))
        self.assertEqual(len(live_p1), expected_live_p1)
        for x in state_live["listings"]:
            self.assertNotIn("Estimated Mint", x["market_stats"]["benchmark_source"])
            if x["release_id"] in rids_with_snapshot_cover:
                self.assertTrue(bool(x["cover_image_url"]))
        self.assertEqual(
            state_live["summary"]["allow_offers_count"],
            sum(1 for x in state_live["listings"] if x["is_latest_in_group"] and x["allow_offers"]),
        )
        self.assertEqual(
            state_live["summary"]["exact_owned_in_live_page1"],
            sum(1 for r in state_live["vault_bridge"]["exact_owned_on_wantlist"] if r["in_live_page1"]),
        )

        # Part B: Deterministic fixture verifying sibling cover propagation, 3-seller median, Vault buckets & Wantlist sync
        fixture_seed = {
            "schema_version": "3.0.0",
            "updated_at": "2026-11-20T12:00:00",
            "live_page_count": 2,
            "items": {
                "4498617398": {
                    "title": "Dayseeker - Dark Sun",
                    "variant": "LP, Ultra Clear",
                    "media_condition": "M",
                    "sleeve_condition": "NM",
                    "list_price": "$30.99",
                    "total_price": "$38.49",
                    "seller_info": "recordmule",
                    "allow_offers": True,
                    "release_url": "https://www.discogs.com/release/38857860",
                },
                "4498000003": {
                    "title": "Dayseeker - Dark Sun",
                    "variant": "LP, Ultra Clear",
                    "media_condition": "M",
                    "sleeve_condition": "NM",
                    "list_price": "$30.00",
                    "total_price": "$36.00",
                    "seller_info": "IndieSellerB",
                    "allow_offers": False,
                    "release_url": "https://www.discogs.com/release/38857860",
                },
                "4498000002": {
                    "title": "Dayseeker - Dark Sun",
                    "variant": "LP, Ultra Clear",
                    "media_condition": "M",
                    "sleeve_condition": "NM",
                    "list_price": "$36.00",
                    "total_price": "$42.00",
                    "seller_info": "CollectorSellerC",
                    "allow_offers": True,
                    "release_url": "https://www.discogs.com/release/38857860",
                },
                "4498000001": {
                    "title": "Dayseeker - Dark Sun",
                    "variant": "LP, Ultra Clear",
                    "media_condition": "M",
                    "sleeve_condition": "NM",
                    "list_price": "$36.99",
                    "total_price": "$44.49",
                    "seller_info": "recordmule",
                    "cover_image": "https://i.discogs.com/dayseeker-cover.jpeg",
                    "release_url": "https://www.discogs.com/release/38857860",
                },
                "4497000002": {
                    "title": "Currents - The Way It Ends",
                    "variant": "LP, Purple Swirl",
                    "media_condition": "NM",
                    "sleeve_condition": "NM",
                    "list_price": "$65.00",
                    "total_price": "$70.00",
                    "seller_info": "VariantShop",
                    "release_url": "https://www.discogs.com/release/99000001",
                },
                "4497000001": {
                    "title": "Currents - The Way It Ends",
                    "variant": "LP, Black Smoke",
                    "media_condition": "NM",
                    "sleeve_condition": "NM",
                    "list_price": "$55.00",
                    "total_price": "$60.00",
                    "seller_info": "VaultOverlapSeller",
                    "release_url": "https://www.discogs.com/release/31082741",
                },
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_dir = Path(tmpdir)
            tmp_seed_file = tmp_dir / "seed_snapshot.json"
            tmp_cache_file = tmp_dir / "releases_cache.json"
            tmp_sync_file = tmp_dir / "wantlist_sync.json"
            tmp_state_file = tmp_dir / "sniper_state.json"
            tmp_seed_file.write_text(json.dumps(fixture_seed), encoding="utf-8")
            tmp_cache_file.write_text("{}", encoding="utf-8")

            with (
                patch.object(builder, "SEED_FILE", tmp_seed_file),
                patch.object(builder, "RELEASES_CACHE_FILE", tmp_cache_file),
                patch.object(builder, "WANTLIST_SYNC_FILE", tmp_sync_file),
                patch.object(builder, "SNIPER_STATE_FILE", tmp_state_file),
            ):
                state_default = builder.build_sniper_state()

                # 1. Sibling cover recovery + allow_offers + exact 3-bucket Vault partition
                dayseeker = next(x for x in state_default["listings"] if x["id"] == "4498617398")
                self.assertEqual(dayseeker["cover_image_url"], "https://i.discogs.com/dayseeker-cover.jpeg")
                self.assertEqual(state_default["summary"]["allow_offers_count"], 2)
                self.assertEqual(state_default["summary"]["exact_owned_releases"], 1)
                self.assertEqual(state_default["summary"]["variant_upgrade_releases"], 1)
                self.assertEqual(state_default["summary"]["missing_grails_releases"], 1)
                self.assertEqual(state_default["summary"]["exact_owned_in_live_page1"], 0)

                # 2. Per-seller deduplicated median ($36.00, $38.49, $42.00 -> $38.49; recordmule $44.49 relist ignored)
                self.assertEqual(dayseeker["market_stats"]["distinct_sellers_tracked"], 3)
                self.assertAlmostEqual(dayseeker["market_stats"]["observed_median_usd"], 38.49, places=2)
                self.assertIn("3-Seller", dayseeker["market_stats"]["benchmark_source"])

                # 3. Live Wantlist sync override: 0 active overlaps -> snapshot owned row marked CLEARED_FROM_WANTLIST
                state_clean = builder.build_sniper_state(
                    wantlist_sync_override={
                        "username": "krunked",
                        "synced_at": "2026-11-19T21:00:00",
                        "total_live_wants": 50,
                        "live_want_release_ids": ["99999991", "99999992"],
                    }
                )
                self.assertTrue(state_clean["live_wantlist_sync"]["synced"])
                self.assertEqual(state_clean["summary"]["live_exact_owned_overlaps"], 0)
                self.assertTrue(
                    all(
                        r["live_wantlist_status"] == "CLEARED_FROM_WANTLIST"
                        for r in state_clean["vault_bridge"]["exact_owned_on_wantlist"]
                    )
                )

                # 4. Live Wantlist sync override: 1 active overlap -> only that 1 row marked STILL_ON_WANTLIST
                state_one = builder.build_sniper_state(
                    wantlist_sync_override={
                        "username": "krunked",
                        "synced_at": "2026-11-19T21:00:00",
                        "total_live_wants": 51,
                        "live_want_release_ids": ["31082741", "99999991"],
                    }
                )
                self.assertEqual(state_one["summary"]["live_exact_owned_overlaps"], 1)
                still_rows = [
                    r
                    for r in state_one["vault_bridge"]["exact_owned_on_wantlist"]
                    if r["live_wantlist_status"] == "STILL_ON_WANTLIST"
                ]
                self.assertEqual([r["release_id"] for r in still_rows], ["31082741"])

    def test_save_wantlist_sync_snapshot_and_html_script_escaping(self):
        import re
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmpdir:
            sync_file = Path(tmpdir) / "wantlist_sync.json"
            out_path = sniper.save_wantlist_sync_snapshot(
                "krunked",
                ["31082741", "99999999", "31082741"],
                {"31082741": {"title": "Currents"}},
                sync_path=sync_file,
            )
            self.assertEqual(out_path, sync_file)
            saved = json.loads(sync_file.read_text(encoding="utf-8"))
            self.assertEqual(saved["total_live_wants"], 2)
            self.assertEqual(saved["live_want_release_ids"], ["31082741", "99999999"])
            self.assertEqual(saved["live_exact_owned_overlaps"], ["31082741"])

            # Verify RFC 8259-compliant escaping of </script> and <!-- in compiled HTML
            tmp_html = Path(tmpdir) / "index_test.html"
            tricky_state = {"probe": "</script><!--comment--><script>alert(1)</script>"}
            with patch.object(builder, "OUTPUT_HTML", tmp_html):
                builder.compile_static_html(tricky_state, check_only=False)
            compiled = tmp_html.read_text(encoding="utf-8")
            m = re.search(
                r'<script id="sniper-prebaked-state" type="application/json">\s*(.*?)\s*</script>',
                compiled,
                flags=re.DOTALL,
            )
            self.assertIsNotNone(m)
            raw_json = m.group(1)
            self.assertNotIn("</script>", raw_json)
            self.assertNotIn("<!--", raw_json)
            parsed = json.loads(raw_json)
            self.assertEqual(parsed["probe"], tricky_state["probe"])
            self.assertIn("v3.0", compiled)
            self.assertIn("btn-toggle-uv", compiled)
            self.assertIn("inspect-modal-backdrop", compiled)

    def test_v3_collector_signals_bundles_offers_and_staging(self):
        import tempfile

        # 1. Variant boilerplate deduplication + badge extraction
        dup = builder.extract_collector_signals("LP, Ultra Clear", "LP, Ultra Clear")
        self.assertEqual(dup["clean_seller_note"], "")
        self.assertFalse(dup["has_wear_warning"])

        sig = builder.extract_collector_signals(
            "BRAND NEW SEALED! Jacket SIGNED by band. Minor seam split on top edge.",
            "LP, Pink Splatter",
        )
        badge_ids = {b["id"] for b in sig["collector_badges"]}
        self.assertIn("SIGNED", badge_ids)
        self.assertIn("SEALED", badge_ids)
        self.assertIn("WEAR_WARN", badge_ids)
        self.assertTrue(sig["has_wear_warning"])
        self.assertNotEqual(sig["clean_seller_note"], "")

        # 2. Shipping policy & multi-LP bundle savings (deterministic rows + live structural invariants)
        flat_pol = builder.parse_shipping_policy(
            [7.5, 7.5, 7.5],
            ["$7.50 flat rate shipping for UNLIMITED ITEMS to the USA"],
            3,
        )
        self.assertEqual(flat_pol["policy_type"], "FLAT_UNLIMITED")
        self.assertTrue(flat_pol["confirmed_policy"])
        self.assertAlmostEqual(flat_pol["bundled_shipping_usd"], 7.50, places=2)

        free_pol = builder.parse_shipping_policy([0.0, 0.0], ["Free US shipping"], 2)
        self.assertEqual(free_pol["policy_type"], "FREE_SHIPPING")
        self.assertAlmostEqual(free_pol["bundled_shipping_usd"], 0.0, places=2)

        def _make_bundle_row(idx: int, seller: str, rid: str, list_p: float, ship_p: float, note: str = "") -> dict:
            return {
                "snapshot_order": idx,
                "id": str(4500000100 + idx),
                "release_id": rid,
                "title": f"Artist {idx} - Album {idx}",
                "artist": f"Artist {idx}",
                "album": f"Album {idx}",
                "variant": "LP, Vinyl",
                "wax_shader": {"wax_name": "LP"},
                "media_condition": "NM",
                "sleeve_condition": "NM",
                "list_price_usd": list_p,
                "shipping_price_usd": ship_p,
                "total_price_usd": round(list_p + ship_p, 2),
                "seller_info": seller,
                "allow_offers": False,
                "cover_image_url": "",
                "add_to_cart_url": f"https://www.discogs.com/sell/cart/?add={4500000100 + idx}",
                "item_url": f"https://www.discogs.com/sell/item/{4500000100 + idx}",
                "raw_description": note,
                "vault_status": "MISSING_GRAIL",
            }

        synthetic_rows = [
            _make_bundle_row(i, "recordmule", f"100{i}", 30.0, 7.5, "$7.50 flat rate shipping for UNLIMITED ITEMS")
            for i in range(1, 5)
        ] + [
            _make_bundle_row(10 + i, "QuickRecords", f"200{i}", 25.0, 6.99, "Standard Media Mail")
            for i in range(1, 6)
        ]
        synth_bundles, synth_by_seller = builder.build_seller_bundles(synthetic_rows)
        self.assertEqual(len(synth_bundles), 2)
        self.assertAlmostEqual(synth_by_seller["recordmule"]["shipping_saved_usd"], 22.50, places=2)
        self.assertEqual(synth_by_seller["quickrecords"]["item_count"], 5)
        self.assertGreater(synth_by_seller["quickrecords"]["shipping_saved_usd"], 15.0)

        state = builder.build_sniper_state(persist=False)
        for b in state["seller_bundles"]:
            self.assertGreaterEqual(b["item_count"], 2)
            self.assertAlmostEqual(
                b["bundled_total_usd"],
                round(b["solo_total_usd"] - b["shipping_saved_usd"], 2),
                places=2,
            )

        # 3. Make-Offer haggle strategy bounds & wear awareness
        sample_row = {
            "id": "4257509076",
            "title": "Bring Me The Horizon - There Is A Hell",
            "seller_info": "curefortheitch",
            "media_condition": "NM",
            "sleeve_condition": "VG+",
            "list_price_usd": 299.99,
            "shipping_price_usd": 0.0,
            "total_price_usd": 299.99,
            "relist_group_total": 1,
            "has_wear_warning": True,
            "market_stats": {
                "condition_suggested_usd": 278.50,
                "observed_median_usd": 278.50,
                "distinct_sellers_tracked": 2,
                "benchmark_verified": True,
            },
        }
        offer = builder.compute_offer_strategy(sample_row, None)
        self.assertLessEqual(offer["aggressive_offer_usd"], offer["recommended_offer_usd"])
        self.assertLessEqual(offer["recommended_offer_usd"], offer["instant_close_offer_usd"])
        self.assertLess(offer["recommended_offer_usd"], 299.99)
        self.assertIn("sleeve/jacket notes", offer["buyer_pitch"].lower())

        # 4. Clean static artifact staging excludes .env and Python files
        with tempfile.TemporaryDirectory() as tmpdir:
            stage_dir = Path(tmpdir) / "_site"
            builder.stage_pages_artifact(stage_dir)
            self.assertTrue((stage_dir / ".nojekyll").exists())
            self.assertTrue((stage_dir / "index.html").exists())
            self.assertTrue((stage_dir / "manifest.webmanifest").exists())
            self.assertTrue((stage_dir / "sw.js").exists())
            self.assertTrue((stage_dir / "data" / "sniper_state.json").exists())
            self.assertFalse((stage_dir / ".env").exists())
            self.assertFalse((stage_dir / "discogs_sniper.py").exists())
            self.assertFalse((stage_dir / "sniper.log").exists())

    def test_html_entity_decoding_and_compiled_notes_clean(self):
        import re
        import tempfile
        from unittest.mock import patch

        # 1. Recursive 7-layer entity decoding (regression for &amp;amp;amp;amp;amp;amp;#34; -> ")
        seven_layer_quote = "&amp;amp;amp;amp;amp;amp;#34;"
        self.assertEqual(builder.decode_html_entities(seven_layer_quote), '"')
        self.assertEqual(
            builder.decode_html_entities(
                f"There is a {seven_layer_quote}Made in Czech Republic{seven_layer_quote} sticker on shrink."
            ),
            'There is a "Made in Czech Republic" sticker on shrink.',
        )
        self.assertEqual(builder.decode_html_entities("&amp;amp;amp;amp;amp;amp;#39;Mint&amp;amp;quot;"), "'Mint\"")
        self.assertEqual(builder.decode_html_entities(None), "")
        self.assertEqual(builder.decode_html_entities("Plain text 100% clean"), "Plain text 100% clean")

        # 2. Zero leftover HTML entities across compiled clean_seller_note fields (snapshot-resilient)
        leftover_entity_re = re.compile(r"&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-fA-F]+);", re.IGNORECASE)
        state = builder.build_sniper_state(persist=False)
        self.assertGreater(len(state["listings"]), 0)
        for row in state["listings"]:
            note = row.get("clean_seller_note") or ""
            self.assertIsNone(
                leftover_entity_re.search(note),
                f"Leftover HTML entity in clean_seller_note for listing {row.get('id')}: {note!r}",
            )

        # 3. Decoded note content preserves RFC 8259 </ and <!-- escaping in embedded HTML script block
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_html = Path(tmpdir) / "index_entity_escape_test.html"
            decoded_payload = builder.decode_html_entities(
                "&amp;amp;amp;amp;amp;amp;#34;Made in Czech Republic&amp;amp;amp;amp;amp;amp;#34; </script><!--probe-->"
            )
            probe_state = {"clean_seller_note": decoded_payload}
            with patch.object(builder, "OUTPUT_HTML", tmp_html):
                builder.compile_static_html(probe_state, check_only=False)
            compiled = tmp_html.read_text(encoding="utf-8")
            m = re.search(
                r'<script id="sniper-prebaked-state" type="application/json">\s*(.*?)\s*</script>',
                compiled,
                flags=re.DOTALL,
            )
            self.assertIsNotNone(m)
            raw_json = m.group(1)
            self.assertIn(r"\u003c/", raw_json)
            self.assertIn(r"\u003c!--", raw_json)
            self.assertNotIn("</script>", raw_json)
            self.assertNotIn("<!--", raw_json)
            parsed = json.loads(raw_json)
            self.assertEqual(parsed["clean_seller_note"], decoded_payload)
            self.assertIn('"Made in Czech Republic"', parsed["clean_seller_note"])

    def test_v6_obsidian_parity_markers_cookie_security_and_manifest(self):
        import re

        # 1. Compiled index.html carries discogs_collection v6.0 parity markers and zero Chakra Petch
        html_path = REPO_ROOT / "index.html"
        self.assertTrue(html_path.exists())
        html_text = html_path.read_text(encoding="utf-8")
        for marker in (
            "Space Grotesk",
            "krunked-cookie-vault-v1",
            "suite-switcher",
            "sleeve-peek-stage",
            "uv-blacklight",
        ):
            self.assertIn(marker, html_text, f"Missing v6.0 parity marker in index.html: {marker}")
        self.assertNotIn("chakra petch", html_text.lower(), "Legacy Chakra Petch font trace found in index.html")

        # 2. Shadow-cookie auto-healer script strictly denies tokens and GitHub PATs
        cookie_block = re.search(
            r'<script id="krunked-cookie-vault-v1">(.*?)</script>',
            html_text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(cookie_block, "Missing krunked-cookie-vault-v1 script block in index.html")
        cookie_js = cookie_block.group(1)
        key_re_match = re.search(r"SENSITIVE_KEY_RE\s*=\s*/([^/]+)/([a-z]*)", cookie_js)
        val_re_match = re.search(r"SENSITIVE_VALUE_RE\s*=\s*/([^/]+)/([a-z]*)", cookie_js)
        self.assertIsNotNone(key_re_match, "Missing SENSITIVE_KEY_RE deny-list in shadow-cookie script")
        self.assertIsNotNone(val_re_match, "Missing SENSITIVE_VALUE_RE deny-list in shadow-cookie script")
        key_re = re.compile(key_re_match.group(1), re.IGNORECASE if "i" in key_re_match.group(2) else 0)
        val_re = re.compile(val_re_match.group(1), re.IGNORECASE if "i" in val_re_match.group(2) else 0)
        for sensitive_key in ("krunked_discogs_token", "krunked_sniper_github_pat_v3", "api_key", "user_secret"):
            self.assertIsNotNone(key_re.search(sensitive_key), f"SENSITIVE_KEY_RE failed to block {sensitive_key}")
        for sensitive_val in ("github_pat_11ABCDEF123456", "ghp_secretTokenValue123"):
            self.assertIsNotNone(val_re.search(sensitive_val), f"SENSITIVE_VALUE_RE failed to block {sensitive_val}")

        # 3. PWA manifest.webmanifest uses canonical Obsidian v6.0 palette
        manifest = json.loads((REPO_ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest.get("theme_color"), "#06070b")
        self.assertEqual(manifest.get("background_color"), "#05060b")


if __name__ == "__main__":
    unittest.main()
