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
