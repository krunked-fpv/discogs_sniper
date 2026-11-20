(() => {
  "use strict";

  // =====================================================================
  // 1. BOOTSTRAP PRE-BAKED STATE & PERSISTENT USER PREFERENCES
  // =====================================================================
  const stateEl = document.getElementById("sniper-prebaked-state");
  let SNIPER_STATE = {
    schema_version: "2.1.0-beta",
    summary: {},
    live_wantlist_sync: {},
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
    CONFIG_OVERRIDES: "krunked_sniper_config_v2_1",
    PRUNED: "krunked_sniper_pruned_ids_v2",
    LIGHTING_MODE: "krunked_sniper_lighting_v2_1",
  };

  function safeGetStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSetStorage(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (_) {}
  }

  function safeRemoveStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function discoverStoredToken() {
    const candidateKeys = [
      STORAGE_KEYS.TOKEN,
      "discogs_token",
      "DISCOGS_TOKEN",
      "krunked_vault_token",
    ];
    for (const k of candidateKeys) {
      const val = safeGetStorage(k);
      if (val && val.trim().length >= 20) return val.trim();
    }
    return "";
  }

  function loadSavedConfigOverrides() {
    const raw = safeGetStorage(STORAGE_KEYS.CONFIG_OVERRIDES);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  const baseConfig = SNIPER_STATE.config || {};
  const savedOverrides = loadSavedConfigOverrides() || {};
  const initialMuted = Array.isArray(savedOverrides.muted_sellers)
    ? savedOverrides.muted_sellers
    : baseConfig.filters?.muted_sellers || [];
  const initialDropOnly = Array.isArray(savedOverrides.price_drop_only_sellers)
    ? savedOverrides.price_drop_only_sellers
    : baseConfig.filters?.price_drop_only_sellers || ["recordmule"];

  const datasetMaxPrice = Math.max(
    500,
    Math.ceil(Number(SNIPER_STATE.summary?.max_listing_price_usd || 500) / 25) * 25
  );

  // Check if build_dashboard.py already baked live wantlist verification into SNIPER_STATE
  const prebakedSync = SNIPER_STATE.live_wantlist_sync || {};
  let initialLiveWantIds = null;
  if (prebakedSync.synced) {
    const stillOn = (SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [])
      .filter((r) => r.live_wantlist_status === "STILL_ON_WANTLIST")
      .map((r) => String(r.release_id));
    initialLiveWantIds = new Set(stillOn);
  }

  const appState = {
    activeView: "radar",
    lightingMode: safeGetStorage(STORAGE_KEYS.LIGHTING_MODE) === "uv" ? "uv" : "neon",
    searchQuery: "",
    scopeMode: "ALL", // "ALL" | "LIVE_P1"
    dedupEnabled: true,
    hideRecordmule: false,
    conditionFilter: "ALL",
    sortMode: "SNAPSHOT_ORDER",
    categoryFilter: "ALL",
    sliderMaxUsd: datasetMaxPrice,
    maxPriceUsd: datasetMaxPrice,
    mutedSellers: new Set(initialMuted.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
    priceDropOnlySellers: new Set(initialDropOnly.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
    sellerSearchQuery: "",
    showAllSellers: false,
    expandedHistoryIds: new Set(),
    liveApiResults: {},
    prunedReleaseIds: new Set(),
    liveWantlistIds: initialLiveWantIds,
    liveWantlistSource: prebakedSync.synced ? "prebaked" : "",
    liveWantlistLoading: false,
    liveWantlistError: "",
    liveWantlistSyncedAt: prebakedSync.synced_at || "",
    liveWantlistTotal: Number(prebakedSync.total_live_wants || 0),
    discogsUsername: safeGetStorage(STORAGE_KEYS.USER) || SNIPER_STATE.discogs_username || "krunked",
    discogsToken: discoverStoredToken(),
    artCache: {},
    currentlyPlayingId: null,
    isAudioActuallyPlaying: false,
    inspectListingId: null,
  };

  try {
    const cachedArt = safeGetStorage(STORAGE_KEYS.ART_CACHE);
    if (cachedArt) appState.artCache = JSON.parse(cachedArt) || {};
  } catch (_) {}

  try {
    const cachedPruned = safeGetStorage(STORAGE_KEYS.PRUNED);
    if (cachedPruned) {
      const parsed = JSON.parse(cachedPruned);
      if (Array.isArray(parsed)) {
        appState.prunedReleaseIds = new Set(parsed.map((x) => String(x)));
      }
    }
  } catch (_) {}

  function saveArtCache() {
    safeSetStorage(STORAGE_KEYS.ART_CACHE, JSON.stringify(appState.artCache));
  }

  function savePrunedReleaseIds() {
    safeSetStorage(STORAGE_KEYS.PRUNED, JSON.stringify([...appState.prunedReleaseIds]));
  }

  function saveConfigOverrides() {
    const cfg = buildCurrentConfigObject();
    safeSetStorage(
      STORAGE_KEYS.CONFIG_OVERRIDES,
      JSON.stringify({
        cooldown_days: cfg.relist_deduplication.cooldown_days,
        price_drop_override_usd: cfg.relist_deduplication.price_drop_override_usd,
        max_total_price_usd: cfg.filters.max_total_price_usd,
        suppress_exact_owned_alerts: cfg.collection_vault_bridge.suppress_exact_owned_alerts,
        price_drop_only_sellers: [...appState.priceDropOnlySellers],
        muted_sellers: [...appState.mutedSellers],
      })
    );
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

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const rem = String(s % 60).padStart(2, "0");
    return `${m}:${rem}`;
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return `rgba(0, 240, 255, ${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return `rgba(0, 240, 255, ${alpha})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Non-blocking neon toast notifications (replaces window.alert)
  function showToast(message, variant = "cyan", durationMs = 3600) {
    const stack = document.getElementById("toast-stack");
    if (!stack) return;
    const item = document.createElement("div");
    item.className = `toast-item toast-${variant}`;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateX(16px)";
      item.style.transition = "all 0.2s ease";
      setTimeout(() => item.remove(), 220);
    }, durationMs);
  }

  async function copyTextSafe(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(successMsg, "lime");
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) {
        showToast(successMsg, "lime");
        return true;
      }
    } catch (_) {}
    showToast("Copy blocked by browser permissions — select text manually.", "amber");
    return false;
  }

  // Inline crisp SVG micro-icons
  const ICONS = {
    cart: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
    ext: `<svg class="ico ico-xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>`,
    play: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    stop: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
    bolt: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z"/></svg>`,
    trash: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
    check: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
    repeat: `<svg class="ico ico-xs" viewBox="0 0 24 24" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  };

  function isReleaseClearedFromLiveWantlist(releaseId) {
    const rid = String(releaseId);
    if (appState.liveWantlistIds !== null) {
      return !appState.liveWantlistIds.has(rid);
    }
    return appState.prunedReleaseIds.has(rid);
  }

  function getActiveExactOwnedList() {
    const exactList = SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [];
    return exactList.filter((r) => !isReleaseClearedFromLiveWantlist(r.release_id));
  }

  function getClearedExactOwnedList() {
    const exactList = SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [];
    return exactList.filter((r) => isReleaseClearedFromLiveWantlist(r.release_id));
  }

  function getListingById(listingId) {
    return (SNIPER_STATE.listings || []).find((x) => String(x.id) === String(listingId)) || null;
  }

  function getDisplayAlbumTitle(item) {
    const a = (item.artist || "").trim();
    const b = (item.album || "").trim();
    if (a && b && a.toLowerCase() === b.toLowerCase()) {
      return `${b} (Self-Titled)`;
    }
    return b || item.title || "Untitled Release";
  }

  // =====================================================================
  // 2. LIGHTING MODE (NEON OVERDRIVE / UV BLACKLIGHT) & DYNAMIC STAGE CHROMA
  // =====================================================================
  function applyLightingMode() {
    const isUv = appState.lightingMode === "uv";
    document.body.classList.toggle("mode-uv", isUv);
    document.body.classList.toggle("mode-neon", !isUv);
    const lbl = document.getElementById("uv-mode-label");
    if (lbl) lbl.textContent = isUv ? "UV MODE" : "NEON";
    safeSetStorage(STORAGE_KEYS.LIGHTING_MODE, appState.lightingMode);
  }

  function setStageChromaFromWax(wax) {
    if (!wax) return;
    const primary = wax.primary && wax.primary !== "#181a1f" ? wax.primary : "#00f0ff";
    const accent = wax.accent || "#ff1f8f";
    const boost = appState.lightingMode === "uv" ? 0.3 : 0.17;
    document.documentElement.style.setProperty("--stage-c1", hexToRgba(primary, boost));
    document.documentElement.style.setProperty("--stage-c2", hexToRgba(accent, boost * 0.8));
  }

  // =====================================================================
  // 3. COLORED-VINYL SVG PLATTER & SLEEVE FALLBACK
  // =====================================================================
  function renderFallbackSleeveDataUri(artist, album, primaryColor) {
    const initials = `${(artist || "D")[0] || "D"}${(album || "S")[0] || "S"}`.toUpperCase();
    const accent = primaryColor && primaryColor !== "#181a1f" ? primaryColor : "#00f0ff";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#121829"/>
          <stop offset="100%" stop-color="#05070e"/>
        </linearGradient>
      </defs>
      <rect width="160" height="160" fill="url(#g)"/>
      <circle cx="80" cy="80" r="56" fill="none" stroke="${accent}" stroke-opacity="0.34" stroke-width="1.5"/>
      <circle cx="80" cy="80" r="38" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="1"/>
      <text x="80" y="89" text-anchor="middle" fill="${accent}" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="28" letter-spacing="3">${escapeHtml(initials)}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function renderVinylDiscSVG(wax, uid, size = 86) {
    const w = wax || { pattern: "solid", primary: "#181a1f", secondary: "#0d0f12", accent: "#00f0ff" };
    const p = w.primary || "#181a1f";
    const s = w.secondary || "#0d0f12";
    const a = w.accent || "#00f0ff";
    const pattern = w.pattern || "solid";

    let patternOverlay = "";
    if (pattern === "splatter") {
      patternOverlay = `
        <g opacity="0.9">
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
      patternOverlay = `<path d="M 50,4 A 46,46 0 0,1 50,96 Z" fill="${s}" opacity="0.92"/>`;
    } else if (pattern === "marble" || pattern === "smoke") {
      patternOverlay = `
        <circle cx="50" cy="50" r="34" fill="none" stroke="${s}" stroke-width="10" stroke-dasharray="28 18" opacity="0.58"/>
        <circle cx="50" cy="50" r="24" fill="none" stroke="${a}" stroke-width="6" stroke-dasharray="16 24" opacity="0.44"/>`;
    } else if (pattern === "translucent") {
      patternOverlay = `<circle cx="50" cy="50" r="44" fill="${a}" opacity="0.18"/>`;
    }

    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <radialGradient id="wax-${uid}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="${p}"/>
          <stop offset="70%" stop-color="${p}"/>
          <stop offset="100%" stop-color="${s}"/>
        </radialGradient>
        <linearGradient id="sheen-${uid}" x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.24"/>
          <stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="100%" stop-color="#00f0ff" stop-opacity="0.18"/>
        </linearGradient>
        <clipPath id="clip-${uid}"><circle cx="50" cy="50" r="45.5"/></clipPath>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#wax-${uid})" stroke="#05070d" stroke-width="1.5"/>
      ${patternOverlay}
      <g clip-path="url(#clip-${uid})">
        <path d="M50 50 L14 6 L40 2 Z" fill="url(#sheen-${uid})"/>
        <path d="M50 50 L86 94 L60 98 Z" fill="url(#sheen-${uid})"/>
      </g>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="30" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="24" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="0.6"/>
      <circle cx="50" cy="50" r="16" fill="#0d111c" stroke="${a}" stroke-width="1.6"/>
      <circle cx="50" cy="50" r="9.5" fill="${a}" opacity="0.88"/>
      <circle cx="50" cy="50" r="3.2" fill="#040509"/>
    </svg>`;
  }

  function resolveCoverSrc(item) {
    return (
      item.cover_image_url ||
      appState.artCache[item.release_id] ||
      appState.artCache[item.norm_album_key] ||
      renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary)
    );
  }

  // =====================================================================
  // 4. TOP KPI RIBBON & NAVIGATION BADGE UPDATER
  // =====================================================================
  function renderTopKPIs(filteredRadarCount = null) {
    const s = SNIPER_STATE.summary || {};
    const f = SNIPER_STATE.forensics || {};

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.textContent = val;
    };

    const rawTotal = s.total_tracked_listings ?? 218;
    const uniqueTotal = s.unique_deduped_offerings ?? 113;
    const liveP1Count = s.live_page1_count ?? 25;

    setTxt("kpi-unique-offerings", uniqueTotal);
    setTxt("kpi-raw-total-badge", `from ${rawTotal} raw`);
    setTxt("kpi-live-p1-chip", `${liveP1Count} Live P1`);
    setTxt("kpi-distinct-releases-sub", `Across ${s.distinct_releases ?? 73} distinct Wantlist pressings`);

    setTxt("kpi-relists-intercepted", s.auto_relists_intercepted ?? 105);
    setTxt("kpi-spam-pct-badge", `-${s.spam_reduction_pct ?? 48.2}% Noise`);
    setTxt("kpi-price-drops-chip", `${s.price_drops_detected ?? 4} Drops`);
    setTxt(
      "kpi-recordmule-sub",
      `recordmule drives ${s.recordmule_listings ?? 99}/${rawTotal} (${s.recordmule_share_pct ?? 45.4}%)`
    );

    const activeOverlaps = getActiveExactOwnedList().length;
    const totalSnapshotOwned = (SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || []).length;
    const variantCount = s.variant_upgrade_releases ?? 9;

    setTxt("kpi-missing-grails", s.missing_grails_releases ?? 54);
    setTxt("kpi-variants-chip", `${variantCount} Variants`);
    setTxt(
      "kpi-vault-sub",
      `${s.missing_grails_releases ?? 54} Grails // ${variantCount} Variants // ${s.vault_total_owned_lps ?? 159} Vault LPs`
    );

    const kpiOverlapBadge = document.getElementById("kpi-owned-overlap-badge");
    const navVaultCount = document.getElementById("nav-count-vault");
    if (appState.liveWantlistLoading) {
      if (kpiOverlapBadge) {
        kpiOverlapBadge.className = "kpi-badge badge-cyan";
        kpiOverlapBadge.textContent = "Verifying Live...";
      }
      if (navVaultCount) {
        navVaultCount.className = "nav-tab-count";
        navVaultCount.textContent = "Syncing";
      }
    } else if (appState.liveWantlistIds !== null) {
      if (activeOverlaps === 0) {
        if (kpiOverlapBadge) {
          kpiOverlapBadge.className = "kpi-badge badge-lime";
          kpiOverlapBadge.textContent = "0 Live Overlaps";
        }
        if (navVaultCount) {
          navVaultCount.className = "nav-tab-count count-clean";
          navVaultCount.textContent = "Clean";
        }
      } else {
        if (kpiOverlapBadge) {
          kpiOverlapBadge.className = "kpi-badge badge-crimson";
          kpiOverlapBadge.textContent = `${activeOverlaps} Live Overlap${activeOverlaps === 1 ? "" : "s"}`;
        }
        if (navVaultCount) {
          navVaultCount.className = "nav-tab-count count-alert";
          navVaultCount.textContent = `${activeOverlaps} Live`;
        }
      }
    } else {
      const p1Owned = s.exact_owned_in_live_page1 ?? 0;
      if (kpiOverlapBadge) {
        kpiOverlapBadge.className = p1Owned > 0 ? "kpi-badge badge-crimson" : "kpi-badge badge-amber";
        kpiOverlapBadge.textContent =
          p1Owned > 0 ? `${p1Owned} on Live P1` : `${activeOverlaps}/${totalSnapshotOwned} Hist`;
      }
      if (navVaultCount) {
        navVaultCount.className = "nav-tab-count";
        navVaultCount.textContent = `${activeOverlaps} Hist`;
      }
    }

    setTxt("kpi-total-checks", Number(f.total_checks ?? 5632).toLocaleString());
    setTxt("kpi-uptime-badge", `${f.hydration_success_rate_pct ?? 98.8}% Hydrated`);
    setTxt("kpi-alerts-sent-sub", `${f.total_alerts_sent ?? 225} Priority Alerts // Dual-Trigger Fixed`);

    setTxt(
      "nav-count-radar",
      filteredRadarCount !== null ? filteredRadarCount : appState.dedupEnabled ? uniqueTotal : rawTotal
    );
    setTxt("nav-count-forensics", `-${s.spam_reduction_pct ?? 48.2}%`);
    setTxt(
      "dedup-status-chip",
      appState.dedupEnabled ? `ON (-${s.auto_relists_intercepted ?? 105})` : `OFF (${rawTotal})`
    );
  }

  function updateApiConnectionStatusUI() {
    const dot = document.getElementById("api-connection-dot");
    const lbl = document.getElementById("api-connection-label");
    const navApi = document.getElementById("nav-count-api");
    const tokenInput = document.getElementById("input-discogs-token");
    const userInput = document.getElementById("input-discogs-username");
    const quickUser = document.getElementById("quick-api-username");
    const quickTok = document.getElementById("quick-api-token");
    const subtitle = document.getElementById("header-telemetry-subtitle");

    if (userInput) userInput.value = appState.discogsUsername;
    if (tokenInput) tokenInput.value = appState.discogsToken;
    if (quickUser) quickUser.value = appState.discogsUsername;
    if (quickTok) quickTok.value = appState.discogsToken;
    if (subtitle) {
      subtitle.textContent = `@${appState.discogsUsername} // API v2 + GRAPHQL + VAULT`;
    }

    if (appState.discogsToken) {
      if (dot) dot.classList.add("connected");
      if (lbl) lbl.textContent = `@${appState.discogsUsername} API`;
      if (navApi) {
        navApi.className = "nav-tab-count count-clean";
        navApi.textContent = "LIVE";
      }
    } else {
      if (dot) dot.classList.remove("connected");
      if (lbl) lbl.textContent = "Connect API";
      if (navApi) {
        navApi.className = "nav-tab-count";
        navApi.textContent = "API v2";
      }
    }
  }

  // =====================================================================
  // 5. FILTERING, SORTING & SURGICAL LIVE DROP RADAR RENDERER
  // =====================================================================
  function passesConditionGrade(mediaCond, minGrade) {
    if (minGrade === "ALL") return true;
    const rankMap = { M: 4, NM: 3, "M-": 3, "VG+": 2, VG: 1 };
    const itemRank = rankMap[(mediaCond || "").toUpperCase()] ?? 2;
    const reqRank = rankMap[minGrade] ?? 1;
    return itemRank >= reqRank;
  }

  function isListingVerifiedDeal(item) {
    return item.deal_tier === "STEAL" || item.deal_tier === "GREAT_DEAL";
  }

  function hasActiveFilters() {
    return (
      Boolean(appState.searchQuery) ||
      appState.scopeMode !== "ALL" ||
      appState.categoryFilter !== "ALL" ||
      appState.conditionFilter !== "ALL" ||
      appState.hideRecordmule ||
      appState.maxPriceUsd < appState.sliderMaxUsd
    );
  }

  function resetAllRadarFilters() {
    appState.searchQuery = "";
    appState.scopeMode = "ALL";
    appState.categoryFilter = "ALL";
    appState.conditionFilter = "ALL";
    appState.sortMode = "SNAPSHOT_ORDER";
    appState.hideRecordmule = false;
    appState.maxPriceUsd = appState.sliderMaxUsd;

    const sInput = document.getElementById("radar-search-input");
    if (sInput) sInput.value = "";
    const condSel = document.getElementById("radar-condition-select");
    if (condSel) condSel.value = "ALL";
    const sortSel = document.getElementById("radar-sort-select");
    if (sortSel) sortSel.value = "SNAPSHOT_ORDER";
    const slider = document.getElementById("radar-max-price-slider");
    if (slider) slider.value = String(appState.sliderMaxUsd);
    const readout = document.getElementById("max-price-readout");
    if (readout) readout.textContent = "No Limit";
    const rmBtn = document.getElementById("btn-hide-recordmule");
    if (rmBtn) rmBtn.classList.remove("active");

    document.querySelectorAll(".scope-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.scope === "ALL");
    });
    document.querySelectorAll(".filter-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.filter === "ALL");
    });

    renderRadarGrid();
  }

  function getFilteredListings() {
    const all = SNIPER_STATE.listings || [];

    const basePool = all.filter((item) => {
      if (appState.dedupEnabled && !item.is_latest_in_group) return false;
      if (appState.scopeMode === "LIVE_P1" && !item.is_live_page1) return false;
      const sellerLow = (item.seller_info || "").toLowerCase();
      if (appState.mutedSellers.has(sellerLow)) return false;
      if (appState.hideRecordmule && sellerLow === "recordmule") return false;
      if (!passesConditionGrade(item.media_condition, appState.conditionFilter)) return false;
      if (appState.maxPriceUsd < appState.sliderMaxUsd && item.total_price_usd > appState.maxPriceUsd) return false;

      if (appState.searchQuery) {
        const q = appState.searchQuery.toLowerCase();
        const hay = `${item.title} ${item.variant} ${item.seller_info} ${item.id} ${item.release_id} ${item.raw_description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const counts = {
      ALL: basePool.length,
      MISSING_GRAIL: basePool.filter((x) => x.vault_status === "MISSING_GRAIL").length,
      STEALS: basePool.filter(isListingVerifiedDeal).length,
      PRICE_DROP: basePool.filter((x) => x.is_price_drop).length,
      MAKE_OFFER: basePool.filter((x) => x.allow_offers).length,
      VARIANT_UPGRADE: basePool.filter((x) => x.vault_status === "VARIANT_UPGRADE").length,
      ALREADY_OWNED: basePool.filter((x) => x.vault_status === "ALREADY_OWNED").length,
    };

    const setCnt = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };
    setCnt("pill-cnt-all", counts.ALL);
    setCnt("pill-cnt-grails", counts.MISSING_GRAIL);
    setCnt("pill-cnt-steals", counts.STEALS);
    setCnt("pill-cnt-pricedrop", counts.PRICE_DROP);
    setCnt("pill-cnt-offers", counts.MAKE_OFFER);
    setCnt("pill-cnt-variants", counts.VARIANT_UPGRADE);
    setCnt("pill-cnt-owned", counts.ALREADY_OWNED);

    const filtered = basePool.filter((item) => {
      switch (appState.categoryFilter) {
        case "MISSING_GRAIL":
          return item.vault_status === "MISSING_GRAIL";
        case "STEALS":
          return isListingVerifiedDeal(item);
        case "PRICE_DROP":
          return item.is_price_drop;
        case "MAKE_OFFER":
          return item.allow_offers;
        case "VARIANT_UPGRADE":
          return item.vault_status === "VARIANT_UPGRADE";
        case "ALREADY_OWNED":
          return item.vault_status === "ALREADY_OWNED";
        default:
          return true;
      }
    });

    filtered.sort((a, b) => {
      switch (appState.sortMode) {
        case "DEAL_SCORE": {
          const da = a.deal_delta_pct ?? 999;
          const db = b.deal_delta_pct ?? 999;
          return (b.deal_score - a.deal_score) || (da - db);
        }
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
      const cleared = isReleaseClearedFromLiveWantlist(item.release_id);
      if (cleared) {
        return `<span class="tag-pill badge-neutral" title="Owned in your Collection Vault and already cleared from your live Wantlist">VAULT // CLEARED</span>`;
      }
      return `<span class="tag-pill badge-crimson" title="Exact release_id (#${escapeHtml(item.release_id)}) is in your Collection Vault">IN VAULT</span>`;
    }
    if (item.vault_status === "VARIANT_UPGRADE") {
      const ownedFmt = item.vault_owned_detail ? item.vault_owned_detail.format_string : "Another pressing";
      return `<span class="tag-pill badge-magenta" title="Alternate variant of album you own: ${escapeHtml(ownedFmt)}">VARIANT HUNTER</span>`;
    }
    return `<span class="tag-pill badge-lime">MISSING GRAIL</span>`;
  }

  function renderDealAndRelistPills(item) {
    const pills = [];
    if (item.is_live_page1) {
      pills.push(`<span class="tag-pill badge-cyan">LIVE P1</span>`);
    }
    if (item.allow_offers) {
      pills.push(`<span class="tag-pill badge-amber">MAKE OFFER</span>`);
    }
    if (item.is_price_drop) {
      pills.push(
        `<span class="tag-pill badge-lime" title="Price dropped from $${Number(item.group_highest_price_usd || 0).toFixed(2)}">DROP -$${Number(item.price_drop_usd || 0).toFixed(2)}</span>`
      );
    } else if (item.deal_delta_pct !== null && item.deal_delta_pct !== undefined && item.deal_delta_pct <= -15) {
      pills.push(`<span class="tag-pill badge-lime">STEAL ${item.deal_delta_pct.toFixed(0)}%</span>`);
    } else if (item.deal_delta_pct !== null && item.deal_delta_pct !== undefined && item.deal_delta_pct <= -3) {
      pills.push(`<span class="tag-pill badge-cyan">${item.deal_delta_pct.toFixed(0)}% DEAL</span>`);
    }

    if (item.relist_group_total > 1) {
      pills.push(
        `<button type="button" class="tag-pill tag-pill-btn badge-amber btn-toggle-relist-history" data-id="${escapeHtml(item.id)}" title="Inspect all ${item.relist_group_total} relist IDs from ${escapeHtml(item.seller_info)}">
          ${ICONS.repeat}<span>${item.relist_group_total}x RELISTS</span>
        </button>`
      );
    }
    return pills.join("");
  }

  function renderCardDrawersHtml(item) {
    const liveResult = appState.liveApiResults[item.id];
    const historyOpen = appState.expandedHistoryIds.has(item.id);
    const mkt = item.market_stats || {};
    let html = "";

    if (historyOpen && item.sibling_history && item.sibling_history.length > 1) {
      const rowsHtml = item.sibling_history
        .map(
          (h, idx) => `
          <div class="history-row">
            <span>#${idx + 1} // <a href="${escapeHtml(h.item_url)}" target="_blank" rel="noopener" style="color:var(--neon-cyan);">ID #${escapeHtml(h.id)}</a></span>
            <span style="color:var(--neon-lime);font-weight:600;">${escapeHtml(h.total_price)}</span>
            <span style="color:var(--text-muted);">${escapeHtml((h.alerted_at || "").replace("T", " ").slice(0, 16))}</span>
          </div>`
        )
        .join("");
      html += `
        <div class="relist-history-drawer">
          <div style="display:flex;justify-content:space-between;color:var(--neon-amber);font-weight:600;gap:8px;flex-wrap:wrap;">
            <span>RELIST TRAIL (${item.relist_group_total}x // ${escapeHtml(item.seller_info)})</span>
            <span>${formatUsd(item.group_lowest_price_usd)} – ${formatUsd(item.group_highest_price_usd)}</span>
          </div>
          <div class="history-list">${rowsHtml}</div>
        </div>`;
    }

    if (liveResult) {
      if (liveResult.loading) {
        html += `<div class="live-api-drawer" style="color:var(--neon-cyan);">Querying api.discogs.com for Listing #${escapeHtml(item.id)} &amp; Release #${escapeHtml(item.release_id)}...</div>`;
      } else if (liveResult.error) {
        html += `<div class="live-api-drawer" style="color:#ff6082;">${escapeHtml(liveResult.error)}</div>`;
      } else {
        const statusClass = liveResult.status === "For Sale" ? "badge-lime" : liveResult.status === "Unknown" ? "badge-amber" : "badge-crimson";
        const statusText = liveResult.status === "For Sale" ? "STILL FOR SALE" : liveResult.status;
        const offerBadge = liveResult.allow_offers ? `<span class="kpi-badge badge-amber">MAKE OFFER</span>` : "";
        html += `
          <div class="live-api-drawer">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
              <strong style="color:var(--neon-cyan);">DISCOGS API LIVE TELEMETRY</strong>
              <div style="display:flex;gap:5px;flex-wrap:wrap;">
                <span class="kpi-badge ${statusClass}">${escapeHtml(statusText)}</span>
                ${offerBadge}
              </div>
            </div>
            <div>Release Market: <strong>${liveResult.num_for_sale ?? "?"}</strong> for sale (Lowest: <strong>${escapeHtml(liveResult.lowest_price_str || "N/A")}</strong>)</div>
            <div>Condition Suggested (${escapeHtml(item.media_condition)}): <strong style="color:var(--neon-lime);">${escapeHtml(liveResult.suggested_str || mkt.condition_suggested_formatted || "Connect Token")}</strong></div>
            <div>Demand: <strong>${liveResult.want ?? "?"}</strong> Want / <strong>${liveResult.have ?? "?"}</strong> Have ${liveResult.seller_rating ? `// Seller: ${escapeHtml(liveResult.seller_rating)}` : ""}</div>
          </div>`;
      }
    }

    return html;
  }

  function renderDropCard(item) {
    const fallbackUri = renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary);
    const coverSrc = resolveCoverSrc(item);
    const needsHydration =
      !item.cover_image_url && !appState.artCache[item.release_id] && !appState.artCache[item.norm_album_key];
    const isPlaying = appState.currentlyPlayingId === item.id;
    const isSpinning = isPlaying && appState.isAudioActuallyPlaying;
    const mkt = item.market_stats || {};
    const waxPrimary = item.wax_shader?.primary && item.wax_shader.primary !== "#181a1f" ? item.wax_shader.primary : "#00f0ff";
    const waxGlow = hexToRgba(waxPrimary, 0.24);
    const liveBench = appState.liveApiResults[item.id]?.suggested_usd;
    const benchDisplay = liveBench ? formatUsd(liveBench) : mkt.condition_suggested_formatted || "Live API";
    const benchSub = liveBench
      ? "Official Discogs API"
      : mkt.condition_suggested_usd > 0
      ? `Low ${formatUsd(mkt.observed_low_usd)} / Hi ${formatUsd(mkt.observed_high_usd)}`
      : "Click API to verify";
    const shipText = item.shipping_price_usd > 0 ? `+ ${formatUsd(item.shipping_price_usd)} ship` : "incl. ship";
    const vaultCardCls =
      item.vault_status === "VARIANT_UPGRADE"
        ? "card-variant"
        : item.vault_status === "ALREADY_OWNED"
        ? "card-owned"
        : "card-grail";

    return `
      <article class="drop-card ${vaultCardCls} ${isPlaying ? "card-playing" : ""}" style="--wax-glow:${waxGlow};" data-listing-id="${escapeHtml(item.id)}" data-release-id="${escapeHtml(item.release_id)}" data-artist="${escapeHtml(item.artist)}" data-album="${escapeHtml(item.album)}">
        <div class="drop-card-top">
          <div class="status-pills">
            ${renderVaultStatusPill(item)}
            ${renderDealAndRelistPills(item)}
          </div>
          <span class="listing-id-label">#${escapeHtml(item.id)}</span>
        </div>

        <div class="drop-card-hero">
          <button type="button" class="artwork-stage" data-inspect-id="${escapeHtml(item.id)}" title="Inspect full vinyl pressing details">
            <div class="sleeve-frame">
              <img
                src="${escapeHtml(coverSrc)}"
                data-fallback-src="${escapeHtml(fallbackUri)}"
                alt="${escapeHtml(item.title)}"
                class="sleeve-img ${needsHydration ? "needs-art-hydration" : ""}"
                loading="lazy"
                data-release-id="${escapeHtml(item.release_id)}"
                data-norm-key="${escapeHtml(item.norm_album_key)}"
                data-artist="${escapeHtml(item.artist)}"
                data-album="${escapeHtml(item.album)}"
              />
            </div>
            <div class="vinyl-platter-wrap ${isSpinning ? "spinning" : ""}" id="platter-${escapeHtml(item.id)}">
              ${renderVinylDiscSVG(item.wax_shader, item.id, 86)}
            </div>
          </button>

          <div class="drop-meta">
            <div class="drop-artist">${escapeHtml(item.artist)}</div>
            <button type="button" class="drop-album-btn" data-inspect-id="${escapeHtml(item.id)}" title="${escapeHtml(item.album)}">
              <h2 class="drop-album">${escapeHtml(getDisplayAlbumTitle(item))}</h2>
            </button>
            <div class="drop-variant" title="${escapeHtml(item.variant)}">
              <span class="wax-swatch" style="background:${escapeHtml(waxPrimary)};box-shadow:0 0 8px ${waxGlow};"></span>
              <span class="drop-variant-text">${escapeHtml(item.wax_shader?.wax_name || item.variant)}</span>
            </div>
          </div>
        </div>

        <div class="price-matrix">
          <div class="matrix-cell">
            <span class="matrix-label">Total Shipped</span>
            <span class="matrix-val matrix-val-price">${escapeHtml(item.total_price)}</span>
            <span class="matrix-sub">${escapeHtml(item.list_price)} ${shipText}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">Benchmark (${escapeHtml(item.media_condition)})</span>
            <span class="matrix-val ${benchDisplay === "Live API" ? "matrix-val-muted" : ""}" data-bench-val="${escapeHtml(item.id)}">${escapeHtml(benchDisplay)}</span>
            <span class="matrix-sub" title="${escapeHtml(mkt.benchmark_source || "")}">${escapeHtml(benchSub)}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">Media / Sleeve</span>
            <span class="matrix-val">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</span>
            <span class="matrix-sub">${item.deal_tier === "UNRATED" ? "Unrated" : `Score ${item.deal_score}/100`}</span>
          </div>
        </div>

        <div class="seller-strip">
          <div class="seller-left">
            <a href="https://www.discogs.com/seller/${encodeURIComponent(item.seller_info)}/profile" target="_blank" rel="noopener" class="seller-link">${escapeHtml(item.seller_info)}</a>
            ${item.seller_rating ? `<span style="color:var(--neon-lime);font-family:var(--font-mono);font-size:0.68rem;">${escapeHtml(item.seller_rating)}</span>` : ""}
            <button type="button" class="mute-seller-inline" data-mute-seller="${escapeHtml(item.seller_info)}" title="Mute all listings from ${escapeHtml(item.seller_info)}">Mute</button>
          </div>
          <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">
            ${escapeHtml((item.alerted_at || "").replace("T", " ").slice(0, 16) || item.listed_age)}
          </span>
        </div>

        ${item.raw_description ? `<div class="seller-notes" title="${escapeHtml(item.raw_description)}">${escapeHtml(item.raw_description)}</div>` : ""}

        <div class="card-drawers-slot" data-drawers-for="${escapeHtml(item.id)}">${renderCardDrawersHtml(item)}</div>

        <div class="card-actions">
          <a href="${escapeHtml(item.add_to_cart_url)}" target="_blank" rel="noopener" class="btn-action btn-cart" title="1-Click Add to Discogs Cart">
            ${ICONS.cart}<span>Cart (${escapeHtml(item.total_price)})</span>
          </a>
          <a href="${escapeHtml(item.item_url)}" target="_blank" rel="noopener" class="btn-action" title="Open Discogs Listing #${escapeHtml(item.id)}">
            <span>Listing</span>${ICONS.ext}
          </a>
          <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}" title="Audition 30-second studio audio preview">
            ${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s"}</span>
          </button>
          <button type="button" class="btn-action" data-live-api-id="${escapeHtml(item.id)}" title="Verify live status &amp; Discogs API price suggestions">
            ${ICONS.bolt}<span>API</span>
          </button>
        </div>
      </article>
    `;
  }

  // Surgical single-card update (zero grid flicker!)
  function updateCardInPlace(listingId) {
    const item = getListingById(listingId);
    if (!item) return;
    const slot = document.querySelector(`.card-drawers-slot[data-drawers-for="${CSS.escape(String(listingId))}"]`);
    if (slot) {
      slot.innerHTML = renderCardDrawersHtml(item);
    }
    const liveBench = appState.liveApiResults[listingId]?.suggested_usd;
    if (liveBench) {
      const benchEl = document.querySelector(`[data-bench-val="${CSS.escape(String(listingId))}"]`);
      if (benchEl) {
        benchEl.textContent = formatUsd(liveBench);
        benchEl.classList.remove("matrix-val-muted");
      }
    }
    if (appState.inspectListingId === listingId) {
      openInspectModal(listingId);
    }
  }

  function syncAudioPlayingClassesInDOM() {
    document.querySelectorAll(".drop-card").forEach((card) => {
      const lid = card.dataset.listingId;
      const isPlaying = appState.currentlyPlayingId === lid;
      const isSpinning = isPlaying && appState.isAudioActuallyPlaying;
      card.classList.toggle("card-playing", isPlaying);
      const platter = card.querySelector(".vinyl-platter-wrap");
      if (platter) platter.classList.toggle("spinning", isSpinning);
      const btn = card.querySelector(".btn-audition");
      if (btn) {
        btn.classList.toggle("playing", isPlaying);
        btn.innerHTML = `${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s"}</span>`;
      }
    });
    const eq = document.getElementById("audio-eq-bars");
    if (eq) eq.classList.toggle("eq-active", appState.isAudioActuallyPlaying);
  }

  function renderRadarGrid() {
    const grid = document.getElementById("radar-drops-grid");
    const summaryEl = document.getElementById("radar-showing-summary");
    const mutedBar = document.getElementById("radar-muted-sellers-bar");
    const quickResetBtn = document.getElementById("btn-quick-reset-filters");
    if (!grid) return;

    const filtered = getFilteredListings();
    renderTopKPIs(filtered.length);

    if (quickResetBtn) {
      quickResetBtn.hidden = !hasActiveFilters();
    }

    if (summaryEl) {
      const scopeLabel = appState.scopeMode === "LIVE_P1" ? "Live Top-25 drops" : appState.dedupEnabled ? "unique deduplicated offerings" : "raw tracked listings";
      summaryEl.textContent = `Showing ${filtered.length} ${scopeLabel} (of ${SNIPER_STATE.listings?.length || 218} in snapshot)`;
    }

    if (mutedBar) {
      if (appState.mutedSellers.size > 0) {
        const names = Array.from(appState.mutedSellers).join(", ");
        mutedBar.innerHTML = `Muted: <strong style="color:var(--neon-crimson);">${escapeHtml(names)}</strong> <button type="button" id="btn-clear-muted" class="mute-seller-inline" style="margin-left:6px;">Unmute All</button>`;
        const clearBtn = document.getElementById("btn-clear-muted");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            appState.mutedSellers.clear();
            syncRuleInputsFromState();
            saveConfigOverrides();
            renderRadarGrid();
            renderForensicsView();
            showToast("Cleared all muted sellers.", "cyan");
          });
        }
      } else {
        mutedBar.innerHTML = "";
      }
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="panel-card" style="grid-column: 1 / -1; text-align: center; padding: 52px 20px;">
          <h3 style="font-family: var(--font-display); font-size: 1.15rem; margin-bottom: 8px; color: #fff;">No Wantlist Drops Match Current Filters</h3>
          <p style="color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 18px;">Reset filters, switch scope to All Tracked, or widen the max price ceiling.</p>
          <button type="button" class="btn-action btn-neon-cyan" id="btn-reset-all-filters">Reset All Filters</button>
        </div>`;
      const resetBtn = document.getElementById("btn-reset-all-filters");
      if (resetBtn) {
        resetBtn.addEventListener("click", resetAllRadarFilters);
      }
      return;
    }

    grid.innerHTML = filtered.map(renderDropCard).join("");
    observeCoverArtHydration();
  }

  // =====================================================================
  // 6. THROTTLED CLIENT-SIDE ALBUM ART HYDRATION (REMAINING 25 HISTORICAL)
  // =====================================================================
  let artObserver = null;
  const inflightArtQueries = new Set();
  const artQueue = [];
  let artQueueRunning = false;

  function fetchItunesCoverArt(artist, album) {
    const cleanArtist = String(artist || "").replace(/\s*\(\d+\)\s*/g, " ");
    const cleanAlbum = String(album || "").replace(/\s*\(\d+\)\s*/g, " ");
    const cleanTerm = `${cleanArtist} ${cleanAlbum}`.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanTerm) return Promise.resolve("");
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

  async function processArtQueue() {
    if (artQueueRunning) return;
    artQueueRunning = true;
    while (artQueue.length > 0) {
      const job = artQueue.shift();
      if (!job) break;
      try {
        const artUrl = await fetchItunesCoverArt(job.artist, job.album);
        if (artUrl) {
          appState.artCache[job.normKey] = artUrl;
          if (job.releaseId) appState.artCache[job.releaseId] = artUrl;
          saveArtCache();
          document.querySelectorAll(`img[data-norm-key="${CSS.escape(job.normKey)}"]`).forEach((el) => {
            el.src = artUrl;
            el.classList.remove("needs-art-hydration");
          });
        }
      } finally {
        inflightArtQueries.delete(job.normKey);
      }
      if (artQueue.length > 0) {
        await new Promise((res) => setTimeout(res, 320));
      }
    }
    artQueueRunning = false;
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
          const releaseId = img.dataset.releaseId;
          const artist = img.dataset.artist;
          const album = img.dataset.album;
          if (!normKey || appState.artCache[normKey] || inflightArtQueries.has(normKey)) return;

          inflightArtQueries.add(normKey);
          artQueue.push({ normKey, releaseId, artist, album });
          processArtQueue();
        });
      },
      { rootMargin: "220px" }
    );

    document.querySelectorAll("img.needs-art-hydration").forEach((img) => artObserver.observe(img));
  }

  // =====================================================================
  // 7. 30-SECOND STUDIO AUDIO PREVIEW ENGINE (RACE-SAFE + SCRUBBABLE)
  // =====================================================================
  let auditionRequestSeq = 0;

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
        try {
          delete window[cbName];
        } catch (_) {
          window[cbName] = undefined;
        }
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
    const progFill = document.getElementById("audio-progress-fill");
    const progThumb = document.getElementById("audio-progress-thumb");

    if (!audio || !bar) return;

    if (appState.currentlyPlayingId === listingId) {
      auditionRequestSeq += 1;
      audio.pause();
      appState.currentlyPlayingId = null;
      appState.isAudioActuallyPlaying = false;
      bar.classList.remove("visible");
      syncAudioPlayingClassesInDOM();
      return;
    }

    const item = getListingById(listingId);
    if (!item) return;

    const mySeq = ++auditionRequestSeq;
    audio.pause();
    appState.currentlyPlayingId = listingId;
    appState.isAudioActuallyPlaying = false;
    setStageChromaFromWax(item.wax_shader);
    bar.classList.add("visible");

    if (progFill) progFill.style.width = "0%";
    if (progThumb) progThumb.style.left = "0%";
    if (titleEl) titleEl.textContent = `${item.artist} — ${getDisplayAlbumTitle(item)}`;
    if (subEl) subEl.textContent = "Resolving 30s studio preview...";
    if (thumbEl) thumbEl.src = resolveCoverSrc(item);
    if (cartBtn) {
      cartBtn.href = item.add_to_cart_url;
      cartBtn.textContent = `Add to Cart (${item.total_price})`;
    }
    syncAudioPlayingClassesInDOM();

    const cleanQuery = `${item.artist} ${item.album}`.replace(/\s*\(\d+\)\s*/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
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

    if (mySeq !== auditionRequestSeq) return;

    if (!previewInfo) {
      const dz = await fetchDeezerJsonpPreview(cleanQuery);
      if (mySeq !== auditionRequestSeq) return;
      if (dz) {
        previewInfo = { ...dz, source: "Deezer Studio Preview" };
      }
    }

    if (!previewInfo || !previewInfo.previewUrl) {
      if (subEl) subEl.textContent = "30s preview unavailable for this pressing — open Discogs listing";
      showToast(`No audio preview found for ${item.artist} — ${item.album}`, "amber");
      return;
    }

    if (previewInfo.artwork && !appState.artCache[item.norm_album_key]) {
      appState.artCache[item.norm_album_key] = previewInfo.artwork;
      appState.artCache[item.release_id] = previewInfo.artwork;
      saveArtCache();
      if (thumbEl) thumbEl.src = previewInfo.artwork;
    }

    if (titleEl) titleEl.textContent = `${previewInfo.artistName || item.artist} — "${previewInfo.trackName}"`;
    if (subEl) subEl.textContent = `${previewInfo.source} // ${item.wax_shader?.wax_name || item.variant} (${item.total_price})`;
    audio.src = previewInfo.previewUrl;
    audio.play().catch(() => {
      if (subEl) subEl.textContent = "Click Play to start audio (autoplay blocked by browser)";
    });
  }

  // =====================================================================
  // 8. CORS-FREE OFFICIAL DISCOGS REST API v2.0 BROWSER CLIENT
  // =====================================================================
  function buildDiscogsApiUrl(path, includeToken = true) {
    let url = `https://api.discogs.com${path}`;
    if (includeToken && appState.discogsToken) {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}token=${encodeURIComponent(appState.discogsToken)}`;
    }
    return url;
  }

  async function discogsApiFetch(path, { allowAnonymous = true } = {}) {
    if (!allowAnonymous && !appState.discogsToken) {
      const err = new Error("DISCOGS_TOKEN required for this endpoint");
      err.code = "NO_TOKEN";
      throw err;
    }
    // Use preflight-free GET with ?token= query param and NO custom headers so CORS never triggers OPTIONS preflight
    const url = buildDiscogsApiUrl(path, Boolean(appState.discogsToken));
    let resp;
    try {
      resp = await fetch(url, { method: "GET" });
    } catch (networkErr) {
      const err = new Error("Network/CORS error reaching api.discogs.com (rate limit or offline)");
      err.code = "NETWORK_OR_CORS";
      throw err;
    }

    if (!resp.ok) {
      const err = new Error(`Discogs API HTTP ${resp.status}`);
      err.httpStatus = resp.status;
      throw err;
    }
    return resp.json();
  }

  async function verifyLiveListingViaAPI(listingId) {
    const item = getListingById(listingId);
    if (!item) return;

    appState.liveApiResults[listingId] = { loading: true };
    updateCardInPlace(listingId);

    const result = { loading: false };
    try {
      const [listingRes, statsRes, suggRes] = await Promise.allSettled([
        discogsApiFetch(`/marketplace/listings/${encodeURIComponent(listingId)}?curr_abbr=USD`),
        item.release_id && item.release_id !== "unknown"
          ? discogsApiFetch(`/marketplace/stats/${encodeURIComponent(item.release_id)}?curr_abbr=USD`)
          : Promise.resolve(null),
        appState.discogsToken && item.release_id && item.release_id !== "unknown"
          ? discogsApiFetch(`/marketplace/price_suggestions/${encodeURIComponent(item.release_id)}`, { allowAnonymous: false })
          : Promise.resolve(null),
      ]);

      const listingData = listingRes.status === "fulfilled" ? listingRes.value : null;
      const statsData = statsRes.status === "fulfilled" ? statsRes.value : null;
      const suggData = suggRes.status === "fulfilled" ? suggRes.value : null;

      if (!listingData && !statsData) {
        const reason = listingRes.status === "rejected" ? listingRes.reason : statsRes.reason;
        if (reason?.httpStatus === 404) {
          result.status = "Sold / Removed (404)";
        } else {
          throw new Error(
            reason?.message || "Could not reach api.discogs.com — connect DISCOGS_TOKEN in API & Rules for higher quota."
          );
        }
      }

      if (listingData) {
        result.status = listingData.status || "For Sale";
        result.allow_offers = Boolean(listingData.allow_offers);
        result.seller_rating = listingData.seller?.stats?.rating
          ? `${listingData.seller.stats.rating}% (${listingData.seller.stats.total || 0})`
          : "";
        const comm = listingData.release?.stats?.community;
        if (comm) {
          result.want = comm.in_wantlist;
          result.have = comm.in_collection;
        }
        const img = listingData.release?.images?.[0]?.uri || listingData.release?.thumbnail;
        if (img) {
          appState.artCache[item.norm_album_key] = img;
          appState.artCache[item.release_id] = img;
          saveArtCache();
        }
      } else if (!result.status) {
        const listingErr = listingRes.status === "rejected" ? listingRes.reason : null;
        result.status = listingErr?.httpStatus === 404 ? "Sold / Removed (404)" : "Unknown";
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
          result.suggested_usd = Number(suggObj.value);
          result.suggested_str = `$${Number(suggObj.value).toFixed(2)} (Official API)`;
        }
      }
    } catch (err) {
      result.error = err.message || "Discogs API query failed.";
    }

    appState.liveApiResults[listingId] = result;
    updateCardInPlace(listingId);
  }

  // =====================================================================
  // 9. VIEW 2: RELIST FORENSICS, PRECISION CHARTS & FULL 88-SELLER TABLE
  // =====================================================================
  function renderForensicsView() {
    const f = SNIPER_STATE.forensics || {};

    // Chart 1: 24-Hour Alert Spectrum (zero overflow, separated axis row)
    const hourlyContainer = document.getElementById("chart-hourly-alerts");
    if (hourlyContainer && f.alerts_by_hour) {
      const entries = Object.entries(f.alerts_by_hour).sort(([a], [b]) => a.localeCompare(b));
      const maxVal = Math.max(1, ...entries.map(([, v]) => Number(v)));

      const colsHtml = entries
        .map(([hr, cnt]) => {
          const n = Number(cnt);
          const pxHeight = n > 0 ? Math.max(6, Math.round((n / maxVal) * 124)) : 2;
          const isSpike = hr === "12" || hr === "13" || hr === "01";
          const barClass = n === 0 ? "bar-zero" : isSpike ? "bar-spike" : "";
          return `
            <div class="chart-col" title="${hr}:00 — ${n} alerts dispatched">
              <span class="chart-val">${n > 0 ? n : ""}</span>
              <div class="chart-bar ${barClass}" style="height:${pxHeight}px;"></div>
            </div>`;
        })
        .join("");

      const ticksHtml = entries
        .map(([hr], idx) => `<span class="chart-tick ${idx % 2 === 1 ? "chart-tick-even-hide" : ""}">${hr}h</span>`)
        .join("");

      hourlyContainer.innerHTML = `
        <div class="chart-plot-area">${colsHtml}</div>
        <div class="chart-xaxis">${ticksHtml}</div>`;
    }

    // Chart 2: 14-Day Engine Check Telemetry with 288/day Baseline Reference Line
    const dailyContainer = document.getElementById("chart-daily-checks");
    if (dailyContainer && f.checks_by_day) {
      const entries = Object.entries(f.checks_by_day).sort(([a], [b]) => a.localeCompare(b));
      const maxVal = Math.max(300, ...entries.map(([, v]) => Number(v)));
      const refBottomPx = Math.round((288 / maxVal) * 124);

      const colsHtml = entries
        .map(([day, cnt]) => {
          const n = Number(cnt);
          const pxHeight = Math.max(6, Math.round((n / maxVal) * 124));
          const isDoubleBug = n > 320;
          return `
            <div class="chart-col" title="${day}: ${n} checks (${isDoubleBug ? "576/day Dual-Trigger Bug" : "288/day Normal 5-Min Clock"})">
              <span class="chart-val">${n}</span>
              <div class="chart-bar ${isDoubleBug ? "bar-anomaly" : "bar-clean"}" style="height:${pxHeight}px;"></div>
            </div>`;
        })
        .join("");

      const ticksHtml = entries
        .map(([day]) => `<span class="chart-tick">${day.slice(5)}</span>`)
        .join("");

      dailyContainer.innerHTML = `
        <div class="chart-plot-area">
          <div class="chart-ref-line" style="bottom:${refBottomPx}px;">
            <span class="chart-ref-label">288/day target</span>
          </div>
          ${colsHtml}
        </div>
        <div class="chart-xaxis">${ticksHtml}</div>`;
    }

    // Full Searchable Seller Leaderboard (all 88 sellers + Drop-Only + Mute)
    const sellersTbody = document.getElementById("tbody-seller-leaderboard");
    const sellersCountBadge = document.getElementById("forensics-sellers-count");
    const toggleAllBtn = document.getElementById("btn-toggle-all-sellers");
    const allSellers = SNIPER_STATE.seller_leaderboard || [];
    const q = appState.sellerSearchQuery.toLowerCase();
    const matchedSellers = q ? allSellers.filter((s) => s.seller.toLowerCase().includes(q)) : allSellers;

    if (sellersCountBadge) sellersCountBadge.textContent = `${allSellers.length} Sellers`;
    if (toggleAllBtn) {
      toggleAllBtn.hidden = matchedSellers.length <= 20;
      toggleAllBtn.textContent = appState.showAllSellers
        ? "Show Top 20"
        : `Show All ${matchedSellers.length}`;
    }

    const visibleSellers = appState.showAllSellers || q ? matchedSellers : matchedSellers.slice(0, 20);
    if (sellersTbody) {
      sellersTbody.innerHTML = visibleSellers
        .map((s) => {
          const sLow = s.seller.toLowerCase();
          const isMuted = appState.mutedSellers.has(sLow);
          const isDropOnly = appState.priceDropOnlySellers.has(sLow);
          const clsBadge =
            s.classification === "AUTO-RELIST BOT"
              ? "badge-crimson"
              : s.classification === "HIGH-VOLUME DEALER"
              ? "badge-amber"
              : "badge-lime";
          return `
            <tr>
              <td>
                <a href="${escapeHtml(s.seller_url)}" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-weight:700;color:#fff;">${escapeHtml(s.seller)}</a>
                <div style="font-size:0.7rem;color:var(--text-muted);">${s.share_of_snapshot_pct}% share</div>
              </td>
              <td style="font-family:var(--font-mono);font-weight:700;">${s.total_listings}</td>
              <td style="font-family:var(--font-mono);">${s.unique_releases}</td>
              <td style="font-family:var(--font-mono);color:var(--neon-amber);">${s.auto_relists} (${s.relist_rate_pct}%)</td>
              <td style="font-family:var(--font-mono);">${formatUsd(s.min_price_usd)} / ${formatUsd(s.avg_price_usd)}</td>
              <td><span class="kpi-badge ${clsBadge}">${escapeHtml(s.classification)}</span></td>
              <td>
                <div class="seller-ctrl-group">
                  <button type="button" class="btn-micro ${isDropOnly ? "active-amber" : ""}" data-toggle-droponly-seller="${escapeHtml(s.seller)}" title="Only alert when this seller drops price">
                    ${isDropOnly ? "Drop-Only: ON" : "Drop-Only"}
                  </button>
                  <button type="button" class="btn-micro ${isMuted ? "active-crimson" : ""}" data-toggle-mute-seller="${escapeHtml(s.seller)}" title="Hard-mute all drops from this seller">
                    ${isMuted ? "Muted" : "Mute"}
                  </button>
                </div>
              </td>
            </tr>`;
        })
        .join("");
    }

    // Most Churned Releases Table
    const churnTbody = document.getElementById("tbody-release-churn");
    const churn = SNIPER_STATE.release_churn_leaderboard || [];
    if (churnTbody) {
      churnTbody.innerHTML = churn
        .map((r) => {
          const fallbackUri = renderFallbackSleeveDataUri(r.title, r.title);
          const vBadge =
            r.vault_status === "ALREADY_OWNED"
              ? `<span class="kpi-badge badge-crimson">Owned</span>`
              : r.vault_status === "VARIANT_UPGRADE"
              ? `<span class="kpi-badge badge-magenta">Variant</span>`
              : `<span class="kpi-badge badge-lime">Grail</span>`;
          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${escapeHtml(r.cover_image_url || fallbackUri)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="" style="width:36px;height:36px;border-radius:5px;object-fit:cover;border:1px solid var(--border-strong);flex-shrink:0;" />
                  <div style="min-width:0;">
                    <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
                    <div style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;">${escapeHtml(r.variant)}</div>
                  </div>
                </div>
              </td>
              <td style="font-family:var(--font-mono);font-weight:700;color:var(--neon-amber);">${r.total_listings}x</td>
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
  // 10. VIEW 3: COLLECTION VAULT BRIDGE & LIVE WANTLIST VERIFICATION
  // =====================================================================
  async function syncLiveWantlistFromAPI({ silent = false } = {}) {
    appState.liveWantlistLoading = true;
    appState.liveWantlistError = "";
    renderTopKPIs();
    renderVaultBridgeView();

    try {
      const liveIds = new Set();
      let page = 1;
      let totalPages = 1;
      const maxPages = 15;

      while (page <= totalPages && page <= maxPages) {
        const data = await discogsApiFetch(
          `/users/${encodeURIComponent(appState.discogsUsername)}/wants?page=${page}&per_page=100`,
          { allowAnonymous: true }
        );
        if (!data || !Array.isArray(data.wants)) {
          throw new Error("Unexpected response from /users/{username}/wants");
        }
        for (const w of data.wants) {
          const rawId = w?.id ?? w?.basic_information?.id;
          if (rawId != null) liveIds.add(String(rawId));
        }
        totalPages = Number(data.pagination?.pages || 1);
        page += 1;
        if (page <= totalPages && !appState.discogsToken) {
          // Gentle pacing for unauthenticated public quota
          await new Promise((r) => setTimeout(r, 450));
        }
      }

      appState.liveWantlistIds = liveIds;
      appState.liveWantlistSource = appState.discogsToken ? "authenticated_live" : "public_live";
      appState.liveWantlistTotal = liveIds.size;
      appState.liveWantlistSyncedAt = new Date().toLocaleTimeString();

      const exactList = SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [];
      for (const r of exactList) {
        const rid = String(r.release_id);
        if (liveIds.has(rid)) {
          appState.prunedReleaseIds.delete(rid);
        } else {
          appState.prunedReleaseIds.add(rid);
        }
      }
      savePrunedReleaseIds();
      appState.liveWantlistLoading = false;
      renderTopKPIs();
      renderVaultBridgeView();
      renderRadarGrid();

      if (!silent) {
        const rem = getActiveExactOwnedList().length;
        showToast(
          rem === 0
            ? `Live Wantlist clean: 0 exact-owned overlaps across ${liveIds.size} wants.`
            : `Synced ${liveIds.size} live wants: ${rem} exact-owned overlap(s) still active.`,
          rem === 0 ? "lime" : "amber"
        );
      }
      return liveIds;
    } catch (err) {
      appState.liveWantlistLoading = false;
      const isAuthBlocked = err.httpStatus === 401 || err.httpStatus === 403;
      if (isAuthBlocked) {
        appState.liveWantlistError = `Wantlist for @${appState.discogsUsername} is private (HTTP ${err.httpStatus}). Connect DISCOGS_TOKEN to verify live.`;
      } else if (!silent) {
        appState.liveWantlistError = err.message || String(err);
      } else {
        appState.liveWantlistError = "";
      }
      renderTopKPIs();
      renderVaultBridgeView();
      if (!silent) {
        showToast(appState.liveWantlistError, "amber", 5000);
      }
      return null;
    }
  }

  async function pruneReleaseFromWantlistAPI(releaseId, title, { silent = false } = {}) {
    if (!appState.discogsToken) {
      if (!silent) {
        showToast("Connect your DISCOGS_TOKEN first (or run python discogs_sniper.py --prune-owned).", "amber", 4800);
        openQuickApiModal();
      }
      return { ok: false, status: "unauthenticated" };
    }

    const rid = String(releaseId);
    const url = buildDiscogsApiUrl(
      `/users/${encodeURIComponent(appState.discogsUsername)}/wants/${encodeURIComponent(rid)}`,
      true
    );

    try {
      const resp = await fetch(url, { method: "DELETE" });
      if (resp.status === 204 || resp.status === 200 || resp.status === 404) {
        appState.prunedReleaseIds.add(rid);
        if (appState.liveWantlistIds !== null) appState.liveWantlistIds.delete(rid);
        savePrunedReleaseIds();
        renderTopKPIs();
        renderVaultBridgeView();
        renderRadarGrid();
        if (!silent) {
          showToast(
            resp.status === 404
              ? `Release #${rid} was already removed from your live Wantlist.`
              : `Removed ${title} (#${rid}) from Discogs Wantlist.`,
            "lime"
          );
        }
        return { ok: true, status: resp.status === 404 ? "already_absent" : "removed", httpStatus: resp.status };
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      const likelyCors = err instanceof TypeError || /failed to fetch/i.test(String(err.message || ""));
      const msg = likelyCors
        ? `Browser DELETE blocked by Discogs CORS policy. Run: python discogs_sniper.py --prune-owned`
        : `Could not delete release #${rid}: ${err.message}`;
      if (!silent) {
        showToast(msg, "crimson", 6000);
      }
      return { ok: false, status: likelyCors ? "cors_blocked" : "error", message: msg };
    }
  }

  function renderVaultBridgeView() {
    const vb = SNIPER_STATE.vault_bridge || {};
    const s = SNIPER_STATE.summary || {};
    const exactList = vb.exact_owned_on_wantlist || [];
    const variantList = vb.variant_upgrades_on_wantlist || [];
    const activeList = getActiveExactOwnedList();
    const clearedList = getClearedExactOwnedList();
    const activeCount = activeList.length;
    const vaultTotal = s.vault_total_owned_lps ?? 159;
    const isLiveVerified = appState.liveWantlistIds !== null;

    const headingEl = document.getElementById("vault-exact-owned-heading");
    const badgeEl = document.getElementById("vault-exact-owned-badge");
    const pruneAllBtn = document.getElementById("btn-prune-all-owned-api");
    const syncBtn = document.getElementById("btn-sync-live-wantlist");
    const statusEl = document.getElementById("vault-live-sync-status");
    const activeWrap = document.getElementById("vault-active-overlaps-wrap");
    const archiveDetails = document.getElementById("vault-cleared-archive");
    const archiveSummary = document.getElementById("vault-cleared-summary-label");

    if (headingEl) {
      if (isLiveVerified && activeCount === 0) {
        headingEl.textContent = `Live Wantlist Verified Clean — 0 Exact-Owned Overlaps Remaining`;
      } else if (isLiveVerified) {
        headingEl.textContent = `${activeCount} Active Exact-Owned Pressing${activeCount === 1 ? "" : "s"} Still on Your Live Wantlist`;
      } else {
        headingEl.textContent = `${activeCount} Historical Vault Matches in Snapshot (0 in Live Top-25 Scan)`;
      }
    }

    if (badgeEl) {
      if (appState.liveWantlistLoading) {
        badgeEl.className = "kpi-badge badge-cyan";
        badgeEl.textContent = "Querying Live Wantlist...";
      } else if (isLiveVerified && activeCount === 0) {
        badgeEl.className = "kpi-badge badge-lime";
        badgeEl.textContent = "Live Wantlist Clean";
      } else if (isLiveVerified) {
        badgeEl.className = "kpi-badge badge-crimson";
        badgeEl.textContent = `${activeCount} Live Overlap${activeCount === 1 ? "" : "s"}`;
      } else {
        badgeEl.className = "kpi-badge badge-amber";
        badgeEl.textContent = "Snapshot History (Unverified)";
      }
    }

    if (pruneAllBtn && !pruneAllBtn.dataset.busy) {
      if (activeCount === 0) {
        pruneAllBtn.disabled = true;
        pruneAllBtn.innerHTML = `${ICONS.check}<span>0 Active Overlaps to Prune</span>`;
      } else {
        pruneAllBtn.disabled = false;
        pruneAllBtn.innerHTML = `${ICONS.trash}<span>Prune ${activeCount} Pressing${activeCount === 1 ? "" : "s"} (API)</span>`;
      }
    }

    if (syncBtn) {
      syncBtn.disabled = appState.liveWantlistLoading;
      syncBtn.querySelector("span").textContent = appState.liveWantlistLoading
        ? "Syncing Live Wantlist..."
        : "Sync Live Wantlist";
    }

    if (statusEl) {
      statusEl.className = "vault-sync-banner";
      if (appState.liveWantlistLoading) {
        statusEl.textContent = `Querying GET https://api.discogs.com/users/${appState.discogsUsername}/wants ...`;
      } else if (appState.liveWantlistError) {
        statusEl.classList.add("banner-warn");
        statusEl.textContent = `${appState.liveWantlistError} Showing ${activeCount} historical snapshot records (${s.exact_owned_in_live_page1 ?? 0} in latest Live Top-25 scan).`;
      } else if (isLiveVerified) {
        const modeTag = appState.liveWantlistSource === "prebaked" ? "Build-Time Sync" : appState.liveWantlistSource === "authenticated_live" ? "Authenticated Live API" : "Public Live API";
        if (activeCount === 0) {
          statusEl.classList.add("banner-clean");
          statusEl.textContent = `VERIFIED (${modeTag} // @${appState.discogsUsername} @ ${appState.liveWantlistSyncedAt}): Checked ${appState.liveWantlistTotal} live Wantlist releases. All ${exactList.length} historical Vault pressings from past sniper runs have already been removed from your live Wantlist.`;
        } else {
          statusEl.classList.add("banner-warn");
          statusEl.textContent = `LIVE AUDIT (${modeTag} // @${appState.discogsUsername} @ ${appState.liveWantlistSyncedAt}): Checked ${appState.liveWantlistTotal} live Wantlist releases — ${activeCount} owned pressing(s) are still on your live Wantlist.`;
        }
      } else {
        statusEl.textContent = `Snapshot history view: ${activeCount} owned pressing(s) appeared in Nov 8–18 sniper logs (0 of ${activeCount} in latest Live Top-25 scan). Click "Sync Live Wantlist" or connect DISCOGS_TOKEN to verify live status against your ${vaultTotal}-LP Collection Vault.`;
      }
    }

    // Active Overlaps Table
    if (activeWrap) {
      activeWrap.hidden = activeCount === 0;
    }

    const exactTbody = document.getElementById("tbody-vault-exact-owned");
    if (exactTbody) {
      exactTbody.innerHTML = activeList
        .map((r) => {
          const fallbackUri = renderFallbackSleeveDataUri(r.artist, r.album);
          const statusChip = isLiveVerified
            ? `<span class="kpi-badge badge-crimson">On Live Wantlist</span>`
            : `<span class="kpi-badge badge-amber">Historical Log</span>`;
          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${escapeHtml(r.cover_image_url || fallbackUri)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="" style="width:42px;height:42px;border-radius:6px;object-fit:cover;border:1px solid var(--border-strong);flex-shrink:0;" />
                  <div>
                    <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
                    <div style="font-size:0.72rem;color:var(--text-secondary);">${escapeHtml(r.owned_format)}</div>
                  </div>
                </div>
              </td>
              <td style="font-family:var(--font-mono);">#${escapeHtml(r.release_id)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml((r.owned_date_added || "").slice(0, 10) || "In Vault")}</td>
              <td style="font-family:var(--font-mono);color:var(--neon-lime);">${formatUsd(r.owned_value_usd)}</td>
              <td style="font-family:var(--font-mono);">${r.wantlist_hits_count}x (${formatUsd(r.lowest_sniped_usd)})</td>
              <td>${statusChip}</td>
              <td>
                <button
                  type="button"
                  class="btn-action btn-neon-crimson btn-sm"
                  data-prune-release-id="${escapeHtml(r.release_id)}"
                  data-prune-title="${escapeHtml(r.title)}"
                >
                  ${ICONS.trash}<span>Remove</span>
                </button>
              </td>
            </tr>`;
        })
        .join("");
    }

    // Cleared Historical Archive Accordion
    if (archiveDetails) {
      archiveDetails.hidden = clearedList.length === 0;
      if (archiveSummary) {
        archiveSummary.textContent = `Historical Archive: ${clearedList.length} Previously Owned Pressing${clearedList.length === 1 ? "" : "s"} (Already Cleared from Live Wantlist)`;
      }
      const clearedTbody = document.getElementById("tbody-vault-cleared-archive");
      if (clearedTbody) {
        clearedTbody.innerHTML = clearedList
          .map((r) => {
            const fallbackUri = renderFallbackSleeveDataUri(r.artist, r.album);
            return `
            <tr style="opacity:0.78;">
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${escapeHtml(r.cover_image_url || fallbackUri)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="" style="width:38px;height:38px;border-radius:6px;object-fit:cover;border:1px solid var(--border-strong);flex-shrink:0;" />
                  <div>
                    <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:600;color:#fff;">${escapeHtml(r.title)}</a>
                    <div style="font-size:0.71rem;color:var(--text-secondary);">${escapeHtml(r.owned_format)}</div>
                  </div>
                </div>
              </td>
              <td style="font-family:var(--font-mono);">#${escapeHtml(r.release_id)}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml((r.owned_date_added || "").slice(0, 10) || "In Vault")}</td>
              <td style="font-family:var(--font-mono);color:var(--neon-lime);">${formatUsd(r.owned_value_usd)}</td>
              <td style="font-family:var(--font-mono);">${r.wantlist_hits_count}x</td>
              <td style="font-family:var(--font-mono);">${formatUsd(r.lowest_sniped_usd)}</td>
              <td><span class="kpi-badge badge-lime">Cleared</span></td>
            </tr>`;
          })
          .join("");
      }
    }

    // Variant Hunter Table (Intentional Targets)
    const variantsHeading = document.getElementById("vault-variants-heading");
    if (variantsHeading) {
      variantsHeading.textContent = `${variantList.length} Variant Upgrade Targets (Alternate Pressings of Owned Albums)`;
    }
    const varTbody = document.getElementById("tbody-vault-variants");
    if (varTbody) {
      varTbody.innerHTML = variantList
        .map((r) => {
          const fallbackUri = renderFallbackSleeveDataUri(r.artist, r.album, "#ff1f8f");
          return `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${escapeHtml(r.cover_image_url || fallbackUri)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="" style="width:42px;height:42px;border-radius:6px;object-fit:cover;border:1px solid var(--border-strong);flex-shrink:0;" />
                <div>
                  <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
                  <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">Target Release #${escapeHtml(r.wantlist_release_id)}</div>
                </div>
              </div>
            </td>
            <td style="color:#ff6cb9;font-size:0.79rem;">${escapeHtml(r.wantlist_variant)}</td>
            <td style="color:var(--text-secondary);font-size:0.79rem;">
              ${escapeHtml(r.owned_format)}
              <span style="font-family:var(--font-mono);color:var(--neon-lime);">(${formatUsd(r.owned_value_usd)})</span>
            </td>
            <td style="font-family:var(--font-mono);font-weight:700;">${formatUsd(r.lowest_sniped_usd)} (${r.wantlist_hits_count}x)</td>
            <td>
              <a href="${escapeHtml(r.release_url)}" target="_blank" rel="noopener" class="btn-action btn-sm">Inspect ${ICONS.ext}</a>
            </td>
          </tr>`;
        })
        .join("");
    }
  }

  // =====================================================================
  // 11. PRESSING QUICK-INSPECT NEON LIGHTBOX & QUICK API MODAL
  // =====================================================================
  function openInspectModal(listingId) {
    const item = getListingById(listingId);
    const backdrop = document.getElementById("inspect-modal-backdrop");
    const body = document.getElementById("inspect-modal-body");
    if (!item || !backdrop || !body) return;

    appState.inspectListingId = listingId;
    setStageChromaFromWax(item.wax_shader);

    const fallbackUri = renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary);
    const coverSrc = resolveCoverSrc(item);
    const mkt = item.market_stats || {};
    const waxPrimary = item.wax_shader?.primary && item.wax_shader.primary !== "#181a1f" ? item.wax_shader.primary : "#00f0ff";
    const waxGlow = hexToRgba(waxPrimary, 0.35);
    const isPlaying = appState.currentlyPlayingId === item.id;
    const vaultPhoto = item.vault_owned_detail?.pressing_image_url || "";

    body.innerHTML = `
      <div class="inspect-hero" style="--wax-glow:${waxGlow};">
        <div class="inspect-vinyl-stage">
          <div class="inspect-sleeve">
            <img src="${escapeHtml(coverSrc)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="${escapeHtml(item.title)}" />
          </div>
          <div class="inspect-platter">
            ${renderVinylDiscSVG(item.wax_shader, `modal-${item.id}`, 146)}
          </div>
        </div>

        <div class="inspect-meta">
          <div class="status-pills" style="margin-bottom:8px;">
            ${renderVaultStatusPill(item)}
            ${item.is_live_page1 ? `<span class="tag-pill badge-cyan">LIVE PAGE 1</span>` : `<span class="tag-pill badge-neutral">HISTORICAL</span>`}
            ${item.allow_offers ? `<span class="tag-pill badge-amber">MAKE OFFER</span>` : ""}
          </div>
          <div class="drop-artist" style="font-size:0.8rem;">${escapeHtml(item.artist)}</div>
          <h2 id="inspect-modal-title" style="font-family:var(--font-display);font-size:1.45rem;color:#fff;margin:3px 0 8px;">${escapeHtml(getDisplayAlbumTitle(item))}</h2>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:10px;">${escapeHtml(item.variant)}</p>
          <div style="font-family:var(--font-mono);font-size:0.74rem;color:var(--text-muted);">
            Listing #${escapeHtml(item.id)} // Release #${escapeHtml(item.release_id)} // Seller: <a href="https://www.discogs.com/seller/${encodeURIComponent(item.seller_info)}/profile" target="_blank" rel="noopener" class="inline-neon-link">${escapeHtml(item.seller_info)}</a>
          </div>
        </div>
      </div>

      <div class="inspect-spec-grid">
        <div class="inspect-spec-cell">
          <span class="matrix-label">Total Shipped</span>
          <div class="matrix-val matrix-val-price" style="font-size:1.25rem;">${escapeHtml(item.total_price)}</div>
          <div class="matrix-sub">${escapeHtml(item.list_price)} + ${formatUsd(item.shipping_price_usd)} ship</div>
        </div>
        <div class="inspect-spec-cell">
          <span class="matrix-label">Benchmark (${escapeHtml(item.media_condition)})</span>
          <div class="matrix-val" style="font-size:1.1rem;">${escapeHtml(mkt.condition_suggested_formatted || "Live API")}</div>
          <div class="matrix-sub">${escapeHtml(mkt.benchmark_source || "")}</div>
        </div>
        <div class="inspect-spec-cell">
          <span class="matrix-label">Condition Grade</span>
          <div class="matrix-val" style="font-size:1.1rem;">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</div>
          <div class="matrix-sub">${escapeHtml(item.media_condition_full || "")}</div>
        </div>
        <div class="inspect-spec-cell">
          <span class="matrix-label">Observed Range</span>
          <div class="matrix-val" style="font-size:1.05rem;">${formatUsd(mkt.observed_low_usd)} – ${formatUsd(mkt.observed_high_usd)}</div>
          <div class="matrix-sub">${mkt.release_listings_tracked || 1} tracked offering(s)</div>
        </div>
      </div>

      ${item.raw_description ? `<div class="seller-notes" style="-webkit-line-clamp:unset;margin-bottom:14px;"><strong style="color:var(--neon-cyan);font-family:var(--font-mono);font-size:0.68rem;display:block;margin-bottom:4px;">SELLER NOTES</strong>${escapeHtml(item.raw_description)}</div>` : ""}

      ${vaultPhoto ? `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:10px;border-radius:8px;background:rgba(255,31,143,0.07);border:1px solid rgba(255,31,143,0.25);"><img src="${escapeHtml(vaultPhoto)}" alt="Vault pressing photo" style="width:54px;height:54px;border-radius:50%;object-fit:cover;border:1px solid var(--neon-magenta);" /><div style="font-size:0.78rem;"><strong style="color:#ff6cb9;">Your Vault Pressing Reference:</strong><div style="color:var(--text-secondary);">${escapeHtml(item.vault_owned_detail?.format_string || "")}</div></div></div>` : ""}

      <div style="margin-bottom:14px;">${renderCardDrawersHtml(item)}</div>

      <div class="card-actions">
        <a href="${escapeHtml(item.add_to_cart_url)}" target="_blank" rel="noopener" class="btn-action btn-cart">
          ${ICONS.cart}<span>1-Click Add to Cart (${escapeHtml(item.total_price)})</span>
        </a>
        <a href="${escapeHtml(item.item_url)}" target="_blank" rel="noopener" class="btn-action">Listing ${ICONS.ext}</a>
        <a href="${escapeHtml(item.release_url)}" target="_blank" rel="noopener" class="btn-action">Release ${ICONS.ext}</a>
        <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}">
          ${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s Preview"}</span>
        </button>
        <button type="button" class="btn-action btn-neon-cyan" data-live-api-id="${escapeHtml(item.id)}">
          ${ICONS.bolt}<span>Query Live API</span>
        </button>
      </div>
    `;

    backdrop.hidden = false;
  }

  function closeInspectModal() {
    const backdrop = document.getElementById("inspect-modal-backdrop");
    if (backdrop) backdrop.hidden = true;
    appState.inspectListingId = null;
  }

  function openQuickApiModal() {
    const backdrop = document.getElementById("api-modal-backdrop");
    if (!backdrop) return;
    const u = document.getElementById("quick-api-username");
    const t = document.getElementById("quick-api-token");
    if (u) u.value = appState.discogsUsername;
    if (t) t.value = appState.discogsToken;
    backdrop.hidden = false;
    setTimeout(() => t?.focus(), 40);
  }

  function closeQuickApiModal() {
    const backdrop = document.getElementById("api-modal-backdrop");
    if (backdrop) backdrop.hidden = true;
  }

  // =====================================================================
  // 12. VIEW 4: PERSISTENT SNIPER RULE BUILDER & API CONSOLE
  // =====================================================================
  function hydrateRuleInputsFromConfig() {
    const dedup = baseConfig.relist_deduplication || {};
    const vBridge = baseConfig.collection_vault_bridge || {};
    const filters = baseConfig.filters || {};

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = String(val);
    };

    setVal("cfg-cooldown-days", savedOverrides.cooldown_days ?? dedup.cooldown_days ?? 7);
    setVal("cfg-price-drop-usd", savedOverrides.price_drop_override_usd ?? dedup.price_drop_override_usd ?? 1.0);
    const maxP = savedOverrides.max_total_price_usd !== undefined ? savedOverrides.max_total_price_usd : filters.max_total_price_usd;
    setVal("cfg-max-price", maxP ?? "");
    const suppOwned =
      savedOverrides.suppress_exact_owned_alerts !== undefined
        ? savedOverrides.suppress_exact_owned_alerts
        : Boolean(vBridge.suppress_exact_owned_alerts);
    setVal("cfg-suppress-owned", suppOwned ? "true" : "false");
    setVal("cfg-pricedrop-sellers", [...appState.priceDropOnlySellers].join(", "));
    setVal("cfg-muted-sellers", [...appState.mutedSellers].join(", "));
  }

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
      schema_version: SNIPER_STATE.schema_version || "2.1.0-beta",
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
        local_collection_path: baseConfig.collection_vault_bridge?.local_collection_path || "C:\\Discogs_collection\\data\\collection.json",
      },
      filters: {
        min_media_condition: appState.conditionFilter === "ALL" ? baseConfig.filters?.min_media_condition || "VG+" : appState.conditionFilter,
        min_sleeve_condition: baseConfig.filters?.min_sleeve_condition || "Any",
        max_total_price_usd: maxPriceRaw ? Number(maxPriceRaw) : null,
        muted_sellers: muted,
        price_drop_only_sellers: pdSellers,
        target_prices_by_release: baseConfig.filters?.target_prices_by_release || {},
      },
      alerts: {
        email_to: baseConfig.alerts?.email_to || "alexgoresch@gmail.com",
        email_cc: baseConfig.alerts?.email_cc || "mleven42@gmail.com",
        ntfy_base: baseConfig.alerts?.ntfy_base || "https://ntfy.sh",
        auto_rebuild_static_dashboard: true,
      },
    };
  }

  function syncRuleInputsFromState() {
    const mutedInput = document.getElementById("cfg-muted-sellers");
    if (mutedInput) mutedInput.value = [...appState.mutedSellers].join(", ");
    const pdInput = document.getElementById("cfg-pricedrop-sellers");
    if (pdInput) pdInput.value = [...appState.priceDropOnlySellers].join(", ");
    updateConfigJsonPreview();
  }

  function updateConfigJsonPreview() {
    const preview = document.getElementById("config-json-preview");
    if (!preview) return;
    preview.textContent = JSON.stringify(buildCurrentConfigObject(), null, 2);
  }

  async function saveAndVerifyDiscogsToken(rawUser, rawTok) {
    const consoleOut = document.getElementById("api-console-output");
    appState.discogsUsername = rawUser || "krunked";
    appState.discogsToken = rawTok || "";
    safeSetStorage(STORAGE_KEYS.USER, appState.discogsUsername);
    if (appState.discogsToken) safeSetStorage(STORAGE_KEYS.TOKEN, appState.discogsToken);
    else safeRemoveStorage(STORAGE_KEYS.TOKEN);
    updateApiConnectionStatusUI();
    updateConfigJsonPreview();

    if (!appState.discogsToken) {
      if (consoleOut) consoleOut.textContent = "// Paste a Discogs Personal Access Token first.";
      showToast("Paste your Discogs Personal Access Token first.", "amber");
      return false;
    }

    if (consoleOut) consoleOut.textContent = "// Querying GET https://api.discogs.com/oauth/identity?token=*** ...";
    try {
      const ident = await discogsApiFetch("/oauth/identity", { allowAnonymous: false });
      if (ident && ident.username) {
        appState.discogsUsername = ident.username;
        safeSetStorage(STORAGE_KEYS.USER, ident.username);
        updateApiConnectionStatusUI();
        updateConfigJsonPreview();
      }
      if (consoleOut) {
        consoleOut.textContent = `// HTTP 200 OK — Authenticated via Official Discogs API v2.0:\n${JSON.stringify(ident, null, 2)}`;
      }
      showToast(`Authenticated as @${appState.discogsUsername} via Discogs API v2.0.`, "lime");
      await syncLiveWantlistFromAPI({ silent: true });
      return true;
    } catch (err) {
      if (consoleOut) {
        consoleOut.textContent = `// Error verifying token against /oauth/identity: ${err.message}`;
      }
      showToast(`Token verification failed: ${err.message}`, "crimson", 4800);
      return false;
    }
  }

  // =====================================================================
  // 13. VIEW ROUTING & EVENT BINDINGS
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
    // Initialize dynamic price slider ceiling
    const priceSlider = document.getElementById("radar-max-price-slider");
    const priceReadout = document.getElementById("max-price-readout");
    if (priceSlider) {
      priceSlider.max = String(appState.sliderMaxUsd);
      priceSlider.value = String(appState.sliderMaxUsd);
    }

    // View Navigation & Brand Home
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    document.getElementById("btn-brand-home")?.addEventListener("click", () => switchView("radar"));

    // Interactive KPI Cards jump directly to views
    document.querySelectorAll(".kpi-card[data-jump-view]").forEach((card) => {
      card.addEventListener("click", () => {
        const target = card.dataset.jumpView;
        if (target) switchView(target);
      });
    });

    // Lighting Mode Toggle (NEON / UV)
    document.getElementById("btn-toggle-uv")?.addEventListener("click", () => {
      appState.lightingMode = appState.lightingMode === "uv" ? "neon" : "uv";
      applyLightingMode();
      showToast(
        appState.lightingMode === "uv" ? "UV Blacklight Overdrive engaged." : "Neon Telemetry mode active.",
        "cyan",
        2200
      );
    });

    // Quick API Modal Trigger
    document.getElementById("btn-open-api-modal")?.addEventListener("click", openQuickApiModal);
    document.getElementById("btn-close-api-modal")?.addEventListener("click", closeQuickApiModal);
    document.getElementById("api-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "api-modal-backdrop") closeQuickApiModal();
    });
    document.getElementById("btn-quick-api-save")?.addEventListener("click", async () => {
      const u = document.getElementById("quick-api-username")?.value.trim() || "krunked";
      const t = document.getElementById("quick-api-token")?.value.trim() || "";
      const ok = await saveAndVerifyDiscogsToken(u, t);
      if (ok) closeQuickApiModal();
    });
    document.getElementById("btn-quick-api-open-console")?.addEventListener("click", () => {
      closeQuickApiModal();
      switchView("rules");
    });

    // Pressing Inspect Modal Close
    document.getElementById("btn-close-inspect-modal")?.addEventListener("click", closeInspectModal);
    document.getElementById("inspect-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "inspect-modal-backdrop") closeInspectModal();
    });

    // Cursor-tracking neon specular highlight + dynamic stage wax chroma on cards
    const radarGrid = document.getElementById("radar-drops-grid");
    if (radarGrid) {
      radarGrid.addEventListener("pointermove", (e) => {
        const card = e.target.closest(".drop-card");
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        card.style.setProperty("--my", `${e.clientY - rect.top}px`);
      });
      radarGrid.addEventListener("pointerover", (e) => {
        const card = e.target.closest(".drop-card");
        if (!card || appState.isAudioActuallyPlaying) return;
        const item = getListingById(card.dataset.listingId);
        if (item?.wax_shader) setStageChromaFromWax(item.wax_shader);
      });
    }

    // Search Input
    const searchInput = document.getElementById("radar-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        appState.searchQuery = e.target.value.trim();
        renderRadarGrid();
      });
    }

    // Scope Switch (All Tracked vs Live Top-25)
    document.querySelectorAll(".scope-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        appState.scopeMode = btn.dataset.scope || "ALL";
        document.querySelectorAll(".scope-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderRadarGrid();
      });
    });

    // Collapse Auto-Relists Shield Toggle
    const dedupBtn = document.getElementById("btn-toggle-dedup");
    if (dedupBtn) {
      dedupBtn.addEventListener("click", () => {
        appState.dedupEnabled = !appState.dedupEnabled;
        dedupBtn.classList.toggle("active", appState.dedupEnabled);
        renderRadarGrid();
      });
    }

    // Independent Hide recordmule Toggle
    const hideRmBtn = document.getElementById("btn-hide-recordmule");
    if (hideRmBtn) {
      hideRmBtn.addEventListener("click", () => {
        appState.hideRecordmule = !appState.hideRecordmule;
        hideRmBtn.classList.toggle("active", appState.hideRecordmule);
        renderRadarGrid();
      });
    }

    // Condition & Sort Selects
    document.getElementById("radar-condition-select")?.addEventListener("change", (e) => {
      appState.conditionFilter = e.target.value;
      updateConfigJsonPreview();
      renderRadarGrid();
    });
    document.getElementById("radar-sort-select")?.addEventListener("change", (e) => {
      appState.sortMode = e.target.value;
      renderRadarGrid();
    });

    // Category Filter Pills
    document.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        appState.categoryFilter = pill.dataset.filter || "ALL";
        document.querySelectorAll(".filter-pill").forEach((p) => p.classList.toggle("active", p === pill));
        renderRadarGrid();
      });
    });

    // Price Ceiling Slider
    if (priceSlider) {
      priceSlider.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        appState.maxPriceUsd = val;
        if (priceReadout) {
          priceReadout.textContent = val >= appState.sliderMaxUsd ? "No Limit" : `$${val}`;
        }
        renderRadarGrid();
      });
    }

    // Quick Reset Filters Button
    document.getElementById("btn-quick-reset-filters")?.addEventListener("click", resetAllRadarFilters);

    // Seller Leaderboard Search & Expand All
    document.getElementById("seller-leaderboard-search")?.addEventListener("input", (e) => {
      appState.sellerSearchQuery = e.target.value.trim();
      renderForensicsView();
    });
    document.getElementById("btn-toggle-all-sellers")?.addEventListener("click", () => {
      appState.showAllSellers = !appState.showAllSellers;
      renderForensicsView();
    });

    // Copy CLI prune command chip
    document.getElementById("btn-copy-prune-cli")?.addEventListener("click", () => {
      copyTextSafe("python discogs_sniper.py --prune-owned", "Copied: python discogs_sniper.py --prune-owned");
    });

    // Delegated Clicks across Radar, Modals, Forensics, and Vault tables
    document.addEventListener("click", (e) => {
      const inspectBtn = e.target.closest("[data-inspect-id]");
      if (inspectBtn) {
        openInspectModal(inspectBtn.dataset.inspectId);
        return;
      }

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
        updateCardInPlace(id);
        return;
      }

      const muteInlineBtn = e.target.closest("[data-mute-seller]");
      if (muteInlineBtn) {
        const seller = (muteInlineBtn.dataset.muteSeller || "").toLowerCase();
        if (seller) {
          appState.mutedSellers.add(seller);
          syncRuleInputsFromState();
          saveConfigOverrides();
          renderRadarGrid();
          renderForensicsView();
          showToast(`Muted seller "${muteInlineBtn.dataset.muteSeller}" (synced to Rules).`, "amber");
        }
        return;
      }

      const toggleMuteBtn = e.target.closest("[data-toggle-mute-seller]");
      if (toggleMuteBtn) {
        const rawName = toggleMuteBtn.dataset.toggleMuteSeller || "";
        const seller = rawName.toLowerCase();
        if (appState.mutedSellers.has(seller)) {
          appState.mutedSellers.delete(seller);
          showToast(`Unmuted seller "${rawName}".`, "cyan");
        } else {
          appState.mutedSellers.add(seller);
          showToast(`Muted seller "${rawName}" (persisted locally).`, "amber");
        }
        syncRuleInputsFromState();
        saveConfigOverrides();
        renderForensicsView();
        renderRadarGrid();
        return;
      }

      const toggleDropOnlyBtn = e.target.closest("[data-toggle-droponly-seller]");
      if (toggleDropOnlyBtn) {
        const rawName = toggleDropOnlyBtn.dataset.toggleDroponlySeller || "";
        const seller = rawName.toLowerCase();
        if (appState.priceDropOnlySellers.has(seller)) {
          appState.priceDropOnlySellers.delete(seller);
          showToast(`Removed "${rawName}" from Price-Drop-Only list.`, "cyan");
        } else {
          appState.priceDropOnlySellers.add(seller);
          showToast(`"${rawName}" set to Price-Drop-Only in sniper_config.json.`, "amber");
        }
        syncRuleInputsFromState();
        saveConfigOverrides();
        renderForensicsView();
        return;
      }

      const pruneBtn = e.target.closest("[data-prune-release-id]");
      if (pruneBtn) {
        pruneReleaseFromWantlistAPI(pruneBtn.dataset.pruneReleaseId, pruneBtn.dataset.pruneTitle);
        return;
      }
    });

    // Prune All Active Overlaps Button
    const pruneAllBtn = document.getElementById("btn-prune-all-owned-api");
    if (pruneAllBtn) {
      pruneAllBtn.addEventListener("click", async () => {
        const list = getActiveExactOwnedList();
        if (!appState.discogsToken) {
          showToast("Connect your DISCOGS_TOKEN first — or copy the CLI prune command.", "amber", 4500);
          openQuickApiModal();
          return;
        }
        if (list.length === 0) {
          renderVaultBridgeView();
          return;
        }

        pruneAllBtn.dataset.busy = "1";
        pruneAllBtn.disabled = true;
        let removed = 0;
        let alreadyAbsent = 0;
        let failed = 0;
        let corsBlocked = false;

        for (let i = 0; i < list.length; i += 1) {
          const r = list[i];
          pruneAllBtn.textContent = `Pruning ${i + 1}/${list.length} (#${r.release_id})...`;
          const res = await pruneReleaseFromWantlistAPI(r.release_id, r.title, { silent: true });
          if (res.status === "removed") removed += 1;
          else if (res.status === "already_absent") alreadyAbsent += 1;
          else {
            failed += 1;
            if (res.status === "cors_blocked") {
              corsBlocked = true;
              break;
            }
          }
          if (i + 1 < list.length) {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        }

        delete pruneAllBtn.dataset.busy;
        if (corsBlocked) {
          renderVaultBridgeView();
          showToast(
            "Discogs blocks browser DELETE via CORS — click the CLI chip to run python discogs_sniper.py --prune-owned locally.",
            "crimson",
            6500
          );
          return;
        }

        await syncLiveWantlistFromAPI({ silent: true });
        const remNow = getActiveExactOwnedList().length;
        showToast(
          `Prune complete: ${removed} removed, ${alreadyAbsent} already absent, ${failed} failed. ${remNow} remaining.`,
          failed > 0 ? "crimson" : "lime",
          5000
        );
      });
    }

    document.getElementById("btn-sync-live-wantlist")?.addEventListener("click", async () => {
      await syncLiveWantlistFromAPI({ silent: false });
    });

    // Audio Transport Controls + Click/Drag Scrubber
    const audio = document.getElementById("sniper-preview-audio");
    const playPauseBtn = document.getElementById("btn-audio-play-pause");
    const closeAudioBtn = document.getElementById("btn-audio-close");
    const progTrack = document.getElementById("audio-progress-track");
    const progFill = document.getElementById("audio-progress-fill");
    const progThumb = document.getElementById("audio-progress-thumb");
    const timeLbl = document.getElementById("audio-time-label");

    function seekAudioToClientX(clientX) {
      if (!audio || !progTrack || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const rect = progTrack.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      audio.currentTime = ratio * audio.duration;
      const pct = `${(ratio * 100).toFixed(2)}%`;
      if (progFill) progFill.style.width = pct;
      if (progThumb) progThumb.style.left = pct;
    }

    if (progTrack && audio) {
      let dragging = false;
      progTrack.addEventListener("pointerdown", (e) => {
        dragging = true;
        progTrack.setPointerCapture?.(e.pointerId);
        seekAudioToClientX(e.clientX);
      });
      progTrack.addEventListener("pointermove", (e) => {
        if (dragging) seekAudioToClientX(e.clientX);
      });
      progTrack.addEventListener("pointerup", () => {
        dragging = false;
      });
      progTrack.addEventListener("keydown", (e) => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        if (e.key === "ArrowRight") {
          audio.currentTime = Math.min(audio.duration, audio.currentTime + 3);
        } else if (e.key === "ArrowLeft") {
          audio.currentTime = Math.max(0, audio.currentTime - 3);
        }
      });
    }

    if (audio) {
      audio.addEventListener("timeupdate", () => {
        const cur = audio.currentTime || 0;
        const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30;
        const pct = Math.min(100, (cur / dur) * 100);
        if (progFill) progFill.style.width = `${pct}%`;
        if (progThumb) progThumb.style.left = `${pct}%`;
        if (progTrack) progTrack.setAttribute("aria-valuenow", String(Math.round(pct)));
        if (timeLbl) timeLbl.textContent = `${formatSeconds(cur)} / ${formatSeconds(dur)}`;
      });
      audio.addEventListener("play", () => {
        appState.isAudioActuallyPlaying = true;
        if (playPauseBtn) playPauseBtn.textContent = "Pause";
        syncAudioPlayingClassesInDOM();
      });
      audio.addEventListener("pause", () => {
        appState.isAudioActuallyPlaying = false;
        if (playPauseBtn) playPauseBtn.textContent = "Play";
        syncAudioPlayingClassesInDOM();
      });
      audio.addEventListener("ended", () => {
        appState.currentlyPlayingId = null;
        appState.isAudioActuallyPlaying = false;
        syncAudioPlayingClassesInDOM();
      });
    }

    if (playPauseBtn && audio) {
      playPauseBtn.addEventListener("click", () => {
        if (!audio.src) return;
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
      });
    }

    if (closeAudioBtn && audio) {
      closeAudioBtn.addEventListener("click", () => {
        auditionRequestSeq += 1;
        audio.pause();
        appState.currentlyPlayingId = null;
        appState.isAudioActuallyPlaying = false;
        document.getElementById("audio-transport-bar")?.classList.remove("visible");
        syncAudioPlayingClassesInDOM();
      });
    }

    // Rules & API Console Controls
    const revealBtn = document.getElementById("btn-toggle-token-vis");
    const tokenInp = document.getElementById("input-discogs-token");
    if (revealBtn && tokenInp) {
      revealBtn.addEventListener("click", () => {
        const isPwd = tokenInp.type === "password";
        tokenInp.type = isPwd ? "text" : "password";
        revealBtn.textContent = isPwd ? "Hide" : "Show";
      });
    }

    document.getElementById("btn-save-verify-token")?.addEventListener("click", async () => {
      const rawUser = document.getElementById("input-discogs-username")?.value.trim() || "krunked";
      const rawTok = document.getElementById("input-discogs-token")?.value.trim() || "";
      await saveAndVerifyDiscogsToken(rawUser, rawTok);
    });

    const consoleOut = document.getElementById("api-console-output");
    document.getElementById("btn-test-price-suggestions")?.addEventListener("click", async () => {
      if (consoleOut) {
        consoleOut.textContent =
          "// Querying Official Discogs API for Dayseeker - Dark Sun (Release #38857860)...";
      }
      try {
        const [stats, sugg] = await Promise.all([
          discogsApiFetch("/marketplace/stats/38857860?curr_abbr=USD"),
          appState.discogsToken
            ? discogsApiFetch("/marketplace/price_suggestions/38857860", { allowAnonymous: false }).catch((e) => ({
                note: e.message,
              }))
            : Promise.resolve({
                note: "Connect DISCOGS_TOKEN above to unlock condition-graded /marketplace/price_suggestions",
              }),
        ]);
        if (consoleOut) {
          consoleOut.textContent = JSON.stringify(
            { release_id: 38857860, marketplace_stats: stats, price_suggestions: sugg },
            null,
            2
          );
        }
        showToast("Fetched live telemetry for Release #38857860.", "lime");
      } catch (err) {
        if (consoleOut) consoleOut.textContent = `// API Request Error: ${err.message}`;
        showToast(`API test failed: ${err.message}`, "crimson");
      }
    });

    document.getElementById("btn-clear-token")?.addEventListener("click", () => {
      appState.discogsToken = "";
      safeRemoveStorage(STORAGE_KEYS.TOKEN);
      updateApiConnectionStatusUI();
      if (consoleOut) consoleOut.textContent = "// Cleared browser-stored Discogs token.";
      showToast("Disconnected browser Discogs token.", "cyan");
    });

    [
      "cfg-cooldown-days",
      "cfg-price-drop-usd",
      "cfg-max-price",
      "cfg-suppress-owned",
      "cfg-pricedrop-sellers",
      "cfg-muted-sellers",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        if (id === "cfg-muted-sellers") {
          appState.mutedSellers = new Set(
            el.value
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
          renderRadarGrid();
          renderForensicsView();
        } else if (id === "cfg-pricedrop-sellers") {
          appState.priceDropOnlySellers = new Set(
            el.value
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
          renderForensicsView();
        }
        updateConfigJsonPreview();
        saveConfigOverrides();
      });
    });

    document.getElementById("btn-download-config")?.addEventListener("click", () => {
      const cfg = buildCurrentConfigObject();
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sniper_config.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Downloaded sniper_config.json", "lime");
    });

    document.getElementById("btn-copy-config")?.addEventListener("click", () => {
      const cfg = buildCurrentConfigObject();
      copyTextSafe(JSON.stringify(cfg, null, 2), "Copied sniper_config.json to clipboard!");
    });

    document.getElementById("btn-reset-config")?.addEventListener("click", () => {
      safeRemoveStorage(STORAGE_KEYS.CONFIG_OVERRIDES);
      appState.mutedSellers = new Set((baseConfig.filters?.muted_sellers || []).map((s) => s.toLowerCase()));
      appState.priceDropOnlySellers = new Set(
        (baseConfig.filters?.price_drop_only_sellers || ["recordmule"]).map((s) => s.toLowerCase())
      );
      const dedup = baseConfig.relist_deduplication || {};
      const filters = baseConfig.filters || {};
      const vBridge = baseConfig.collection_vault_bridge || {};
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
      };
      setVal("cfg-cooldown-days", String(dedup.cooldown_days ?? 7));
      setVal("cfg-price-drop-usd", String(dedup.price_drop_override_usd ?? 1.0));
      setVal("cfg-max-price", filters.max_total_price_usd ?? "");
      setVal("cfg-suppress-owned", vBridge.suppress_exact_owned_alerts ? "true" : "false");
      syncRuleInputsFromState();
      renderRadarGrid();
      renderForensicsView();
      showToast("Reset sniper_config.json rules to repository defaults.", "cyan");
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", (e) => {
      const tag = (e.target?.tagName || "").toUpperCase();
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        closeInspectModal();
        closeQuickApiModal();
        return;
      }
      if (inField) return;

      if (e.key === "/") {
        e.preventDefault();
        switchView("radar");
        searchInput?.focus();
      } else if (e.key.toLowerCase() === "u") {
        appState.lightingMode = appState.lightingMode === "uv" ? "neon" : "uv";
        applyLightingMode();
        showToast(appState.lightingMode === "uv" ? "UV Blacklight Overdrive engaged." : "Neon Telemetry mode active.", "cyan", 1800);
      }
    });
  }

  // =====================================================================
  // 14. INITIALIZE APPLICATION
  // =====================================================================
  // Graceful automatic fallback for any unreachable external cover URL (zero broken-image icons)
  document.addEventListener(
    "error",
    (e) => {
      const target = e.target;
      if (target && target.tagName === "IMG" && target.dataset && target.dataset.fallbackSrc) {
        if (target.src !== target.dataset.fallbackSrc) {
          target.src = target.dataset.fallbackSrc;
        }
      }
    },
    true
  );

  applyLightingMode();
  hydrateRuleInputsFromConfig();
  updateApiConnectionStatusUI();
  updateConfigJsonPreview();
  renderTopKPIs();
  renderRadarGrid();
  renderForensicsView();
  renderVaultBridgeView();
  bindEvents();

  // Quietly verify live Discogs Wantlist on boot (works for public wantlists OR with saved token!)
  syncLiveWantlistFromAPI({ silent: true });
})();
