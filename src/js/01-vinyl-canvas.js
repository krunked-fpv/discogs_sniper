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
  const cleanArtist = decodeHtmlEntities(artist || "D");
  const cleanAlbum = decodeHtmlEntities(album || "S");
  const initials = `${cleanArtist[0] || "D"}${cleanAlbum[0] || "S"}`.toUpperCase();
  const accent = primaryColor && primaryColor !== "#181a1f" ? primaryColor : "#22d3ee";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#111524"/>
        <stop offset="100%" stop-color="#05060b"/>
      </linearGradient>
    </defs>
    <rect width="160" height="160" fill="url(#g)"/>
    <circle cx="80" cy="80" r="56" fill="none" stroke="${accent}" stroke-opacity="0.34" stroke-width="1.5"/>
    <circle cx="80" cy="80" r="38" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="1"/>
    <text x="80" y="89" text-anchor="middle" fill="${accent}" font-family="Space Grotesk, Inter, sans-serif" font-weight="700" font-size="28" letter-spacing="3">${escapeHtml(initials)}</text>
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
