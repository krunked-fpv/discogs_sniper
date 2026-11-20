(() => {
  "use strict";

  // =====================================================================
  // 1. BOOTSTRAP PRE-BAKED STATE & LOCAL CREDENTIALS
  // =====================================================================
  const stateEl = document.getElementById("sniper-prebaked-state");
  let SNIPER_STATE = {
    summary: {},
    forensics: {},
    seller_leaderboard: [],
    release_churn_leaderboard: [],
    vault_bridge: { exact_owned_on_wantlist: [], variant_upgrades_on_wantlist: [] },
    listings: [],
    config: {},
  };

  if (stateEl && stateEl.textContent.trim()) {
    try {
      SNIPER_STATE = JSON.parse(stateEl.textContent);
    } catch (err) {
      console.error("Could not parse pre-baked sniper state:", err);
    }
  }

  const STORAGE_KEYS = {
    TOKEN: "krunked_discogs_token",
    USER: "krunked_discogs_username",
    ART_CACHE: "krunked_sniper_art_cache_v2",
    CONFIG_OVERRIDES: "krunked_sniper_config_v2",
  };

  function discoverStoredToken() {
    // Check sniper keys + shared origin keys from krunked-fpv/discogs_collection
    const candidateKeys = [
      STORAGE_KEYS.TOKEN,
      "discogs_token",
      "DISCOGS_TOKEN",
      "krunked_vault_token",
    ];
    for (const k of candidateKeys) {
      try {
        const val = localStorage.getItem(k);
        if (val && val.trim().length >= 20) return val.trim();
      } catch (_) {}
    }
    return "";
  }

  let appState = {
    activeView: "radar",
    searchQuery: "",
    dedupEnabled: true,
    conditionFilter: "ALL",
    sortMode: "SNAPSHOT_ORDER",
    categoryFilter: "ALL",
    maxPriceUsd: 500,
    mutedSellers: new Set(),
    priceDropOnlySellers: new Set(["recordmule"]),
    expandedHistoryIds: new Set(),
    liveApiResults: {},
    prunedReleaseIds: new Set(),
    discogsUsername: localStorage.getItem(STORAGE_KEYS.USER) || SNIPER_STATE.discogs_username || "krunked",
    discogsToken: discoverStoredToken(),
    artCache: {},
    currentlyPlayingId: null,
  };

  try {
    const cachedArt = localStorage.getItem(STORAGE_KEYS.ART_CACHE);
    if (cachedArt) appState.artCache = JSON.parse(cachedArt) || {};
  } catch (_) {}

  function saveArtCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.ART_CACHE, JSON.stringify(appState.artCache));
    } catch (_) {}
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatUsd(val) {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) return "N/A";
    return `$${num.toFixed(2)}`;
  }

  // =====================================================================
  // 2. DETERMINISTIC COLORED-VINYL SVG PLATTER & SLEEVE FALLBACK
  // =====================================================================
  function renderFallbackSleeveDataUri(artist, album, primaryColor) {
    const initials = `${(artist || "D")[0] || "D"}${(album || "S")[0] || "S"}`.toUpperCase();
    const accent = primaryColor && primaryColor !== "#181a1f" ? primaryColor : "#f59e0b";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#171a21"/>
          <stop offset="100%" stop-color="#0b0d11"/>
        </linearGradient>
      </defs>
      <rect width="160" height="160" fill="url(#g)"/>
      <circle cx="80" cy="80" r="56" fill="none" stroke="${accent}" stroke-opacity="0.22" stroke-width="1.5"/>
      <circle cx="80" cy="80" r="40" fill="none" stroke="${accent}" stroke-opacity="0.15" stroke-width="1"/>
      <text x="80" y="88" text-anchor="middle" fill="${accent}" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="28" letter-spacing="2">${escapeHtml(initials)}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function renderVinylDiscSVG(wax, uid) {
    const w = wax || { pattern: "solid", primary: "#181a1f", secondary: "#0d0f12", accent: "#f59e0b" };
    const p = w.primary || "#181a1f";
    const s = w.secondary || "#0d0f12";
    const a = w.accent || "#f59e0b";
    const pattern = w.pattern || "solid";

    let patternOverlay = "";
    if (pattern === "splatter") {
      patternOverlay = `
        <g opacity="0.88">
          <line x1="50" y1="50" x2="14" y2="22" stroke="${a}" stroke-width="2.4" stroke-linecap="round"/>
          <line x1="50" y1="50" x2="86" y2="26" stroke="${s}" stroke-width="2.8" stroke-linecap="round"/>
          <line x1="50" y1="50" x2="82" y2="78" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="50" y1="50" x2="20" y2="75" stroke="${s}" stroke-width="2.6" stroke-linecap="round"/>
          <line x1="50" y1="50" x2="50" y2="10" stroke="${a}" stroke-width="2" stroke-linecap="round"/>
          <circle cx="26" cy="34" r="2.3" fill="${a}"/>
          <circle cx="72" cy="30" r="2.6" fill="${a}"/>
          <circle cx="70" cy="68" r="2.2" fill="${s}"/>
          <circle cx="30" cy="66" r="2.5" fill="${a}"/>
          <circle cx="52" cy="82" r="2.0" fill="${s}"/>
        </g>`;
    } else if (pattern === "split") {
      patternOverlay = `
        <path d="M 50,4 A 46,46 0 0,1 50,96 Z" fill="${s}" opacity="0.92"/>`;
    } else if (pattern === "marble" || pattern === "smoke") {
      patternOverlay = `
        <circle cx="50" cy="50" r="34" fill="none" stroke="${s}" stroke-width="10" stroke-dasharray="28 18" opacity="0.55"/>
        <circle cx="50" cy="50" r="24" fill="none" stroke="${a}" stroke-width="6" stroke-dasharray="16 24" opacity="0.4"/>`;
    } else if (pattern === "translucent") {
      patternOverlay = `
        <circle cx="50" cy="50" r="44" fill="${a}" opacity="0.16"/>`;
    }

    return `<svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true">
      <defs>
        <radialGradient id="wax-${uid}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="${p}"/>
          <stop offset="70%" stop-color="${p}"/>
          <stop offset="100%" stop-color="${s}"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#wax-${uid})" stroke="#07080a" stroke-width="1.5"/>
      ${patternOverlay}
      <circle cx="50" cy="50" r="41" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="35" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="29" fill="none" stroke="#ffffff" stroke-opacity="0.11" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="23" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="16" fill="#12151b" stroke="${a}" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="10" fill="${a}" opacity="0.85"/>
      <circle cx="50" cy="50" r="3.2" fill="#060709"/>
    </svg>`;
  }

  // =====================================================================
  // 3. TOP KPI & NAVIGATION INITIALIZATION
  // =====================================================================
  function renderTopKPIs() {
    const s = SNIPER_STATE.summary || {};
    const f = SNIPER_STATE.forensics || {};

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.textContent = val;
    };

    setTxt("kpi-unique-offerings", s.unique_deduped_offerings ?? 113);
    setTxt("kpi-raw-total-badge", `from ${s.total_tracked_listings ?? 218} raw`);
    setTxt("kpi-distinct-releases-sub", `Across ${s.distinct_releases ?? 73} distinct Wantlist pressings`);

    setTxt("kpi-relists-intercepted", s.auto_relists_intercepted ?? 105);
    setTxt("kpi-spam-pct-badge", `-${s.spam_reduction_pct ?? 48.2}% Noise`);
    setTxt(
      "kpi-recordmule-sub",
      `recordmule accounts for ${s.recordmule_listings ?? 99}/${s.total_tracked_listings ?? 218} (${s.recordmule_share_pct ?? 45.4}%)`
    );

    setTxt("kpi-missing-grails", s.missing_grails_releases ?? 54);
    setTxt("kpi-owned-overlap-badge", `${s.exact_owned_releases ?? 10} Already Owned`);
    setTxt(
      "kpi-vault-sub",
      `${s.missing_grails_releases ?? 54} Missing Grails • ${s.variant_upgrade_releases ?? 9} Variants • ${s.vault_total_owned_lps ?? 159} Vault LPs`
    );

    setTxt("kpi-total-checks", Number(f.total_checks ?? 5632).toLocaleString());
    setTxt("kpi-uptime-badge", `${f.hydration_success_rate_pct ?? 98.8}% Hydrated`);
    setTxt(
      "kpi-alerts-sent-sub",
      `${f.total_alerts_sent ?? 225} Priority Alerts • Dual-Trigger Fixed (288/day)`
    );

    setTxt("nav-count-radar", appState.dedupEnabled ? (s.unique_deduped_offerings ?? 113) : (s.total_tracked_listings ?? 218));
    setTxt("nav-count-forensics", `${s.spam_reduction_pct ?? 48}% Spam`);
    setTxt("nav-count-vault", `${(s.exact_owned_releases ?? 10) + (s.variant_upgrade_releases ?? 9)} Overlaps`);
    setTxt("dedup-status-chip", appState.dedupEnabled ? `ON (-${s.auto_relists_intercepted ?? 105})` : "OFF (Raw 218)");
  }

  function updateApiConnectionStatusUI() {
    const dot = document.getElementById("api-connection-dot");
    const lbl = document.getElementById("api-connection-label");
    const tokenInput = document.getElementById("input-discogs-token");
    const userInput = document.getElementById("input-discogs-username");

    if (userInput) userInput.value = appState.discogsUsername;
    if (tokenInput && appState.discogsToken) tokenInput.value = appState.discogsToken;

    if (appState.discogsToken) {
      if (dot) dot.classList.add("connected");
      if (lbl) lbl.textContent = `API Active (@${appState.discogsUsername})`;
    } else {
      if (dot) dot.classList.remove("connected");
      if (lbl) lbl.textContent = "Connect Discogs API";
    }
  }

  // =====================================================================
  // 4. FILTERING, SORTING & LIVE DROP RADAR RENDERER
  // =====================================================================
  function passesConditionGrade(mediaCond, minGrade) {
    if (minGrade === "ALL") return true;
    const rankMap = { M: 4, NM: 3, "M-": 3, "VG+": 2, VG: 1 };
    const itemRank = rankMap[(mediaCond || "").toUpperCase()] ?? 2;
    const reqRank = rankMap[minGrade] ?? 1;
    return itemRank >= reqRank;
  }

  function getFilteredListings() {
    const all = SNIPER_STATE.listings || [];

    // Base pool after dedup toggle & muted sellers
    const basePool = all.filter((item) => {
      if (appState.dedupEnabled && !item.is_latest_in_group) return false;
      const sellerLow = (item.seller_info || "").toLowerCase();
      if (appState.mutedSellers.has(sellerLow)) return false;
      if (appState.prunedReleaseIds.has(item.release_id)) return false;
      if (!passesConditionGrade(item.media_condition, appState.conditionFilter)) return false;
      if (appState.maxPriceUsd < 500 && item.total_price_usd > appState.maxPriceUsd) return false;

      if (appState.searchQuery) {
        const q = appState.searchQuery.toLowerCase();
        const hay = `${item.title} ${item.variant} ${item.seller_info} ${item.id} ${item.release_id} ${item.raw_description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Update filter pill counts based on current basePool
    const counts = {
      ALL: basePool.length,
      MISSING_GRAIL: basePool.filter((x) => x.vault_status === "MISSING_GRAIL").length,
      STEALS: basePool.filter((x) => x.deal_tier === "STEAL" || x.deal_tier === "GREAT_DEAL" || x.deal_delta_pct < 0).length,
      PRICE_DROP: basePool.filter((x) => x.is_price_drop).length,
      VARIANT_UPGRADE: basePool.filter((x) => x.vault_status === "VARIANT_UPGRADE").length,
      ALREADY_OWNED: basePool.filter((x) => x.vault_status === "ALREADY_OWNED").length,
    };

    const setCnt = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `(${n})`;
    };
    setCnt("pill-cnt-all", counts.ALL);
    setCnt("pill-cnt-grails", counts.MISSING_GRAIL);
    setCnt("pill-cnt-steals", counts.STEALS);
    setCnt("pill-cnt-pricedrop", counts.PRICE_DROP);
    setCnt("pill-cnt-variants", counts.VARIANT_UPGRADE);
    setCnt("pill-cnt-owned", counts.ALREADY_OWNED);

    // Apply category pill filter
    const filtered = basePool.filter((item) => {
      switch (appState.categoryFilter) {
        case "MISSING_GRAIL":
          return item.vault_status === "MISSING_GRAIL";
        case "STEALS":
          return item.deal_tier === "STEAL" || item.deal_tier === "GREAT_DEAL" || item.deal_delta_pct < 0;
        case "PRICE_DROP":
          return item.is_price_drop;
        case "VARIANT_UPGRADE":
          return item.vault_status === "VARIANT_UPGRADE";
        case "ALREADY_OWNED":
          return item.vault_status === "ALREADY_OWNED";
        case "HIDE_RECORDMULE":
          return (item.seller_info || "").toLowerCase() !== "recordmule";
        default:
          return true;
      }
    });

    // Sort
    filtered.sort((a, b) => {
      switch (appState.sortMode) {
        case "DEAL_SCORE":
          return (b.deal_score - a.deal_score) || (a.deal_delta_pct - b.deal_delta_pct);
        case "PRICE_ASC":
          return a.total_price_usd - b.total_price_usd;
        case "PRICE_DESC":
          return b.total_price_usd - a.total_price_usd;
        case "MOST_RELISTED":
          return (b.relist_group_total - a.relist_group_total) || (a.snapshot_order - b.snapshot_order);
        default:
          return a.snapshot_order - b.snapshot_order;
      }
    });

    return filtered;
  }

  function renderVaultStatusPill(item) {
    if (item.vault_status === "ALREADY_OWNED") {
      return `<span class="tag-pill badge-crimson" title="You already own this exact release_id (#${escapeHtml(item.release_id)}) in your Discogs Collection Vault!">✅ IN COLLECTION VAULT</span>`;
    }
    if (item.vault_status === "VARIANT_UPGRADE") {
      const ownedFmt = item.vault_owned_detail ? item.vault_owned_detail.format_string : "Another pressing";
      return `<span class="tag-pill badge-cyan" title="You own another pressing of this album: ${escapeHtml(ownedFmt)}">🌈 VARIANT HUNTER</span>`;
    }
    return `<span class="tag-pill badge-emerald">🎯 MISSING GRAIL</span>`;
  }

  function renderDealAndRelistPills(item) {
    const pills = [];
    if (item.is_price_drop) {
      pills.push(
        `<span class="tag-pill badge-emerald" title="Seller lowered price from $${item.group_highest_price_usd.toFixed(2)}">📉 PRICE DROP (-$${item.price_drop_usd.toFixed(2)})</span>`
      );
    } else if (item.deal_delta_pct <= -10) {
      pills.push(`<span class="tag-pill badge-emerald">🔥 ${item.deal_delta_pct.toFixed(0)}% vs ${escapeHtml(item.media_condition)}</span>`);
    } else if (item.deal_delta_pct < 0) {
      pills.push(`<span class="tag-pill badge-emerald">💎 ${item.deal_delta_pct.toFixed(0)}% Below Benchmark</span>`);
    }

    if (item.relist_group_total > 1) {
      pills.push(
        `<button type="button" class="tag-pill badge-amber btn-toggle-relist-history" data-id="${escapeHtml(item.id)}" style="border:none;cursor:pointer;" title="Click to inspect all ${item.relist_group_total} relist IDs from ${escapeHtml(item.seller_info)}">
          🔁 ${item.relist_group_total}x Relists ▾
        </button>`
      );
    }
    return pills.join("");
  }

  function renderDropCard(item) {
    const coverSrc =
      item.cover_image_url ||
      appState.artCache[item.release_id] ||
      appState.artCache[item.norm_album_key] ||
      renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary);

    const needsHydration = !item.cover_image_url && !appState.artCache[item.release_id] && !appState.artCache[item.norm_album_key];
    const isPlaying = appState.currentlyPlayingId === item.id;
    const mkt = item.market_stats || {};
    const liveResult = appState.liveApiResults[item.id];
    const historyOpen = appState.expandedHistoryIds.has(item.id);

    let historyDrawerHtml = "";
    if (historyOpen && item.sibling_history && item.sibling_history.length > 1) {
      const rowsHtml = item.sibling_history
        .map(
          (h, idx) => `
          <div class="history-row">
            <span>#${idx + 1} • <a href="${escapeHtml(h.item_url)}" target="_blank" rel="noopener" style="color:var(--accent-amber);">Listing #${escapeHtml(h.id)} ↗</a></span>
            <span>${escapeHtml(h.total_price)}</span>
            <span style="color:var(--text-muted);">${escapeHtml((h.alerted_at || "").replace("T", " "))}</span>
          </div>`
        )
        .join("");
      historyDrawerHtml = `
        <div class="relist-history-drawer">
          <div style="display:flex;justify-content:space-between;color:var(--accent-amber);font-weight:600;">
            <span>Relist Audit Trail (${item.relist_group_total}x by ${escapeHtml(item.seller_info)})</span>
            <span>Range: ${formatUsd(item.group_lowest_price_usd)} – ${formatUsd(item.group_highest_price_usd)}</span>
          </div>
          <div class="history-list">${rowsHtml}</div>
        </div>`;
    }

    let liveApiDrawerHtml = "";
    if (liveResult) {
      if (liveResult.loading) {
        liveApiDrawerHtml = `<div class="live-api-drawer" style="color:var(--accent-amber);">⚡ Querying api.discogs.com for Listing #${escapeHtml(item.id)} &amp; Release #${escapeHtml(item.release_id)}...</div>`;
      } else if (liveResult.error) {
        liveApiDrawerHtml = `<div class="live-api-drawer" style="color:var(--accent-crimson);">⚠️ ${escapeHtml(liveResult.error)}</div>`;
      } else {
        const statusBadge =
          liveResult.status === "For Sale"
            ? `<span class="kpi-badge badge-emerald">🟢 STILL FOR SALE</span>`
            : `<span class="kpi-badge badge-crimson">🔴 ${escapeHtml(liveResult.status || "SOLD / REMOVED")}</span>`;
        const offerBadge = liveResult.allow_offers ? `<span class="kpi-badge badge-amber">💬 Make Offer Enabled</span>` : "";
        liveApiDrawerHtml = `
          <div class="live-api-drawer">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
              <strong>Official Discogs API Live Telemetry</strong>
              <div>${statusBadge} ${offerBadge}</div>
            </div>
            <div>• <strong>Live Release Stats:</strong> ${liveResult.num_for_sale ?? "?"} copies for sale (Lowest: ${escapeHtml(liveResult.lowest_price_str || "N/A")})</div>
            <div>• <strong>Condition Suggested (${escapeHtml(item.media_condition)}):</strong> ${escapeHtml(liveResult.suggested_str || mkt.condition_suggested_formatted || "Connect Token")}</div>
            <div>• <strong>Community Demand:</strong> ${liveResult.want ?? "?"} Want / ${liveResult.have ?? "?"} Have ${liveResult.seller_rating ? `• Seller: ${escapeHtml(liveResult.seller_rating)}` : ""}</div>
          </div>`;
      }
    }

    return `
      <article class="drop-card" data-listing-id="${escapeHtml(item.id)}" data-release-id="${escapeHtml(item.release_id)}" data-artist="${escapeHtml(item.artist)}" data-album="${escapeHtml(item.album)}">
        <div class="drop-card-top">
          <div class="status-pills">
            ${renderVaultStatusPill(item)}
            ${renderDealAndRelistPills(item)}
          </div>
          <span class="listing-id-label">#${escapeHtml(item.id)}</span>
        </div>

        <div class="drop-card-Hero">
          <div class="artwork-stage">
            <div class="sleeve-frame">
              <img
                src="${escapeHtml(coverSrc)}"
                alt="${escapeHtml(item.title)}"
                class="sleeve-img ${needsHydration ? "needs-art-hydration" : ""}"
                loading="lazy"
                data-release-id="${escapeHtml(item.release_id)}"
                data-norm-key="${escapeHtml(item.norm_album_key)}"
                data-artist="${escapeHtml(item.artist)}"
                data-album="${escapeHtml(item.album)}"
              />
            </div>
            <div class="vinyl-platter-wrap ${isPlaying ? "spinning" : ""}" id="platter-${escapeHtml(item.id)}">
              ${renderVinylDiscSVG(item.wax_shader, item.id)}
            </div>
          </div>

          <div class="drop-meta">
            <div class="drop-artist">${escapeHtml(item.artist)}</div>
            <h2 class="drop-album" title="${escapeHtml(item.album)}">${escapeHtml(item.album)}</h2>
            <div class="drop-variant" title="${escapeHtml(item.variant)}">
              💿 ${escapeHtml(item.wax_shader?.wax_name || item.variant)}
            </div>
          </div>
        </div>

        <div class="price-matrix">
          <div class="matrix-cell">
            <span class="matrix-label">Total Shipped</span>
            <span class="matrix-val" style="color:var(--accent-emerald);">${escapeHtml(item.total_price)}</span>
            <span class="matrix-sub">${escapeHtml(item.list_price)} + ${formatUsd(item.shipping_price_usd)} ship</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">Benchmark (${escapeHtml(item.media_condition)})</span>
            <span class="matrix-val">${escapeHtml(mkt.condition_suggested_formatted || "N/A")}</span>
            <span class="matrix-sub">Low ${formatUsd(mkt.observed_low_usd)} / High ${formatUsd(mkt.observed_high_usd)}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">Media / Sleeve</span>
            <span class="matrix-val">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</span>
            <span class="matrix-sub">Score: ${item.deal_score}/100</span>
          </div>
        </div>

        <div class="seller-strip">
          <div>
            Seller: <a href="https://www.discogs.com/seller/${encodeURIComponent(item.seller_info)}/profile" target="_blank" rel="noopener" class="seller-link">${escapeHtml(item.seller_info)}</a>
            <button type="button" class="mute-seller-inline" data-mute-seller="${escapeHtml(item.seller_info)}" title="Mute all listings from ${escapeHtml(item.seller_info)}">Mute</button>
          </div>
          <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
            ${escapeHtml((item.alerted_at || "").replace("T", " ").slice(0, 16) || item.listed_age)}
          </span>
        </div>

        ${item.raw_description ? `<div class="seller-notes" title="${escapeHtml(item.raw_description)}">${escapeHtml(item.raw_description)}</div>` : ""}

        ${historyDrawerHtml}
        ${liveApiDrawerHtml}

        <div class="card-actions">
          <a href="${escapeHtml(item.add_to_cart_url)}" target="_blank" rel="noopener" class="btn-action btn-cart" title="1-Click Add to Discogs Cart">
            🛒 1-Click Cart (${escapeHtml(item.total_price)})
          </a>
          <a href="${escapeHtml(item.item_url)}" target="_blank" rel="noopener" class="btn-action" title="Open Discogs Listing #${escapeHtml(item.id)}">
            🔎 Listing
          </a>
          <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}" title="Play 30-second studio audio preview">
            ${isPlaying ? "⏹ Stop" : "🎧 30s"}
          </button>
          <button type="button" class="btn-action" data-live-api-id="${escapeHtml(item.id)}" title="Verify live availability &amp; Discogs API stats">
            ⚡ Live API
          </button>
        </div>
      </article>
    `;
  }

  function renderRadarGrid() {
    const grid = document.getElementById("radar-drops-grid");
    const summaryEl = document.getElementById("radar-showing-summary");
    const mutedBar = document.getElementById("radar-muted-sellers-bar");
    if (!grid) return;

    const filtered = getFilteredListings();
    if (summaryEl) {
      summaryEl.textContent = `Showing ${filtered.length} ${appState.dedupEnabled ? "unique deduplicated offerings" : "raw tracked listings"} (of ${SNIPER_STATE.listings?.length || 218} total in seed_snapshot.json)`;
    }

    if (mutedBar) {
      if (appState.mutedSellers.size > 0) {
        const names = Array.from(appState.mutedSellers).join(", ");
        mutedBar.innerHTML = `Muted sellers: <strong>${escapeHtml(names)}</strong> <button type="button" id="btn-clear-muted" class="mute-seller-inline" style="margin-left:6px;">Unmute All</button>`;
        const clearBtn = document.getElementById("btn-clear-muted");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            appState.mutedSellers.clear();
            syncRuleInputsFromState();
            renderRadarGrid();
            renderForensicsView();
          });
        }
      } else {
        mutedBar.innerHTML = "";
      }
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="panel-card" style="grid-column: 1 / -1; text-align: center; padding: 48px 20px;">
          <h3 style="font-family: var(--font-display); font-size: 1.15rem; margin-bottom: 8px;">No Wantlist Drops Match Current Filters</h3>
          <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 16px;">Try clearing your search query, expanding the price slider, or resetting category filters.</p>
          <button type="button" class="btn-action btn-primary-amber" id="btn-reset-all-filters">Reset Filters</button>
        </div>`;
      const resetBtn = document.getElementById("btn-reset-all-filters");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          appState.searchQuery = "";
          appState.categoryFilter = "ALL";
          appState.conditionFilter = "ALL";
          appState.maxPriceUsd = 500;
          const sInput = document.getElementById("radar-search-input");
          if (sInput) sInput.value = "";
          document.querySelectorAll(".filter-pill").forEach((b) => b.classList.toggle("active", b.dataset.filter === "ALL"));
          renderRadarGrid();
        });
      }
      return;
    }

    grid.innerHTML = filtered.map(renderDropCard).join("");
    observeCoverArtHydration();
  }

  // =====================================================================
  // 5. LAZY CLIENT-SIDE ALBUM ART HYDRATION (iTunes + Discogs API)
  // =====================================================================
  let artObserver = null;
  const inflightArtQueries = new Set();

  function fetchItunesCoverArt(artist, album) {
    const cleanTerm = `${artist} ${album}`.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTerm)}&entity=album&limit=1`;
    return fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.results && data.results.length > 0) {
          const art100 = data.results[0].artworkUrl100;
          if (art100) return art100.replace("100x100bb", "600x600bb");
        }
        return "";
      })
      .catch(() => "");
  }

  function observeCoverArtHydration() {
    if (!("IntersectionObserver" in window)) return;
    if (artObserver) artObserver.disconnect();

    artObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          artObserver.unobserve(img);
          const normKey = img.dataset.normKey;
          const artist = img.dataset.artist;
          const album = img.dataset.album;
          if (!normKey || appState.artCache[normKey] || inflightArtQueries.has(normKey)) return;

          inflightArtQueries.add(normKey);
          fetchItunesCoverArt(artist, album).then((artUrl) => {
            if (artUrl) {
              appState.artCache[normKey] = artUrl;
              saveArtCache();
              document.querySelectorAll(`img[data-norm-key="${CSS.escape(normKey)}"]`).forEach((el) => {
                el.src = artUrl;
                el.classList.remove("needs-art-hydration");
              });
            }
          });
        });
      },
      { rootMargin: "240px" }
    );

    document.querySelectorAll("img.needs-art-hydration").forEach((img) => artObserver.observe(img));
  }

  // =====================================================================
  // 6. 30-SECOND STUDIO AUDIO PREVIEW ENGINE (iTunes + Deezer JSONP)
  // =====================================================================
  function fetchDeezerJsonpPreview(query) {
    return new Promise((resolve) => {
      const cbName = `dz_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 4500);

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (data) => {
        cleanup();
        const hit = data && data.data && data.data.find((t) => t.preview);
        resolve(hit ? { previewUrl: hit.preview, trackName: hit.title, artistName: hit.artist?.name } : null);
      };

      script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=3&output=jsonp&callback=${cbName}`;
      script.onerror = () => {
        cleanup();
        resolve(null);
      };
      document.body.appendChild(script);
    });
  }

  async function auditionListing(listingId) {
    const audio = document.getElementById("sniper-preview-audio");
    const bar = document.getElementById("audio-transport-bar");
    const titleEl = document.getElementById("audio-player-title");
    const subEl = document.getElementById("audio-player-sub");
    const thumbEl = document.getElementById("audio-player-thumb");
    const cartBtn = document.getElementById("audio-player-cart-btn");

    if (!audio || !bar) return;

    if (appState.currentlyPlayingId === listingId) {
      audio.pause();
      appState.currentlyPlayingId = null;
      bar.classList.remove("visible");
      renderRadarGrid();
      return;
    }

    const item = (SNIPER_STATE.listings || []).find((x) => x.id === listingId);
    if (!item) return;

    appState.currentlyPlayingId = listingId;
    bar.classList.add("visible");
    if (titleEl) titleEl.textContent = `${item.artist} — ${item.album}`;
    if (subEl) subEl.textContent = "Resolving 30s studio master preview...";
    if (thumbEl) {
      thumbEl.src =
        item.cover_image_url ||
        appState.artCache[item.norm_album_key] ||
        renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary);
    }
    if (cartBtn) {
      cartBtn.href = item.add_to_cart_url;
      cartBtn.textContent = `🛒 1-Click Cart (${item.total_price})`;
    }
    renderRadarGrid();

    const cleanQuery = `${item.artist} ${item.album}`.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    let previewInfo = null;

    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=5`);
      if (res.ok) {
        const data = await res.json();
        const track = (data.results || []).find((t) => t.previewUrl);
        if (track) {
          previewInfo = {
            previewUrl: track.previewUrl,
            trackName: track.trackName,
            artistName: track.artistName,
            artwork: track.artworkUrl100 ? track.artworkUrl100.replace("100x100bb", "600x600bb") : "",
            source: "iTunes Studio Preview",
          };
        }
      }
    } catch (_) {}

    if (!previewInfo) {
      const dz = await fetchDeezerJsonpPreview(cleanQuery);
      if (dz) {
        previewInfo = { ...dz, source: "Deezer Studio Preview" };
      }
    }

    if (!previewInfo || !previewInfo.previewUrl) {
      if (subEl) subEl.textContent = "Preview unavailable for this release — click Listing to inspect on Discogs";
      return;
    }

    if (previewInfo.artwork && !appState.artCache[item.norm_album_key]) {
      appState.artCache[item.norm_album_key] = previewInfo.artwork;
      saveArtCache();
      if (thumbEl) thumbEl.src = previewInfo.artwork;
    }

    if (titleEl) titleEl.textContent = `${previewInfo.artistName || item.artist} — "${previewInfo.trackName}"`;
    if (subEl) subEl.textContent = `${previewInfo.source} • ${item.variant} (${item.total_price})`;
    audio.src = previewInfo.previewUrl;
    audio.play().catch(() => {});
  }

  // =====================================================================
  // 7. LIVE BROWSER-SIDE OFFICIAL DISCOGS API v2.0 QUERIES
  // =====================================================================
  async function discogsApiFetch(path) {
    const headers = {
      Accept: "application/vnd.discogs.v2.discogs+json",
    };
    if (appState.discogsToken) {
      headers["Authorization"] = `Discogs token=${appState.discogsToken}`;
    }
    const resp = await fetch(`https://api.discogs.com${path}`, { headers });
    if (!resp.ok) {
      throw new Error(`Discogs API HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async function verifyLiveListingViaAPI(listingId) {
    const item = (SNIPER_STATE.listings || []).find((x) => x.id === listingId);
    if (!item) return;

    appState.liveApiResults[listingId] = { loading: true };
    renderRadarGrid();

    const result = { loading: false };
    try {
      const [listingData, statsData, suggData] = await Promise.all([
        discogsApiFetch(`/marketplace/listings/${encodeURIComponent(listingId)}?curr_abbr=USD`).catch(() => null),
        item.release_id && item.release_id !== "unknown"
          ? discogsApiFetch(`/marketplace/stats/${encodeURIComponent(item.release_id)}?curr_abbr=USD`).catch(() => null)
          : Promise.resolve(null),
        appState.discogsToken && item.release_id && item.release_id !== "unknown"
          ? discogsApiFetch(`/marketplace/price_suggestions/${encodeURIComponent(item.release_id)}`).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!listingData && !statsData) {
        throw new Error("Could not reach api.discogs.com (connect DISCOGS_TOKEN in API & Sniper Rules tab).");
      }

      if (listingData) {
        result.status = listingData.status || "For Sale";
        result.allow_offers = Boolean(listingData.allow_offers);
        result.seller_rating = listingData.seller?.stats?.rating ? `${listingData.seller.stats.rating}% (${listingData.seller.stats.total || 0})` : "";
        const comm = listingData.release?.stats?.community;
        if (comm) {
          result.want = comm.in_wantlist;
          result.have = comm.in_collection;
        }
        const img = listingData.release?.images?.[0]?.uri || listingData.release?.thumbnail;
        if (img) {
          appState.artCache[item.norm_album_key] = img;
          saveArtCache();
        }
      } else {
        result.status = "Removed / Sold (404)";
      }

      if (statsData) {
        result.num_for_sale = statsData.num_for_sale;
        const lp = statsData.lowest_price?.value ?? statsData.lowest_price;
        if (lp !== undefined && lp !== null) {
          result.lowest_price_str = `$${Number(lp).toFixed(2)}`;
        }
      }

      if (suggData) {
        const gradeKey = item.media_condition_full || "Near Mint (NM or M-)";
        const suggObj = suggData[gradeKey] || suggData["Near Mint (NM or M-)"];
        if (suggObj && suggObj.value !== undefined) {
          result.suggested_str = `$${Number(suggObj.value).toFixed(2)} (Official API)`;
        }
      }
    } catch (err) {
      result.error = err.message || "Discogs API query failed.";
    }

    appState.liveApiResults[listingId] = result;
    renderRadarGrid();
  }

  // =====================================================================
  // 8. VIEW 2: RELIST FORENSICS & CHARTS
  // =====================================================================
  function renderForensicsView() {
    const f = SNIPER_STATE.forensics || {};
    const hourlyContainer = document.getElementById("chart-hourly-alerts");
    if (hourlyContainer && f.alerts_by_hour) {
      const entries = Object.entries(f.alerts_by_hour).sort(([a], [b]) => a.localeCompare(b));
      const maxVal = Math.max(1, ...entries.map(([, v]) => Number(v)));
      hourlyContainer.innerHTML = entries
        .map(([hr, cnt]) => {
          const pct = Math.round((Number(cnt) / maxVal) * 100);
          const isRelistSpike = hr === "12" || hr === "13" || hr === "01";
          return `
            <div class="bar-col" title="${hr}:00 — ${cnt} priority alerts dispatched">
              <span class="bar-val">${cnt > 0 ? cnt : ""}</span>
              <div class="bar-fill ${isRelistSpike ? "anomaly" : ""}" style="height: ${Math.max(4, pct)}%;"></div>
              <span class="bar-lbl">${hr}h</span>
            </div>`;
        })
        .join("");
    }

    const dailyContainer = document.getElementById("chart-daily-checks");
    if (dailyContainer && f.checks_by_day) {
      const entries = Object.entries(f.checks_by_day).sort(([a], [b]) => a.localeCompare(b));
      const maxVal = Math.max(1, ...entries.map(([, v]) => Number(v)));
      dailyContainer.innerHTML = entries
        .map(([day, cnt]) => {
          const pct = Math.round((Number(cnt) / maxVal) * 100);
          const isDoubleBug = Number(cnt) > 320;
          const shortDay = day.slice(5);
          return `
            <div class="bar-col" title="${day}: ${cnt} runs (${isDoubleBug ? "576/day Dual-Trigger Bug" : "288/day Normal 5-Min Clock"})">
              <span class="bar-val">${cnt}</span>
              <div class="bar-fill ${isDoubleBug ? "anomaly" : "clean"}" style="height: ${Math.max(6, pct)}%;"></div>
              <span class="bar-lbl">${shortDay}</span>
            </div>`;
        })
        .join("");
    }

    const sellersTbody = document.getElementById("tbody-seller-leaderboard");
    const sellersCountBadge = document.getElementById("forensics-sellers-count");
    const sellers = SNIPER_STATE.seller_leaderboard || [];
    if (sellersCountBadge) sellersCountBadge.textContent = `${sellers.length} Sellers`;

    if (sellersTbody) {
      sellersTbody.innerHTML = sellers
        .slice(0, 18)
        .map((s) => {
          const sLow = s.seller.toLowerCase();
          const isMuted = appState.mutedSellers.has(sLow);
          const clsBadge =
            s.classification === "AUTO-RELIST BOT"
              ? "badge-crimson"
              : s.classification === "HIGH-VOLUME DEALER"
              ? "badge-amber"
              : "badge-emerald";
          return `
            <tr>
              <td>
                <a href="${escapeHtml(s.seller_url)}" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-weight:700;color:var(--text-primary);">${escapeHtml(s.seller)} ↗</a>
                <div style="font-size:0.72rem;color:var(--text-muted);">${s.share_of_snapshot_pct}% of all notifications</div>
              </td>
              <td style="font-family:var(--font-mono);font-weight:700;">${s.total_listings}</td>
              <td style="font-family:var(--font-mono);">${s.unique_releases}</td>
              <td style="font-family:var(--font-mono);color:var(--accent-amber);">${s.auto_relists} (${s.relist_rate_pct}%)</td>
              <td style="font-family:var(--font-mono);">${formatUsd(s.min_price_usd)} / ${formatUsd(s.avg_price_usd)}</td>
              <td><span class="kpi-badge ${clsBadge}">${escapeHtml(s.classification)}</span></td>
              <td>
                <button type="button" class="btn-action" data-toggle-mute-seller="${escapeHtml(s.seller)}" style="padding:5px 10px;font-size:0.74rem;">
                  ${isMuted ? "🔊 Unmute" : "🔇 Mute Seller"}
                </button>
              </td>
            </tr>`;
        })
        .join("");
    }

    const churnTbody = document.getElementById("tbody-release-churn");
    const churn = SNIPER_STATE.release_churn_leaderboard || [];
    if (churnTbody) {
      churnTbody.innerHTML = churn
        .map((r) => {
          const vBadge =
            r.vault_status === "ALREADY_OWNED"
              ? `<span class="kpi-badge badge-crimson">✅ Owned</span>`
              : r.vault_status === "VARIANT_UPGRADE"
              ? `<span class="kpi-badge badge-cyan">🌈 Variant</span>`
              : `<span class="kpi-badge badge-emerald">🎯 Grail</span>`;
          return `
            <tr>
              <td>
                <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;color:var(--text-primary);">${escapeHtml(r.title)} ↗</a>
                <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(r.variant)}</div>
              </td>
              <td style="font-family:var(--font-mono);font-weight:700;color:var(--accent-amber);">${r.total_listings}x</td>
              <td style="font-family:var(--font-mono);">${r.unique_sellers}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(r.top_seller)} (${r.top_seller_count}x)</td>
              <td style="font-family:var(--font-mono);">${formatUsd(r.lowest_price_usd)} – ${formatUsd(r.highest_price_usd)}</td>
              <td>${vBadge}</td>
            </tr>`;
        })
        .join("");
    }
  }

  // =====================================================================
  // 9. VIEW 3: COLLECTION VAULT CROSS-CHECK & 1-CLICK WANTLIST PRUNER
  // =====================================================================
  async function pruneReleaseFromWantlistAPI(releaseId, title) {
    if (!appState.discogsToken) {
      alert(
        `To delete Release #${releaseId} (${title}) directly from your Discogs Wantlist in the browser, paste your DISCOGS_TOKEN in the "⚙️ API & Sniper Rules" tab first — or run:\n\npython discogs_sniper.py --prune-owned`
      );
      switchView("rules");
      return false;
    }

    try {
      const resp = await fetch(
        `https://api.discogs.com/users/${encodeURIComponent(appState.discogsUsername)}/wants/${encodeURIComponent(releaseId)}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.discogs.v2.discogs+json",
            Authorization: `Discogs token=${appState.discogsToken}`,
          },
        }
      );
      if (resp.status === 204 || resp.status === 200 || resp.status === 404) {
        appState.prunedReleaseIds.add(String(releaseId));
        renderVaultBridgeView();
        renderRadarGrid();
        return true;
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      alert(`Could not delete release #${releaseId} via Discogs API: ${err.message}`);
      return false;
    }
  }

  function renderVaultBridgeView() {
    const vb = SNIPER_STATE.vault_bridge || {};
    const exactList = vb.exact_owned_on_wantlist || [];
    const variantList = vb.variant_upgrades_on_wantlist || [];

    const exactTbody = document.getElementById("tbody-vault-exact-owned");
    if (exactTbody) {
      exactTbody.innerHTML = exactList
        .map((r) => {
          const isPruned = appState.prunedReleaseIds.has(String(r.release_id));
          return `
            <tr style="${isPruned ? "opacity:0.45;" : ""}">
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${escapeHtml(r.cover_image_url || renderFallbackSleeveDataUri(r.artist, r.album))}" alt="" style="width:42px;height:42px;border-radius:6px;object-fit:cover;border:1px solid var(--border-strong);" />
                  <div>
                    <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;">${escapeHtml(r.title)} ↗</a>
                    <div style="font-size:0.73rem;color:var(--text-secondary);">${escapeHtml(r.owned_format)}</div>
                  </div>
                </div>
              </td>
              <td style="font-family:var(--font-mono);">#${escapeHtml(r.release_id)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml((r.owned_date_added || "").slice(0, 10) || "In Vault")} (${escapeHtml(r.owned_condition)})</td>
              <td style="font-family:var(--font-mono);color:var(--accent-emerald);">${formatUsd(r.owned_value_usd)}</td>
              <td style="font-family:var(--font-mono);">${r.wantlist_hits_count}x</td>
              <td style="font-family:var(--font-mono);">${formatUsd(r.lowest_sniped_usd)}</td>
              <td>
                <button
                  type="button"
                  class="btn-action ${isPruned ? "" : "btn-primary-amber"}"
                  data-prune-release-id="${escapeHtml(r.release_id)}"
                  data-prune-title="${escapeHtml(r.title)}"
                  ${isPruned ? "disabled" : ""}
                >
                  ${isPruned ? "✓ Removed from Wantlist" : "🗑️ Remove from Wantlist"}
                </button>
              </td>
            </tr>`;
        })
        .join("");
    }

    const varTbody = document.getElementById("tbody-vault-variants");
    if (varTbody) {
      varTbody.innerHTML = variantList
        .map(
          (r) => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${escapeHtml(r.cover_image_url || renderFallbackSleeveDataUri(r.artist, r.album))}" alt="" style="width:42px;height:42px;border-radius:6px;object-fit:cover;border:1px solid var(--border-strong);" />
                <div>
                  <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;">${escapeHtml(r.title)} ↗</a>
                  <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">Wantlist Release #${escapeHtml(r.wantlist_release_id)}</div>
                </div>
              </div>
            </td>
            <td style="color:var(--accent-amber);font-size:0.8rem;">💿 ${escapeHtml(r.wantlist_variant)}</td>
            <td style="color:var(--text-secondary);font-size:0.8rem;">
              🏛️ ${escapeHtml(r.owned_format)}
              <span style="font-family:var(--font-mono);color:var(--accent-emerald);">(${formatUsd(r.owned_value_usd)})</span>
            </td>
            <td style="font-family:var(--font-mono);font-weight:700;">${formatUsd(r.lowest_sniped_usd)} (${r.wantlist_hits_count}x)</td>
            <td>
              <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" class="btn-action">Inspect Variant ↗</a>
            </td>
          </tr>`
        )
        .join("");
    }
  }

  // =====================================================================
  // 10. VIEW 4: SNIPER RULES & LIVE DISCOGS API CONSOLE
  // =====================================================================
  function buildCurrentConfigObject() {
    const cooldown = Number(document.getElementById("cfg-cooldown-days")?.value || 7);
    const dropUsd = Number(document.getElementById("cfg-price-drop-usd")?.value || 1.0);
    const maxPriceRaw = document.getElementById("cfg-max-price")?.value;
    const suppressOwned = document.getElementById("cfg-suppress-owned")?.value === "true";
    const pdSellers = (document.getElementById("cfg-pricedrop-sellers")?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const muted = (document.getElementById("cfg-muted-sellers")?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      schema_version: "2.0.0",
      discogs_username: appState.discogsUsername || "krunked",
      wantlist_url:
        SNIPER_STATE.wantlist_url ||
        "https://www.discogs.com/shop/mywants/?formatDescription=LP&formatName=Vinyl&shipsFrom=United+States&sort=listedNewest",
      relist_deduplication: {
        enabled: true,
        cooldown_days: cooldown,
        consolidate_multi_copy_batches: true,
        price_drop_override_usd: dropUsd,
        price_drop_override_pct: 3.0,
      },
      collection_vault_bridge: {
        enabled: true,
        suppress_exact_owned_alerts: suppressOwned,
        local_collection_path: "C:\\DiscogsCollection\\discogs_collection\\data\\collection.json",
      },
      filters: {
        min_media_condition: appState.conditionFilter === "ALL" ? "VG+" : appState.conditionFilter,
        min_sleeve_condition: "Any",
        max_total_price_usd: maxPriceRaw ? Number(maxPriceRaw) : null,
        muted_sellers: muted,
        price_drop_only_sellers: pdSellers,
        target_prices_by_release: {},
      },
      alerts: {
        email_to: "alexgoresch@gmail.com",
        email_cc: "mleven42@gmail.com",
        ntfy_base: "https://ntfy.sh",
        auto_rebuild_static_dashboard: true,
      },
    };
  }

  function syncRuleInputsFromState() {
    const mutedInput = document.getElementById("cfg-muted-sellers");
    if (mutedInput) {
      mutedInput.value = Array.from(appState.mutedSellers).join(", ");
    }
    updateConfigJsonPreview();
  }

  function updateConfigJsonPreview() {
    const preview = document.getElementById("config-json-preview");
    if (!preview) return;
    const cfg = buildCurrentConfigObject();
    preview.textContent = JSON.stringify(cfg, null, 2);
  }

  // =====================================================================
  // 11. EVENT LISTENERS & VIEW ROUTING
  // =====================================================================
  function switchView(viewName) {
    appState.activeView = viewName;
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
    document.querySelectorAll(".view-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `view-${viewName}`);
    });
  }

  function bindEvents() {
    // View Navigation Tabs
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    const openApiBtn = document.getElementById("btn-open-api-modal");
    if (openApiBtn) {
      openApiBtn.addEventListener("click", () => switchView("rules"));
    }

    // Search Input
    const searchInput = document.getElementById("radar-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        appState.searchQuery = e.target.value.trim();
        renderRadarGrid();
      });
    }

    // Collapse Auto-Relists Toggle
    const dedupBtn = document.getElementById("btn-toggle-dedup");
    if (dedupBtn) {
      dedupBtn.addEventListener("click", () => {
        appState.dedupEnabled = !appState.dedupEnabled;
        dedupBtn.classList.toggle("active", appState.dedupEnabled);
        renderTopKPIs();
        renderRadarGrid();
      });
    }

    // Condition & Sort Selects
    const condSelect = document.getElementById("radar-condition-select");
    if (condSelect) {
      condSelect.addEventListener("change", (e) => {
        appState.conditionFilter = e.target.value;
        updateConfigJsonPreview();
        renderRadarGrid();
      });
    }

    const sortSelect = document.getElementById("radar-sort-select");
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        appState.sortMode = e.target.value;
        renderRadarGrid();
      });
    }

    // Category Filter Pills
    document.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        appState.categoryFilter = pill.dataset.filter || "ALL";
        document.querySelectorAll(".filter-pill").forEach((p) => p.classList.toggle("active", p === pill));
        renderRadarGrid();
      });
    });

    // Price Ceiling Slider
    const priceSlider = document.getElementById("radar-max-price-slider");
    const priceReadout = document.getElementById("max-price-readout");
    if (priceSlider) {
      priceSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        appState.maxPriceUsd = val;
        if (priceReadout) {
          priceReadout.textContent = val >= 500 ? "No Limit" : `$${val}`;
        }
        renderRadarGrid();
      });
    }

    // Delegated Clicks on Drop Cards & Tables
    document.addEventListener("click", (e) => {
      const auditionBtn = e.target.closest("[data-audition-id]");
      if (auditionBtn) {
        auditionListing(auditionBtn.dataset.auditionId);
        return;
      }

      const liveApiBtn = e.target.closest("[data-live-api-id]");
      if (liveApiBtn) {
        verifyLiveListingViaAPI(liveApiBtn.dataset.liveApiId);
        return;
      }

      const historyBtn = e.target.closest(".btn-toggle-relist-history");
      if (historyBtn) {
        const id = historyBtn.dataset.id;
        if (appState.expandedHistoryIds.has(id)) {
          appState.expandedHistoryIds.delete(id);
        } else {
          appState.expandedHistoryIds.add(id);
        }
        renderRadarGrid();
        return;
      }

      const muteInlineBtn = e.target.closest("[data-mute-seller]");
      if (muteInlineBtn) {
        const seller = (muteInlineBtn.dataset.muteSeller || "").toLowerCase();
        if (seller) {
          appState.mutedSellers.add(seller);
          syncRuleInputsFromState();
          renderRadarGrid();
          renderForensicsView();
        }
        return;
      }

      const toggleMuteBtn = e.target.closest("[data-toggle-mute-seller]");
      if (toggleMuteBtn) {
        const seller = (toggleMuteBtn.dataset.toggleMuteSeller || "").toLowerCase();
        if (appState.mutedSellers.has(seller)) {
          appState.mutedSellers.delete(seller);
        } else {
          appState.mutedSellers.add(seller);
        }
        syncRuleInputsFromState();
        renderForensicsView();
        renderRadarGrid();
        return;
      }

      const pruneBtn = e.target.closest("[data-prune-release-id]");
      if (pruneBtn) {
        pruneReleaseFromWantlistAPI(pruneBtn.dataset.pruneReleaseId, pruneBtn.dataset.pruneTitle);
        return;
      }
    });

    // Prune All 10 Owned Pressings button
    const pruneAllBtn = document.getElementById("btn-prune-all-owned-api");
    if (pruneAllBtn) {
      pruneAllBtn.addEventListener("click", async () => {
        const list = SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [];
        if (!appState.discogsToken) {
          pruneReleaseFromWantlistAPI(list[0]?.release_id || "31082741", list[0]?.title || "Owned Pressing");
          return;
        }
        for (const r of list) {
          if (!appState.prunedReleaseIds.has(String(r.release_id))) {
            await pruneReleaseFromWantlistAPI(r.release_id, r.title);
          }
        }
      });
    }

    // Audio Transport Controls
    const audio = document.getElementById("sniper-preview-audio");
    const playPauseBtn = document.getElementById("btn-audio-play-pause");
    const closeAudioBtn = document.getElementById("btn-audio-close");
    const progFill = document.getElementById("audio-progress-fill");
    const timeLbl = document.getElementById("audio-time-label");

    if (audio) {
      audio.addEventListener("timeupdate", () => {
        const cur = audio.currentTime || 0;
        const dur = audio.duration || 30;
        if (progFill) progFill.style.width = `${Math.min(100, (cur / dur) * 100)}%`;
        if (timeLbl) {
          const s = Math.floor(cur)
            .toString()
            .padStart(2, "0");
          timeLbl.textContent = `0:${s} / 0:30`;
        }
      });
      audio.addEventListener("play", () => {
        if (playPauseBtn) playPauseBtn.textContent = "⏸ Pause";
      });
      audio.addEventListener("pause", () => {
        if (playPauseBtn) playPauseBtn.textContent = "▶ Play";
      });
      audio.addEventListener("ended", () => {
        appState.currentlyPlayingId = null;
        renderRadarGrid();
      });
    }

    if (playPauseBtn && audio) {
      playPauseBtn.addEventListener("click", () => {
        if (audio.paused) audio.play();
        else audio.pause();
      });
    }

    if (closeAudioBtn && audio) {
      closeAudioBtn.addEventListener("click", () => {
        audio.pause();
        appState.currentlyPlayingId = null;
        document.getElementById("audio-transport-bar")?.classList.remove("visible");
        renderRadarGrid();
      });
    }

    // API Token Save & Live Tester
    const saveVerifyBtn = document.getElementById("btn-save-verify-token");
    const consoleOut = document.getElementById("api-console-output");
    if (saveVerifyBtn) {
      saveVerifyBtn.addEventListener("click", async () => {
        const rawUser = document.getElementById("input-discogs-username")?.value.trim() || "krunked";
        const rawTok = document.getElementById("input-discogs-token")?.value.trim() || "";
        appState.discogsUsername = rawUser;
        appState.discogsToken = rawTok;
        try {
          localStorage.setItem(STORAGE_KEYS.USER, rawUser);
          localStorage.setItem(STORAGE_KEYS.TOKEN, rawTok);
        } catch (_) {}
        updateApiConnectionStatusUI();

        if (!rawTok) {
          if (consoleOut) consoleOut.textContent = "// Please paste a Discogs Personal Access Token first.";
          return;
        }
        if (consoleOut) consoleOut.textContent = "// Querying GET https://api.discogs.com/oauth/identity ...";
        try {
          const ident = await discogsApiFetch("/oauth/identity");
          if (ident && ident.username) {
            appState.discogsUsername = ident.username;
            localStorage.setItem(STORAGE_KEYS.USER, ident.username);
            updateApiConnectionStatusUI();
          }
          if (consoleOut) {
            consoleOut.textContent = `// HTTP 200 OK — Authenticated via Official Discogs API v2.0:\n${JSON.stringify(ident, null, 2)}`;
          }
        } catch (err) {
          if (consoleOut) {
            consoleOut.textContent = `// Error verifying token against /oauth/identity: ${err.message}`;
          }
        }
      });
    }

    const testSuggBtn = document.getElementById("btn-test-price-suggestions");
    if (testSuggBtn) {
      testSuggBtn.addEventListener("click", async () => {
        if (consoleOut) {
          consoleOut.textContent =
            "// Querying Official Discogs API for Dayseeker - Dark Sun (Release #38857860):\n// GET /marketplace/stats/38857860?curr_abbr=USD & GET /marketplace/price_suggestions/38857860 ...";
        }
        try {
          const [stats, sugg] = await Promise.all([
            discogsApiFetch("/marketplace/stats/38857860?curr_abbr=USD"),
            appState.discogsToken
              ? discogsApiFetch("/marketplace/price_suggestions/38857860").catch((e) => ({ note: e.message }))
              : Promise.resolve({ note: "Connect DISCOGS_TOKEN above to unlock condition-graded /marketplace/price_suggestions" }),
          ]);
          if (consoleOut) {
            consoleOut.textContent = JSON.stringify({ release_id: 38857860, marketplace_stats: stats, price_suggestions: sugg }, null, 2);
          }
        } catch (err) {
          if (consoleOut) consoleOut.textContent = `// API Request Error: ${err.message}`;
        }
      });
    }

    const clearTokBtn = document.getElementById("btn-clear-token");
    if (clearTokBtn) {
      clearTokBtn.addEventListener("click", () => {
        appState.discogsToken = "";
        try {
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
        } catch (_) {}
        const inp = document.getElementById("input-discogs-token");
        if (inp) inp.value = "";
        updateApiConnectionStatusUI();
        if (consoleOut) consoleOut.textContent = "// Cleared browser-stored Discogs token.";
      });
    }

    // Rule Builder Live Preview & Export
    [
      "cfg-cooldown-days",
      "cfg-price-drop-usd",
      "cfg-max-price",
      "cfg-suppress-owned",
      "cfg-pricedrop-sellers",
      "cfg-muted-sellers",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", () => {
          if (id === "cfg-muted-sellers") {
            appState.mutedSellers = new Set(
              el.value
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            );
            renderRadarGrid();
          }
          updateConfigJsonPreview();
        });
      }
    });

    const dlBtn = document.getElementById("btn-download-config");
    if (dlBtn) {
      dlBtn.addEventListener("click", () => {
        const cfg = buildCurrentConfigObject();
        const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sniper_config.json";
        a.click();
      });
    }

    const copyBtn = document.getElementById("btn-copy-config");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const cfg = buildCurrentConfigObject();
        navigator.clipboard?.writeText(JSON.stringify(cfg, null, 2));
        copyBtn.textContent = "✓ Copied sniper_config.json!";
        setTimeout(() => {
          copyBtn.textContent = "📋 Copy JSON to Clipboard";
        }, 2000);
      });
    }
  }

  // =====================================================================
  // 12. INITIALIZE APPLICATION
  // =====================================================================
  renderTopKPIs();
  updateApiConnectionStatusUI();
  renderRadarGrid();
  renderForensicsView();
  renderVaultBridgeView();
  updateConfigJsonPreview();
  bindEvents();
})();
