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
        SNIPER_STATE = normalizeSniperStateEntities(remoteState);
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
