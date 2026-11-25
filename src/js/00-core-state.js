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
  UI_PREFS: "krunked_sniper_ui_prefs_v3",
  DISMISSED: "krunked_sniper_dismissed_v3",
};

const HTML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  times: "×",
  bull: "•",
  middot: "·",
};

function decodeHtmlEntitiesOnce(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch (_) {
          return match;
        }
      }
      return match;
    }
    const mapped = HTML_ENTITY_MAP[body.toLowerCase()];
    return mapped !== undefined ? mapped : match;
  });
}

function decodeHtmlEntities(str, maxDepth = 12) {
  let cur = String(str ?? "");
  if (!cur.includes("&")) return cur;
  for (let i = 0; i < maxDepth; i += 1) {
    const next = decodeHtmlEntitiesOnce(cur);
    if (next === cur) break;
    cur = next;
    if (!cur.includes("&")) break;
  }
  return cur;
}

function normalizeSniperStateEntities(state) {
  if (!state || typeof state !== "object") return state;
  const decodeFields = (obj, keys) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of keys) {
      if (typeof obj[k] === "string" && obj[k].includes("&")) {
        obj[k] = decodeHtmlEntities(obj[k]);
      }
    }
  };
  if (Array.isArray(state.listings)) {
    for (const item of state.listings) {
      decodeFields(item, ["title", "artist", "album", "variant", "seller_info", "raw_description", "clean_seller_note"]);
      if (item.wax_shader) decodeFields(item.wax_shader, ["wax_name"]);
      if (item.offer_strategy) decodeFields(item.offer_strategy, ["buyer_pitch"]);
      if (item.vault_owned_detail) decodeFields(item.vault_owned_detail, ["format_string", "title", "artist"]);
    }
  }
  if (Array.isArray(state.seller_bundles)) {
    for (const b of state.seller_bundles) {
      decodeFields(b, ["seller", "policy_label"]);
      if (Array.isArray(b.items)) {
        for (const it of b.items) decodeFields(it, ["title", "artist", "album", "variant"]);
      }
    }
  }
  if (Array.isArray(state.seller_leaderboard)) {
    for (const s of state.seller_leaderboard) decodeFields(s, ["seller", "top_title"]);
  }
  if (Array.isArray(state.release_churn_leaderboard)) {
    for (const r of state.release_churn_leaderboard) decodeFields(r, ["title", "variant", "top_seller"]);
  }
  const vb = state.vault_bridge;
  if (vb) {
    for (const r of vb.exact_owned_on_wantlist || []) decodeFields(r, ["title", "artist", "album", "variant", "owned_format"]);
    for (const r of vb.variant_upgrades_on_wantlist || []) decodeFields(r, ["title", "artist", "album", "wantlist_variant", "owned_format"]);
  }
  return state;
}

normalizeSniperStateEntities(SNIPER_STATE);

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

function loadSavedUiPrefs() {
  const raw = safeGetStorage(STORAGE_KEYS.UI_PREFS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

const savedUiPrefs = loadSavedUiPrefs();
const savedLight = safeGetStorage(STORAGE_KEYS.LIGHTING_MODE);
const initialLighting = savedLight === "uv" || savedLight === "tube" ? savedLight : "obsidian";

const appState = {
  activeView: "radar",
  lightingMode: initialLighting,
  radarLayout: safeGetStorage(STORAGE_KEYS.RADAR_LAYOUT) === "matrix" ? "matrix" : "cards",
  searchQuery: "",
  scopeMode: savedUiPrefs.scopeMode === "LIVE_P1" ? "LIVE_P1" : "ALL",
  dedupEnabled: savedUiPrefs.dedupEnabled !== false,
  hideRecordmule: Boolean(savedUiPrefs.hideRecordmule),
  hideSold: Boolean(savedUiPrefs.hideSold),
  conditionFilter: ["ALL", "M", "NM", "VG+"].includes(savedUiPrefs.conditionFilter) ? savedUiPrefs.conditionFilter : "ALL",
  sortMode: [
    "SNAPSHOT_ORDER",
    "DEAL_SCORE",
    "PRICE_ASC",
    "PRICE_DESC",
    "TARGET_HITS",
    "BUNDLE_SAVINGS",
    "MOST_RELISTED",
  ].includes(savedUiPrefs.sortMode)
    ? savedUiPrefs.sortMode
    : "SNAPSHOT_ORDER",
  categoryFilter: [
    "ALL",
    "MISSING_GRAIL",
    "STEALS",
    "PRICE_DROP",
    "BUNDLE_READY",
    "MAKE_OFFER",
    "TARGET_HITS",
    "VARIANT_UPGRADE",
    "ALREADY_OWNED",
  ].includes(savedUiPrefs.categoryFilter)
    ? savedUiPrefs.categoryFilter
    : "ALL",
  sliderMaxUsd: datasetMaxPrice,
  maxPriceUsd: datasetMaxPrice,
  focusedListingId: null,
  cmdPaletteSelectedIdx: 0,
  mutedSellers: new Set(initialMuted.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
  priceDropOnlySellers: new Set(initialDropOnly.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
  targetPricesByRelease: { ...initialTargetPrices },
  sellerSearchQuery: "",
  showAllSellers: false,
  expandedHistoryIds: new Set(),
  expandedApiIds: new Set(),
  dismissedListingIds: new Set(),
  filtersDrawerOpen: false,
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

try {
  const cachedDismissed = safeGetStorage(STORAGE_KEYS.DISMISSED);
  if (cachedDismissed) {
    const parsed = JSON.parse(cachedDismissed);
    if (Array.isArray(parsed)) {
      appState.dismissedListingIds = new Set(parsed.map((x) => String(x)).filter(Boolean));
    }
  }
} catch (_) {}

function saveArtCache() {
  safeSetStorage(STORAGE_KEYS.ART_CACHE, JSON.stringify(appState.artCache));
}

function savePrunedReleaseIds() {
  safeSetStorage(STORAGE_KEYS.PRUNED, JSON.stringify([...appState.prunedReleaseIds]));
}

function saveDismissedListingIds() {
  safeSetStorage(STORAGE_KEYS.DISMISSED, JSON.stringify([...appState.dismissedListingIds]));
}

function saveUiPrefs() {
  safeSetStorage(
    STORAGE_KEYS.UI_PREFS,
    JSON.stringify({
      scopeMode: appState.scopeMode,
      dedupEnabled: appState.dedupEnabled,
      hideRecordmule: appState.hideRecordmule,
      hideSold: appState.hideSold,
      conditionFilter: appState.conditionFilter,
      sortMode: appState.sortMode,
      categoryFilter: appState.categoryFilter,
    })
  );
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
  if (clean.length !== 6) return `rgba(34, 211, 238, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(34, 211, 238, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function showToast(message, variant = "cyan", durationMs = 3400, action = null) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  while (stack.children.length >= 2) {
    stack.firstElementChild?.remove();
  }
  const item = document.createElement("div");
  item.className = `toast-item toast-${variant}`;
  let removed = false;
  const dismissToast = () => {
    if (removed) return;
    removed = true;
    item.style.opacity = "0";
    item.style.transform = "translateX(16px)";
    item.style.transition = "all 0.2s ease";
    setTimeout(() => item.remove(), 220);
  };
  if (action && action.label && typeof action.onClick === "function") {
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.gap = "10px";
    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-micro toast-undo-btn";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      dismissToast();
    });
    item.appendChild(msgSpan);
    item.appendChild(btn);
  } else {
    item.textContent = message;
  }
  stack.appendChild(item);
  setTimeout(dismissToast, durationMs);
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
  document.body.classList.remove("mode-neon", "mode-obsidian", "mode-uv", "uv-blacklight", "mode-tube");
  document.body.classList.add("ambient-stage-bg");
  if (appState.lightingMode === "uv") {
    document.body.classList.add("mode-uv", "uv-blacklight");
  } else if (appState.lightingMode === "tube") {
    document.body.classList.add("mode-tube");
  } else {
    document.body.classList.add("mode-obsidian");
  }
  const toggleBtn = document.getElementById("btn-toggle-uv");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-pressed", String(appState.lightingMode === "uv"));
    toggleBtn.dataset.lightingMode = appState.lightingMode;
  }
  const lbl = document.getElementById("uv-mode-label");
  if (lbl) {
    lbl.textContent =
      appState.lightingMode === "uv" ? "UV 395nm" : appState.lightingMode === "tube" ? "TUBE AMP" : "OBSIDIAN";
  }
  safeSetStorage(STORAGE_KEYS.LIGHTING_MODE, appState.lightingMode);
}

function setStageChromaFromWax(wax) {
  if (!wax || appState.lightingMode === "tube") return;
  const primary = wax.primary && wax.primary !== "#181a1f" ? wax.primary : "#22d3ee";
  const secondary = wax.secondary && wax.secondary !== "#0d0f12" ? wax.secondary : "#a855f7";
  const accent = wax.accent || "#f43f5e";
  const boost = appState.lightingMode === "uv" ? 0.34 : 0.22;
  const root = document.documentElement.style;
  root.setProperty("--stage-c1", hexToRgba(primary, boost));
  root.setProperty("--stage-c2", hexToRgba(secondary, boost * 0.85));
  root.setProperty("--glow-primary", hexToRgba(primary, boost * 1.15));
  root.setProperty("--glow-secondary", hexToRgba(secondary, boost));
  root.setProperty("--glow-accent", hexToRgba(accent, boost * 0.72));
}
