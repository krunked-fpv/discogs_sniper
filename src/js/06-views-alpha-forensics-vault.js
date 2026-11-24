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
        <article class="bundle-card anodized-panel">
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
        <article class="haggle-card anodized-panel">
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
            <input type="range" class="price-slider audiophile-slider" min="${minOffer}" max="${maxOffer}" step="0.5" value="${curOffer.toFixed(2)}" data-offer-slider-id="${escapeHtml(item.id)}" />
            <strong style="color:var(--mint-lock, var(--neon-lime));">${formatUsd(curOffer)}</strong>
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
      <div class="bluff-stat-box anodized-panel">
        <div class="matrix-label">Genuine Price Cuts</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--mint-lock, var(--neon-lime));">${genuineCuts}</div>
        <div class="matrix-sub">Strictly lower than historical peak</div>
      </div>
      <div class="bluff-stat-box anodized-panel">
        <div class="matrix-label">Yo-Yo Bluff Groups</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--strobe-amber, var(--neon-amber));">${yoyoBluffs}</div>
        <div class="matrix-sub">Price bounced without true floor cut</div>
      </div>
      <div class="bluff-stat-box anodized-panel">
        <div class="matrix-label">Flatline Bot Spam</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--signal-rose, var(--neon-crimson));">${flatBots}</div>
        <div class="matrix-sub">Zero price change across relist IDs</div>
      </div>
      <div class="bluff-stat-box anodized-panel">
        <div class="matrix-label">Clean Single Drops</div>
        <div class="kpi-value" style="font-size:1.4rem;color:var(--quartz-cyan, var(--neon-cyan));">${singles}</div>
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
    <div class="showdown-side anodized-panel side-shelf">
      <img src="${escapeHtml(shelfImgUrl)}" data-fallback-src="${escapeHtml(renderFallbackSleeveDataUri(target.artist, target.album))}" alt="Owned pressing" class="showdown-disc-photo" />
      <div style="min-width:0;flex:1;">
        <span class="kpi-badge badge-lime">ON YOUR SHELF // VAULT #${escapeHtml(target.owned_release_id)}</span>
        <h3 style="color:#fff;font-family:var(--font-display);font-size:1.02rem;margin:6px 0 4px;">${escapeHtml(decodeHtmlEntities(target.title))}</h3>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:6px;">${escapeHtml(decodeHtmlEntities(shelfFormat))}</div>
        <div style="font-family:var(--font-mono);font-size:0.74rem;color:var(--mint-lock, var(--neon-lime));">
          Est. Vault Value: <strong>${formatUsd(shelfVal)}</strong> // ${escapeHtml(shelfCond)}
        </div>
        ${siblingRec?.wax_spec?.variant_badge ? `<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(decodeHtmlEntities(siblingRec.wax_spec.variant_badge))}</div>` : ""}
      </div>
    </div>

    <div class="showdown-side anodized-panel side-target">
      <canvas id="showdown-target-canvas" class="uv-reactive" width="128" height="128" style="width:112px;height:112px;flex-shrink:0;"></canvas>
      <div style="min-width:0;flex:1;">
        <span class="kpi-badge badge-magenta">MARKET TARGET // RELEASE #${escapeHtml(target.wantlist_release_id)}</span>
        <h3 style="color:#fff;font-family:var(--font-display);font-size:1.02rem;margin:6px 0 4px;">${escapeHtml(decodeHtmlEntities(target.wantlist_variant))}</h3>
        <div style="font-family:var(--font-mono);font-size:0.76rem;color:var(--quartz-cyan, var(--neon-cyan));margin-bottom:8px;">
          Lowest Sniped: <strong>${formatUsd(target.lowest_sniped_usd)}</strong> (${target.wantlist_hits_count}x seen)
          ${priceDiff !== null ? ` // <span style="color:${priceDiff <= 0 ? "var(--mint-lock, var(--neon-lime))" : "var(--strobe-amber, var(--neon-amber))"};">${priceDiff >= 0 ? "+" : ""}${formatUsd(priceDiff)} vs shelf</span>` : ""}
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
