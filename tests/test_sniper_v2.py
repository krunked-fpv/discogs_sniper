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


if __name__ == "__main__":
    unittest.main()
