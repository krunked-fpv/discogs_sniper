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
        self.assertEqual(sniper.sanitize_username("  'krunked\n' "), "krunked")
        self.assertEqual(sniper.sanitize_username(""), "krunked")

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


if __name__ == "__main__":
    unittest.main()
