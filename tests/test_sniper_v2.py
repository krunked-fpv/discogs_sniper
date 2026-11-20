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
        state = builder.build_sniper_state()
        summary = state["summary"]
        self.assertEqual(summary["total_tracked_listings"], 218)
        self.assertEqual(summary["unique_deduped_offerings"], 113)
        self.assertEqual(summary["auto_relists_intercepted"], 105)
        self.assertEqual(summary["exact_owned_releases"], 10)
        self.assertEqual(summary["variant_upgrade_releases"], 9)
        self.assertEqual(summary["missing_grails_releases"], 54)

        out_html = builder.compile_static_html(state, check_only=True)
        self.assertTrue(out_html.exists())
        html_text = out_html.read_text(encoding="utf-8")
        self.assertNotIn("__INJECT_STYLES_CSS__", html_text)
        self.assertNotIn("__INJECT_SNIPER_STATE_JSON__", html_text)
        self.assertNotIn("// __INJECT_APP_JS__", html_text)
        self.assertIn("DISCOGS SNIPER", html_text)
        self.assertIn("btn-sync-live-wantlist", html_text)
        self.assertIn("vault-live-sync-status", html_text)

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

        # Live wantlist has 0 owned overlaps even though seed_snapshot.json still has 10 historical ones
        buf = io.StringIO()
        with (
            patch.object(client, "get_identity", return_value={"username": "krunked", "id": 32496351}),
            patch.object(client, "fetch_wantlist_ids", return_value=["99999991", "99999992"]),
            contextlib.redirect_stdout(buf),
        ):
            rc = sniper.run_api_diagnostics(client, token_source="test")
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("Live Discogs Wantlist   : 2 releases", out)
        self.assertIn("Exact Owned Pressings Still on Live Wantlist (0 releases):", out)
        self.assertIn("Historical Snapshot Note: 10 owned release(s) remain in seed_snapshot.json", out)

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
        import tempfile
        from unittest.mock import patch

        self.assertEqual(builder.normalize_album_key("The Way It Ends "), "the way it ends")

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_state_file = Path(tmpdir) / "sniper_state.json"
            with patch.object(builder, "SNIPER_STATE_FILE", tmp_state_file):
                state_default = builder.build_sniper_state()

                # 1. Schema version & Live Page 1 100% cover recovery + allow_offers recovery
                self.assertEqual(state_default["schema_version"], "2.1.0-beta")
                live_p1 = [x for x in state_default["listings"] if x["is_live_page1"]]
                self.assertEqual(len(live_p1), 25)
                self.assertEqual(sum(1 for x in live_p1 if not x["cover_image_url"]), 0)
                self.assertGreaterEqual(state_default["summary"]["allow_offers_count"], 10)
                self.assertEqual(state_default["summary"]["exact_owned_in_live_page1"], 0)

                # 2. Authentic benchmark: zero fabricated Mint +18% estimates; Dayseeker uses per-seller median ($38.49)
                for x in state_default["listings"]:
                    self.assertNotIn("Estimated Mint", x["market_stats"]["benchmark_source"])
                dayseeker = next(x for x in state_default["listings"] if x["release_id"] == "38857860")
                self.assertEqual(dayseeker["market_stats"]["distinct_sellers_tracked"], 3)
                self.assertAlmostEqual(dayseeker["market_stats"]["observed_median_usd"], 38.49, places=2)
                self.assertIn("3-Seller", dayseeker["market_stats"]["benchmark_source"])

                # 3. Live Wantlist sync override: 0 active overlaps -> all 10 snapshot rows marked CLEARED_FROM_WANTLIST
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
            self.assertIn("v2.1 BETA", compiled)
            self.assertIn("btn-toggle-uv", compiled)
            self.assertIn("inspect-modal-backdrop", compiled)


if __name__ == "__main__":
    unittest.main()
