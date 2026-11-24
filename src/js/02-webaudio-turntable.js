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
  const cTop = isTube ? "#f59e0b" : "#c026d3";
  const cBot = isTube ? "#10b981" : "#22d3ee";
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

  const trackTitleText = `${decodeHtmlEntities(previewInfo.artistName || item.artist)} — "${decodeHtmlEntities(previewInfo.trackName)}"`;
  if (titleEl) titleEl.textContent = trackTitleText;
  if (subEl) subEl.textContent = `${previewInfo.source} // ${decodeHtmlEntities(item.wax_shader?.wax_name || item.variant)} (${item.total_price})`;
  const deckTrackEl = document.getElementById("deck-now-track");
  if (deckTrackEl) deckTrackEl.textContent = `▶ ${decodeHtmlEntities(previewInfo.trackName)} (${previewInfo.source})`;

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
