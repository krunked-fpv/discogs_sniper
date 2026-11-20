(() => {
  "use strict";

// =====================================================================
// 00. CORE BOOTSTRAP STATE, PERSISTENCE & CLIENT-SIDE ENRICHMENT
// =====================================================================
const stateEl = document.getElementById("sniper-prebaked-state");
let SNIPER_STATE = {
  schema_version: "3.0.0",
  summary: {},
  live_wantlist_sync: {},
  forensics: {},
  seller_bundles: [],
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
  GH_PAT: "krunked_sniper_github_pat_v3",
  GH_REPO: "krunked_sniper_github_repo_v3",
  ART_CACHE: "krunked_sniper_art_cache_v2",
  CONFIG_OVERRIDES: "krunked_sniper_config_v3",
  LEGACY_CONFIG: "krunked_sniper_config_v2_1",
  PRUNED: "krunked_sniper_pruned_ids_v2",
  LIGHTING_MODE: "krunked_sniper_lighting_v3",
  AUTO_HYDRATE: "krunked_sniper_autohydrate_v3",
  RADAR_LAYOUT: "krunked_sniper_radar_layout_v3",
};

const SIBLING_VAULT_BASE_URL = "https://krunked-fpv.github.io/discogs_collection/";
const SIBLING_COLLECTION_JSON_URL = `${SIBLING_VAULT_BASE_URL}data/collection.json`;

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
  for (const key of [STORAGE_KEYS.CONFIG_OVERRIDES, STORAGE_KEYS.LEGACY_CONFIG]) {
    const raw = safeGetStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
  }
  return null;
}

const baseConfig = SNIPER_STATE.config || {};
const savedOverrides = loadSavedConfigOverrides() || {};
const initialMuted = Array.isArray(savedOverrides.muted_sellers)
  ? savedOverrides.muted_sellers
  : baseConfig.filters?.muted_sellers || [];
const initialDropOnly = Array.isArray(savedOverrides.price_drop_only_sellers)
  ? savedOverrides.price_drop_only_sellers
  : baseConfig.filters?.price_drop_only_sellers || ["recordmule"];
const initialTargetPrices =
  savedOverrides.target_prices_by_release && typeof savedOverrides.target_prices_by_release === "object"
    ? savedOverrides.target_prices_by_release
    : baseConfig.filters?.target_prices_by_release || {};

const datasetMaxPrice = Math.max(
  500,
  Math.ceil(Number(SNIPER_STATE.summary?.max_listing_price_usd || 500) / 25) * 25
);

const prebakedSync = SNIPER_STATE.live_wantlist_sync || {};
let initialLiveWantIds = null;
if (prebakedSync.synced) {
  const stillOn = (SNIPER_STATE.vault_bridge?.exact_owned_on_wantlist || [])
    .filter((r) => r.live_wantlist_status === "STILL_ON_WANTLIST")
    .map((r) => String(r.release_id));
  initialLiveWantIds = new Set(stillOn);
}

const savedLight = safeGetStorage(STORAGE_KEYS.LIGHTING_MODE);
const initialLighting = savedLight === "uv" || savedLight === "tube" ? savedLight : "neon";

const appState = {
  activeView: "radar",
  lightingMode: initialLighting,
  radarLayout: safeGetStorage(STORAGE_KEYS.RADAR_LAYOUT) === "matrix" ? "matrix" : "cards",
  searchQuery: "",
  scopeMode: "ALL",
  dedupEnabled: true,
  hideRecordmule: false,
  hideSold: false,
  conditionFilter: "ALL",
  sortMode: "SNAPSHOT_ORDER",
  categoryFilter: "ALL",
  sliderMaxUsd: datasetMaxPrice,
  maxPriceUsd: datasetMaxPrice,
  focusedListingId: null,
  mutedSellers: new Set(initialMuted.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
  priceDropOnlySellers: new Set(initialDropOnly.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
  targetPricesByRelease: { ...initialTargetPrices },
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
  githubPat: safeGetStorage(STORAGE_KEYS.GH_PAT) || "",
  githubRepo: safeGetStorage(STORAGE_KEYS.GH_REPO) || "krunked-fpv/discogs_sniper",
  githubLiveSnapshotStatus: null,
  artCache: {},
  // Background Token-Bucket Hydrator
  autoHydrateEnabled: safeGetStorage(STORAGE_KEYS.AUTO_HYDRATE) !== "false",
  hydrationQueue: [],
  hydrationQueuedIds: new Set(),
  hydrationInFlight: false,
  hydrationPausedUntil: 0,
  hydrationCachedCount: 0,
  hydrationSweepCompleted: 0,
  // 3D Crate & WebAudio Turntable Deck
  crateFilter: "ALL",
  crateIndex: 0,
  grailRadioEnabled: false,
  rpmMode: 33,
  pitchPct: 0,
  crackleMode: "OFF", // OFF | WARM | DUSTY
  currentlyPlayingId: null,
  isAudioActuallyPlaying: false,
  deckTracklist: [],
  deckActiveTrackIdx: 0,
  inspectListingId: null,
  // Sniper Alpha & Vault Showdown
  bundleFilter: "ALL",
  bundleSelectionBySeller: {},
  customOfferById: {},
  siblingVaultData: null,
  siblingVaultMapByRid: {},
  siblingVaultMapByAlbum: {},
  siblingVaultSyncedAt: "",
  siblingVaultError: "",
  activeShowdownIndex: 0,
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
      target_prices_by_release: { ...appState.targetPricesByRelease },
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

function sanitizeHttpUrl(url, fallback = "#") {
  const raw = String(url || "").trim();
  if (/^(https?:\/\/|data:image\/|\/|\.\/)/i.test(raw)) return raw;
  return fallback;
}

function resolveSiblingVaultAssetUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  if (/^(https?:\/\/|data:image\/)/i.test(raw)) return raw;
  const trimmed = raw.replace(/^\.?\//, "");
  return `${SIBLING_VAULT_BASE_URL}${trimmed}`;
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

function formatRelativeAge(isoStr) {
  if (!isoStr) return "Unknown";
  const ts = Date.parse(isoStr);
  if (Number.isNaN(ts)) return isoStr;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ${diffMin % 60}m ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
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

function showToast(message, variant = "cyan", durationMs = 3400) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  while (stack.children.length >= 2) {
    stack.firstElementChild?.remove();
  }
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

const ICONS = {
  cart: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  ext: `<svg class="ico ico-xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>`,
  play: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  stop: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`,
  bolt: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z"/></svg>`,
  trash: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
  check: `<svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  repeat: `<svg class="ico ico-xs" viewBox="0 0 24 24" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  target: `<svg class="ico ico-xs" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>`,
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

function isListingSold(item) {
  const live = appState.liveApiResults[item.id];
  if (!live || live.loading || live.error) return false;
  const st = String(live.status || "").toLowerCase();
  return Boolean(st && st !== "for sale" && st !== "unknown");
}

function getTargetPriceForRelease(releaseId) {
  const val = Number(appState.targetPricesByRelease[String(releaseId)] || 0);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function isListingTargetHit(item) {
  const t = getTargetPriceForRelease(item.release_id);
  return Boolean(t && item.total_price_usd > 0 && item.total_price_usd <= t);
}

function recomputeListingDerivedFields(item) {
  const live = appState.liveApiResults[item.id];
  const mkt = item.market_stats || (item.market_stats = {});

  if (live && !live.loading && !live.error) {
    if (live.allow_offers !== undefined) item.allow_offers = Boolean(live.allow_offers);
    if (live.seller_rating) item.seller_rating = live.seller_rating;
    if (live.want != null) mkt.community_want = live.want;
    if (live.have != null) mkt.community_have = live.have;
    if (live.num_for_sale != null) mkt.num_for_sale = live.num_for_sale;
    if (live.suggested_usd > 0) {
      mkt.condition_suggested_usd = Number(live.suggested_usd);
      mkt.condition_suggested_formatted = formatUsd(live.suggested_usd);
      mkt.benchmark_source = "Discogs API /marketplace/price_suggestions";
      mkt.benchmark_verified = true;
    }
  }

  const bench = Number(mkt.condition_suggested_usd || 0);
  if (bench > 0 && item.total_price_usd > 0) {
    const deltaUsd = Math.round((item.total_price_usd - bench) * 100) / 100;
    const deltaPct = Math.round((deltaUsd / bench) * 1000) / 10;
    item.deal_delta_usd = deltaUsd;
    item.deal_delta_pct = deltaPct;
    let score = 68;
    let tier = "FAIR_MARKET";
    let label = "FAIR MARKET";
    if (deltaPct <= -15) {
      score = 94;
      tier = "STEAL";
      label = `STEAL (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(0)}% vs ${item.media_condition})`;
    } else if (deltaPct <= -3) {
      score = 82;
      tier = "GREAT_DEAL";
      label = `BELOW BENCHMARK (${deltaPct.toFixed(0)}%)`;
    } else if (deltaPct > 12) {
      score = Math.max(25, Math.round(60 - deltaPct));
      tier = "ABOVE_MARKET";
      label = `PREMIUM (+${deltaPct.toFixed(0)}%)`;
    }
    if (item.is_price_drop) score = Math.min(98, score + 16);
    if (item.allow_offers) score = Math.min(98, score + 5);
    if (item.vault_status === "MISSING_GRAIL") score = Math.min(99, score + 4);
    item.deal_score = score;
    item.deal_tier = tier;
    item.deal_tier_label = label;
  }

  item.target_price_usd = getTargetPriceForRelease(item.release_id);
  item.is_target_hit = isListingTargetHit(item);
}

function applyLightingMode() {
  document.body.classList.remove("mode-neon", "mode-uv", "mode-tube");
  document.body.classList.add(`mode-${appState.lightingMode}`);
  const lbl = document.getElementById("uv-mode-label");
  if (lbl) {
    lbl.textContent =
      appState.lightingMode === "uv" ? "UV MODE" : appState.lightingMode === "tube" ? "TUBE AMP" : "NEON";
  }
  safeSetStorage(STORAGE_KEYS.LIGHTING_MODE, appState.lightingMode);
}

function setStageChromaFromWax(wax) {
  if (!wax || appState.lightingMode === "tube") return;
  const primary = wax.primary && wax.primary !== "#181a1f" ? wax.primary : "#00f0ff";
  const accent = wax.accent || "#ff1f8f";
  const boost = appState.lightingMode === "uv" ? 0.3 : 0.16;
  document.documentElement.style.setProperty("--stage-c1", hexToRgba(primary, boost));
  document.documentElement.style.setProperty("--stage-c2", hexToRgba(accent, boost * 0.8));
}


// =====================================================================
// 01. PROCEDURAL COLORED-VINYL CANVAS SHADER & SLEEVE FALLBACKS
// =====================================================================
function createSeededRng(seedVal) {
  let s = (Math.abs(Number(seedVal) || 1337) % 2147483647) || 1337;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

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

function resolveCoverSrc(item) {
  return (
    item.cover_image_url ||
    appState.artCache[item.release_id] ||
    appState.artCache[item.norm_album_key] ||
    renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary)
  );
}

function renderVinylDiscSVG(wax, uid, size = 86) {
  const w = wax || { pattern: "solid", subpattern: "solid", primary: "#181a1f", secondary: "#0d0f12", accent: "#00f0ff" };
  const p = w.primary || "#181a1f";
  const s = w.secondary || "#0d0f12";
  const a = w.accent || "#00f0ff";
  const pattern = w.subpattern || w.pattern || "solid";

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
      </g>`;
  } else if (pattern === "split" || pattern === "pinwheel") {
    patternOverlay = `<path d="M 50,4 A 46,46 0 0,1 50,96 Z" fill="${s}" opacity="0.92"/>`;
  } else if (pattern === "cornetto") {
    patternOverlay = `<circle cx="50" cy="50" r="28" fill="${s}" opacity="0.88"/>`;
  } else if (pattern === "starburst") {
    patternOverlay = `
      <g opacity="0.82">
        <polygon points="50,50 18,12 38,6" fill="${s}"/>
        <polygon points="50,50 86,20 92,42" fill="${a}"/>
        <polygon points="50,50 78,86 58,94" fill="${s}"/>
        <polygon points="50,50 14,76 8,54" fill="${a}"/>
      </g>`;
  } else if (pattern === "marble" || pattern === "smoke" || pattern === "galaxy" || pattern === "swirl") {
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
    <circle cx="50" cy="50" r="35" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="0.6"/>
    <circle cx="50" cy="50" r="28" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.6"/>
    <circle cx="50" cy="50" r="16" fill="#0d111c" stroke="${a}" stroke-width="1.6"/>
    <circle cx="50" cy="50" r="9.5" fill="${a}" opacity="0.88"/>
    <circle cx="50" cy="50" r="3.2" fill="#040509"/>
  </svg>`;
}

function renderVinylCanvas(canvas, waxShader, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const size = canvas.width || 360;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.47;
  const labelR = R * 0.34;
  const angleRad = Number(opts.angleRad || 0);
  const w = waxShader || {
    pattern: "solid",
    subpattern: "solid",
    primary: "#181a1f",
    secondary: "#0d0f12",
    accent: "#00f0ff",
    tertiary: "#ff1f8f",
    seed: 1984,
  };
  const pat = w.subpattern || w.pattern || "solid";
  const rng = createSeededRng(w.seed || 1984);

  ctx.clearRect(0, 0, size, size);

  // Clip & rotate wax geometry (grooves + wax swirls rotate together; specular stays fixed to studio lights)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate(angleRad);

  // Base radial wax tone
  const baseGrad = ctx.createRadialGradient(-R * 0.2, -R * 0.2, R * 0.1, 0, 0, R);
  baseGrad.addColorStop(0, w.primary || "#181a1f");
  baseGrad.addColorStop(0.75, w.primary || "#181a1f");
  baseGrad.addColorStop(1, w.secondary || "#0d0f12");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  if (pat === "split") {
    ctx.fillStyle = w.secondary || "#00f0ff";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  } else if (pat === "pinwheel") {
    const colors = [w.primary, w.secondary, w.accent, w.tertiary || w.secondary];
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, (i * Math.PI) / 4, ((i + 1) * Math.PI) / 4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pat === "cornetto") {
    ctx.fillStyle = w.secondary || "#00f0ff";
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = w.accent || "#ff1f8f";
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * 0.94, a, a + 0.12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pat === "starburst") {
    const rays = 14;
    for (let i = 0; i < rays; i += 1) {
      const a = (i / rays) * Math.PI * 2 + rng() * 0.2;
      const spread = 0.1 + rng() * 0.14;
      ctx.fillStyle = i % 2 === 0 ? (w.secondary || "#00f0ff") : (w.accent || "#ff1f8f");
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * (0.72 + rng() * 0.28), a, a + spread);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pat === "splatter") {
    const colors = [w.secondary, w.accent, w.tertiary || "#ffffff"];
    for (let i = 0; i < 42; i += 1) {
      const a = rng() * Math.PI * 2;
      const len = labelR + rng() * (R - labelR) * 0.96;
      const col = colors[i % colors.length] || "#00f0ff";
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 + rng() * 4.2;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (labelR * 0.9), Math.sin(a) * (labelR * 0.9));
      ctx.lineTo(Math.cos(a + (rng() - 0.5) * 0.15) * len, Math.sin(a + (rng() - 0.5) * 0.15) * len);
      ctx.stroke();

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * len, Math.sin(a) * len, 1.5 + rng() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pat === "marble" || pat === "galaxy" || pat === "smoke" || pat === "swirl") {
    const swirls = 18;
    for (let i = 0; i < swirls; i += 1) {
      const rBand = labelR + rng() * (R - labelR);
      const startA = rng() * Math.PI * 2;
      const sweep = 0.8 + rng() * 2.1;
      ctx.strokeStyle = i % 2 === 0 ? (w.secondary || "#64748b") : (w.accent || "#00f0ff");
      ctx.lineWidth = 6 + rng() * 14;
      ctx.lineCap = "round";
      ctx.globalAlpha = pat === "smoke" ? 0.28 : 0.45;
      ctx.beginPath();
      ctx.arc(0, 0, rBand, startA, startA + sweep);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (pat === "translucent") {
    ctx.fillStyle = w.accent || "#00f0ff";
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.96, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Concentric vinyl micro-grooves + etched indicator rings
  const grooveCount = 34;
  for (let g = 0; g < grooveCount; g += 1) {
    const gr = labelR + 6 + (g / grooveCount) * (R - labelR - 10);
    ctx.strokeStyle = g % 6 === 0 ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.34)";
    ctx.lineWidth = g % 6 === 0 ? 0.9 : 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, gr, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (w.is_etched) {
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Center label & spindle hole
  ctx.fillStyle = "#0b0f1c";
  ctx.beginPath();
  ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = w.accent || "#00f0ff";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, labelR - 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = w.accent || "#00f0ff";
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(0, 0, labelR * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Center label index stripe (visible spin marker!)
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.65;
  ctx.fillRect(labelR * 0.25, -1.5, labelR * 0.58, 3);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#040509";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(5, R * 0.052), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Fixed studio lighting anisotropic groove sheen overlay (does not rotate with disc)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  const sheen = ctx.createConicGradient(0.45, cx, cy);
  sheen.addColorStop(0.0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.1, "rgba(255,255,255,0.0)");
  sheen.addColorStop(0.45, "rgba(0,240,255,0.04)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.18)");
  sheen.addColorStop(0.6, "rgba(255,255,255,0.0)");
  sheen.addColorStop(0.95, "rgba(255,31,143,0.05)");
  sheen.addColorStop(1.0, "rgba(255,255,255,0.22)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Outer 180g rim bevel
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}


// =====================================================================
// 02. WEBAUDIO DSP ENGINE, VINYL CRACKLE SYNTH & TURNTABLE PLATTER LOOP
// =====================================================================
let auditionRequestSeq = 0;
let audioCtx = null;
let mediaSourceNode = null;
let analyserNode = null;
let crackleGainNode = null;
let crackleSourceNode = null;
let fftDataArray = null;
let platterAngleRad = 0;
let platterAnimHandle = 0;
let platterLastTs = 0;
let audioUsingCors = false;

function ensureWebAudioGraph() {
  const audio = document.getElementById("sniper-preview-audio");
  if (!audio) return null;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      analyserNode.smoothingTimeConstant = 0.78;
      fftDataArray = new Uint8Array(analyserNode.frequencyBinCount);

      mediaSourceNode = audioCtx.createMediaElementSource(audio);
      mediaSourceNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
    } catch (err) {
      console.debug("WebAudio media source init skipped:", err);
    }
  }

  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playStylusDropThump() {
  const ctx = ensureWebAudioGraph();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.09);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch (_) {}
}

function updateCrackleSynthesis() {
  const ctx = ensureWebAudioGraph();
  if (!ctx) return;

  if (!crackleGainNode) {
    const sampleRate = ctx.sampleRate || 44100;
    const len = sampleRate * 2;
    const buf = ctx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      const pop = Math.random() > 0.9987 ? (Math.random() * 2 - 1) * 0.55 : 0;
      data[i] = lastOut * 0.16 + pop;
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1850;
    filter.Q.value = 0.7;

    crackleSourceNode = ctx.createBufferSource();
    crackleSourceNode.buffer = buf;
    crackleSourceNode.loop = true;

    crackleGainNode = ctx.createGain();
    crackleGainNode.gain.value = 0;

    crackleSourceNode.connect(filter);
    filter.connect(crackleGainNode);
    crackleGainNode.connect(ctx.destination);
    crackleSourceNode.start();
  }

  const shouldEmit = appState.crackleMode !== "OFF" && appState.isAudioActuallyPlaying;
  const targetGain = !shouldEmit ? 0 : appState.crackleMode === "DUSTY" ? 0.16 : 0.07;
  crackleGainNode.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.08);
}

function applyTurntablePlaybackRate() {
  const audio = document.getElementById("sniper-preview-audio");
  const baseRate = appState.rpmMode === 45 ? 1.35 : 1.0;
  const rate = Math.max(0.65, Math.min(1.65, baseRate * (1 + appState.pitchPct / 100)));

  if (audio) {
    try {
      audio.preservesPitch = false;
      audio.mozPreservesPitch = false;
      audio.webkitPreservesPitch = false;
    } catch (_) {}
    audio.playbackRate = rate;
  }

  const rpmLed = document.getElementById("deck-rpm-readout");
  if (rpmLed) rpmLed.textContent = appState.rpmMode === 45 ? "45 RPM" : "33⅓ RPM";
  const pitchLed = document.getElementById("deck-pitch-readout");
  if (pitchLed) {
    const sign = appState.pitchPct > 0 ? "+" : "";
    pitchLed.textContent =
      appState.pitchPct === 0 ? "0.0% QUARTZ" : `${sign}${appState.pitchPct.toFixed(1)}% PITCH`;
  }
  const miniRpm = document.getElementById("btn-mini-rpm");
  if (miniRpm) miniRpm.textContent = appState.rpmMode === 45 ? "45" : "33⅓";

  document.getElementById("btn-rpm-33")?.classList.toggle("active", appState.rpmMode === 33);
  document.getElementById("btn-rpm-45")?.classList.toggle("active", appState.rpmMode === 45);
}

function drawFftSpectrumFrame(nowMs) {
  const fftCanvas = document.getElementById("turntable-fft-canvas");
  if (!fftCanvas) return;
  const ctx = fftCanvas.getContext("2d");
  if (!ctx) return;

  const w = fftCanvas.width;
  const h = fftCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const bands = 32;
  let hasLiveSignal = false;
  if (analyserNode && fftDataArray && appState.isAudioActuallyPlaying && audioUsingCors) {
    analyserNode.getByteFrequencyData(fftDataArray);
    for (let i = 0; i < Math.min(bands, fftDataArray.length); i += 1) {
      if (fftDataArray[i] > 3) {
        hasLiveSignal = true;
        break;
      }
    }
  }

  const barW = (w - (bands - 1) * 3) / bands;
  const isTube = appState.lightingMode === "tube";
  const cTop = isTube ? "#ffb020" : "#ff1f8f";
  const cBot = isTube ? "#19f08a" : "#00f0ff";
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, cTop);
  grad.addColorStop(1, cBot);
  ctx.fillStyle = grad;

  for (let i = 0; i < bands; i += 1) {
    let norm = 0.05;
    if (hasLiveSignal) {
      const bin = Math.min(fftDataArray.length - 1, i);
      norm = Math.max(0.06, fftDataArray[bin] / 255);
    } else if (appState.isAudioActuallyPlaying) {
      // Smooth procedural bounce fallback when stream is non-CORS (e.g. Deezer JSONP or file://)
      const t = nowMs * 0.006;
      norm = 0.14 + 0.52 * Math.abs(Math.sin(t + i * 0.42) * Math.cos(t * 0.7 - i * 0.25));
    }
    const barH = Math.max(3, norm * (h - 10));
    const x = i * (barW + 3);
    const y = h - barH - 4;
    ctx.fillRect(x, y, barW, barH);
  }
}

function startTurntableAnimationLoop() {
  if (platterAnimHandle) return;

  const tick = (nowMs) => {
    if (!platterLastTs) platterLastTs = nowMs;
    const dt = Math.min(0.1, (nowMs - platterLastTs) / 1000);
    platterLastTs = nowMs;

    const crateViewActive = appState.activeView === "crate";
    if (appState.isAudioActuallyPlaying) {
      const rpm = appState.rpmMode === 45 ? 45 : 33.333;
      const effectiveRpm = rpm * (1 + appState.pitchPct / 100);
      const radPerSec = (effectiveRpm / 60) * Math.PI * 2;
      platterAngleRad = (platterAngleRad + radPerSec * dt) % (Math.PI * 2);
    }

    if (crateViewActive) {
      const crateItems = getCrateFilteredListings();
      const activeItem = crateItems[appState.crateIndex] || getListingById(appState.currentlyPlayingId) || crateItems[0];
      const canvas = document.getElementById("turntable-platter-canvas");
      if (canvas && activeItem) {
        renderVinylCanvas(canvas, activeItem.wax_shader, { angleRad: platterAngleRad });
      }
      drawFftSpectrumFrame(nowMs);
    }

    if (appState.isAudioActuallyPlaying || crateViewActive) {
      platterAnimHandle = requestAnimationFrame(tick);
    } else {
      platterAnimHandle = 0;
      platterLastTs = 0;
    }
  };
  platterAnimHandle = requestAnimationFrame(tick);
}

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

    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5&output=jsonp&callback=${cbName}`;
    script.onerror = () => {
      cleanup();
      resolve(null);
    };
    document.body.appendChild(script);
  });
}

function playPreviewStreamWithFallback(audio, previewUrl, allowCors) {
  audioUsingCors = Boolean(allowCors && location.protocol.startsWith("http"));
  if (audioUsingCors) {
    audio.crossOrigin = "anonymous";
  } else {
    audio.removeAttribute("crossorigin");
  }
  audio.src = previewUrl;
  applyTurntablePlaybackRate();

  const onErr = () => {
    audio.removeEventListener("error", onErr);
    if (audioUsingCors) {
      // Retry seamlessly without CORS if remote CDN rejects Access-Control-Allow-Origin
      audioUsingCors = false;
      audio.removeAttribute("crossorigin");
      audio.src = previewUrl;
      applyTurntablePlaybackRate();
      audio.play().catch(() => {});
    }
  };
  audio.addEventListener("error", onErr, { once: true });
  return audio.play();
}

async function auditionListing(listingId, trackIndexOverride = null) {
  const audio = document.getElementById("sniper-preview-audio");
  const bar = document.getElementById("audio-transport-bar");
  const titleEl = document.getElementById("audio-player-title");
  const subEl = document.getElementById("audio-player-sub");
  const thumbEl = document.getElementById("audio-player-thumb");
  const cartBtn = document.getElementById("audio-player-cart-btn");
  const progFill = document.getElementById("audio-progress-fill");
  const progThumb = document.getElementById("audio-progress-thumb");

  if (!audio || !bar) return;

  if (appState.currentlyPlayingId === listingId && trackIndexOverride === null) {
    auditionRequestSeq += 1;
    audio.pause();
    appState.currentlyPlayingId = null;
    appState.isAudioActuallyPlaying = false;
    updateCrackleSynthesis();
    bar.classList.remove("visible");
    syncAudioPlayingClassesInDOM();
    return;
  }

  const item = getListingById(listingId);
  if (!item) return;

  ensureWebAudioGraph();
  playStylusDropThump();

  const mySeq = ++auditionRequestSeq;
  audio.pause();
  appState.currentlyPlayingId = listingId;
  appState.isAudioActuallyPlaying = false;
  setStageChromaFromWax(item.wax_shader);
  bar.classList.add("visible");

  if (item.wax_shader?.rpm === 45 && trackIndexOverride === null) {
    appState.rpmMode = 45;
  } else if (trackIndexOverride === null) {
    appState.rpmMode = 33;
  }
  applyTurntablePlaybackRate();

  if (progFill) progFill.style.width = "0%";
  if (progThumb) progThumb.style.left = "0%";
  if (titleEl) titleEl.textContent = `${item.artist} — ${getDisplayAlbumTitle(item)}`;
  if (subEl) subEl.textContent = "Resolving 30s studio preview...";
  if (thumbEl) thumbEl.src = resolveCoverSrc(item);
  if (cartBtn) {
    cartBtn.href = sanitizeHttpUrl(item.add_to_cart_url);
    cartBtn.textContent = `Add to Cart (${item.total_price})`;
  }
  syncAudioPlayingClassesInDOM();
  startTurntableAnimationLoop();

  // If switching tracks inside already fetched tracklist for this listing:
  if (trackIndexOverride !== null && appState.deckTracklist.length > trackIndexOverride) {
    const picked = appState.deckTracklist[trackIndexOverride];
    appState.deckActiveTrackIdx = trackIndexOverride;
    if (titleEl) titleEl.textContent = `${picked.artistName || item.artist} — "${picked.trackName}"`;
    if (subEl) subEl.textContent = `${picked.source} // ${item.wax_shader?.wax_name || item.variant}`;
    renderDeckTracklistPills();
    playPreviewStreamWithFallback(audio, picked.previewUrl, picked.corsCapable).catch(() => {});
    return;
  }

  const cleanQuery = `${item.artist} ${item.album}`
    .replace(/\s*\(\d+\)\s*/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let tracks = [];
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=6`
    );
    if (res.ok) {
      const data = await res.json();
      tracks = (data.results || [])
        .filter((t) => t.previewUrl)
        .map((t) => ({
          previewUrl: t.previewUrl,
          trackName: t.trackName,
          artistName: t.artistName,
          artwork: t.artworkUrl100 ? t.artworkUrl100.replace("100x100bb", "600x600bb") : "",
          source: "iTunes Studio Preview",
          corsCapable: true,
        }));
    }
  } catch (_) {}

  if (mySeq !== auditionRequestSeq) return;

  if (tracks.length === 0) {
    const dz = await fetchDeezerJsonpPreview(cleanQuery);
    if (mySeq !== auditionRequestSeq) return;
    if (dz) {
      tracks = [{ ...dz, source: "Deezer Studio Preview", corsCapable: false }];
    }
  }

  appState.deckTracklist = tracks;
  appState.deckActiveTrackIdx = 0;
  renderDeckTracklistPills();

  const previewInfo = tracks[0];
  if (!previewInfo || !previewInfo.previewUrl) {
    if (subEl) subEl.textContent = "30s preview unavailable for this pressing — open Discogs listing";
    const deckTrackEl = document.getElementById("deck-now-track");
    if (deckTrackEl) deckTrackEl.textContent = "No 30s studio preview found — inspect on Discogs";
    showToast(`No audio preview found for ${item.artist} — ${item.album}`, "amber");
    return;
  }

  if (previewInfo.artwork && !appState.artCache[item.norm_album_key]) {
    appState.artCache[item.norm_album_key] = previewInfo.artwork;
    appState.artCache[item.release_id] = previewInfo.artwork;
    saveArtCache();
    if (thumbEl) thumbEl.src = previewInfo.artwork;
  }

  const trackTitleText = `${previewInfo.artistName || item.artist} — "${previewInfo.trackName}"`;
  if (titleEl) titleEl.textContent = trackTitleText;
  if (subEl) subEl.textContent = `${previewInfo.source} // ${item.wax_shader?.wax_name || item.variant} (${item.total_price})`;
  const deckTrackEl = document.getElementById("deck-now-track");
  if (deckTrackEl) deckTrackEl.textContent = `▶ ${previewInfo.trackName} (${previewInfo.source})`;

  playPreviewStreamWithFallback(audio, previewInfo.previewUrl, previewInfo.corsCapable).catch(() => {
    if (subEl) subEl.textContent = "Click Play to start audio (autoplay blocked by browser)";
  });
}

function renderDeckTracklistPills() {
  const wrap = document.getElementById("deck-tracklist-pills");
  if (!wrap) return;
  if (!appState.deckTracklist || appState.deckTracklist.length <= 1) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = appState.deckTracklist
    .slice(0, 5)
    .map(
      (tr, idx) => `
      <button type="button" class="track-chip-btn ${idx === appState.deckActiveTrackIdx ? "active" : ""}" data-deck-track-idx="${idx}" title="${escapeHtml(tr.trackName)}">
        ${idx + 1}. ${escapeHtml(tr.trackName)}
      </button>`
    )
    .join("");
}


// =====================================================================
// 03. TOKEN-BUCKET DISCOGS API v2.0 HYDRATOR, INDEXEDDB CACHE & ART
// =====================================================================
const IDB_DB_NAME = "krunked_sniper_idb_v3";
const IDB_STORE_NAME = "discogs_live_cache";
const IDB_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours fresh cache
const memoryCacheFallback = new Map();
let idbPromise = null;

function openSniperIDB() {
  if (idbPromise) return idbPromise;
  if (!("indexedDB" in window)) {
    idbPromise = Promise.resolve(null);
    return idbPromise;
  }
  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: "listing_id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return idbPromise;
}

async function idbGetRecord(listingId) {
  const key = String(listingId);
  const db = await openSniperIDB();
  if (!db) return memoryCacheFallback.get(key) || null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function idbPutRecord(listingId, data) {
  const key = String(listingId);
  const rec = { listing_id: key, cached_at: Date.now(), data };
  memoryCacheFallback.set(key, rec);
  const db = await openSniperIDB();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).put(rec);
  } catch (_) {}
}

async function idbLoadAllFreshIntoState() {
  const db = await openSniperIDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        let loaded = 0;
        const now = Date.now();
        for (const rec of rows) {
          if (!rec || !rec.listing_id || !rec.data) continue;
          if (now - Number(rec.cached_at || 0) > IDB_TTL_MS) continue;
          appState.liveApiResults[rec.listing_id] = rec.data;
          const item = getListingById(rec.listing_id);
          if (item) recomputeListingDerivedFields(item);
          loaded += 1;
        }
        appState.hydrationCachedCount = loaded;
        resolve(loaded);
      };
      req.onerror = () => resolve(0);
    } catch (_) {
      resolve(0);
    }
  });
}

async function clearSniperIDBCache() {
  memoryCacheFallback.clear();
  const db = await openSniperIDB();
  if (db) {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).clear();
    } catch (_) {}
  }
  appState.hydrationCachedCount = 0;
  appState.liveApiResults = {};
  updateHydratorStatusUI();
  renderRadarGrid();
  showToast("Cleared IndexedDB Discogs API cache.", "cyan");
}

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
  // Preflight-free GET with ?token= query param and ZERO custom headers so CORS never triggers OPTIONS preflight
  const url = buildDiscogsApiUrl(path, Boolean(appState.discogsToken));
  let resp;
  try {
    resp = await fetch(url, { method: "GET" });
  } catch (_) {
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

async function verifyLiveListingViaAPI(listingId, { silent = false } = {}) {
  const item = getListingById(listingId);
  if (!item) return null;

  if (!silent) {
    appState.liveApiResults[listingId] = { loading: true };
    updateCardInPlace(listingId);
  }

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
      if (reason?.httpStatus === 429) {
        appState.hydrationPausedUntil = Date.now() + 65000;
        if (!silent) result.error = "Discogs rate limit (429) — cooling down 60s.";
        else return { rateLimited: true };
      } else if (reason?.httpStatus === 404) {
        result.status = "Sold / Removed (404)";
      } else {
        throw new Error(
          reason?.message || "Could not reach api.discogs.com — connect DISCOGS_TOKEN in Remote & API."
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
  if (!result.error) {
    recomputeListingDerivedFields(item);
    await idbPutRecord(listingId, result);
    appState.hydrationCachedCount = Math.max(
      appState.hydrationCachedCount,
      Object.keys(appState.liveApiResults).length
    );
  }
  updateCardInPlace(listingId, { flash: !result.error });
  updateHydratorStatusUI();
  return result;
}

function updateHydratorStatusUI() {
  const dot = document.getElementById("hydrator-dot");
  const lbl = document.getElementById("hydrator-status-label");
  const kpiBadge = document.getElementById("kpi-hydrated-badge");
  const inlineHint = document.getElementById("radar-hydrator-inline");
  const consoleReadout = document.getElementById("hydrator-metrics-readout");
  const toggleBtn = document.getElementById("btn-toggle-autohydrate");

  const hydratedCount = Object.values(appState.liveApiResults).filter((r) => r && !r.loading && !r.error).length;
  const soldCount = (SNIPER_STATE.listings || []).filter((x) => x.is_latest_in_group && isListingSold(x)).length;
  const queued = appState.hydrationQueue.length;
  const coolingDown = Date.now() < appState.hydrationPausedUntil;

  if (dot) {
    dot.classList.toggle("active", appState.hydrationInFlight && !coolingDown);
    dot.classList.toggle("paused", !appState.autoHydrateEnabled || coolingDown);
  }
  if (lbl) {
    if (coolingDown) lbl.textContent = "Cooldown 429";
    else if (!appState.autoHydrateEnabled) lbl.textContent = `Hydrate: PAUSED`;
    else if (appState.hydrationInFlight || queued > 0) lbl.textContent = `Hydrating (${hydratedCount})`;
    else lbl.textContent = `Live: ${hydratedCount}${soldCount ? ` / ${soldCount} Sold` : ""}`;
  }
  if (kpiBadge) {
    kpiBadge.textContent = coolingDown
      ? "Rate Cooldown"
      : `${hydratedCount} Live / ${soldCount} Sold`;
  }
  if (inlineHint) {
    inlineHint.textContent = appState.autoHydrateEnabled
      ? `Token-bucket sweeper: ${hydratedCount} live verified${soldCount ? `, ${soldCount} sold` : ""}`
      : "Auto-hydrator paused (click Hydrate pill to resume)";
  }
  if (consoleReadout) {
    consoleReadout.textContent = `IDB/Session: ${hydratedCount} live // ${queued} queued // ${soldCount} sold`;
  }
  if (toggleBtn) {
    toggleBtn.textContent = `Auto-Hydrate: ${appState.autoHydrateEnabled ? "ON" : "OFF"}`;
  }
}

async function processHydrationQueue() {
  if (appState.hydrationInFlight) return;
  appState.hydrationInFlight = true;
  updateHydratorStatusUI();

  while (appState.hydrationQueue.length > 0 && appState.autoHydrateEnabled) {
    if (Date.now() < appState.hydrationPausedUntil) {
      updateHydratorStatusUI();
      await new Promise((res) => setTimeout(res, 5000));
      continue;
    }

    const listingId = appState.hydrationQueue.shift();
    if (!listingId) break;
    appState.hydrationQueuedIds.delete(listingId);

    const existing = appState.liveApiResults[listingId];
    if (existing && !existing.error && !existing.loading) continue;

    const cached = await idbGetRecord(listingId);
    if (cached && Date.now() - Number(cached.cached_at || 0) < IDB_TTL_MS && cached.data) {
      appState.liveApiResults[listingId] = cached.data;
      const item = getListingById(listingId);
      if (item) recomputeListingDerivedFields(item);
      updateCardInPlace(listingId, { flash: false });
      updateHydratorStatusUI();
      continue;
    }

    const res = await verifyLiveListingViaAPI(listingId, { silent: true });
    if (res && res.rateLimited) {
      appState.hydrationQueue.unshift(listingId);
      appState.hydrationQueuedIds.add(listingId);
    }

    // Token-bucket pacing: 1.25s with token (<= 48 req/min < 60), 3.1s public (<= 19 req/min < 25)
    const delayMs = appState.discogsToken ? 1250 : 3100;
    if (appState.hydrationQueue.length > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  appState.hydrationInFlight = false;
  updateHydratorStatusUI();
}

function enqueueHydrationListing(listingId, priority = false) {
  const id = String(listingId);
  if (!id || appState.hydrationQueuedIds.has(id)) return;
  const existing = appState.liveApiResults[id];
  if (existing && !existing.error && !existing.loading) return;
  if (!appState.autoHydrateEnabled) return;

  appState.hydrationQueuedIds.add(id);
  if (priority) appState.hydrationQueue.unshift(id);
  else appState.hydrationQueue.push(id);
  if (appState.hydrationQueue.length > 35) {
    const dropped = appState.hydrationQueue.pop();
    if (dropped) appState.hydrationQueuedIds.delete(dropped);
  }
  processHydrationQueue();
}

let radarCardObserver = null;
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

function observeCoverArtAndLiveHydration() {
  if (!("IntersectionObserver" in window)) return;
  if (artObserver) artObserver.disconnect();
  if (radarCardObserver) radarCardObserver.disconnect();

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

  if (appState.autoHydrateEnabled) {
    radarCardObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const card = entry.target;
          radarCardObserver.unobserve(card);
          const lid = card.dataset.listingId;
          if (lid) {
            const item = getListingById(lid);
            // Prioritize Live Page 1 or Unrated listings first
            const isPriority = Boolean(item?.is_live_page1 || item?.deal_tier === "UNRATED");
            enqueueHydrationListing(lid, isPriority);
          }
        });
      },
      { rootMargin: "120px" }
    );
    document.querySelectorAll(".drop-card[data-listing-id]").forEach((card) => radarCardObserver.observe(card));
  }
}


// =====================================================================
// 04. TWO-WAY GITHUB API SYNC & LOCAL RIG HEARTBEAT TELEMETRY
// =====================================================================
function computeRigHeartbeatStatus() {
  const snapTs = SNIPER_STATE.snapshot_updated_at || "";
  const logTs = SNIPER_STATE.forensics?.last_log_timestamp || "";
  const latestIso = snapTs >= logTs ? snapTs : logTs;
  const parsed = latestIso ? Date.parse(latestIso) : NaN;
  const ageMin = Number.isNaN(parsed) ? 999 : Math.max(0, Math.round((Date.now() - parsed) / 60000));

  let state = "live";
  let badge = "Sync Fresh";
  if (ageMin > 60 * 12) {
    state = "offline";
    badge = `${formatRelativeAge(latestIso)}`;
  } else if (ageMin > 25) {
    state = "stale";
    badge = `${formatRelativeAge(latestIso)}`;
  } else {
    state = "live";
    badge = `Synced ${ageMin <= 1 ? "now" : `${ageMin}m ago`}`;
  }
  return { state, badge, latestIso, ageMin };
}

function updateRigHeartbeatUI() {
  const hb = computeRigHeartbeatStatus();
  const dot = document.getElementById("hb-dot");
  const lbl = document.getElementById("hb-label");
  const kpiAge = document.getElementById("kpi-heartbeat-age");
  const banner = document.getElementById("github-sync-status-banner");

  if (dot) {
    dot.classList.remove("hb-stale", "hb-offline");
    if (hb.state === "stale") dot.classList.add("hb-stale");
    if (hb.state === "offline") dot.classList.add("hb-offline");
  }
  if (lbl) lbl.textContent = hb.badge;
  if (kpiAge) {
    kpiAge.textContent = hb.ageMin <= 20 ? "5m Active" : hb.ageMin < 1440 ? `${Math.round(hb.ageMin / 60)}h Lag` : "Static Build";
  }
  if (banner) {
    const ghInfo = appState.githubLiveSnapshotStatus;
    const ghPart = ghInfo
      ? ` // GitHub HEAD: ${ghInfo.commitSha?.slice(0, 7) || "synced"} (${ghInfo.liveItems || "?"} items @ ${ghInfo.updatedAt || "?"})`
      : "";
    banner.className = `vault-sync-banner ${hb.state === "live" ? "banner-clean" : "banner-warn"}`;
    banner.textContent = `Pre-baked snapshot timestamp: ${hb.latestIso || "N/A"} (${hb.badge}). Compiled schema v${SNIPER_STATE.schema_version}.${ghPart}`;
  }
}

function parseRepoOwnerAndName() {
  const raw = (appState.githubRepo || "krunked-fpv/discogs_sniper").trim();
  const parts = raw.split("/").filter(Boolean);
  if (parts.length !== 2) return { owner: "krunked-fpv", repo: "discogs_sniper" };
  return { owner: parts[0], repo: parts[1] };
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

async function pullLiveRepoSnapshotFromGitHub({ silent = false } = {}) {
  const { owner, repo } = parseRepoOwnerAndName();
  const bust = Date.now();
  try {
    const [stateResp, cfgResp, commitsResp] = await Promise.allSettled([
      fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/data/sniper_state.json?t=${bust}`),
      fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/sniper_config.json?t=${bust}`),
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`),
    ]);

    let commitSha = "";
    if (commitsResp.status === "fulfilled" && commitsResp.value.ok) {
      const commits = await commitsResp.value.json();
      if (Array.isArray(commits) && commits[0]?.sha) {
        commitSha = commits[0].sha;
      }
    }

    if (stateResp.status === "fulfilled" && stateResp.value.ok) {
      const remoteState = await stateResp.value.json();
      if (remoteState && Array.isArray(remoteState.listings)) {
        SNIPER_STATE = remoteState;
        for (const item of SNIPER_STATE.listings) {
          recomputeListingDerivedFields(item);
        }
        if (cfgResp.status === "fulfilled" && cfgResp.value.ok) {
          const remoteCfg = await cfgResp.value.json();
          if (remoteCfg && typeof remoteCfg === "object") {
            SNIPER_STATE.config = remoteCfg;
          }
        }
        appState.githubLiveSnapshotStatus = {
          commitSha,
          updatedAt: remoteState.snapshot_updated_at || remoteState.compiled_at,
          liveItems: remoteState.listings.length,
        };
        updateRigHeartbeatUI();
        renderTopKPIs();
        renderRadarGrid();
        renderCrateStudio();
        renderAlphaView();
        renderForensicsView();
        renderVaultBridgeView();
        if (!silent) {
          showToast(
            `Pulled live repo snapshot (${remoteState.listings.length} tracked listings @ ${appState.githubLiveSnapshotStatus.updatedAt}).`,
            "lime"
          );
        }
        return true;
      }
    }
    if (!silent) showToast("Could not pull remote data/sniper_state.json from GitHub.", "amber");
  } catch (err) {
    if (!silent) showToast(`GitHub pull error: ${err.message}`, "crimson");
  }
  return false;
}

async function commitSniperConfigToGitHub() {
  if (!appState.githubPat) {
    showToast("Save a Fine-Grained GitHub PAT (Contents: Read & Write) first.", "amber", 4500);
    return false;
  }
  const { owner, repo } = parseRepoOwnerAndName();
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/sniper_config.json`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${appState.githubPat}`,
    "Content-Type": "application/json",
  };

  try {
    const getResp = await fetch(apiUrl, { method: "GET", headers });
    if (!getResp.ok) throw new Error(`GET sniper_config.json HTTP ${getResp.status}`);
    const meta = await getResp.json();
    const cfgContent = `${JSON.stringify(buildCurrentConfigObject(), null, 2)}\n`;

    const putResp = await fetch(apiUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "chore(config): update sniper_config.json via Discogs Sniper Remote",
        content: utf8ToBase64(cfgContent),
        sha: meta.sha,
        branch: "main",
      }),
    });
    if (!putResp.ok) {
      const errBody = await putResp.text();
      throw new Error(`PUT HTTP ${putResp.status}: ${errBody.slice(0, 120)}`);
    }
    showToast("Committed updated sniper_config.json to main!", "lime", 4500);
    return true;
  } catch (err) {
    showToast(`GitHub commit failed: ${err.message}`, "crimson", 5200);
    return false;
  }
}

async function triggerGitHubPagesWorkflow() {
  if (!appState.githubPat) {
    showToast("Save a Fine-Grained GitHub PAT (Actions: Read & Write) first.", "amber", 4500);
    return false;
  }
  const { owner, repo } = parseRepoOwnerAndName();
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/static.yml/dispatches`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appState.githubPat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (resp.status === 204 || resp.ok) {
      showToast("Dispatched GitHub Actions Pages build workflow (static.yml)!", "lime", 4800);
      return true;
    }
    throw new Error(`HTTP ${resp.status}`);
  } catch (err) {
    showToast(`Workflow dispatch failed: ${err.message}`, "crimson", 5000);
    return false;
  }
}


// =====================================================================
// 05. KPI RIBBON, TACTICAL DROP RADAR (CARDS + MATRIX) & 3D CRATE DECK
// =====================================================================
function renderTopKPIs(filteredRadarCount = null) {
  const s = SNIPER_STATE.summary || {};
  const f = SNIPER_STATE.forensics || {};
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.textContent = val;
  };

  const rawTotal = s.total_tracked_listings ?? 219;
  const uniqueTotal = s.unique_deduped_offerings ?? 114;
  const liveP1Count = s.live_page1_count ?? 25;

  setTxt("kpi-unique-offerings", uniqueTotal);
  setTxt("kpi-raw-total-badge", `from ${rawTotal} raw`);
  setTxt("kpi-live-p1-chip", `${liveP1Count} Live P1`);
  setTxt("kpi-distinct-releases-sub", `Across ${s.distinct_releases ?? 73} distinct Wantlist pressings`);

  const bundles = SNIPER_STATE.seller_bundles || [];
  const maxSave = s.max_bundle_savings_usd ?? (bundles[0]?.shipping_saved_usd || 0);
  const offersCount = (SNIPER_STATE.listings || []).filter((x) => x.is_latest_in_group && x.allow_offers).length;
  setTxt("kpi-bundles-count", bundles.length);
  setTxt("kpi-bundle-save-badge", maxSave > 0 ? `Save up to ${formatUsd(maxSave)}` : "Multi-LP Alpha");
  setTxt("kpi-offers-chip", `${offersCount} Make Offer`);
  setTxt("kpi-alpha-sub", `${bundles.length} multi-LP sellers // ${Object.keys(appState.targetPricesByRelease).length} target watches`);
  setTxt("nav-count-alpha", `${bundles.length}`);

  setTxt("kpi-relists-intercepted", s.auto_relists_intercepted ?? 105);
  setTxt("kpi-spam-pct-badge", `-${s.spam_reduction_pct ?? 47.9}% Noise`);
  setTxt("kpi-price-drops-chip", `${s.price_drops_detected ?? 4} Drops`);
  setTxt(
    "kpi-recordmule-sub",
    `recordmule drives ${s.recordmule_listings ?? 99}/${rawTotal} (${s.recordmule_share_pct ?? 45.2}%)`
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
      kpiOverlapBadge.textContent = p1Owned > 0 ? `${p1Owned} on Live P1` : `${activeOverlaps}/${totalSnapshotOwned} Hist`;
    }
    if (navVaultCount) {
      navVaultCount.className = "nav-tab-count";
      navVaultCount.textContent = `${activeOverlaps} Hist`;
    }
  }

  setTxt("kpi-total-checks", `${Number(f.total_checks ?? 5632).toLocaleString()} runs`);
  setTxt("kpi-alerts-sent-sub", `${f.total_alerts_sent ?? 225} Priority Alerts // ${f.hydration_success_rate_pct ?? 98.8}% Hydrated`);

  setTxt(
    "nav-count-radar",
    filteredRadarCount !== null ? filteredRadarCount : appState.dedupEnabled ? uniqueTotal : rawTotal
  );
  setTxt("nav-count-forensics", `-${s.spam_reduction_pct ?? 47.9}%`);
  setTxt("dedup-status-chip", appState.dedupEnabled ? `ON (-${s.auto_relists_intercepted ?? 105})` : `OFF (${rawTotal})`);
  updateRigHeartbeatUI();
  updateHydratorStatusUI();
}

function updateApiConnectionStatusUI() {
  const dot = document.getElementById("api-connection-dot");
  const lbl = document.getElementById("api-connection-label");
  const navApi = document.getElementById("nav-count-api");
  const tokenInput = document.getElementById("input-discogs-token");
  const userInput = document.getElementById("input-discogs-username");
  const quickUser = document.getElementById("quick-api-username");
  const quickTok = document.getElementById("quick-api-token");
  const quickGh = document.getElementById("quick-github-pat");
  const ghPatInp = document.getElementById("input-github-pat");
  const ghRepoInp = document.getElementById("input-github-repo");
  const subtitle = document.getElementById("header-telemetry-subtitle");

  if (userInput) userInput.value = appState.discogsUsername;
  if (tokenInput) tokenInput.value = appState.discogsToken;
  if (quickUser) quickUser.value = appState.discogsUsername;
  if (quickTok) quickTok.value = appState.discogsToken;
  if (quickGh) quickGh.value = appState.githubPat;
  if (ghPatInp) ghPatInp.value = appState.githubPat;
  if (ghRepoInp) ghRepoInp.value = appState.githubRepo;
  if (subtitle) {
    subtitle.textContent = `@${appState.discogsUsername} // API v2 + GRAPHQL + VAULT + GITHUB REMOTE`;
  }

  if (appState.discogsToken) {
    if (dot) dot.classList.add("connected");
    if (lbl) lbl.textContent = `@${appState.discogsUsername} API`;
    if (navApi) {
      navApi.className = "nav-tab-count count-clean";
      navApi.textContent = appState.githubPat ? "API+GH" : "LIVE";
    }
  } else {
    if (dot) dot.classList.remove("connected");
    if (lbl) lbl.textContent = appState.githubPat ? "GitHub Connected" : "Connect API";
    if (navApi) {
      navApi.className = "nav-tab-count";
      navApi.textContent = appState.githubPat ? "GH PAT" : "API v2";
    }
  }
}

function renderPriceSparklineSVG(points, width = 108, height = 26) {
  if (!Array.isArray(points) || points.length < 2) {
    return `<span style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.68rem;">Flatline</span>`;
  }
  const vals = points.map((p) => (typeof p === "number" ? p : Number(p.price_usd || 0))).filter((v) => v > 0);
  if (vals.length < 2) return "";
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(0.01, maxV - minV);
  const pad = 3;
  const coords = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (width - pad * 2);
    const y = maxV === minV ? height / 2 : height - pad - ((v - minV) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = vals[0];
  const last = vals[vals.length - 1];
  const stroke = last < first ? "#39ff88" : maxV > minV ? "#ffb800" : "#00f0ff";
  const lastPt = coords[coords.length - 1].split(",");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" style="vertical-align:middle;">
    <polyline fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${coords.join(" ")}" />
    <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.4" fill="${stroke}" />
  </svg>`;
}

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
    appState.hideSold ||
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
  appState.hideSold = false;
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
  document.getElementById("btn-hide-recordmule")?.classList.remove("active");
  document.getElementById("btn-hide-sold")?.classList.remove("active");

  document.querySelectorAll(".scope-btn[data-scope]").forEach((b) => {
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
    if (appState.hideSold && isListingSold(item)) return false;
    const sellerLow = (item.seller_info || "").toLowerCase();
    if (appState.mutedSellers.has(sellerLow)) return false;
    if (appState.hideRecordmule && sellerLow === "recordmule") return false;
    if (!passesConditionGrade(item.media_condition, appState.conditionFilter)) return false;
    if (appState.maxPriceUsd < appState.sliderMaxUsd && item.total_price_usd > appState.maxPriceUsd) return false;

    if (appState.searchQuery) {
      const q = appState.searchQuery.toLowerCase();
      const badgeStr = (item.collector_badges || []).map((b) => b.label).join(" ");
      const hay = `${item.title} ${item.variant} ${item.seller_info} ${item.id} ${item.release_id} ${item.raw_description} ${badgeStr}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    ALL: basePool.length,
    MISSING_GRAIL: basePool.filter((x) => x.vault_status === "MISSING_GRAIL").length,
    STEALS: basePool.filter(isListingVerifiedDeal).length,
    PRICE_DROP: basePool.filter((x) => x.is_price_drop).length,
    BUNDLE_READY: basePool.filter((x) => Number(x.seller_bundle_count || 1) >= 2).length,
    MAKE_OFFER: basePool.filter((x) => x.allow_offers).length,
    TARGET_HITS: basePool.filter(isListingTargetHit).length,
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
  setCnt("pill-cnt-bundles", counts.BUNDLE_READY);
  setCnt("pill-cnt-offers", counts.MAKE_OFFER);
  setCnt("pill-cnt-targets", counts.TARGET_HITS);
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
      case "BUNDLE_READY":
        return Number(item.seller_bundle_count || 1) >= 2;
      case "MAKE_OFFER":
        return item.allow_offers;
      case "TARGET_HITS":
        return isListingTargetHit(item);
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
        return b.deal_score - a.deal_score || da - db;
      }
      case "PRICE_ASC":
        return a.total_price_usd - b.total_price_usd;
      case "PRICE_DESC":
        return b.total_price_usd - a.total_price_usd;
      case "TARGET_HITS":
        return Number(isListingTargetHit(b)) - Number(isListingTargetHit(a)) || a.total_price_usd - b.total_price_usd;
      case "BUNDLE_SAVINGS":
        return Number(b.seller_bundle_savings_usd || 0) - Number(a.seller_bundle_savings_usd || 0) || a.snapshot_order - b.snapshot_order;
      case "MOST_RELISTED":
        return b.relist_group_total - a.relist_group_total || a.snapshot_order - b.snapshot_order;
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
  const live = appState.liveApiResults[item.id];
  if (isListingSold(item)) {
    pills.push(`<span class="tag-pill badge-crimson">${escapeHtml(live?.status || "SOLD")}</span>`);
  } else if (live && !live.loading && !live.error && live.status === "For Sale") {
    pills.push(`<span class="tag-pill badge-lime">LIVE FOR SALE</span>`);
  }

  if (item.is_live_page1) pills.push(`<span class="tag-pill badge-cyan">LIVE P1</span>`);
  if (isListingTargetHit(item)) {
    pills.push(`<span class="tag-pill badge-gold">${ICONS.target}<span>TARGET HIT</span></span>`);
  }
  if (item.allow_offers) pills.push(`<span class="tag-pill badge-amber">MAKE OFFER</span>`);
  if (Number(item.seller_bundle_count || 1) >= 2) {
    pills.push(
      `<button type="button" class="tag-pill tag-pill-btn badge-cyan btn-jump-bundle" data-bundle-seller="${escapeHtml(item.seller_info)}" title="Seller holds ${item.seller_bundle_count} Wantlist LPs — jump to Bundle Optimizer">
        ${item.seller_bundle_count}x BUNDLE
      </button>`
    );
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
    const bluffTag = item.relist_behavior === "YOYO_BLUFF" ? " BLUFF" : "";
    pills.push(
      `<button type="button" class="tag-pill tag-pill-btn badge-amber btn-toggle-relist-history" data-id="${escapeHtml(item.id)}" title="Inspect ${item.relist_group_total}x relist history">
        ${ICONS.repeat}<span>${item.relist_group_total}x${bluffTag}</span>
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
          <span>#${idx + 1} // <a href="${escapeHtml(sanitizeHttpUrl(h.item_url))}" target="_blank" rel="noopener" style="color:var(--neon-cyan);">ID #${escapeHtml(h.id)}</a></span>
          <span style="color:var(--neon-lime);font-weight:600;">${escapeHtml(h.total_price)}</span>
          <span style="color:var(--text-muted);">${escapeHtml((h.alerted_at || "").replace("T", " ").slice(0, 16))}</span>
        </div>`
      )
      .join("");
    html += `
      <div class="relist-history-drawer">
        <div style="display:flex;justify-content:space-between;color:var(--neon-amber);font-weight:600;gap:8px;flex-wrap:wrap;align-items:center;">
          <span>RELIST TRAIL (${item.relist_group_total}x // ${escapeHtml(item.relist_behavior || "BOT")})</span>
          ${renderPriceSparklineSVG(item.price_trajectory, 86, 20)}
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
      html += `
        <div class="live-api-drawer">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
            <strong style="color:var(--neon-cyan);">DISCOGS API LIVE TELEMETRY</strong>
            <span class="kpi-badge ${statusClass}">${escapeHtml(statusText)}</span>
          </div>
          <div>Market: <strong>${liveResult.num_for_sale ?? "?"}</strong> for sale (Lowest: <strong>${escapeHtml(liveResult.lowest_price_str || "N/A")}</strong>) // <strong>${liveResult.want ?? "?"}</strong> Want / <strong>${liveResult.have ?? "?"}</strong> Have</div>
          <div>Suggested (${escapeHtml(item.media_condition)}): <strong style="color:var(--neon-lime);">${escapeHtml(liveResult.suggested_str || mkt.condition_suggested_formatted || "Connect Token")}</strong></div>
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
  const isFocused = appState.focusedListingId === item.id;
  const isSold = isListingSold(item);
  const mkt = item.market_stats || {};
  const waxPrimary = item.wax_shader?.primary && item.wax_shader.primary !== "#181a1f" ? item.wax_shader.primary : "#00f0ff";
  const waxGlow = hexToRgba(waxPrimary, 0.24);
  const liveBench = appState.liveApiResults[item.id]?.suggested_usd;
  const benchDisplay = liveBench ? formatUsd(liveBench) : mkt.condition_suggested_formatted || "Live API";
  const benchSub = liveBench
    ? "Official Discogs API"
    : mkt.condition_suggested_usd > 0
    ? `Low ${formatUsd(mkt.observed_low_usd)} / Hi ${formatUsd(mkt.observed_high_usd)}`
    : "Auto-hydrating...";
  const shipText = item.shipping_price_usd > 0 ? `+ ${formatUsd(item.shipping_price_usd)} ship` : "incl. ship";
  const vaultCardCls =
    item.vault_status === "VARIANT_UPGRADE"
      ? "card-variant"
      : item.vault_status === "ALREADY_OWNED"
      ? "card-owned"
      : "card-grail";

  const collectorBadgesHtml = (item.collector_badges || [])
    .slice(0, 4)
    .map((b) => `<span class="tag-pill badge-${escapeHtml(b.tone)}">${escapeHtml(b.label)}</span>`)
    .join("");

  const cleanNote =
    item.clean_seller_note !== undefined
      ? item.clean_seller_note
      : item.raw_description && item.raw_description.toLowerCase() !== item.variant.toLowerCase()
      ? item.raw_description
      : "";

  return `
    <article class="drop-card ${vaultCardCls} ${isPlaying ? "card-playing" : ""} ${isFocused ? "card-kbd-focused" : ""} ${isSold ? "card-sold" : ""}" style="--wax-glow:${waxGlow};" data-listing-id="${escapeHtml(item.id)}" data-release-id="${escapeHtml(item.release_id)}" data-artist="${escapeHtml(item.artist)}" data-album="${escapeHtml(item.album)}">
      <div class="drop-card-top">
        <div class="status-pills">
          ${renderVaultStatusPill(item)}
          ${renderDealAndRelistPills(item)}
        </div>
        <span class="listing-id-label">#${escapeHtml(item.id)}</span>
      </div>

      <div class="drop-card-hero">
        <button type="button" class="artwork-stage" data-inspect-id="${escapeHtml(item.id)}" title="Inspect full vinyl pressing, Haggle &amp; Target Price">
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
          ${collectorBadgesHtml ? `<div class="collector-badges-row">${collectorBadgesHtml}</div>` : ""}
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
          <span class="matrix-label">Grade / Alpha</span>
          <span class="matrix-val">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</span>
          <span class="matrix-sub">${
            item.allow_offers && item.offer_strategy?.recommended_offer_usd
              ? `Offer ~${formatUsd(item.offer_strategy.recommended_offer_usd)}`
              : item.deal_tier === "UNRATED"
              ? "Queueing API"
              : `Score ${item.deal_score}/100`
          }</span>
        </div>
      </div>

      <div class="seller-strip">
        <div class="seller-left">
          <a href="https://www.discogs.com/seller/${encodeURIComponent(item.seller_info)}/profile" target="_blank" rel="noopener" class="seller-link">${escapeHtml(item.seller_info)}</a>
          ${item.seller_rating ? `<span style="color:var(--neon-lime);font-family:var(--font-mono);font-size:0.67rem;">${escapeHtml(item.seller_rating)}</span>` : ""}
          <button type="button" class="mute-seller-inline" data-mute-seller="${escapeHtml(item.seller_info)}" title="Mute all listings from ${escapeHtml(item.seller_info)}">Mute</button>
        </div>
        <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);">
          ${escapeHtml((item.alerted_at || "").replace("T", " ").slice(0, 16) || item.listed_age)}
        </span>
      </div>

      ${cleanNote ? `<div class="seller-notes ${item.has_wear_warning ? "notes-wear" : ""}" title="${escapeHtml(cleanNote)}">${escapeHtml(cleanNote)}</div>` : ""}

      <div class="card-drawers-slot" data-drawers-for="${escapeHtml(item.id)}">${renderCardDrawersHtml(item)}</div>

      <div class="card-actions">
        <a href="${escapeHtml(sanitizeHttpUrl(item.add_to_cart_url))}" target="_blank" rel="noopener" class="btn-action btn-cart" title="1-Click Add to Discogs Cart">
          ${ICONS.cart}<span>Cart (${escapeHtml(item.total_price)})</span>
        </a>
        <a href="${escapeHtml(sanitizeHttpUrl(item.item_url))}" target="_blank" rel="noopener" class="btn-action" title="Open Discogs Listing #${escapeHtml(item.id)}">
          <span>Listing</span>${ICONS.ext}
        </a>
        <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}" title="Audition 30-second studio preview (Space)">
          ${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s"}</span>
        </button>
        <button type="button" class="btn-action" data-open-deck-id="${escapeHtml(item.id)}" title="Load onto 3D Turntable Deck">
          <span>Deck</span>
        </button>
        <button type="button" class="btn-action" data-live-api-id="${escapeHtml(item.id)}" title="Verify live status &amp; Discogs API price suggestions">
          ${ICONS.bolt}
        </button>
      </div>
    </article>
  `;
}

function renderMatrixTapeTable(filtered) {
  const rows = filtered
    .map((item) => {
      const mkt = item.market_stats || {};
      const live = appState.liveApiResults[item.id];
      const bench = live?.suggested_usd ? formatUsd(live.suggested_usd) : mkt.condition_suggested_formatted || "—";
      const isFocused = appState.focusedListingId === item.id;
      const isSold = isListingSold(item);
      const isPlaying = appState.currentlyPlayingId === item.id;
      const statusBadge = isSold
        ? `<span class="kpi-badge badge-crimson">SOLD</span>`
        : item.vault_status === "VARIANT_UPGRADE"
        ? `<span class="kpi-badge badge-magenta">Variant</span>`
        : item.vault_status === "ALREADY_OWNED"
        ? `<span class="kpi-badge badge-crimson">Vault</span>`
        : `<span class="kpi-badge badge-lime">Grail</span>`;

      return `
        <tr class="drop-card-row ${isFocused ? "matrix-row-focused" : ""} ${isSold ? "matrix-row-sold" : ""}" data-listing-id="${escapeHtml(item.id)}">
          <td>${statusBadge}</td>
          <td>
            <button type="button" class="drop-album-btn" data-inspect-id="${escapeHtml(item.id)}" style="color:#fff;font-weight:700;">
              ${escapeHtml(item.artist)} — ${escapeHtml(getDisplayAlbumTitle(item))}
            </button>
            <div style="font-size:0.69rem;color:var(--text-muted);">${escapeHtml(item.wax_shader?.wax_name || item.variant)}</div>
          </td>
          <td style="font-family:var(--font-mono);color:var(--neon-lime);font-weight:700;">${escapeHtml(item.total_price)}</td>
          <td style="font-family:var(--font-mono);">${escapeHtml(bench)}</td>
          <td style="font-family:var(--font-mono);">${escapeHtml(item.media_condition)}/${escapeHtml(item.sleeve_condition)}</td>
          <td style="font-family:var(--font-mono);">
            ${escapeHtml(item.seller_info)}
            ${item.seller_bundle_count >= 2 ? `<span class="kpi-badge badge-cyan">${item.seller_bundle_count}x</span>` : ""}
          </td>
          <td>${renderPriceSparklineSVG(item.price_trajectory, 74, 20)}</td>
          <td>
            <div class="seller-ctrl-group">
              <a href="${escapeHtml(sanitizeHttpUrl(item.add_to_cart_url))}" target="_blank" rel="noopener" class="btn-action btn-neon-lime btn-sm">Cart</a>
              <button type="button" class="btn-action btn-sm" data-audition-id="${escapeHtml(item.id)}">${isPlaying ? "Stop" : "30s"}</button>
              <button type="button" class="btn-action btn-sm" data-inspect-id="${escapeHtml(item.id)}">Inspect</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div class="matrix-tape-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Vault</th>
            <th>Release &amp; Pressing</th>
            <th>Shipped</th>
            <th>Benchmark</th>
            <th>Grade</th>
            <th>Seller</th>
            <th>Trajectory</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function updateCardInPlace(listingId, { flash = false } = {}) {
  const item = getListingById(listingId);
  if (!item) return;
  const slot = document.querySelector(`.card-drawers-slot[data-drawers-for="${CSS.escape(String(listingId))}"]`);
  if (slot) slot.innerHTML = renderCardDrawersHtml(item);

  const live = appState.liveApiResults[listingId];
  const liveBench = live?.suggested_usd;
  if (liveBench) {
    const benchEl = document.querySelector(`[data-bench-val="${CSS.escape(String(listingId))}"]`);
    if (benchEl) {
      benchEl.textContent = formatUsd(liveBench);
      benchEl.classList.remove("matrix-val-muted");
    }
  }
  const cardEl = document.querySelector(`.drop-card[data-listing-id="${CSS.escape(String(listingId))}"]`);
  if (cardEl) {
    cardEl.classList.toggle("card-sold", isListingSold(item));
    if (flash) {
      cardEl.classList.remove("api-hydrated-flash");
      void cardEl.offsetWidth;
      cardEl.classList.add("api-hydrated-flash");
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

  const arm = document.getElementById("btn-tonearm-toggle");
  if (arm) arm.classList.toggle("engaged", appState.isAudioActuallyPlaying);
  const deckSpinBtn = document.getElementById("btn-deck-spin");
  if (deckSpinBtn) {
    deckSpinBtn.innerHTML = appState.isAudioActuallyPlaying ? "<span>■ Lift Stylus</span>" : "<span>▶ Drop Needle</span>";
  }
}

function renderRadarGrid() {
  const grid = document.getElementById("radar-drops-grid");
  const summaryEl = document.getElementById("radar-showing-summary");
  const mutedBar = document.getElementById("radar-muted-sellers-bar");
  const quickResetBtn = document.getElementById("btn-quick-reset-filters");
  if (!grid) return;

  const filtered = getFilteredListings();
  renderTopKPIs(filtered.length);

  if (quickResetBtn) quickResetBtn.hidden = !hasActiveFilters();
  if (summaryEl) {
    const scopeLabel = appState.scopeMode === "LIVE_P1" ? "Live Top-25 drops" : appState.dedupEnabled ? "unique deduplicated offerings" : "raw tracked listings";
    summaryEl.textContent = `Showing ${filtered.length} ${scopeLabel} (of ${SNIPER_STATE.listings?.length || 219} in snapshot)`;
  }

  if (mutedBar) {
    if (appState.mutedSellers.size > 0) {
      const names = Array.from(appState.mutedSellers).join(", ");
      mutedBar.innerHTML = `Muted: <strong style="color:var(--neon-crimson);">${escapeHtml(names)}</strong> <button type="button" id="btn-clear-muted" class="mute-seller-inline" style="margin-left:6px;">Unmute All</button>`;
      document.getElementById("btn-clear-muted")?.addEventListener("click", () => {
        appState.mutedSellers.clear();
        syncRuleInputsFromState();
        saveConfigOverrides();
        renderRadarGrid();
        renderForensicsView();
        showToast("Cleared all muted sellers.", "cyan");
      });
    } else {
      mutedBar.innerHTML = "";
    }
  }

  grid.classList.toggle("layout-matrix", appState.radarLayout === "matrix");

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="panel-card" style="grid-column: 1 / -1; text-align: center; padding: 50px 20px;">
        <h3 style="font-family: var(--font-display); font-size: 1.12rem; margin-bottom: 8px; color: #fff;">No Wantlist Drops Match Current Filters</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Reset filters, unhide sold items, or widen the max price ceiling.</p>
        <button type="button" class="btn-action btn-neon-cyan" id="btn-reset-all-filters">Reset All Filters</button>
      </div>`;
    document.getElementById("btn-reset-all-filters")?.addEventListener("click", resetAllRadarFilters);
    return;
  }

  if (appState.radarLayout === "matrix") {
    grid.innerHTML = renderMatrixTapeTable(filtered);
  } else {
    grid.innerHTML = filtered.map(renderDropCard).join("");
  }
  observeCoverArtAndLiveHydration();
}

// =====================================================================
// 3D VINYL CRATE DIGGING & VIRTUAL TURNTABLE STUDIO
// =====================================================================
function getCrateFilteredListings() {
  const deduped = (SNIPER_STATE.listings || []).filter(
    (x) => x.is_latest_in_group && !appState.mutedSellers.has((x.seller_info || "").toLowerCase())
  );
  switch (appState.crateFilter) {
    case "MISSING_GRAIL":
      return deduped.filter((x) => x.vault_status === "MISSING_GRAIL");
    case "VARIANT_UPGRADE":
      return deduped.filter((x) => x.vault_status === "VARIANT_UPGRADE");
    case "MAKE_OFFER":
      return deduped.filter((x) => x.allow_offers);
    case "COLORED":
      return deduped.filter((x) => x.wax_shader && x.wax_shader.primary !== "#181a1f");
    default:
      return deduped;
  }
}

function renderCrateStudio() {
  const stage = document.getElementById("crate-3d-stage");
  const slider = document.getElementById("crate-index-slider");
  const counter = document.getElementById("crate-counter-label");
  if (!stage) return;

  const items = getCrateFilteredListings();
  if (items.length === 0) {
    stage.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary);">No records match this crate filter.</div>`;
    if (counter) counter.textContent = "0 / 0";
    return;
  }

  if (appState.crateIndex >= items.length) appState.crateIndex = items.length - 1;
  if (appState.crateIndex < 0) appState.crateIndex = 0;

  if (slider) {
    slider.max = String(Math.max(0, items.length - 1));
    slider.value = String(appState.crateIndex);
  }
  if (counter) counter.textContent = `${appState.crateIndex + 1} / ${items.length}`;

  // Render local window of +-5 sleeves for crisp 60fps 3D perspective
  const start = Math.max(0, appState.crateIndex - 5);
  const end = Math.min(items.length - 1, appState.crateIndex + 5);
  const cardsHtml = [];

  for (let i = start; i <= end; i += 1) {
    const item = items[i];
    const offset = i - appState.crateIndex;
    const absOff = Math.abs(offset);
    const tx = offset * 62;
    const tz = -absOff * 68;
    const ry = offset * -14;
    const scale = Math.max(0.68, 1 - absOff * 0.08);
    const opacity = Math.max(0.28, 1 - absOff * 0.16);
    const zIndex = 30 - absOff;
    const isFoil = Boolean(item.wax_shader?.is_foil_sleeve);
    const cover = resolveCoverSrc(item);
    const fallback = renderFallbackSleeveDataUri(item.artist, item.album, item.wax_shader?.primary);

    cardsHtml.push(`
      <div class="crate-sleeve-card ${offset === 0 ? "is-active" : ""} ${isFoil ? "is-foil" : ""}"
           data-crate-pos="${i}"
           style="z-index:${zIndex};opacity:${opacity};transform:translate(-50%, -50%) translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale});">
        <img class="crate-sleeve-art" src="${escapeHtml(cover)}" data-fallback-src="${escapeHtml(fallback)}" alt="${escapeHtml(item.title)}" />
        <div class="crate-sleeve-footer">
          <div class="crate-sleeve-title">${escapeHtml(item.artist)} — ${escapeHtml(getDisplayAlbumTitle(item))}</div>
          <div class="crate-sleeve-sub">
            <span>${escapeHtml(item.total_price)}</span>
            <span style="color:var(--neon-cyan);">${escapeHtml(item.media_condition)}/${escapeHtml(item.sleeve_condition)}</span>
          </div>
        </div>
      </div>`);
  }
  stage.innerHTML = cardsHtml.join("");

  // Sync active deck info panel
  const active = items[appState.crateIndex];
  if (active) {
    setStageChromaFromWax(active.wax_shader);
    const titleEl = document.getElementById("deck-now-title");
    const varEl = document.getElementById("deck-now-variant");
    const priceEl = document.getElementById("deck-now-price");
    const gradeEl = document.getElementById("deck-now-grade");
    const cartEl = document.getElementById("deck-action-cart");
    const offerEl = document.getElementById("deck-action-offer");
    const targetEl = document.getElementById("deck-action-target");
    const inspectEl = document.getElementById("deck-action-inspect");

    if (titleEl) titleEl.textContent = `${active.artist} — ${getDisplayAlbumTitle(active)}`;
    if (varEl) varEl.textContent = `${active.wax_shader?.wax_name || active.variant} (${(active.wax_shader?.subpattern || "vinyl").toUpperCase()})`;
    if (priceEl) priceEl.textContent = active.total_price;
    if (gradeEl) gradeEl.textContent = `${active.media_condition} / ${active.sleeve_condition} // ${active.seller_info}`;
    if (cartEl) cartEl.href = sanitizeHttpUrl(active.add_to_cart_url);
    if (offerEl) offerEl.dataset.inspectId = active.id;
    if (targetEl) targetEl.dataset.pinTargetRelease = active.release_id;
    if (inspectEl) inspectEl.dataset.inspectId = active.id;

    const canvas = document.getElementById("turntable-platter-canvas");
    if (canvas) renderVinylCanvas(canvas, active.wax_shader, { angleRad: platterAngleRad });
    drawFftSpectrumFrame(performance.now());
  }
}

function selectCrateIndex(newIdx, { autoPlay = false } = {}) {
  const items = getCrateFilteredListings();
  if (items.length === 0) return;
  appState.crateIndex = Math.max(0, Math.min(items.length - 1, Number(newIdx) || 0));
  renderCrateStudio();
  if (autoPlay && items[appState.crateIndex]) {
    auditionListing(items[appState.crateIndex].id);
  }
}

function openListingInTurntableDeck(listingId) {
  const items = getCrateFilteredListings();
  let idx = items.findIndex((x) => String(x.id) === String(listingId));
  if (idx < 0) {
    appState.crateFilter = "ALL";
    document.querySelectorAll(".crate-filter-chip[data-crate-filter]").forEach((c) => {
      c.classList.toggle("active", c.dataset.crateFilter === "ALL");
    });
    idx = getCrateFilteredListings().findIndex((x) => String(x.id) === String(listingId));
  }
  if (idx >= 0) appState.crateIndex = idx;
  switchView("crate");
  renderCrateStudio();
  startTurntableAnimationLoop();
}


// =====================================================================
// 06. SNIPER ALPHA, RELIST FORENSICS & VAULT SHOWDOWN / PRUNER
// =====================================================================
function renderAlphaView() {
  renderAlphaBundles();
  renderAlphaHaggleDesk();
  renderTargetWatchlist();
}

function getBundleItemCheckedState(seller, itemId) {
  const map = appState.bundleSelectionBySeller[seller];
  if (!map) return true;
  return map[itemId] !== false;
}

function renderAlphaBundles() {
  const grid = document.getElementById("alpha-bundles-grid");
  if (!grid) return;

  const allBundles = SNIPER_STATE.seller_bundles || [];
  const filtered = allBundles.filter((b) => {
    if (appState.mutedSellers.has((b.seller || "").toLowerCase())) return false;
    if (appState.bundleFilter === "CONFIRMED") return b.confirmed_policy;
    if (appState.bundleFilter === "OFFERS") return b.allow_offers_count > 0;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="panel-subtitle">No multi-LP seller bundles match the active filter.</div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((b) => {
      const selectedItems = b.items.filter((it) => getBundleItemCheckedState(b.seller, it.id));
      const selCount = selectedItems.length;
      const selShips = selectedItems.map((it) => Number(it.shipping_price_usd || 0));
      const soloList = selectedItems.reduce((acc, it) => acc + Number(it.list_price_usd || 0), 0);
      const soloShip = selShips.reduce((acc, s) => acc + s, 0);
      const maxShip = selShips.length ? Math.max(...selShips) : 0;

      let bundledShip = 0;
      if (selCount > 0) {
        if (maxShip <= 0) bundledShip = 0;
        else if (b.policy_type === "FLAT_UNLIMITED") bundledShip = maxShip;
        else if (maxShip >= 3.0) bundledShip = Math.min(soloShip, maxShip + 1.5 * Math.max(0, selCount - 1));
        else bundledShip = soloShip;
      }

      const saved = Math.max(0, soloShip - bundledShip);
      const bundledTotal = soloList + bundledShip;
      const perLp = selCount > 0 ? bundledTotal / selCount : 0;
      const policyBadge = b.confirmed_policy ? "badge-lime" : "badge-amber";

      const itemsHtml = b.items
        .map((it) => {
          const checked = getBundleItemCheckedState(b.seller, it.id);
          const fallback = renderFallbackSleeveDataUri(it.artist, it.album);
          return `
            <label class="bundle-item-row" style="cursor:pointer;">
              <input type="checkbox" class="bundle-item-chk" data-bundle-seller="${escapeHtml(b.seller)}" data-bundle-item-id="${escapeHtml(it.id)}" ${checked ? "checked" : ""} />
              <img src="${escapeHtml(it.cover_image_url || fallback)}" data-fallback-src="${escapeHtml(fallback)}" alt="" />
              <span class="bundle-item-title" title="${escapeHtml(it.title)} — ${escapeHtml(it.variant)}">${escapeHtml(it.title)}</span>
              <span style="font-family:var(--font-mono);color:var(--neon-lime);font-weight:700;">${formatUsd(it.list_price_usd)}</span>
            </label>`;
        })
        .join("");

      return `
        <article class="bundle-card">
          <div class="bundle-card-head">
            <div>
              <a href="${escapeHtml(sanitizeHttpUrl(b.seller_url))}" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-weight:700;font-size:0.95rem;color:#fff;">
                ${escapeHtml(b.seller)}
              </a>
              <div style="font-size:0.71rem;color:var(--text-secondary);">${selCount}/${b.item_count} LPs selected // ${b.allow_offers_count} Make Offer</div>
            </div>
            <span class="kpi-badge ${policyBadge}">${escapeHtml(b.policy_label)}</span>
          </div>

          <div class="bundle-items-list">${itemsHtml}</div>

          <div class="bundle-math-bar">
            <div>
              <div class="matrix-label">Solo Shipped</div>
              <div style="color:var(--text-secondary);text-decoration:line-through;">${formatUsd(soloList + soloShip)}</div>
            </div>
            <div>
              <div class="matrix-label">Bundled Total</div>
              <div style="color:var(--neon-lime);font-weight:700;">${formatUsd(bundledTotal)}</div>
            </div>
            <div>
              <div class="matrix-label">Ship Saved</div>
              <div style="color:var(--neon-cyan);font-weight:700;">-${formatUsd(saved)} (${formatUsd(perLp)}/LP)</div>
            </div>
          </div>

          <div class="card-actions">
            <button type="button" class="btn-action btn-neon-lime btn-sm" data-launch-bundle-seller="${escapeHtml(b.seller)}" ${selCount === 0 ? "disabled" : ""}>
              ${ICONS.cart}<span>Open ${selCount} Cart Tab${selCount === 1 ? "" : "s"}</span>
            </button>
            <button type="button" class="btn-action btn-sm" data-copy-bundle-msg="${escapeHtml(b.seller)}" ${selCount === 0 ? "disabled" : ""}>
              <span>Copy Inquiry</span>
            </button>
            <a href="${escapeHtml(sanitizeHttpUrl(b.seller_wantlist_url))}" target="_blank" rel="noopener" class="btn-action btn-sm">
              <span>Shop</span>${ICONS.ext}
            </a>
          </div>
        </article>`;
    })
    .join("");
}

function renderAlphaHaggleDesk() {
  const wrap = document.getElementById("alpha-haggle-grid");
  const countEl = document.getElementById("alpha-haggle-count");
  if (!wrap) return;

  const offers = (SNIPER_STATE.listings || []).filter(
    (x) => x.is_latest_in_group && x.allow_offers && !appState.mutedSellers.has((x.seller_info || "").toLowerCase())
  );
  if (countEl) countEl.textContent = `${offers.length} Make-Offer LPs`;

  if (offers.length === 0) {
    wrap.innerHTML = `<div class="panel-subtitle">No active Make-Offer listings found.</div>`;
    return;
  }

  wrap.innerHTML = offers
    .map((item) => {
      const strat = item.offer_strategy || {};
      const rec = Number(strat.recommended_offer_usd || item.list_price_usd * 0.9);
      const agg = Number(strat.aggressive_offer_usd || item.list_price_usd * 0.82);
      const inst = Number(strat.instant_close_offer_usd || item.list_price_usd * 0.95);
      const curOffer = Number(appState.customOfferById[item.id] || rec);
      const minOffer = Math.max(5, Math.floor(item.list_price_usd * 0.55));
      const maxOffer = Math.max(minOffer + 1, Math.ceil(item.list_price_usd));
      const pitch = buildCustomBuyerPitch(item, curOffer);

      const rationalesHtml = (strat.rationales || [])
        .map((r) => `<span class="kpi-badge badge-neutral">${escapeHtml(r)}</span>`)
        .join("");

      return `
        <article class="haggle-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
            <div>
              <button type="button" class="drop-album-btn" data-inspect-id="${escapeHtml(item.id)}" style="color:#fff;font-weight:700;font-size:0.92rem;">
                ${escapeHtml(item.title)}
              </button>
              <div style="font-family:var(--font-mono);font-size:0.71rem;color:var(--text-secondary);">
                Seller: <strong style="color:var(--neon-cyan);">${escapeHtml(item.seller_info)}</strong> // ${escapeHtml(item.media_condition)}/${escapeHtml(item.sleeve_condition)} // Ask: <strong>${formatUsd(item.list_price_usd)}</strong> (+${formatUsd(item.shipping_price_usd)} ship)
              </div>
            </div>
            <span class="kpi-badge badge-amber">Target ${formatUsd(curOffer)}</span>
          </div>

          ${rationalesHtml ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">${rationalesHtml}</div>` : ""}

          <div class="haggle-tiers-row">
            <button type="button" class="haggle-tier-btn ${Math.abs(curOffer - agg) < 0.05 ? "active" : ""}" data-set-offer-id="${escapeHtml(item.id)}" data-set-offer-val="${agg.toFixed(2)}">
              <div style="font-size:0.62rem;color:var(--text-muted);">AGGRESSIVE</div>
              <div style="font-size:0.84rem;color:var(--neon-magenta);font-weight:700;">${formatUsd(agg)}</div>
            </button>
            <button type="button" class="haggle-tier-btn ${Math.abs(curOffer - rec) < 0.05 ? "active" : ""}" data-set-offer-id="${escapeHtml(item.id)}" data-set-offer-val="${rec.toFixed(2)}">
              <div style="font-size:0.62rem;color:var(--text-muted);">RECOMMENDED</div>
              <div style="font-size:0.84rem;color:var(--neon-lime);font-weight:700;">${formatUsd(rec)}</div>
            </button>
            <button type="button" class="haggle-tier-btn ${Math.abs(curOffer - inst) < 0.05 ? "active" : ""}" data-set-offer-id="${escapeHtml(item.id)}" data-set-offer-val="${inst.toFixed(2)}">
              <div style="font-size:0.62rem;color:var(--text-muted);">INSTANT CLOSE</div>
              <div style="font-size:0.84rem;color:var(--neon-cyan);font-weight:700;">${formatUsd(inst)}</div>
            </button>
          </div>

          <div class="pitch-fader-row">
            <span>Custom Item Offer:</span>
            <input type="range" class="price-slider" min="${minOffer}" max="${maxOffer}" step="0.5" value="${curOffer.toFixed(2)}" data-offer-slider-id="${escapeHtml(item.id)}" />
            <strong style="color:var(--neon-lime);">${formatUsd(curOffer)}</strong>
          </div>

          <div class="card-actions">
            <button type="button" class="btn-action btn-neon-cyan btn-sm" data-copy-offer-pitch="${escapeHtml(item.id)}">Copy Buyer Pitch</button>
            <a href="${escapeHtml(sanitizeHttpUrl(item.item_url))}" target="_blank" rel="noopener" class="btn-action btn-sm">Open Listing ${ICONS.ext}</a>
          </div>
          <div style="font-size:0.71rem;color:var(--text-muted);font-family:var(--font-mono);" data-pitch-preview="${escapeHtml(item.id)}">${escapeHtml(pitch)}</div>
        </article>`;
    })
    .join("");
}

function buildCustomBuyerPitch(item, offerUsd) {
  const hasWear = Boolean(item.has_wear_warning);
  const mkt = item.market_stats || {};
  const parts = [
    `Hi ${item.seller_info}, I'm interested in your ${item.media_condition}/${item.sleeve_condition} copy of ${item.title} (#${item.id}).`,
  ];
  if (hasWear) parts.push("I noted your jacket/sleeve description and am fine with the media grade.");
  if (mkt.benchmark_verified && mkt.condition_suggested_usd > 0) {
    parts.push(
      `Based on recent ${item.media_condition} comps around ${formatUsd(mkt.condition_suggested_usd)} shipped, would you take ${formatUsd(offerUsd)} (+ shipping)?`
    );
  } else {
    parts.push(`Would you consider ${formatUsd(offerUsd)} (+ shipping) for a quick purchase today?`);
  }
  if (Number(item.seller_bundle_count || 1) >= 2) {
    parts.push(`I also spotted ${item.seller_bundle_count - 1} other LP(s) in your shop if you combine shipping!`);
  }
  return parts.join(" ");
}

function renderTargetWatchlist() {
  const selectEl = document.getElementById("target-release-select");
  const tbody = document.getElementById("tbody-target-watchlist");
  const countEl = document.getElementById("alpha-targets-count");

  const releasesMap = new Map();
  for (const x of SNIPER_STATE.listings || []) {
    if (x.release_id && x.release_id !== "unknown" && !releasesMap.has(x.release_id)) {
      releasesMap.set(x.release_id, x);
    }
  }

  if (selectEl) {
    const curVal = selectEl.value;
    selectEl.innerHTML = Array.from(releasesMap.values())
      .map((r) => `<option value="${escapeHtml(r.release_id)}">${escapeHtml(r.title)} (Floor ${formatUsd(r.market_stats?.observed_low_usd || r.total_price_usd)})</option>`)
      .join("");
    if (curVal && releasesMap.has(curVal)) selectEl.value = curVal;
  }

  const entries = Object.entries(appState.targetPricesByRelease || {});
  if (countEl) countEl.textContent = `${entries.length} Pinned`;
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;padding:18px;">No target snipe prices pinned yet. Select any release above or press T on a card.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries
    .map(([rid, targetRaw]) => {
      const targetUsd = Number(targetRaw);
      const relRows = (SNIPER_STATE.listings || []).filter((x) => x.release_id === String(rid));
      const latestActive = relRows.filter((x) => x.is_latest_in_group);
      const sample = latestActive[0] || relRows[0] || { title: `Release #${rid}`, release_url: `https://www.discogs.com/release/${rid}` };
      const activeFloor = latestActive.length
        ? Math.min(...latestActive.map((x) => x.total_price_usd))
        : relRows.length
        ? Math.min(...relRows.map((x) => x.total_price_usd))
        : 0;
      const histHits = relRows.filter((x) => x.total_price_usd > 0 && x.total_price_usd <= targetUsd).length;
      const nearMiss = activeFloor > 0 && activeFloor <= targetUsd * 1.1;

      const backtestBadge =
        activeFloor > 0 && activeFloor <= targetUsd
          ? `<span class="kpi-badge badge-lime">ACTIVE HIT (${histHits}x in 14d)</span>`
          : histHits > 0
          ? `<span class="kpi-badge badge-cyan">${histHits}x Hit in 14d</span>`
          : nearMiss
          ? `<span class="kpi-badge badge-amber">Near Miss (+${(((activeFloor - targetUsd) / targetUsd) * 100).toFixed(0)}%)</span>`
          : `<span class="kpi-badge badge-neutral">0 Hits (14d)</span>`;

      return `
        <tr>
          <td>
            <a href="${escapeHtml(sanitizeHttpUrl(sample.release_url))}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(sample.title)}</a>
            <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);">#${escapeHtml(rid)}</div>
          </td>
          <td style="font-family:var(--font-mono);color:var(--neon-cyan);font-weight:700;">${formatUsd(targetUsd)}</td>
          <td style="font-family:var(--font-mono);color:var(--neon-lime);">${activeFloor > 0 ? formatUsd(activeFloor) : "N/A"}</td>
          <td>${backtestBadge}</td>
          <td>
            <button type="button" class="btn-micro active-crimson" data-remove-target-rid="${escapeHtml(rid)}">Remove</button>
          </td>
        </tr>`;
    })
    .join("");
}

function setReleaseTargetPrice(releaseId, targetUsd) {
  const rid = String(releaseId);
  const val = Number(targetUsd);
  if (!rid || rid === "unknown" || !Number.isFinite(val) || val <= 0) return;
  appState.targetPricesByRelease[rid] = Math.round(val * 100) / 100;
  for (const item of SNIPER_STATE.listings || []) {
    if (item.release_id === rid) recomputeListingDerivedFields(item);
  }
  saveConfigOverrides();
  updateConfigJsonPreview();
  renderTopKPIs();
  renderRadarGrid();
  renderAlphaView();
  showToast(`Pinned ${formatUsd(val)} target snipe price for Release #${rid}.`, "lime");
}

function removeReleaseTargetPrice(releaseId) {
  const rid = String(releaseId);
  delete appState.targetPricesByRelease[rid];
  for (const item of SNIPER_STATE.listings || []) {
    if (item.release_id === rid) recomputeListingDerivedFields(item);
  }
  saveConfigOverrides();
  updateConfigJsonPreview();
  renderTopKPIs();
  renderRadarGrid();
  renderAlphaView();
  showToast(`Removed target price for Release #${rid}.`, "cyan");
}

// =====================================================================
// VIEW 4: RELIST FORENSICS, BOT WEATHER & 88-SELLER RADAR
// =====================================================================
function renderForensicsView() {
  const f = SNIPER_STATE.forensics || {};

  // Live Bot Weather Banner
  const curHour = new Date().getHours();
  const hourly = f.alerts_by_hour || {};
  const curHrKey = String(curHour).padStart(2, "0");
  const curHrCount = Number(hourly[curHrKey] || 0);
  const isStorm = curHour === 1 || curHour === 12 || curHour === 13;
  const weatherHead = document.getElementById("weather-headline");
  const weatherChips = document.getElementById("weather-stats-chips");
  if (weatherHead) {
    weatherHead.textContent = isStorm
      ? `STORM WINDOW (${curHrKey}:00) — Peak Bot Auto-Relist Surge (${curHrCount} historical hits)`
      : `CLEAR SKIES (${curHrKey}:00) — High Indie Collector Drop Ratio (${curHrCount} historical hits)`;
  }
  if (weatherChips) {
    weatherChips.innerHTML = `
      <span class="kpi-badge ${isStorm ? "badge-crimson" : "badge-lime"}">${isStorm ? "BOT STORM ACTIVE" : "INDIE WINDOW"}</span>
      <span class="kpi-badge badge-amber">Peak Hours: 01h / 12h–13h</span>
      <span class="kpi-badge badge-cyan">5-Min Target: 288 checks/day</span>`;
  }

  // Chart 1: 24-Hour Alert Spectrum
  const hourlyContainer = document.getElementById("chart-hourly-alerts");
  if (hourlyContainer && f.alerts_by_hour) {
    const entries = Object.entries(f.alerts_by_hour).sort(([a], [b]) => a.localeCompare(b));
    const maxVal = Math.max(1, ...entries.map(([, v]) => Number(v)));

    const colsHtml = entries
      .map(([hr, cnt]) => {
        const n = Number(cnt);
        const pxHeight = n > 0 ? Math.max(6, Math.round((n / maxVal) * 118)) : 2;
        const isSpike = hr === "12" || hr === "13" || hr === "01";
        return `
          <div class="chart-col" title="${hr}:00 — ${n} alerts dispatched">
            <span class="chart-val">${n > 0 ? n : ""}</span>
            <div class="chart-bar ${n === 0 ? "bar-zero" : isSpike ? "bar-spike" : ""}" style="height:${pxHeight}px;"></div>
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

  // Chart 2: Daily Engine Checks
  const dailyContainer = document.getElementById("chart-daily-checks");
  if (dailyContainer && f.checks_by_day) {
    const entries = Object.entries(f.checks_by_day).sort(([a], [b]) => a.localeCompare(b));
    const maxVal = Math.max(300, ...entries.map(([, v]) => Number(v)));
    const refBottomPx = Math.round((288 / maxVal) * 118);

    const colsHtml = entries
      .map(([day, cnt]) => {
        const n = Number(cnt);
        const pxHeight = Math.max(6, Math.round((n / maxVal) * 118));
        const isDoubleBug = n > 320;
        return `
          <div class="chart-col" title="${day}: ${n} checks">
            <span class="chart-val">${n}</span>
            <div class="chart-bar ${isDoubleBug ? "bar-anomaly" : "bar-clean"}" style="height:${pxHeight}px;"></div>
          </div>`;
      })
      .join("");

    const ticksHtml = entries.map(([day]) => `<span class="chart-tick">${day.slice(5)}</span>`).join("");

    dailyContainer.innerHTML = `
      <div class="chart-plot-area">
        <div class="chart-ref-line" style="bottom:${refBottomPx}px;"><span class="chart-ref-label">288/day target</span></div>
        ${colsHtml}
      </div>
      <div class="chart-xaxis">${ticksHtml}</div>`;
  }

  // Bluff vs Genuine Cut Audit
  const bluffGrid = document.getElementById("forensics-bluff-grid");
  if (bluffGrid) {
    const dedup = (SNIPER_STATE.listings || []).filter((x) => x.is_latest_in_group);
    const genuineCuts = dedup.filter((x) => x.relist_behavior === "GENUINE_CUT").length;
    const yoyoBluffs = dedup.filter((x) => x.relist_behavior === "YOYO_BLUFF").length;
    const flatBots = dedup.filter((x) => x.relist_behavior === "FLATLINE_BOT").length;
    const singles = dedup.filter((x) => x.relist_behavior === "SINGLE_DROP").length;
    bluffGrid.innerHTML = `
      <div class="bluff-stat-box">
        <div class="matrix-label">Genuine Price Cuts</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--neon-lime);">${genuineCuts}</div>
        <div class="matrix-sub">Strictly lower than historical peak</div>
      </div>
      <div class="bluff-stat-box">
        <div class="matrix-label">Yo-Yo Bluff Groups</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--neon-amber);">${yoyoBluffs}</div>
        <div class="matrix-sub">Price bounced without true floor cut</div>
      </div>
      <div class="bluff-stat-box">
        <div class="matrix-label">Flatline Bot Spam</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--neon-crimson);">${flatBots}</div>
        <div class="matrix-sub">Zero price change across relist IDs</div>
      </div>
      <div class="bluff-stat-box">
        <div class="matrix-label">Clean Single Drops</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--neon-cyan);">${singles}</div>
        <div class="matrix-sub">First-time listings with zero churn</div>
      </div>`;
  }

  // Full Seller Leaderboard
  const sellersTbody = document.getElementById("tbody-seller-leaderboard");
  const sellersCountBadge = document.getElementById("forensics-sellers-count");
  const toggleAllBtn = document.getElementById("btn-toggle-all-sellers");
  const allSellers = SNIPER_STATE.seller_leaderboard || [];
  const q = appState.sellerSearchQuery.toLowerCase();
  const matchedSellers = q ? allSellers.filter((s) => s.seller.toLowerCase().includes(q)) : allSellers;

  if (sellersCountBadge) sellersCountBadge.textContent = `${allSellers.length} Sellers`;
  if (toggleAllBtn) {
    toggleAllBtn.hidden = matchedSellers.length <= 20;
    toggleAllBtn.textContent = appState.showAllSellers ? "Show Top 20" : `Show All ${matchedSellers.length}`;
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
        const bundleTag = s.bundle_items >= 2 ? `<span class="kpi-badge badge-cyan">${s.bundle_items} LP Bundle</span>` : "";
        return `
          <tr>
            <td>
              <a href="${escapeHtml(sanitizeHttpUrl(s.seller_url))}" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-weight:700;color:#fff;">${escapeHtml(s.seller)}</a>
              <div style="font-size:0.69rem;color:var(--text-muted);">${s.share_of_snapshot_pct}% share</div>
            </td>
            <td style="font-family:var(--font-mono);font-weight:700;">${s.total_listings}</td>
            <td style="font-family:var(--font-mono);">${s.unique_releases} ${bundleTag}</td>
            <td style="font-family:var(--font-mono);color:var(--neon-amber);">${s.auto_relists} (${s.relist_rate_pct}%)</td>
            <td style="font-family:var(--font-mono);">${formatUsd(s.min_price_usd)} / ${formatUsd(s.avg_price_usd)}</td>
            <td><span class="kpi-badge ${clsBadge}">${escapeHtml(s.classification)}</span></td>
            <td>
              <div class="seller-ctrl-group">
                <button type="button" class="btn-micro ${isDropOnly ? "active-amber" : ""}" data-toggle-droponly-seller="${escapeHtml(s.seller)}">
                  ${isDropOnly ? "Drop-Only: ON" : "Drop-Only"}
                </button>
                <button type="button" class="btn-micro ${isMuted ? "active-crimson" : ""}" data-toggle-mute-seller="${escapeHtml(s.seller)}">
                  ${isMuted ? "Muted" : "Mute"}
                </button>
              </div>
            </td>
          </tr>`;
      })
      .join("");
  }

  // Top Churned Releases with Sparklines
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
                  <a href="${escapeHtml(sanitizeHttpUrl(r.release_url))}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
                  <div style="font-size:0.69rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px;">${escapeHtml(r.variant)}</div>
                </div>
              </div>
            </td>
            <td style="font-family:var(--font-mono);font-weight:700;color:var(--neon-amber);">${r.total_listings}x</td>
            <td style="font-family:var(--font-mono);">${r.unique_sellers}</td>
            <td style="font-family:var(--font-mono);">${escapeHtml(r.top_seller)} (${r.top_seller_count}x)</td>
            <td>${renderPriceSparklineSVG(r.price_points || [], 94, 22)}</td>
            <td style="font-family:var(--font-mono);">${formatUsd(r.lowest_price_usd)} – ${formatUsd(r.highest_price_usd)}</td>
            <td>${vBadge}</td>
          </tr>`;
      })
      .join("");
  }
}

// =====================================================================
// VIEW 5: SIBLING VAULT SHOWDOWN & LIVE WANTLIST PRUNER
// =====================================================================
async function fetchSiblingVaultJson({ silent = false } = {}) {
  const banner = document.getElementById("sibling-vault-sync-banner");
  if (banner) banner.textContent = `Fetching live Collection Vault JSON from ${SIBLING_COLLECTION_JSON_URL}...`;

  try {
    const resp = await fetch(`${SIBLING_COLLECTION_JSON_URL}?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data || !Array.isArray(data.records)) throw new Error("Invalid collection.json schema");

    appState.siblingVaultData = data;
    appState.siblingVaultSyncedAt = data.synced_at_utc || new Date().toISOString();
    appState.siblingVaultError = "";
    const byRid = {};
    const byAlbum = {};
    for (const rec of data.records) {
      const rid = String(rec.release_id || "");
      if (rid) byRid[rid] = rec;
      const aNorm = `${String(rec.artist || "").replace(/\s*\(\d+\)/g, "").trim()} - ${String(rec.title || "").replace(/\s*\(\d+\)/g, "").trim()}`.toLowerCase();
      if (aNorm) byAlbum[aNorm] = rec;
    }
    appState.siblingVaultMapByRid = byRid;
    appState.siblingVaultMapByAlbum = byAlbum;

    if (banner) {
      banner.className = "vault-sync-banner banner-clean";
      banner.textContent = `LIVE SIBLING VAULT SYNCED: ${data.records.length} LPs loaded from krunked-fpv/discogs_collection (synced ${appState.siblingVaultSyncedAt}) // Valuation: ${data.profile?.collection_value?.median || "N/A"}`;
    }
    renderVaultShowdown();
    if (!silent) showToast(`Synced ${data.records.length} LPs from live Collection Vault.`, "lime");
    return true;
  } catch (err) {
    appState.siblingVaultError = err.message || "Offline";
    if (banner) {
      banner.className = "vault-sync-banner banner-warn";
      banner.textContent = `Using pre-baked Vault crossref (live sibling fetch skipped: ${appState.siblingVaultError}).`;
    }
    renderVaultShowdown();
    return false;
  }
}

function renderVaultShowdown() {
  const tabsEl = document.getElementById("vault-showdown-tabs");
  const stageEl = document.getElementById("vault-showdown-stage");
  if (!tabsEl || !stageEl) return;

  const variants = SNIPER_STATE.vault_bridge?.variant_upgrades_on_wantlist || [];
  if (variants.length === 0) {
    tabsEl.innerHTML = "";
    stageEl.innerHTML = `<div class="panel-subtitle">No Variant Hunter targets in snapshot.</div>`;
    return;
  }

  if (appState.activeShowdownIndex >= variants.length) appState.activeShowdownIndex = 0;

  tabsEl.innerHTML = variants
    .map((v, idx) => {
      const shortLbl = `${v.title} (#${v.wantlist_release_id})`;
      return `
        <button type="button" class="crate-filter-chip ${idx === appState.activeShowdownIndex ? "active" : ""}" data-showdown-idx="${idx}">
          ${escapeHtml(shortLbl)}
        </button>`;
    })
    .join("");

  const target = variants[appState.activeShowdownIndex];
  const siblingRec = appState.siblingVaultMapByRid[String(target.owned_release_id)];
  const shelfImgRaw =
    siblingRec?.images?.pressing_image_url ||
    siblingRec?.images?.cover_image_url ||
    target.pressing_image_url ||
    target.cover_image_url;
  const shelfImgUrl = resolveSiblingVaultAssetUrl(shelfImgRaw) || renderFallbackSleeveDataUri(target.artist, target.album);
  const shelfFormat = siblingRec?.format_string || target.owned_format;
  const shelfVal = Number(siblingRec?.estimated_value_usd ?? target.owned_value_usd ?? 0);
  const shelfCond = siblingRec?.media_condition || "Near Mint (NM or M-)";
  const targetWax = target.wax_shader || { pattern: "splatter", primary: "#00f0ff", secondary: "#ff1f8f", accent: "#ffffff" };
  const matchingListing = (SNIPER_STATE.listings || []).find(
    (x) => x.is_latest_in_group && String(x.release_id) === String(target.wantlist_release_id)
  );
  const priceDiff = shelfVal > 0 && target.lowest_sniped_usd > 0 ? target.lowest_sniped_usd - shelfVal : null;

  stageEl.innerHTML = `
    <div class="showdown-side side-shelf">
      <img src="${escapeHtml(shelfImgUrl)}" data-fallback-src="${escapeHtml(renderFallbackSleeveDataUri(target.artist, target.album))}" alt="Owned pressing" class="showdown-disc-photo" />
      <div style="min-width:0;flex:1;">
        <span class="kpi-badge badge-lime">ON YOUR SHELF // VAULT #${escapeHtml(target.owned_release_id)}</span>
        <h3 style="color:#fff;font-family:var(--font-display);font-size:1.02rem;margin:6px 0 4px;">${escapeHtml(target.title)}</h3>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:6px;">${escapeHtml(shelfFormat)}</div>
        <div style="font-family:var(--font-mono);font-size:0.74rem;color:var(--neon-lime);">
          Est. Vault Value: <strong>${formatUsd(shelfVal)}</strong> // ${escapeHtml(shelfCond)}
        </div>
        ${siblingRec?.wax_spec?.variant_badge ? `<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(siblingRec.wax_spec.variant_badge)}</div>` : ""}
      </div>
    </div>

    <div class="showdown-side side-target">
      <canvas id="showdown-target-canvas" width="128" height="128" style="width:112px;height:112px;flex-shrink:0;"></canvas>
      <div style="min-width:0;flex:1;">
        <span class="kpi-badge badge-magenta">MARKET TARGET // RELEASE #${escapeHtml(target.wantlist_release_id)}</span>
        <h3 style="color:#fff;font-family:var(--font-display);font-size:1.02rem;margin:6px 0 4px;">${escapeHtml(target.wantlist_variant)}</h3>
        <div style="font-family:var(--font-mono);font-size:0.76rem;color:var(--neon-cyan);margin-bottom:8px;">
          Lowest Sniped: <strong>${formatUsd(target.lowest_sniped_usd)}</strong> (${target.wantlist_hits_count}x seen)
          ${priceDiff !== null ? ` // <span style="color:${priceDiff <= 0 ? "var(--neon-lime)" : "var(--neon-amber)"};">${priceDiff >= 0 ? "+" : ""}${formatUsd(priceDiff)} vs shelf</span>` : ""}
        </div>
        <div class="card-actions">
          ${matchingListing ? `<a href="${escapeHtml(sanitizeHttpUrl(matchingListing.add_to_cart_url))}" target="_blank" rel="noopener" class="btn-action btn-neon-lime btn-sm">${ICONS.cart}<span>Cart (${escapeHtml(matchingListing.total_price)})</span></a>` : ""}
          ${matchingListing ? `<button type="button" class="btn-action btn-sm" data-audition-id="${escapeHtml(matchingListing.id)}">30s</button>` : ""}
          <a href="${escapeHtml(sanitizeHttpUrl(target.release_url))}" target="_blank" rel="noopener" class="btn-action btn-sm">Release ${ICONS.ext}</a>
        </div>
      </div>
    </div>`;

  const cvs = document.getElementById("showdown-target-canvas");
  if (cvs) renderVinylCanvas(cvs, targetWax, { angleRad: 0.45 });
}

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
      if (liveIds.has(rid)) appState.prunedReleaseIds.delete(rid);
      else appState.prunedReleaseIds.add(rid);
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
    if (!silent) showToast(appState.liveWantlistError, "amber", 5000);
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
    if (!silent) showToast(msg, "crimson", 6000);
    return { ok: false, status: likelyCors ? "cors_blocked" : "error", message: msg };
  }
}

function renderVaultBridgeView() {
  renderVaultShowdown();
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
    const spanEl = syncBtn.querySelector("span");
    if (spanEl) spanEl.textContent = appState.liveWantlistLoading ? "Syncing Live Wantlist..." : "Sync Live Wantlist";
  }

  if (statusEl) {
    statusEl.className = "vault-sync-banner";
    if (appState.liveWantlistLoading) {
      statusEl.textContent = `Querying GET https://api.discogs.com/users/${appState.discogsUsername}/wants ...`;
    } else if (appState.liveWantlistError) {
      statusEl.classList.add("banner-warn");
      statusEl.textContent = `${appState.liveWantlistError} Showing ${activeCount} historical snapshot records (${s.exact_owned_in_live_page1 ?? 0} in latest Live Top-25 scan).`;
    } else if (isLiveVerified) {
      const modeTag =
        appState.liveWantlistSource === "prebaked"
          ? "Build-Time Sync"
          : appState.liveWantlistSource === "authenticated_live"
          ? "Authenticated Live API"
          : "Public Live API";
      if (activeCount === 0) {
        statusEl.classList.add("banner-clean");
        statusEl.textContent = `VERIFIED (${modeTag} // @${appState.discogsUsername} @ ${appState.liveWantlistSyncedAt}): Checked ${appState.liveWantlistTotal} live Wantlist releases. All ${exactList.length} historical Vault pressings have been removed from your live Wantlist.`;
      } else {
        statusEl.classList.add("banner-warn");
        statusEl.textContent = `LIVE AUDIT (${modeTag} // @${appState.discogsUsername} @ ${appState.liveWantlistSyncedAt}): Checked ${appState.liveWantlistTotal} live Wantlist releases — ${activeCount} owned pressing(s) are still on your live Wantlist.`;
      }
    } else {
      statusEl.textContent = `Snapshot history view: ${activeCount} owned pressing(s) appeared in past sniper logs (0 in Live Top-25 scan). Click "Sync Live Wantlist" or connect DISCOGS_TOKEN to verify against your ${vaultTotal}-LP Collection Vault.`;
    }
  }

  if (activeWrap) activeWrap.hidden = activeCount === 0;

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
                  <a href="${escapeHtml(sanitizeHttpUrl(r.release_url))}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
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
              <button type="button" class="btn-action btn-neon-crimson btn-sm" data-prune-release-id="${escapeHtml(r.release_id)}" data-prune-title="${escapeHtml(r.title)}">
                ${ICONS.trash}<span>Remove</span>
              </button>
            </td>
          </tr>`;
      })
      .join("");
  }

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
                  <a href="${escapeHtml(sanitizeHttpUrl(r.release_url))}" target="_blank" rel="noopener" style="font-weight:600;color:#fff;">${escapeHtml(r.title)}</a>
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
                <a href="${escapeHtml(sanitizeHttpUrl(r.release_url))}" target="_blank" rel="noopener" style="font-weight:700;color:#fff;">${escapeHtml(r.title)}</a>
                <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">Target Release #${escapeHtml(r.wantlist_release_id)}</div>
              </div>
            </div>
          </td>
          <td style="color:#ff6cb9;font-size:0.78rem;">${escapeHtml(r.wantlist_variant)}</td>
          <td style="color:var(--text-secondary);font-size:0.78rem;">
            ${escapeHtml(r.owned_format)}
            <span style="font-family:var(--font-mono);color:var(--neon-lime);">(${formatUsd(r.owned_value_usd)})</span>
          </td>
          <td style="font-family:var(--font-mono);font-weight:700;">${formatUsd(r.lowest_sniped_usd)} (${r.wantlist_hits_count}x)</td>
          <td>
            <a href="${escapeHtml(sanitizeHttpUrl(r.release_url))}" target="_blank" rel="noopener" class="btn-action btn-sm">Inspect ${ICONS.ext}</a>
          </td>
        </tr>`;
      })
      .join("");
  }
}


// =====================================================================
// 07. INSPECT LIGHTBOX, CMD+K PALETTE, RULES REMOTE & BOOTSTRAP
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
  const vaultPhotoRaw = item.vault_owned_detail?.pressing_image_url || "";
  const vaultPhoto = vaultPhotoRaw ? resolveSiblingVaultAssetUrl(vaultPhotoRaw) : "";
  const strat = item.offer_strategy || {};
  const curTarget = getTargetPriceForRelease(item.release_id);
  const cleanNote =
    item.clean_seller_note !== undefined
      ? item.clean_seller_note
      : item.raw_description && item.raw_description.toLowerCase() !== item.variant.toLowerCase()
      ? item.raw_description
      : "";

  body.innerHTML = `
    <div class="inspect-hero" style="--wax-glow:${waxGlow};">
      <div class="inspect-vinyl-stage">
        <div class="inspect-sleeve">
          <img src="${escapeHtml(coverSrc)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="${escapeHtml(item.title)}" />
        </div>
        <div class="inspect-platter">
          <canvas id="inspect-vinyl-canvas" width="160" height="160" style="width:146px;height:146px;"></canvas>
        </div>
      </div>

      <div class="inspect-meta">
        <div class="status-pills" style="margin-bottom:8px;">
          ${renderVaultStatusPill(item)}
          ${item.is_live_page1 ? `<span class="tag-pill badge-cyan">LIVE PAGE 1</span>` : `<span class="tag-pill badge-neutral">HISTORICAL</span>`}
          ${item.allow_offers ? `<span class="tag-pill badge-amber">MAKE OFFER</span>` : ""}
          ${isListingTargetHit(item) ? `<span class="tag-pill badge-gold">TARGET HIT</span>` : ""}
        </div>
        <div class="drop-artist" style="font-size:0.8rem;">${escapeHtml(item.artist)}</div>
        <h2 id="inspect-modal-title" style="font-family:var(--font-display);font-size:1.38rem;color:#fff;margin:3px 0 8px;">${escapeHtml(getDisplayAlbumTitle(item))}</h2>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:10px;">${escapeHtml(item.variant)}</p>
        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
          Listing #${escapeHtml(item.id)} // Release #${escapeHtml(item.release_id)} // Seller: <a href="https://www.discogs.com/seller/${encodeURIComponent(item.seller_info)}/profile" target="_blank" rel="noopener" class="inline-neon-link">${escapeHtml(item.seller_info)}</a>
        </div>
      </div>
    </div>

    <div class="inspect-spec-grid">
      <div class="inspect-spec-cell">
        <span class="matrix-label">Total Shipped</span>
        <div class="matrix-val matrix-val-price" style="font-size:1.22rem;">${escapeHtml(item.total_price)}</div>
        <div class="matrix-sub">${escapeHtml(item.list_price)} + ${formatUsd(item.shipping_price_usd)} ship</div>
      </div>
      <div class="inspect-spec-cell">
        <span class="matrix-label">Benchmark (${escapeHtml(item.media_condition)})</span>
        <div class="matrix-val" style="font-size:1.08rem;">${escapeHtml(mkt.condition_suggested_formatted || "Live API")}</div>
        <div class="matrix-sub">${escapeHtml(mkt.benchmark_source || "")}</div>
      </div>
      <div class="inspect-spec-cell">
        <span class="matrix-label">Condition Grade</span>
        <div class="matrix-val" style="font-size:1.08rem;">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</div>
        <div class="matrix-sub">${escapeHtml(item.media_condition_full || "")}</div>
      </div>
      <div class="inspect-spec-cell">
        <span class="matrix-label">Observed Range / Trend</span>
        <div class="matrix-val" style="font-size:1.02rem;">${formatUsd(mkt.observed_low_usd)} – ${formatUsd(mkt.observed_high_usd)}</div>
        <div class="matrix-sub">${renderPriceSparklineSVG(item.price_trajectory, 110, 22)}</div>
      </div>
    </div>

    ${cleanNote ? `<div class="seller-notes ${item.has_wear_warning ? "notes-wear" : ""}" style="-webkit-line-clamp:unset;margin-bottom:12px;"><strong style="color:var(--neon-cyan);font-family:var(--font-mono);font-size:0.68rem;display:block;margin-bottom:4px;">SELLER NOTES</strong>${escapeHtml(cleanNote)}</div>` : ""}

    ${
      strat.recommended_offer_usd
        ? `<div style="margin-bottom:12px;padding:11px 13px;border-radius:8px;background:rgba(255,184,0,0.06);border:1px solid rgba(255,184,0,0.28);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
              <strong style="font-family:var(--font-mono);font-size:0.74rem;color:var(--neon-amber);">HAGGLE STRATEGIST // TARGET ITEM OFFER: ${formatUsd(strat.recommended_offer_usd)} (Range ${formatUsd(strat.aggressive_offer_usd)}–${formatUsd(strat.instant_close_offer_usd)})</strong>
              <button type="button" class="btn-action btn-sm" data-copy-offer-pitch="${escapeHtml(item.id)}">Copy Pitch</button>
            </div>
            <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-secondary);">${escapeHtml(strat.buyer_pitch || "")}</div>
          </div>`
        : ""
    }

    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:rgba(0,240,255,0.05);border:1px solid var(--border-hairline);">
      <span style="font-family:var(--font-mono);font-size:0.73rem;color:var(--neon-cyan);">Target Snipe ($ Shipped):</span>
      <input type="number" id="inspect-target-input" class="form-input" style="width:110px;padding:5px 8px;" min="5" step="1" value="${curTarget || Math.max(10, Math.round(item.total_price_usd * 0.85))}" />
      <button type="button" class="btn-action btn-neon-lime btn-sm" id="btn-inspect-save-target" data-release-id="${escapeHtml(item.release_id)}">Pin Target</button>
      ${curTarget ? `<button type="button" class="btn-micro active-crimson" data-remove-target-rid="${escapeHtml(item.release_id)}">Clear (${formatUsd(curTarget)})</button>` : ""}
    </div>

    ${vaultPhoto ? `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:10px;border-radius:8px;background:rgba(255,31,143,0.07);border:1px solid rgba(255,31,143,0.25);"><img src="${escapeHtml(vaultPhoto)}" data-fallback-src="${escapeHtml(fallbackUri)}" alt="Vault pressing photo" style="width:54px;height:54px;border-radius:50%;object-fit:cover;border:1px solid var(--neon-magenta);" /><div style="font-size:0.78rem;"><strong style="color:#ff6cb9;">Your Vault Pressing Reference:</strong><div style="color:var(--text-secondary);">${escapeHtml(item.vault_owned_detail?.format_string || "")}</div></div></div>` : ""}

    <div style="margin-bottom:14px;">${renderCardDrawersHtml(item)}</div>

    <div class="card-actions" style="flex-wrap:wrap;">
      <a href="${escapeHtml(sanitizeHttpUrl(item.add_to_cart_url))}" target="_blank" rel="noopener" class="btn-action btn-cart">
        ${ICONS.cart}<span>1-Click Add to Cart (${escapeHtml(item.total_price)})</span>
      </a>
      <a href="${escapeHtml(sanitizeHttpUrl(item.item_url))}" target="_blank" rel="noopener" class="btn-action">Listing ${ICONS.ext}</a>
      <a href="${escapeHtml(sanitizeHttpUrl(item.release_url))}" target="_blank" rel="noopener" class="btn-action">Release ${ICONS.ext}</a>
      <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}">
        ${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s Preview"}</span>
      </button>
      <button type="button" class="btn-action" id="btn-inspect-open-deck" data-listing-id="${escapeHtml(item.id)}">Turntable Deck</button>
      <button type="button" class="btn-action btn-neon-cyan" data-live-api-id="${escapeHtml(item.id)}">
        ${ICONS.bolt}<span>Query Live API</span>
      </button>
    </div>
  `;

  backdrop.hidden = false;
  const cvs = document.getElementById("inspect-vinyl-canvas");
  if (cvs) renderVinylCanvas(cvs, item.wax_shader, { angleRad: 0.35 });
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
  const g = document.getElementById("quick-github-pat");
  if (u) u.value = appState.discogsUsername;
  if (t) t.value = appState.discogsToken;
  if (g) g.value = appState.githubPat;
  backdrop.hidden = false;
  setTimeout(() => t?.focus(), 40);
}

function closeQuickApiModal() {
  const backdrop = document.getElementById("api-modal-backdrop");
  if (backdrop) backdrop.hidden = true;
}

// Command Palette (Cmd/Ctrl + K)
function openCommandPalette() {
  const backdrop = document.getElementById("cmd-palette-backdrop");
  const inp = document.getElementById("cmd-palette-input");
  if (!backdrop || !inp) return;
  inp.value = "";
  renderCommandPaletteResults("");
  backdrop.hidden = false;
  setTimeout(() => inp.focus(), 30);
}

function closeCommandPalette() {
  const backdrop = document.getElementById("cmd-palette-backdrop");
  if (backdrop) backdrop.hidden = true;
}

function renderCommandPaletteResults(query) {
  const listEl = document.getElementById("cmd-palette-results");
  if (!listEl) return;
  const q = String(query || "").trim().toLowerCase();

  const commands = [
    { kind: "VIEW", label: "Go to Drop Radar", hint: "View 1", action: () => switchView("radar") },
    { kind: "VIEW", label: "Go to 3D Crate & Turntable Studio", hint: "View 2", action: () => switchView("crate") },
    { kind: "VIEW", label: "Go to Sniper Alpha (Bundles, Offers & Targets)", hint: "View 3", action: () => switchView("alpha") },
    { kind: "VIEW", label: "Go to Relist Forensics & Bot Weather", hint: "View 4", action: () => switchView("forensics") },
    { kind: "VIEW", label: "Go to Vault Showdown & Wantlist Pruner", hint: "View 5", action: () => switchView("vault") },
    { kind: "VIEW", label: "Go to Remote & API Console", hint: "View 6", action: () => switchView("rules") },
    { kind: "MODE", label: "Cycle Lighting Profile (NEON / UV / TUBE AMP)", hint: "Shortcut: U", action: cycleLightingMode },
    { kind: "ACTION", label: "Toggle Matrix Tape / Card Layout", hint: "Radar", action: () => setRadarLayout(appState.radarLayout === "cards" ? "matrix" : "cards") },
    { kind: "ACTION", label: "Pull Fresh Snapshot from GitHub main", hint: "Remote Sync", action: () => pullLiveRepoSnapshotFromGitHub({ silent: false }) },
    { kind: "ACTION", label: "Sync Live Collection Vault JSON", hint: "Sibling Repo", action: () => fetchSiblingVaultJson({ silent: false }) },
  ];

  const deduped = (SNIPER_STATE.listings || []).filter((x) => x.is_latest_in_group);
  const matchingCmds = commands.filter((c) => !q || `${c.kind} ${c.label} ${c.hint}`.toLowerCase().includes(q));
  const matchingListings = deduped
    .filter((x) => !q || `${x.title} ${x.seller_info} ${x.variant} ${x.id}`.toLowerCase().includes(q))
    .slice(0, q ? 10 : 5);

  const cmdHtml = matchingCmds
    .map(
      (c, idx) => `
      <button type="button" class="cmd-item-btn" data-cmd-idx="${idx}">
        <span><span class="kpi-badge badge-cyan" style="margin-right:8px;">${escapeHtml(c.kind)}</span>${escapeHtml(c.label)}</span>
        <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">${escapeHtml(c.hint)}</span>
      </button>`
    )
    .join("");

  const listingHtml = matchingListings
    .map(
      (x) => `
      <button type="button" class="cmd-item-btn" data-cmd-listing-id="${escapeHtml(x.id)}">
        <span><span class="kpi-badge badge-lime" style="margin-right:8px;">${escapeHtml(x.total_price)}</span>${escapeHtml(x.title)}</span>
        <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">${escapeHtml(x.seller_info)}</span>
      </button>`
    )
    .join("");

  listEl.innerHTML = `${cmdHtml}${listingHtml}` || `<div style="padding:18px;text-align:center;color:var(--text-muted);">No matching commands or records.</div>`;
  listEl._cmdActions = matchingCmds;
}

// =====================================================================
// VIEW 6: RULES BUILDER & DISCOGS CREDENTIALS
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
    schema_version: SNIPER_STATE.schema_version || "3.0.0",
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
      target_prices_by_release: { ...appState.targetPricesByRelease },
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
  if (preview) preview.textContent = JSON.stringify(buildCurrentConfigObject(), null, 2);
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
    if (consoleOut) consoleOut.textContent = `// Error verifying token against /oauth/identity: ${err.message}`;
    showToast(`Token verification failed: ${err.message}`, "crimson", 4800);
    return false;
  }
}

function cycleLightingMode() {
  const order = ["neon", "uv", "tube"];
  const next = order[(order.indexOf(appState.lightingMode) + 1) % order.length];
  appState.lightingMode = next;
  applyLightingMode();
  const label = next === "uv" ? "UV Blacklight Overdrive" : next === "tube" ? "Boutique Vacuum Tube Amp" : "Neon Telemetry";
  showToast(`${label} engaged.`, "cyan", 2000);
}

function setRadarLayout(layout) {
  appState.radarLayout = layout === "matrix" ? "matrix" : "cards";
  safeSetStorage(STORAGE_KEYS.RADAR_LAYOUT, appState.radarLayout);
  document.getElementById("btn-layout-cards")?.classList.toggle("active", appState.radarLayout === "cards");
  document.getElementById("btn-layout-matrix")?.classList.toggle("active", appState.radarLayout === "matrix");
  renderRadarGrid();
}

function switchView(viewName) {
  appState.activeView = viewName;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `view-${viewName}`);
  });
  if (viewName === "crate") {
    renderCrateStudio();
    startTurntableAnimationLoop();
  } else if (viewName === "alpha") {
    renderAlphaView();
  } else if (viewName === "vault") {
    renderVaultBridgeView();
  }
}

function moveRadarKeyboardFocus(delta) {
  const filtered = getFilteredListings();
  if (filtered.length === 0) return;
  let idx = filtered.findIndex((x) => x.id === appState.focusedListingId);
  if (idx < 0) idx = delta > 0 ? 0 : filtered.length - 1;
  else idx = Math.max(0, Math.min(filtered.length - 1, idx + delta));

  appState.focusedListingId = filtered[idx].id;
  document.querySelectorAll(".card-kbd-focused, .matrix-row-focused").forEach((el) => {
    el.classList.remove("card-kbd-focused", "matrix-row-focused");
  });
  const targetEl =
    document.querySelector(`.drop-card[data-listing-id="${CSS.escape(appState.focusedListingId)}"]`) ||
    document.querySelector(`.drop-card-row[data-listing-id="${CSS.escape(appState.focusedListingId)}"]`);
  if (targetEl) {
    targetEl.classList.add(appState.radarLayout === "matrix" ? "matrix-row-focused" : "card-kbd-focused");
    targetEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function bindEvents() {
  const priceSlider = document.getElementById("radar-max-price-slider");
  const priceReadout = document.getElementById("max-price-readout");
  if (priceSlider) {
    priceSlider.max = String(appState.sliderMaxUsd);
    priceSlider.value = String(appState.sliderMaxUsd);
  }
  document.getElementById("btn-layout-cards")?.classList.toggle("active", appState.radarLayout === "cards");
  document.getElementById("btn-layout-matrix")?.classList.toggle("active", appState.radarLayout === "matrix");

  // Navigation
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("btn-brand-home")?.addEventListener("click", () => switchView("radar"));
  document.querySelectorAll(".kpi-card[data-jump-view]").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.jumpView) switchView(card.dataset.jumpView);
    });
  });

  // Header Utilities
  document.getElementById("btn-toggle-uv")?.addEventListener("click", cycleLightingMode);
  document.getElementById("btn-open-cmd-palette")?.addEventListener("click", openCommandPalette);
  document.getElementById("rig-heartbeat-btn")?.addEventListener("click", () => {
    pullLiveRepoSnapshotFromGitHub({ silent: false });
  });
  document.getElementById("hydrator-status-btn")?.addEventListener("click", () => {
    appState.autoHydrateEnabled = !appState.autoHydrateEnabled;
    safeSetStorage(STORAGE_KEYS.AUTO_HYDRATE, String(appState.autoHydrateEnabled));
    updateHydratorStatusUI();
    if (appState.autoHydrateEnabled) {
      observeCoverArtAndLiveHydration();
      processHydrationQueue();
      showToast("Background Discogs API hydrator resumed.", "cyan");
    } else {
      showToast("Background Discogs API hydrator paused.", "amber");
    }
  });

  // Modals
  document.getElementById("btn-open-api-modal")?.addEventListener("click", openQuickApiModal);
  document.getElementById("btn-close-api-modal")?.addEventListener("click", closeQuickApiModal);
  document.getElementById("api-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "api-modal-backdrop") closeQuickApiModal();
  });
  document.getElementById("btn-quick-api-save")?.addEventListener("click", async () => {
    const u = document.getElementById("quick-api-username")?.value.trim() || "krunked";
    const t = document.getElementById("quick-api-token")?.value.trim() || "";
    const gh = document.getElementById("quick-github-pat")?.value.trim() || "";
    if (gh) {
      appState.githubPat = gh;
      safeSetStorage(STORAGE_KEYS.GH_PAT, gh);
    }
    if (t) {
      const ok = await saveAndVerifyDiscogsToken(u, t);
      if (ok) closeQuickApiModal();
    } else if (gh) {
      updateApiConnectionStatusUI();
      closeQuickApiModal();
      showToast("Saved GitHub PAT locally.", "lime");
    }
  });
  document.getElementById("btn-quick-api-open-console")?.addEventListener("click", () => {
    closeQuickApiModal();
    switchView("rules");
  });

  document.getElementById("btn-close-inspect-modal")?.addEventListener("click", closeInspectModal);
  document.getElementById("inspect-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "inspect-modal-backdrop") closeInspectModal();
  });

  // Command Palette Events
  document.getElementById("cmd-palette-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "cmd-palette-backdrop") closeCommandPalette();
  });
  document.getElementById("cmd-palette-input")?.addEventListener("input", (e) => {
    renderCommandPaletteResults(e.target.value);
  });
  document.getElementById("cmd-palette-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstBtn = document.querySelector("#cmd-palette-results .cmd-item-btn");
      if (firstBtn) firstBtn.click();
    }
  });
  document.getElementById("cmd-palette-results")?.addEventListener("click", (e) => {
    const cmdBtn = e.target.closest("[data-cmd-idx]");
    if (cmdBtn) {
      const idx = Number(cmdBtn.dataset.cmdIdx);
      const listEl = document.getElementById("cmd-palette-results");
      const action = listEl?._cmdActions?.[idx]?.action;
      closeCommandPalette();
      if (action) action();
      return;
    }
    const listBtn = e.target.closest("[data-cmd-listing-id]");
    if (listBtn) {
      const lid = listBtn.dataset.cmdListingId;
      closeCommandPalette();
      openInspectModal(lid);
    }
  });

  // Radar Controls
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

  const searchInput = document.getElementById("radar-search-input");
  searchInput?.addEventListener("input", (e) => {
    appState.searchQuery = e.target.value.trim();
    renderRadarGrid();
  });

  document.querySelectorAll(".scope-btn[data-scope]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.scopeMode = btn.dataset.scope || "ALL";
      document.querySelectorAll(".scope-btn[data-scope]").forEach((b) => b.classList.toggle("active", b === btn));
      renderRadarGrid();
    });
  });

  document.getElementById("btn-layout-cards")?.addEventListener("click", () => setRadarLayout("cards"));
  document.getElementById("btn-layout-matrix")?.addEventListener("click", () => setRadarLayout("matrix"));

  document.getElementById("btn-toggle-dedup")?.addEventListener("click", (e) => {
    appState.dedupEnabled = !appState.dedupEnabled;
    e.currentTarget.classList.toggle("active", appState.dedupEnabled);
    renderRadarGrid();
  });

  document.getElementById("btn-hide-sold")?.addEventListener("click", (e) => {
    appState.hideSold = !appState.hideSold;
    e.currentTarget.classList.toggle("active", appState.hideSold);
    renderRadarGrid();
  });

  document.getElementById("btn-hide-recordmule")?.addEventListener("click", (e) => {
    appState.hideRecordmule = !appState.hideRecordmule;
    e.currentTarget.classList.toggle("active", appState.hideRecordmule);
    renderRadarGrid();
  });

  document.getElementById("radar-condition-select")?.addEventListener("change", (e) => {
    appState.conditionFilter = e.target.value;
    updateConfigJsonPreview();
    renderRadarGrid();
  });
  document.getElementById("radar-sort-select")?.addEventListener("change", (e) => {
    appState.sortMode = e.target.value;
    renderRadarGrid();
  });

  document.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      appState.categoryFilter = pill.dataset.filter || "ALL";
      document.querySelectorAll(".filter-pill").forEach((p) => p.classList.toggle("active", p === pill));
      renderRadarGrid();
    });
  });

  priceSlider?.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.maxPriceUsd = val;
    if (priceReadout) priceReadout.textContent = val >= appState.sliderMaxUsd ? "No Limit" : `$${val}`;
    renderRadarGrid();
  });

  document.getElementById("btn-quick-reset-filters")?.addEventListener("click", resetAllRadarFilters);

  // 3D Crate & Turntable Controls
  document.getElementById("btn-crate-prev")?.addEventListener("click", () => selectCrateIndex(appState.crateIndex - 1));
  document.getElementById("btn-crate-next")?.addEventListener("click", () => selectCrateIndex(appState.crateIndex + 1));
  document.getElementById("crate-index-slider")?.addEventListener("input", (e) => selectCrateIndex(e.target.value));

  const crateViewport = document.getElementById("crate-3d-viewport");
  if (crateViewport) {
    let dragStartX = null;
    crateViewport.addEventListener("pointerdown", (e) => {
      dragStartX = e.clientX;
    });
    crateViewport.addEventListener("pointerup", (e) => {
      if (dragStartX === null) return;
      const dx = e.clientX - dragStartX;
      dragStartX = null;
      if (Math.abs(dx) > 34) {
        selectCrateIndex(appState.crateIndex + (dx < 0 ? 1 : -1));
      }
    });
    crateViewport.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > 6 || Math.abs(e.deltaX) > 6) {
          e.preventDefault();
          const step = e.deltaY + e.deltaX > 0 ? 1 : -1;
          selectCrateIndex(appState.crateIndex + step);
        }
      },
      { passive: false }
    );
    crateViewport.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") selectCrateIndex(appState.crateIndex + 1);
      else if (e.key === "ArrowLeft") selectCrateIndex(appState.crateIndex - 1);
    });
  }

  document.querySelectorAll(".crate-filter-chip[data-crate-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      appState.crateFilter = chip.dataset.crateFilter || "ALL";
      appState.crateIndex = 0;
      document.querySelectorAll(".crate-filter-chip[data-crate-filter]").forEach((c) => c.classList.toggle("active", c === chip));
      renderCrateStudio();
    });
  });

  document.getElementById("btn-grail-radio")?.addEventListener("click", (e) => {
    appState.grailRadioEnabled = !appState.grailRadioEnabled;
    e.currentTarget.innerHTML = `<span>📻 Grail Radio: ${appState.grailRadioEnabled ? "ON" : "OFF"}</span>`;
    e.currentTarget.classList.toggle("btn-neon-lime", appState.grailRadioEnabled);
    showToast(
      appState.grailRadioEnabled ? "Grail Radio Auto-DJ armed — will auto-spin next sleeve!" : "Grail Radio Auto-DJ off.",
      "cyan"
    );
  });

  const toggleActiveDeckSpin = () => {
    const items = getCrateFilteredListings();
    const active = items[appState.crateIndex];
    if (!active) return;
    auditionListing(active.id);
  };
  document.getElementById("btn-deck-spin")?.addEventListener("click", toggleActiveDeckSpin);
  document.getElementById("btn-tonearm-toggle")?.addEventListener("click", toggleActiveDeckSpin);

  const toggleRpm = (targetRpm) => {
    appState.rpmMode = targetRpm;
    applyTurntablePlaybackRate();
  };
  document.getElementById("btn-rpm-33")?.addEventListener("click", () => toggleRpm(33));
  document.getElementById("btn-rpm-45")?.addEventListener("click", () => toggleRpm(45));
  document.getElementById("btn-mini-rpm")?.addEventListener("click", () => toggleRpm(appState.rpmMode === 33 ? 45 : 33));
  document.getElementById("btn-mini-open-deck")?.addEventListener("click", () => {
    if (appState.currentlyPlayingId) openListingInTurntableDeck(appState.currentlyPlayingId);
    else switchView("crate");
  });

  document.getElementById("deck-pitch-slider")?.addEventListener("input", (e) => {
    appState.pitchPct = Number(e.target.value || 0);
    applyTurntablePlaybackRate();
  });
  document.getElementById("btn-pitch-reset")?.addEventListener("click", () => {
    appState.pitchPct = 0;
    const sl = document.getElementById("deck-pitch-slider");
    if (sl) sl.value = "0";
    applyTurntablePlaybackRate();
  });

  document.getElementById("btn-crackle-mode")?.addEventListener("click", (e) => {
    const modes = ["OFF", "WARM", "DUSTY"];
    appState.crackleMode = modes[(modes.indexOf(appState.crackleMode) + 1) % modes.length];
    e.currentTarget.innerHTML = `<span>Crackle: ${appState.crackleMode}</span>`;
    e.currentTarget.classList.toggle("btn-neon-amber", appState.crackleMode !== "OFF");
    updateCrackleSynthesis();
  });

  // Sniper Alpha Controls
  document.querySelectorAll(".crate-filter-chip[data-bundle-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      appState.bundleFilter = chip.dataset.bundleFilter || "ALL";
      document.querySelectorAll(".crate-filter-chip[data-bundle-filter]").forEach((c) => c.classList.toggle("active", c === chip));
      renderAlphaBundles();
    });
  });

  document.getElementById("btn-add-target-price")?.addEventListener("click", () => {
    const rid = document.getElementById("target-release-select")?.value;
    const price = Number(document.getElementById("target-price-input")?.value || 0);
    if (!rid || price <= 0) {
      showToast("Select a release and enter a valid target $ USD.", "amber");
      return;
    }
    setReleaseTargetPrice(rid, price);
    const inp = document.getElementById("target-price-input");
    if (inp) inp.value = "";
  });

  // Forensics & Vault
  document.getElementById("seller-leaderboard-search")?.addEventListener("input", (e) => {
    appState.sellerSearchQuery = e.target.value.trim();
    renderForensicsView();
  });
  document.getElementById("btn-toggle-all-sellers")?.addEventListener("click", () => {
    appState.showAllSellers = !appState.showAllSellers;
    renderForensicsView();
  });
  document.getElementById("btn-copy-prune-cli")?.addEventListener("click", () => {
    copyTextSafe("python discogs_sniper.py --prune-owned", "Copied: python discogs_sniper.py --prune-owned");
  });
  document.getElementById("btn-refresh-sibling-vault")?.addEventListener("click", () => {
    fetchSiblingVaultJson({ silent: false });
  });
  document.getElementById("btn-sync-live-wantlist")?.addEventListener("click", () => {
    syncLiveWantlistFromAPI({ silent: false });
  });

  // Delegated clicks & inputs
  document.addEventListener("change", (e) => {
    const chk = e.target.closest(".bundle-item-chk");
    if (chk) {
      const seller = chk.dataset.bundleSeller;
      const itemId = chk.dataset.bundleItemId;
      if (seller && itemId) {
        if (!appState.bundleSelectionBySeller[seller]) appState.bundleSelectionBySeller[seller] = {};
        appState.bundleSelectionBySeller[seller][itemId] = chk.checked;
        renderAlphaBundles();
      }
    }
  });

  document.addEventListener("input", (e) => {
    const slider = e.target.closest("[data-offer-slider-id]");
    if (slider) {
      const lid = slider.dataset.offerSliderId;
      appState.customOfferById[lid] = Number(slider.value);
      const item = getListingById(lid);
      const preview = document.querySelector(`[data-pitch-preview="${CSS.escape(lid)}"]`);
      if (item && preview) preview.textContent = buildCustomBuyerPitch(item, appState.customOfferById[lid]);
      const card = slider.closest(".haggle-card");
      const badge = card?.querySelector(".kpi-badge");
      if (badge) badge.textContent = `Target ${formatUsd(appState.customOfferById[lid])}`;
      const strong = slider.parentElement?.querySelector("strong");
      if (strong) strong.textContent = formatUsd(appState.customOfferById[lid]);
    }
  });

  document.addEventListener("click", (e) => {
    const crateCard = e.target.closest("[data-crate-pos]");
    if (crateCard) {
      const pos = Number(crateCard.dataset.cratePos);
      if (pos === appState.crateIndex) {
        const items = getCrateFilteredListings();
        if (items[pos]) auditionListing(items[pos].id);
      } else {
        selectCrateIndex(pos);
      }
      return;
    }

    const trackChip = e.target.closest("[data-deck-track-idx]");
    if (trackChip && appState.currentlyPlayingId) {
      auditionListing(appState.currentlyPlayingId, Number(trackChip.dataset.deckTrackIdx));
      return;
    }

    const showdownTab = e.target.closest("[data-showdown-idx]");
    if (showdownTab) {
      appState.activeShowdownIndex = Number(showdownTab.dataset.showdownIdx || 0);
      renderVaultShowdown();
      return;
    }

    const inspectBtn = e.target.closest("[data-inspect-id]");
    if (inspectBtn) {
      openInspectModal(inspectBtn.dataset.inspectId);
      return;
    }

    const openDeckBtn = e.target.closest("[data-open-deck-id], #btn-inspect-open-deck");
    if (openDeckBtn) {
      const lid = openDeckBtn.dataset.openDeckId || openDeckBtn.dataset.listingId;
      closeInspectModal();
      openListingInTurntableDeck(lid);
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
      if (appState.expandedHistoryIds.has(id)) appState.expandedHistoryIds.delete(id);
      else appState.expandedHistoryIds.add(id);
      updateCardInPlace(id);
      return;
    }

    const jumpBundleBtn = e.target.closest("[data-bundle-seller].btn-jump-bundle");
    if (jumpBundleBtn) {
      switchView("alpha");
      return;
    }

    const launchBundleBtn = e.target.closest("[data-launch-bundle-seller]");
    if (launchBundleBtn) {
      const seller = launchBundleBtn.dataset.launchBundleSeller;
      const b = (SNIPER_STATE.seller_bundles || []).find((x) => x.seller === seller);
      if (b) {
        const picked = b.items.filter((it) => getBundleItemCheckedState(seller, it.id));
        picked.forEach((it) => window.open(sanitizeHttpUrl(it.add_to_cart_url), "_blank", "noopener"));
        showToast(`Opened ${picked.length} Cart tab(s) for ${seller}.`, "lime");
      }
      return;
    }

    const copyBundleBtn = e.target.closest("[data-copy-bundle-msg]");
    if (copyBundleBtn) {
      const seller = copyBundleBtn.dataset.copyBundleMsg;
      const b = (SNIPER_STATE.seller_bundles || []).find((x) => x.seller === seller);
      if (b) {
        const picked = b.items.filter((it) => getBundleItemCheckedState(seller, it.id));
        const titles = picked.map((it) => `${it.title} (#${it.id})`).join(", ");
        copyTextSafe(
          `Hi ${seller}, I'm planning to order ${picked.length} LPs from your store (${titles}). Could you confirm combined US Media Mail shipping before I check out? Thanks!`,
          `Copied combined shipping inquiry for ${seller}!`
        );
      }
      return;
    }

    const setOfferBtn = e.target.closest("[data-set-offer-id]");
    if (setOfferBtn) {
      const lid = setOfferBtn.dataset.setOfferId;
      appState.customOfferById[lid] = Number(setOfferBtn.dataset.setOfferVal);
      renderAlphaHaggleDesk();
      return;
    }

    const copyPitchBtn = e.target.closest("[data-copy-offer-pitch]");
    if (copyPitchBtn) {
      const lid = copyPitchBtn.dataset.copyOfferPitch;
      const item = getListingById(lid);
      if (item) {
        const val = Number(appState.customOfferById[lid] || item.offer_strategy?.recommended_offer_usd || item.list_price_usd * 0.9);
        copyTextSafe(buildCustomBuyerPitch(item, val), `Copied offer pitch (${formatUsd(val)}) for ${item.seller_info}!`);
      }
      return;
    }

    const inspectSaveTargetBtn = e.target.closest("#btn-inspect-save-target");
    if (inspectSaveTargetBtn) {
      const rid = inspectSaveTargetBtn.dataset.releaseId;
      const val = Number(document.getElementById("inspect-target-input")?.value || 0);
      if (rid && val > 0) {
        setReleaseTargetPrice(rid, val);
        openInspectModal(appState.inspectListingId);
      }
      return;
    }

    const pinDeckTargetBtn = e.target.closest("[data-pin-target-release]");
    if (pinDeckTargetBtn) {
      const rid = pinDeckTargetBtn.dataset.pinTargetRelease;
      const active = getCrateFilteredListings()[appState.crateIndex];
      if (rid && active) setReleaseTargetPrice(rid, Math.max(10, Math.round(active.total_price_usd * 0.85)));
      return;
    }

    const rmTargetBtn = e.target.closest("[data-remove-target-rid]");
    if (rmTargetBtn) {
      removeReleaseTargetPrice(rmTargetBtn.dataset.removeTargetRid);
      if (appState.inspectListingId) openInspectModal(appState.inspectListingId);
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
        showToast(`Muted seller "${muteInlineBtn.dataset.muteSeller}".`, "amber");
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
        showToast(`Muted seller "${rawName}".`, "amber");
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
        showToast(`"${rawName}" set to Price-Drop-Only.`, "amber");
      }
      syncRuleInputsFromState();
      saveConfigOverrides();
      renderForensicsView();
      return;
    }

    const pruneBtn = e.target.closest("[data-prune-release-id]");
    if (pruneBtn) {
      pruneReleaseFromWantlistAPI(pruneBtn.dataset.pruneReleaseId, pruneBtn.dataset.pruneTitle);
    }
  });

  // Prune All Active Overlaps
  const pruneAllBtn = document.getElementById("btn-prune-all-owned-api");
  pruneAllBtn?.addEventListener("click", async () => {
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
      if (i + 1 < list.length) await new Promise((resolve) => setTimeout(resolve, 350));
    }

    delete pruneAllBtn.dataset.busy;
    if (corsBlocked) {
      renderVaultBridgeView();
      showToast("Discogs blocks browser DELETE via CORS — run python discogs_sniper.py --prune-owned locally.", "crimson", 6500);
      return;
    }
    await syncLiveWantlistFromAPI({ silent: true });
    const remNow = getActiveExactOwnedList().length;
    showToast(`Prune complete: ${removed} removed, ${alreadyAbsent} already absent, ${failed} failed. ${remNow} remaining.`, failed > 0 ? "crimson" : "lime", 5000);
  });

  // Audio Transport & Scrubber
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
      updateCrackleSynthesis();
      syncAudioPlayingClassesInDOM();
      startTurntableAnimationLoop();
    });
    audio.addEventListener("pause", () => {
      appState.isAudioActuallyPlaying = false;
      if (playPauseBtn) playPauseBtn.textContent = "Play";
      updateCrackleSynthesis();
      syncAudioPlayingClassesInDOM();
    });
    audio.addEventListener("ended", () => {
      appState.isAudioActuallyPlaying = false;
      updateCrackleSynthesis();
      syncAudioPlayingClassesInDOM();
      if (appState.grailRadioEnabled) {
        const items = getCrateFilteredListings();
        const nextIdx = (appState.crateIndex + 1) % Math.max(1, items.length);
        selectCrateIndex(nextIdx, { autoPlay: true });
      } else {
        appState.currentlyPlayingId = null;
      }
    });
  }

  playPauseBtn?.addEventListener("click", () => {
    if (!audio || !audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  closeAudioBtn?.addEventListener("click", () => {
    if (!audio) return;
    auditionRequestSeq += 1;
    audio.pause();
    appState.currentlyPlayingId = null;
    appState.isAudioActuallyPlaying = false;
    updateCrackleSynthesis();
    document.getElementById("audio-transport-bar")?.classList.remove("visible");
    syncAudioPlayingClassesInDOM();
  });

  // Remote & API Console Bindings
  document.getElementById("btn-toggle-token-vis")?.addEventListener("click", (e) => {
    const inp = document.getElementById("input-discogs-token");
    if (!inp) return;
    const isPwd = inp.type === "password";
    inp.type = isPwd ? "text" : "password";
    e.currentTarget.textContent = isPwd ? "Hide" : "Show";
  });

  document.getElementById("btn-toggle-gh-pat-vis")?.addEventListener("click", (e) => {
    const inp = document.getElementById("input-github-pat");
    if (!inp) return;
    const isPwd = inp.type === "password";
    inp.type = isPwd ? "text" : "password";
    e.currentTarget.textContent = isPwd ? "Hide" : "Show";
  });

  document.getElementById("btn-pull-live-snapshot")?.addEventListener("click", () => pullLiveRepoSnapshotFromGitHub({ silent: false }));
  document.getElementById("btn-push-github-config")?.addEventListener("click", commitSniperConfigToGitHub);
  document.getElementById("btn-trigger-pages-deploy")?.addEventListener("click", triggerGitHubPagesWorkflow);

  document.getElementById("btn-save-github-pat")?.addEventListener("click", () => {
    const repo = document.getElementById("input-github-repo")?.value.trim() || "krunked-fpv/discogs_sniper";
    const pat = document.getElementById("input-github-pat")?.value.trim() || "";
    appState.githubRepo = repo;
    appState.githubPat = pat;
    safeSetStorage(STORAGE_KEYS.GH_REPO, repo);
    if (pat) safeSetStorage(STORAGE_KEYS.GH_PAT, pat);
    else safeRemoveStorage(STORAGE_KEYS.GH_PAT);
    updateApiConnectionStatusUI();
    showToast(pat ? "Saved GitHub PAT locally in browser storage." : "Saved repository coordinate.", "lime");
  });

  document.getElementById("btn-clear-github-pat")?.addEventListener("click", () => {
    appState.githubPat = "";
    safeRemoveStorage(STORAGE_KEYS.GH_PAT);
    updateApiConnectionStatusUI();
    showToast("Cleared browser-stored GitHub PAT.", "cyan");
  });

  document.getElementById("btn-toggle-autohydrate")?.addEventListener("click", () => {
    appState.autoHydrateEnabled = !appState.autoHydrateEnabled;
    safeSetStorage(STORAGE_KEYS.AUTO_HYDRATE, String(appState.autoHydrateEnabled));
    updateHydratorStatusUI();
    if (appState.autoHydrateEnabled) {
      observeCoverArtAndLiveHydration();
      processHydrationQueue();
    }
  });

  document.getElementById("btn-sweep-unrated")?.addEventListener("click", () => {
    const unrated = (SNIPER_STATE.listings || []).filter((x) => x.is_latest_in_group && x.deal_tier === "UNRATED").slice(0, 15);
    appState.autoHydrateEnabled = true;
    unrated.forEach((x) => enqueueHydrationListing(x.id, true));
    showToast(`Queued ${unrated.length} unrated listing(s) for live API enrichment.`, "cyan");
  });

  document.getElementById("btn-clear-idb-cache")?.addEventListener("click", clearSniperIDBCache);

  document.getElementById("btn-save-verify-token")?.addEventListener("click", async () => {
    const rawUser = document.getElementById("input-discogs-username")?.value.trim() || "krunked";
    const rawTok = document.getElementById("input-discogs-token")?.value.trim() || "";
    await saveAndVerifyDiscogsToken(rawUser, rawTok);
  });

  const consoleOut = document.getElementById("api-console-output");
  document.getElementById("btn-test-price-suggestions")?.addEventListener("click", async () => {
    if (consoleOut) consoleOut.textContent = "// Querying Official Discogs API for Dayseeker - Dark Sun (#38857860)...";
    try {
      const [stats, sugg] = await Promise.all([
        discogsApiFetch("/marketplace/stats/38857860?curr_abbr=USD"),
        appState.discogsToken
          ? discogsApiFetch("/marketplace/price_suggestions/38857860", { allowAnonymous: false }).catch((e) => ({ note: e.message }))
          : Promise.resolve({ note: "Connect DISCOGS_TOKEN above to unlock /marketplace/price_suggestions" }),
      ]);
      if (consoleOut) {
        consoleOut.textContent = JSON.stringify({ release_id: 38857860, marketplace_stats: stats, price_suggestions: sugg }, null, 2);
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
        appState.mutedSellers = new Set(el.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
        renderRadarGrid();
        renderForensicsView();
      } else if (id === "cfg-pricedrop-sellers") {
        appState.priceDropOnlySellers = new Set(el.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
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
    copyTextSafe(JSON.stringify(buildCurrentConfigObject(), null, 2), "Copied sniper_config.json to clipboard!");
  });

  document.getElementById("btn-reset-config")?.addEventListener("click", () => {
    safeRemoveStorage(STORAGE_KEYS.CONFIG_OVERRIDES);
    appState.mutedSellers = new Set((baseConfig.filters?.muted_sellers || []).map((s) => s.toLowerCase()));
    appState.priceDropOnlySellers = new Set((baseConfig.filters?.price_drop_only_sellers || ["recordmule"]).map((s) => s.toLowerCase()));
    appState.targetPricesByRelease = { ...(baseConfig.filters?.target_prices_by_release || {}) };
    hydrateRuleInputsFromConfig();
    syncRuleInputsFromState();
    renderRadarGrid();
    renderAlphaView();
    renderForensicsView();
    showToast("Reset sniper_config.json rules to repository defaults.", "cyan");
  });

  // Global Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const cp = document.getElementById("cmd-palette-backdrop");
      if (cp && !cp.hidden) closeCommandPalette();
      else openCommandPalette();
      return;
    }

    if (e.key === "Escape") {
      closeCommandPalette();
      closeInspectModal();
      closeQuickApiModal();
      return;
    }

    const tag = (e.target?.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    const viewMap = { "1": "radar", "2": "crate", "3": "alpha", "4": "forensics", "5": "vault", "6": "rules" };
    if (!e.ctrlKey && !e.metaKey && !e.altKey && viewMap[e.key]) {
      switchView(viewMap[e.key]);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      switchView("radar");
      searchInput?.focus();
    } else if (e.key.toLowerCase() === "u") {
      cycleLightingMode();
    } else if (appState.activeView === "radar") {
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        moveRadarKeyboardFocus(1);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        moveRadarKeyboardFocus(-1);
      } else if (e.key === " " && appState.focusedListingId) {
        e.preventDefault();
        auditionListing(appState.focusedListingId);
      } else if (e.key.toLowerCase() === "o" && appState.focusedListingId) {
        e.preventDefault();
        openInspectModal(appState.focusedListingId);
      } else if (e.key.toLowerCase() === "c" && appState.focusedListingId) {
        const item = getListingById(appState.focusedListingId);
        if (item) window.open(sanitizeHttpUrl(item.add_to_cart_url), "_blank", "noopener");
      } else if (e.key.toLowerCase() === "t" && appState.focusedListingId) {
        const item = getListingById(appState.focusedListingId);
        if (item) setReleaseTargetPrice(item.release_id, Math.max(10, Math.round(item.total_price_usd * 0.85)));
      } else if (e.key.toLowerCase() === "m" && appState.focusedListingId) {
        const item = getListingById(appState.focusedListingId);
        if (item) {
          appState.mutedSellers.add(item.seller_info.toLowerCase());
          syncRuleInputsFromState();
          saveConfigOverrides();
          renderRadarGrid();
          showToast(`Muted ${item.seller_info}.`, "amber");
        }
      }
    }
  });
}

// =====================================================================
// INITIALIZE APPLICATION & BACKGROUND HYDRATION / PWA SERVICE WORKER
// =====================================================================
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

async function bootApp() {
  applyLightingMode();
  hydrateRuleInputsFromConfig();
  updateApiConnectionStatusUI();
  updateConfigJsonPreview();

  await idbLoadAllFreshIntoState();
  renderTopKPIs();
  renderRadarGrid();
  renderCrateStudio();
  renderAlphaView();
  renderForensicsView();
  renderVaultBridgeView();
  bindEvents();

  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Quietly verify live Discogs Wantlist + sibling Vault JSON on HTTP/HTTPS boots
  if (location.protocol.startsWith("http")) {
    syncLiveWantlistFromAPI({ silent: true });
    fetchSiblingVaultJson({ silent: true });
  }
}

bootApp();

})();
