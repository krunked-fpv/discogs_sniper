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
