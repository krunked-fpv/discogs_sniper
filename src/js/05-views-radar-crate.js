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
  document.querySelectorAll(".kpi-grid .kpi-card").forEach((card) => {
    const sub = card.querySelector(".kpi-sub");
    if (sub && sub.textContent) card.title = sub.textContent.trim();
  });
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
  const stroke = last < first ? "#10b981" : maxV > minV ? "#f59e0b" : "#22d3ee";
  const lastPt = coords[coords.length - 1].split(",");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" style="vertical-align:middle;">
    <polyline fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${coords.join(" ")}" />
    <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.4" fill="${stroke}" />
  </svg>`;
}

function hasPriceMovement(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const vals = points.map((p) => (typeof p === "number" ? p : Number(p.price_usd || 0))).filter((v) => v > 0);
  if (vals.length < 2) return false;
  return Math.max(...vals) - Math.min(...vals) >= 0.01;
}

function formatCompactFreshness(item) {
  const iso = item?.alerted_at || "";
  if (iso) {
    const ts = Date.parse(iso);
    if (!Number.isNaN(ts)) {
      const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (diffSec < 60) return "now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 48) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return `${diffDay}d ago`;
      return iso.slice(5, 10).replace("-", "/");
    }
  }
  return item?.listed_age || "";
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

function getActiveAdvancedFilterConstraints() {
  const chips = [];
  if (!appState.dedupEnabled) {
    chips.push({ key: "dedup", label: "Relist Shield: OFF" });
  }
  if (appState.hideRecordmule) {
    chips.push({ key: "recordmule", label: "Hide recordmule" });
  }
  if (appState.hideSold) {
    chips.push({ key: "sold", label: "Hide Sold" });
  }
  if (appState.conditionFilter !== "ALL") {
    chips.push({ key: "condition", label: `Grade: ${appState.conditionFilter}+` });
  }
  if (appState.maxPriceUsd < appState.sliderMaxUsd) {
    chips.push({ key: "price", label: `Max: $${appState.maxPriceUsd}` });
  }
  return chips;
}

function syncFiltersDrawerUI() {
  const drawer = document.getElementById("radar-advanced-drawer");
  const toggleBtn = document.getElementById("btn-radar-filters-toggle");
  const badge = document.getElementById("radar-filters-badge");
  const adv = getActiveAdvancedFilterConstraints();
  const otherCount = adv.filter((c) => c.key !== "dedup").length;

  if (drawer) {
    drawer.hidden = !appState.filtersDrawerOpen;
  }
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", String(Boolean(appState.filtersDrawerOpen)));
    toggleBtn.classList.toggle("active", Boolean(appState.filtersDrawerOpen) || adv.length > 0);
    toggleBtn.classList.toggle("has-active-filters", adv.length > 0);
  }
  if (badge) {
    if (appState.dedupEnabled) {
      badge.textContent = otherCount > 0 ? `Shield · ${otherCount}` : "Shield";
    } else {
      badge.textContent = otherCount > 0 ? `Shield OFF · ${otherCount}` : "Shield OFF";
    }
  }
}

function clearAdvancedFilter(key) {
  if (key === "dedup") {
    appState.dedupEnabled = true;
    document.getElementById("btn-toggle-dedup")?.classList.add("active");
  } else if (key === "recordmule") {
    appState.hideRecordmule = false;
    document.getElementById("btn-hide-recordmule")?.classList.remove("active");
  } else if (key === "sold") {
    appState.hideSold = false;
    document.getElementById("btn-hide-sold")?.classList.remove("active");
  } else if (key === "condition") {
    appState.conditionFilter = "ALL";
    const condSel = document.getElementById("radar-condition-select");
    if (condSel) condSel.value = "ALL";
    if (typeof updateConfigJsonPreview === "function") updateConfigJsonPreview();
  } else if (key === "price") {
    appState.maxPriceUsd = appState.sliderMaxUsd;
    const slider = document.getElementById("radar-max-price-slider");
    if (slider) slider.value = String(appState.sliderMaxUsd);
    const readout = document.getElementById("max-price-readout");
    if (readout) readout.textContent = "No Limit";
  } else {
    return;
  }
  saveUiPrefs();
  renderRadarGrid();
}

function dismissListing(listingId) {
  const id = String(listingId || "");
  if (!id) return;
  const item = getListingById(id);

  if (appState.focusedListingId === id) {
    const curList = getFilteredListings();
    const curIdx = curList.findIndex((x) => String(x.id) === id);
    const nextItem = curIdx >= 0 ? curList[curIdx + 1] || curList[curIdx - 1] || null : null;
    appState.focusedListingId = nextItem ? String(nextItem.id) : null;
  }

  appState.dismissedListingIds.add(id);
  saveDismissedListingIds();
  renderRadarGrid();

  const label = item ? `${decodeHtmlEntities(item.artist)} — ${decodeHtmlEntities(getDisplayAlbumTitle(item))}` : `#${id}`;
  showToast(`Skipped ${label}`, "amber", 4600, {
    label: "Undo",
    onClick: () => restoreDismissedListing(id),
  });
}

function restoreDismissedListing(listingId) {
  const id = String(listingId || "");
  if (!id || !appState.dismissedListingIds.has(id)) return;
  appState.dismissedListingIds.delete(id);
  saveDismissedListingIds();
  renderRadarGrid();
  showToast("Restored skipped listing.", "cyan", 2200);
}

function restoreAllDismissedListings() {
  const count = appState.dismissedListingIds.size;
  if (count === 0) return;
  appState.dismissedListingIds.clear();
  saveDismissedListingIds();
  renderRadarGrid();
  showToast(`Restored ${count} skipped listing${count === 1 ? "" : "s"}.`, "lime", 2600);
}

function hasActiveFilters() {
  return (
    Boolean(appState.searchQuery) ||
    appState.scopeMode !== "ALL" ||
    appState.categoryFilter !== "ALL" ||
    appState.conditionFilter !== "ALL" ||
    !appState.dedupEnabled ||
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
  appState.dedupEnabled = true;
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
  document.getElementById("btn-toggle-dedup")?.classList.add("active");
  document.getElementById("btn-hide-recordmule")?.classList.remove("active");
  document.getElementById("btn-hide-sold")?.classList.remove("active");

  document.querySelectorAll(".scope-btn[data-scope]").forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === "ALL");
  });
  document.querySelectorAll(".filter-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === "ALL");
  });

  saveUiPrefs();
  renderRadarGrid();
  if (appState.dismissedListingIds.size > 0) {
    const n = appState.dismissedListingIds.size;
    showToast(`Filters reset (${n} skipped listing${n === 1 ? "" : "s"} hidden).`, "cyan", 4200, {
      label: "Restore",
      onClick: restoreAllDismissedListings,
    });
  }
}

function getFilteredListings() {
  const all = SNIPER_STATE.listings || [];

  const basePool = all.filter((item) => {
    if (appState.dismissedListingIds.has(String(item.id))) return false;
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

  const pillMap = [
    ["pill-filter-all", "pill-cnt-all", counts.ALL],
    ["pill-filter-grails", "pill-cnt-grails", counts.MISSING_GRAIL],
    ["pill-filter-steals", "pill-cnt-steals", counts.STEALS],
    ["pill-filter-pricedrop", "pill-cnt-pricedrop", counts.PRICE_DROP],
    ["pill-filter-bundles", "pill-cnt-bundles", counts.BUNDLE_READY],
    ["pill-filter-offers", "pill-cnt-offers", counts.MAKE_OFFER],
    ["pill-filter-targets", "pill-cnt-targets", counts.TARGET_HITS],
    ["pill-filter-variants", "pill-cnt-variants", counts.VARIANT_UPGRADE],
    ["pill-filter-owned", "pill-cnt-owned", counts.ALREADY_OWNED],
  ];
  for (const [pillId, cntId, n] of pillMap) {
    const cntEl = document.getElementById(cntId);
    if (cntEl) cntEl.textContent = String(n);
    const pillEl = document.getElementById(pillId);
    if (pillEl) pillEl.classList.toggle("is-empty", n === 0);
  }

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

function renderStageVaultPills(item) {
  const pills = [];
  if (item.vault_status === "ALREADY_OWNED") {
    const cleared = isReleaseClearedFromLiveWantlist(item.release_id);
    if (cleared) {
      pills.push(`<span class="tag-pill badge-neutral" title="Owned in Vault &amp; already cleared from live Wantlist">CLEARED</span>`);
    } else {
      pills.push(`<span class="tag-pill badge-crimson" title="Exact release_id (#${escapeHtml(item.release_id)}) is in your Collection Vault">IN VAULT</span>`);
    }
  } else if (item.vault_status === "VARIANT_UPGRADE") {
    const ownedFmt = item.vault_owned_detail ? item.vault_owned_detail.format_string : "Another pressing";
    pills.push(`<span class="tag-pill badge-magenta" title="Alternate variant of album in your Vault: ${escapeHtml(ownedFmt)}">VARIANT</span>`);
  } else {
    pills.push(`<span class="tag-pill badge-lime" title="Missing from your Collection Vault">GRAIL</span>`);
  }

  const isSold = isListingSold(item);
  if (isSold) {
    const live = appState.liveApiResults[item.id];
    pills.push(`<span class="tag-pill badge-crimson stage-sold-pill">${escapeHtml(live?.status || "SOLD")}</span>`);
  } else if (item.is_live_page1) {
    pills.push(`<span class="tag-pill badge-cyan stage-live-pill" title="Active on Discogs Wantlist Page 1"><span class="live-ping"></span>LIVE</span>`);
  }
  return pills.join("");
}

function renderStageAlphaPill(item) {
  if (isListingTargetHit(item)) {
    return `<span class="tag-pill badge-gold" title="At or below your ${formatUsd(item.target_price_usd)} target">${ICONS.target}<span>TARGET HIT</span></span>`;
  }
  if (item.is_price_drop) {
    return `<span class="tag-pill badge-lime" title="Price dropped from ${formatUsd(item.group_highest_price_usd)}">DROP -$${Number(item.price_drop_usd || 0).toFixed(2)}</span>`;
  }
  if (item.deal_delta_pct !== null && item.deal_delta_pct !== undefined && item.deal_delta_pct <= -15) {
    return `<span class="tag-pill badge-lime" title="${escapeHtml(item.deal_tier_label || "")}">STEAL ${item.deal_delta_pct.toFixed(0)}%</span>`;
  }
  if (item.deal_delta_pct !== null && item.deal_delta_pct !== undefined && item.deal_delta_pct <= -3) {
    return `<span class="tag-pill badge-cyan" title="${escapeHtml(item.deal_tier_label || "")}">DEAL ${item.deal_delta_pct.toFixed(0)}%</span>`;
  }
  if (item.allow_offers) {
    return `<span class="tag-pill badge-amber" title="Seller accepts Make Offer">OFFER</span>`;
  }
  return "";
}

function getGradeChipClass(item) {
  const mc = String(item.media_condition || "").toUpperCase();
  if (item.has_wear_warning || mc === "VG" || mc === "G+" || mc === "G" || mc === "F" || mc === "P") {
    return "grade-warn";
  }
  if (mc === "M" || mc === "NM" || mc === "M-") {
    return "grade-mint";
  }
  return "grade-good";
}

function getSnipeVerdictMeta(item) {
  const live = appState.liveApiResults[item.id];
  const mkt = item.market_stats || {};
  const benchUsd = Number(live?.suggested_usd || mkt.condition_suggested_usd || 0);
  const deltaPct = item.deal_delta_pct;
  const offerUsd = Number(item.offer_strategy?.recommended_offer_usd || 0);

  if (benchUsd > 0 && deltaPct !== null && deltaPct !== undefined) {
    if (deltaPct <= -15) {
      return { cls: "verdict-steal", label: `STEAL ${deltaPct.toFixed(0)}%`, benchUsd };
    }
    if (deltaPct <= -3) {
      return { cls: "verdict-deal", label: `${deltaPct.toFixed(0)}% vs Mkt`, benchUsd };
    }
    if (deltaPct <= 12) {
      if (item.allow_offers && offerUsd > 0) {
        return { cls: "verdict-offer", label: `Offer ~${formatUsd(offerUsd)}`, benchUsd };
      }
      return { cls: "verdict-fair", label: "Fair Mkt", benchUsd };
    }
    if (item.allow_offers && offerUsd > 0) {
      return { cls: "verdict-offer", label: `+${deltaPct.toFixed(0)}% · Offer`, benchUsd };
    }
    return { cls: "verdict-high", label: `+${deltaPct.toFixed(0)}% High`, benchUsd };
  }

  if (item.allow_offers && offerUsd > 0) {
    return { cls: "verdict-offer", label: `Offer ~${formatUsd(offerUsd)}`, benchUsd: 0 };
  }
  if (item.is_price_drop) {
    return { cls: "verdict-deal", label: `Cut -$${Number(item.price_drop_usd || 0).toFixed(2)}`, benchUsd: 0 };
  }
  return { cls: "verdict-unrated", label: "Unrated", benchUsd: 0 };
}

function renderSnipeVerdictHtml(item) {
  const mkt = item.market_stats || {};
  const verdict = getSnipeVerdictMeta(item);
  const sparkHtml = hasPriceMovement(item.price_trajectory)
    ? ` <span class="snipe-sparkline-inline" title="Observed price movement">${renderPriceSparklineSVG(item.price_trajectory, 48, 14)}</span>`
    : "";

  const benchLineHtml =
    verdict.benchUsd > 0
      ? `<span class="snipe-bench-line" title="${escapeHtml(mkt.benchmark_source || "Market Benchmark")}">Mkt <strong data-bench-val="${escapeHtml(item.id)}">${escapeHtml(formatUsd(verdict.benchUsd))}</strong>${sparkHtml}</span>`
      : `<span class="snipe-bench-line" data-bench-val="${escapeHtml(item.id)}"><button type="button" class="snipe-verify-link" data-live-api-id="${escapeHtml(item.id)}" title="Verify live status &amp; Discogs market benchmark">Verify Mkt ↻</button>${sparkHtml}</span>`;

  return `
    <span class="snipe-verdict-pill ${verdict.cls}">${escapeHtml(verdict.label)}</span>
    ${benchLineHtml}`;
}

function renderCardDrawersHtml(item, { forceApiDrawer = false } = {}) {
  const liveResult = appState.liveApiResults[item.id];
  const historyOpen = appState.expandedHistoryIds.has(item.id);
  const apiOpen = forceApiDrawer || appState.expandedApiIds.has(item.id);
  const mkt = item.market_stats || {};
  let html = "";

  if (historyOpen && item.sibling_history && item.sibling_history.length > 1) {
    const rowsHtml = item.sibling_history
      .map(
        (h, idx) => `
        <div class="history-row">
          <span>#${idx + 1} // <a href="${escapeHtml(sanitizeHttpUrl(h.item_url))}" target="_blank" rel="noopener noreferrer" style="color:var(--neon-cyan);">ID #${escapeHtml(h.id)}</a></span>
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

  if (liveResult && apiOpen) {
    const closeBtn = forceApiDrawer
      ? ""
      : `<span style="display:inline-flex;align-items:center;gap:4px;">
           <button type="button" class="btn-micro" data-refresh-live-api-id="${escapeHtml(item.id)}" title="Re-query live Discogs API">↻</button>
           <button type="button" class="btn-micro" data-close-api-drawer="${escapeHtml(item.id)}" title="Collapse API drawer" aria-label="Collapse API drawer">×</button>
         </span>`;
    if (liveResult.loading) {
      html += `<div class="live-api-drawer" style="color:var(--neon-cyan);">Querying api.discogs.com for Listing #${escapeHtml(item.id)} &amp; Release #${escapeHtml(item.release_id)}...</div>`;
    } else if (liveResult.error) {
      html += `
        <div class="live-api-drawer" style="color:#ff6082;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span>${escapeHtml(liveResult.error)}</span>
            ${closeBtn}
          </div>
        </div>`;
    } else {
      const statusClass = liveResult.status === "For Sale" ? "badge-lime" : liveResult.status === "Unknown" ? "badge-amber" : "badge-crimson";
      const statusText = liveResult.status === "For Sale" ? "STILL FOR SALE" : liveResult.status;
      html += `
        <div class="live-api-drawer">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
            <strong style="color:var(--neon-cyan);">DISCOGS API LIVE TELEMETRY</strong>
            <span style="display:inline-flex;align-items:center;gap:6px;">
              <span class="kpi-badge ${statusClass}">${escapeHtml(statusText)}</span>
              ${closeBtn}
            </span>
          </div>
          <div>Market: <strong>${liveResult.num_for_sale ?? "?"}</strong> for sale (Lowest: <strong>${escapeHtml(liveResult.lowest_price_str || "N/A")}</strong>) // <strong>${liveResult.want ?? "?"}</strong> Want / <strong>${liveResult.have ?? "?"}</strong> Have</div>
          <div>Suggested (${escapeHtml(item.media_condition)}): <strong style="color:var(--neon-lime);">${escapeHtml(liveResult.suggested_str || mkt.condition_suggested_formatted || "Connect Token")}</strong></div>
        </div>`;
    }
  }
  return html;
}

function renderDropCard(item) {
  const artistClean = decodeHtmlEntities(item.artist);
  const albumClean = decodeHtmlEntities(item.album);
  const titleClean = decodeHtmlEntities(item.title);
  const variantClean = decodeHtmlEntities(item.variant);
  const waxNameClean = decodeHtmlEntities(item.wax_shader?.wax_name || variantClean);
  const sellerClean = decodeHtmlEntities(item.seller_info);
  const fallbackUri = renderFallbackSleeveDataUri(artistClean, albumClean, item.wax_shader?.primary);
  const coverSrc = resolveCoverSrc(item);
  const needsHydration =
    !item.cover_image_url && !appState.artCache[item.release_id] && !appState.artCache[item.norm_album_key];
  const isPlaying = appState.currentlyPlayingId === item.id;
  const isSpinning = isPlaying && appState.isAudioActuallyPlaying;
  const isFocused = appState.focusedListingId === item.id;
  const isSold = isListingSold(item);
  const live = appState.liveApiResults[item.id];
  const liveDone = Boolean(live && !live.loading && !live.error);
  const waxPrimary = item.wax_shader?.primary && item.wax_shader.primary !== "#181a1f" ? item.wax_shader.primary : "#22d3ee";
  const waxGlow = hexToRgba(waxPrimary, 0.24);
  const priceBreakText =
    item.shipping_price_usd > 0 ? `${item.list_price} + ${formatUsd(item.shipping_price_usd)} ship` : "Free ship";
  const vaultCardCls =
    item.vault_status === "VARIANT_UPGRADE"
      ? "card-variant"
      : item.vault_status === "ALREADY_OWNED"
      ? "card-owned"
      : "card-grail";

  const gradeCls = getGradeChipClass(item);
  const freshnessText = formatCompactFreshness(item);
  const alphaPillHtml = renderStageAlphaPill(item);

  const collectorBadgesHtml = (item.collector_badges || [])
    .filter((b) => !(item.has_wear_warning && b.id === "WEAR_WARN"))
    .slice(0, 2)
    .map((b) => `<span class="tag-pill badge-${escapeHtml(b.tone)}">${escapeHtml(decodeHtmlEntities(b.label))}</span>`)
    .join("");

  const rawNote =
    item.clean_seller_note !== undefined
      ? item.clean_seller_note
      : item.raw_description && item.raw_description.toLowerCase() !== (item.variant || "").toLowerCase()
      ? item.raw_description
      : "";
  const cleanNote = decodeHtmlEntities(rawNote);

  const bundleBtnHtml =
    Number(item.seller_bundle_count || 1) >= 2
      ? `<button type="button" class="tag-pill tag-pill-btn badge-cyan btn-jump-bundle" data-bundle-seller="${escapeHtml(sellerClean)}" title="Seller holds ${item.seller_bundle_count} Wantlist LPs — open Bundle Optimizer">${item.seller_bundle_count}x Bundle</button>`
      : "";

  const relistBtnHtml =
    item.relist_group_total > 1
      ? `<button type="button" class="tag-pill tag-pill-btn badge-amber btn-toggle-relist-history" data-id="${escapeHtml(item.id)}" title="Inspect ${item.relist_group_total}x relist history">${ICONS.repeat}<span>${item.relist_group_total}x${item.relist_behavior === "YOYO_BLUFF" ? " Bluff" : ""}</span></button>`
      : "";

  const noteChipHtml =
    cleanNote && !item.has_wear_warning
      ? `<button type="button" class="seller-note-chip" data-inspect-id="${escapeHtml(item.id)}" title="${escapeHtml(cleanNote)}">Note</button>`
      : "";

  const wearBannerHtml = item.has_wear_warning
    ? `<div class="seller-notes notes-wear" title="${escapeHtml(cleanNote || "Wear noted in listing")}">${escapeHtml(cleanNote || "Jacket / sleeve wear noted in listing — inspect before buying.")}</div>`
    : "";

  return `
    <article class="drop-card card-record ${vaultCardCls} ${isPlaying ? "card-playing" : ""} ${isFocused ? "card-kbd-focused" : ""} ${isSold ? "card-sold" : ""}" style="--wax-glow:${waxGlow};--card-wax-glow:${waxGlow};" data-listing-id="${escapeHtml(item.id)}" data-release-id="${escapeHtml(item.release_id)}" data-artist="${escapeHtml(artistClean)}" data-album="${escapeHtml(albumClean)}">
      <div class="drop-card-stage">
        <button type="button" class="artwork-stage sleeve-peek-stage" data-inspect-id="${escapeHtml(item.id)}" title="Inspect pressing, seller notes, Haggle &amp; Target Price">
          <div class="sleeve-frame sleeve-peek-jacket holo-sleeve">
            <img
              src="${escapeHtml(coverSrc)}"
              data-fallback-src="${escapeHtml(fallbackUri)}"
              alt="${escapeHtml(titleClean)}"
              class="sleeve-img ${needsHydration ? "needs-art-hydration" : ""}"
              loading="lazy"
              data-release-id="${escapeHtml(item.release_id)}"
              data-norm-key="${escapeHtml(item.norm_album_key)}"
              data-artist="${escapeHtml(artistClean)}"
              data-album="${escapeHtml(albumClean)}"
            />
          </div>
          <div class="vinyl-platter-wrap sleeve-peek-disc uv-reactive ${isSpinning ? "spinning" : ""}" id="platter-${escapeHtml(item.id)}">
            ${renderVinylDiscSVG(item.wax_shader, item.id, 120)}
          </div>
        </button>

        <div class="stage-overlay-tl" data-stage-tl="${escapeHtml(item.id)}">${renderStageVaultPills(item)}</div>
        <div class="stage-overlay-tr" data-alpha-slot="${escapeHtml(item.id)}">${alphaPillHtml}</div>
        <div class="stage-overlay-bl">
          <span class="grade-chip ${gradeCls}" title="Media: ${escapeHtml(item.media_condition_full || item.media_condition)} / Sleeve: ${escapeHtml(item.sleeve_condition)}">${escapeHtml(item.media_condition)} / ${escapeHtml(item.sleeve_condition)}</span>
        </div>
        <button type="button" class="btn-triage-dismiss" data-dismiss-id="${escapeHtml(item.id)}" aria-label="Skip listing" title="Skip listing (X)">×</button>
      </div>

      <div class="drop-meta">
        <div class="drop-meta-head">
          <div class="drop-artist">${escapeHtml(artistClean)}</div>
          <span class="drop-freshness" title="Listing #${escapeHtml(item.id)} • ${escapeHtml((item.alerted_at || "").replace("T", " ").slice(0, 16) || item.listed_age || "")}">${escapeHtml(freshnessText)}</span>
        </div>
        <button type="button" class="drop-album-btn" data-inspect-id="${escapeHtml(item.id)}" title="${escapeHtml(albumClean)}">
          <h2 class="drop-album">${escapeHtml(decodeHtmlEntities(getDisplayAlbumTitle(item)))}</h2>
        </button>
        <div class="drop-variant-row">
          <div class="drop-variant" title="${escapeHtml(variantClean)}">
            <span class="wax-swatch" style="background:${escapeHtml(waxPrimary)};box-shadow:0 0 8px ${waxGlow};"></span>
            <span class="drop-variant-text">${escapeHtml(waxNameClean)}</span>
          </div>
          ${collectorBadgesHtml ? `<div class="collector-badges-inline">${collectorBadgesHtml}</div>` : ""}
        </div>
      </div>

      <div class="snipe-price-bar anodized-panel" data-price-bar="${escapeHtml(item.id)}">
        <div class="snipe-price-primary">
          <span class="snipe-price-total">${escapeHtml(item.total_price)}</span>
          <span class="snipe-price-break">${escapeHtml(priceBreakText)}</span>
        </div>
        <div class="snipe-price-verdict">
          ${renderSnipeVerdictHtml(item)}
        </div>
      </div>

      <div class="seller-strip">
        <div class="seller-left">
          <a href="https://www.discogs.com/seller/${encodeURIComponent(sellerClean)}/profile" target="_blank" rel="noopener noreferrer" class="seller-link" title="View ${escapeHtml(sellerClean)} on Discogs">${escapeHtml(sellerClean)}</a>
          ${item.seller_rating ? `<span class="seller-rating">${escapeHtml(item.seller_rating)}</span>` : ""}
          ${bundleBtnHtml}
          ${relistBtnHtml}
        </div>
        <div class="seller-tools">
          ${noteChipHtml}
          <button type="button" class="seller-icon-btn ${liveDone ? "is-verified" : ""}" data-live-api-id="${escapeHtml(item.id)}" title="${liveDone ? "Live API verified — click to inspect telemetry" : "Verify live availability &amp; market benchmark via Discogs API"}" aria-label="Verify live API telemetry">
            ${ICONS.bolt}
          </button>
          <button type="button" class="mute-seller-inline" data-mute-seller="${escapeHtml(sellerClean)}" title="Mute all listings from ${escapeHtml(sellerClean)}" aria-label="Mute seller ${escapeHtml(sellerClean)}">Mute</button>
        </div>
      </div>

      ${wearBannerHtml}

      <div class="card-drawers-slot" data-drawers-for="${escapeHtml(item.id)}">${renderCardDrawersHtml(item)}</div>

      <div class="card-actions">
        <a href="${escapeHtml(sanitizeHttpUrl(item.add_to_cart_url))}" target="_blank" rel="noopener noreferrer" class="btn-action btn-cart" title="${isSold ? "Listing marked sold/removed" : "1-Click Add to Discogs Cart"}">
          ${ICONS.cart}<span>${isSold ? "Sold" : `Cart · ${escapeHtml(item.total_price)}`}</span>
        </a>
        ${
          item.allow_offers
            ? `<button type="button" class="btn-action btn-offer-cta" data-inspect-id="${escapeHtml(item.id)}" title="Open Make-Offer Haggle Desk &amp; Inspector"><span>Offer</span></button>`
            : `<button type="button" class="btn-action btn-inspect-cta" data-inspect-id="${escapeHtml(item.id)}" title="Inspect pressing details, seller notes &amp; target price"><span>Inspect</span></button>`
        }
        <button type="button" class="btn-action btn-audition ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}" title="Audition 30-second studio preview (Space)">
          ${isPlaying ? ICONS.stop : ICONS.play}<span>${isPlaying ? "Stop" : "30s"}</span>
        </button>
        <a href="${escapeHtml(sanitizeHttpUrl(item.item_url))}" target="_blank" rel="noopener noreferrer" class="btn-action btn-icon-only" title="Open Discogs Listing #${escapeHtml(item.id)}" aria-label="Open Discogs Listing #${escapeHtml(item.id)}">
          ${ICONS.ext}
        </a>
      </div>
    </article>
  `;
}

function renderMatrixTapeTable(filtered) {
  const rows = filtered
    .map((item) => {
      const artistClean = decodeHtmlEntities(item.artist);
      const albumClean = decodeHtmlEntities(getDisplayAlbumTitle(item));
      const waxClean = decodeHtmlEntities(item.wax_shader?.wax_name || item.variant);
      const sellerClean = decodeHtmlEntities(item.seller_info);
      const verdict = getSnipeVerdictMeta(item);
      const gradeCls = getGradeChipClass(item);
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
      const benchHtml =
        verdict.benchUsd > 0
          ? `<div class="matrix-bench-sub">Mkt ${escapeHtml(formatUsd(verdict.benchUsd))}</div>`
          : "";
      const trajHtml = hasPriceMovement(item.price_trajectory)
        ? renderPriceSparklineSVG(item.price_trajectory, 68, 18)
        : `<span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.68rem;">—</span>`;

      return `
        <tr class="drop-card-row ${isFocused ? "matrix-row-focused" : ""} ${isSold ? "matrix-row-sold" : ""}" data-listing-id="${escapeHtml(item.id)}">
          <td>${statusBadge}</td>
          <td>
            <button type="button" class="drop-album-btn" data-inspect-id="${escapeHtml(item.id)}" style="color:#fff;font-weight:700;">
              ${escapeHtml(artistClean)} — ${escapeHtml(albumClean)}
            </button>
            <div style="font-size:0.69rem;color:var(--text-muted);">${escapeHtml(waxClean)}</div>
          </td>
          <td style="font-family:var(--font-mono);color:var(--neon-lime);font-weight:700;">${escapeHtml(item.total_price)}</td>
          <td>
            <span class="snipe-verdict-pill ${verdict.cls}">${escapeHtml(verdict.label)}</span>
            ${benchHtml}
          </td>
          <td><span class="grade-chip ${gradeCls}">${escapeHtml(item.media_condition)}/${escapeHtml(item.sleeve_condition)}</span></td>
          <td style="font-family:var(--font-mono);">
            <a href="https://www.discogs.com/seller/${encodeURIComponent(sellerClean)}/profile" target="_blank" rel="noopener noreferrer" class="seller-link">${escapeHtml(sellerClean)}</a>
            ${item.seller_bundle_count >= 2 ? `<button type="button" class="tag-pill tag-pill-btn badge-cyan btn-jump-bundle" data-bundle-seller="${escapeHtml(sellerClean)}">${item.seller_bundle_count}x</button>` : ""}
          </td>
          <td>${trajHtml}</td>
          <td>
            <div class="seller-ctrl-group">
              <a href="${escapeHtml(sanitizeHttpUrl(item.add_to_cart_url))}" target="_blank" rel="noopener noreferrer" class="btn-action btn-neon-lime btn-sm">${isSold ? "Sold" : "Cart"}</a>
              <button type="button" class="btn-action btn-sm ${item.allow_offers ? "btn-offer-cta" : "btn-inspect-cta"}" data-inspect-id="${escapeHtml(item.id)}">${item.allow_offers ? "Offer" : "Inspect"}</button>
              <button type="button" class="btn-action btn-audition btn-sm ${isPlaying ? "playing" : ""}" data-audition-id="${escapeHtml(item.id)}">${isPlaying ? "Stop" : "30s"}</button>
              <a href="${escapeHtml(sanitizeHttpUrl(item.item_url))}" target="_blank" rel="noopener noreferrer" class="btn-action btn-icon-only btn-sm" title="Open Discogs Listing #${escapeHtml(item.id)}" aria-label="Open Discogs Listing">${ICONS.ext}</a>
              <button type="button" class="btn-triage-dismiss btn-triage-dismiss-inline" data-dismiss-id="${escapeHtml(item.id)}" aria-label="Skip listing" title="Skip listing (X)">×</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div class="matrix-tape-wrap machined-plinth">
      <table class="data-table">
        <thead>
          <tr>
            <th>Vault</th>
            <th>Release &amp; Pressing</th>
            <th>Shipped</th>
            <th>Verdict / Mkt</th>
            <th>Grade</th>
            <th>Seller</th>
            <th>Trend</th>
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
  const escId = CSS.escape(String(listingId));

  const slot = document.querySelector(`.card-drawers-slot[data-drawers-for="${escId}"]`);
  if (slot) slot.innerHTML = renderCardDrawersHtml(item);

  const priceBar = document.querySelector(`.snipe-price-bar[data-price-bar="${escId}"]`);
  if (priceBar) {
    const verdictEl = priceBar.querySelector(".snipe-price-verdict");
    if (verdictEl) verdictEl.innerHTML = renderSnipeVerdictHtml(item);
  }

  const alphaSlot = document.querySelector(`[data-alpha-slot="${escId}"]`);
  if (alphaSlot) alphaSlot.innerHTML = renderStageAlphaPill(item);

  const stageTl = document.querySelector(`[data-stage-tl="${escId}"]`);
  if (stageTl) stageTl.innerHTML = renderStageVaultPills(item);

  const isSold = isListingSold(item);
  const live = appState.liveApiResults[listingId];
  const liveDone = Boolean(live && !live.loading && !live.error);

  const cardEl = document.querySelector(`.drop-card[data-listing-id="${escId}"]`);
  if (cardEl) {
    cardEl.classList.toggle("card-sold", isSold);
    const cartSpan = cardEl.querySelector(".btn-cart span");
    if (cartSpan) cartSpan.textContent = isSold ? "Sold" : `Cart · ${item.total_price}`;
    const apiIconBtn = cardEl.querySelector(`.seller-icon-btn[data-live-api-id="${escId}"]`);
    if (apiIconBtn) apiIconBtn.classList.toggle("is-verified", liveDone);
    if (flash) {
      cardEl.classList.remove("api-hydrated-flash");
      void cardEl.offsetWidth;
      cardEl.classList.add("api-hydrated-flash");
    }
  }

  const rowEl = document.querySelector(`.drop-card-row[data-listing-id="${escId}"]`);
  if (rowEl) {
    rowEl.classList.toggle("matrix-row-sold", isSold);
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
  document.querySelectorAll(".drop-card-row").forEach((row) => {
    const lid = row.dataset.listingId;
    const isPlaying = appState.currentlyPlayingId === lid;
    const btn = row.querySelector(".btn-audition");
    if (btn) {
      btn.classList.toggle("playing", isPlaying);
      btn.textContent = isPlaying ? "Stop" : "30s";
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
  const activeChipsEl = document.getElementById("radar-active-chips");
  const dismissedBar = document.getElementById("radar-dismissed-bar");
  const mutedBar = document.getElementById("radar-muted-sellers-bar");
  const quickResetBtn = document.getElementById("btn-quick-reset-filters");
  if (!grid) return;

  const filtered = getFilteredListings();
  renderTopKPIs(filtered.length);
  syncFiltersDrawerUI();

  if (quickResetBtn) quickResetBtn.hidden = !hasActiveFilters();
  if (summaryEl) {
    const liveCount = filtered.filter((x) => x.is_live_page1).length;
    if (appState.scopeMode === "LIVE_P1") {
      summaryEl.textContent = `${filtered.length} live P1 drop${filtered.length === 1 ? "" : "s"}`;
    } else if (appState.dedupEnabled) {
      summaryEl.textContent = `${filtered.length} drop${filtered.length === 1 ? "" : "s"}${liveCount > 0 ? ` · ${liveCount} live` : ""}`;
    } else {
      summaryEl.textContent = `${filtered.length} raw listing${filtered.length === 1 ? "" : "s"}${liveCount > 0 ? ` · ${liveCount} live` : ""}`;
    }
  }

  if (activeChipsEl) {
    const advChips = getActiveAdvancedFilterConstraints();
    if (advChips.length > 0) {
      activeChipsEl.hidden = false;
      activeChipsEl.innerHTML = advChips
        .map(
          (c) =>
            `<button type="button" class="snipe-active-chip" data-clear-adv="${escapeHtml(c.key)}" title="Clear ${escapeHtml(c.label)}">${escapeHtml(c.label)} ×</button>`
        )
        .join("");
    } else {
      activeChipsEl.innerHTML = "";
      activeChipsEl.hidden = true;
    }
  }

  if (dismissedBar) {
    const skipCount = appState.dismissedListingIds.size;
    if (skipCount > 0) {
      dismissedBar.hidden = false;
      dismissedBar.innerHTML = `<button type="button" class="snipe-restore-btn" data-restore-dismissed="all" title="Restore all skipped listings">Skipped (${skipCount}) · Restore</button>`;
    } else {
      dismissedBar.innerHTML = "";
      dismissedBar.hidden = true;
    }
  }

  if (mutedBar) {
    if (appState.mutedSellers.size > 0) {
      const names = Array.from(appState.mutedSellers).join(", ");
      mutedBar.hidden = false;
      mutedBar.innerHTML = `Muted: <strong style="color:var(--neon-crimson);">${escapeHtml(names)}</strong> <button type="button" id="btn-clear-muted" class="mute-seller-inline" data-clear-muted="all" style="margin-left:6px;">Unmute All</button>`;
    } else {
      mutedBar.innerHTML = "";
      mutedBar.hidden = true;
    }
  }

  grid.classList.toggle("layout-matrix", appState.radarLayout === "matrix");

  if (filtered.length === 0) {
    const skipCount = appState.dismissedListingIds.size;
    grid.innerHTML = `
      <div class="panel-card" style="grid-column: 1 / -1; text-align: center; padding: 48px 20px;">
        <h3 style="font-family: var(--font-display); font-size: 1.12rem; margin-bottom: 8px; color: #fff;">No Wantlist Drops Match Current Filters</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Reset filters, widen your price ceiling, or restore skipped listings.</p>
        <div style="display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="btn-action btn-neon-cyan" id="btn-reset-all-filters">Reset All Filters</button>
          ${skipCount > 0 ? `<button type="button" class="btn-action" data-restore-dismissed="all">Restore Skipped (${skipCount})</button>` : ""}
        </div>
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
      <div class="crate-sleeve-card holo-sleeve ${offset === 0 ? "is-active" : ""} ${isFoil ? "is-foil" : ""}"
           data-crate-pos="${i}"
           style="z-index:${zIndex};opacity:${opacity};transform:translate(-50%, -50%) translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${scale});">
        <img class="crate-sleeve-art" src="${escapeHtml(cover)}" data-fallback-src="${escapeHtml(fallback)}" alt="${escapeHtml(decodeHtmlEntities(item.title))}" />
        <div class="crate-sleeve-footer">
          <div class="crate-sleeve-title">${escapeHtml(decodeHtmlEntities(item.artist))} — ${escapeHtml(decodeHtmlEntities(getDisplayAlbumTitle(item)))}</div>
          <div class="crate-sleeve-sub">
            <span>${escapeHtml(item.total_price)}</span>
            <span style="color:var(--quartz-cyan, var(--neon-cyan));">${escapeHtml(item.media_condition)}/${escapeHtml(item.sleeve_condition)}</span>
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
