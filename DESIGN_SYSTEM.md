# Design System — Krunked Vinyl Suite (`discogs_sniper` ↔ `discogs_collection`)

> **Authoritative Visual Reference:** [`krunked-fpv/discogs_collection`](https://krunked-fpv.github.io/discogs_collection/) (v6.0, commit `72e9d3c`)
> **Applied To:** [`krunked-fpv/discogs_sniper`](https://krunked-fpv.github.io/discogs_sniper/) (v3.0 Tactical Wantlist Command Center)

Both applications belong to one cohesive hardware-inspired audiophile suite. A user switching between **KRUNKED // VINYL VAULT** (`discogs_collection`) and **KRUNKED // DISCOGS SNIPER** (`discogs_sniper`) should feel like moving across adjacent modules on the same brushed-anodized dark studio rack.

---

## 1. Color Palette & CSS Custom Properties

### 1.1 Core Studio Obsidian Palette (Default Mode)

Extracted directly from `discogs_collection`'s `src/styles.css` and `css/vault.css`, mapped cleanly onto Sniper's modular CSS tokens (`src/styles/01-tokens-chassis.css`):

| Role | Vault Token (`discogs_collection`) | Exact Value | Usage |
| :--- | :--- | :--- | :--- |
| **Deep Void / Base Canvas** | `--bg-obsidian` | `#05060b` | Page root background, deep recessed terminals, `<meta name="theme-color" content="#06070b">` |
| **Stage Gradient Backdrop** | `.ambient-stage-bg` | `linear-gradient(180deg, #05070d 0%, #090c15 52%, #040509 100%)` | Full-viewport ambient backdrop beneath 3 dynamic wax radial glows |
| **Machined Panel / Plinth** | `--bg-panel` / `--chassis-metal` | `#0b0e16` / `linear-gradient(180deg, rgba(22, 27, 42, 0.94) 0%, rgba(10, 13, 22, 0.97) 100%)` | Hero decks, toolbars, modal shells, analytics panels |
| **Recessed Hardware Bay** | `--chassis-recess` | `linear-gradient(180deg, rgba(5, 7, 12, 0.96) 0%, rgba(11, 14, 23, 0.92) 100%)` | Recessed display wells, inner spec boxes, turntable/crate stages |
| **Elevated Card Surface** | `--bg-card` | `#111524` (usually `rgba(17, 21, 36, 0.95)`) | Record/drop cards, modal inner sections |
| **Sticky Glass Header** | `bg-slate-950/88` | `rgba(2, 6, 23, 0.88)` + `backdrop-filter: blur(24px)` | Top navigation bar |
| **Popover / Dropdown Fill** | `#vault-tools-popover` | `#090c15` | Overflow tools popovers, compact code blocks (`#06070b`) |
| **Primary Text** | `text-slate-100` / `#ffffff` | `#f8fafc` / `#ffffff` | Headings, prices, active labels |
| **Secondary Text** | `text-slate-300` | `#cbd5e1` | Body descriptions, idle nav tabs |
| **Muted / Technical Label** | `text-slate-400` / `slate-500` | `#94a3b8` / `#64748b` | Uppercase mono micro-labels, metadata, placeholders |
| **Hairline Border** | `border-white/10` .. `/15` | `rgba(255, 255, 255, 0.10)` – `0.15` | Default cards, panels, dividers, inputs |
| **Top Hardware Bevel** | `--bevel-top` | `inset 0 1px 0 rgba(255, 255, 255, 0.11)` | Subtle machined aluminum top-edge specular catchlight |
| **Deep Chassis Shadow** | `--bevel-bottom` | `0 16px 40px -12px rgba(0, 0, 0, 0.85)` | Grounding elevation shadow |

### 1.2 Brand & Semantic Hardware Accents

| Semantic Accent | Token | Hex / Value | Meaning & Component Usage |
| :--- | :--- | :--- | :--- |
| **Quartz Cyan** | `--quartz-cyan` | `#22d3ee` (accent family `#06b6d4` – `#67e8f9`) | Primary interactive focus, quartz-lock LEDs, plinth brackets, links, active ring |
| **Brand Fuchsia -> Violet -> Cyan** | `.nav-tab-active` | `linear-gradient(90deg, #c026d3 0%, #7c3aed 48%, #06b6d4 100%)` | Active nav tabs, brand tile border, primary CTA buttons |
| **UV Violet** | `--uv-violet` | `#a855f7` (`#8b2cf5` glow) | UV 395nm mode, Variant Hunter / colored wax badges, numbered pressings |
| **Mint Lock (Emerald)** | `--mint-lock` | `#10b981` (text `#34d399` / `#6ee7b7`) | Verified steals, 1-Click Add-to-Cart, synced/online LEDs, bundle savings, Vault valuation |
| **Strobe Amber** | `--strobe-amber` | `#f59e0b` (text `#fbbf24` / `#fcd34d`) | Relist warnings, price drops, Make-Offer Haggle Desk, queued states |
| **Signal Rose / Crimson** | `--signal-rose` | `#f43f5e` (play CTA `#e11d48`) | Audio play/playing indicators, jacket-wear warnings, already-owned overlap alerts, sold status |

### 1.3 Dynamic Wax Ambient Glows

Every time the user hovers, selects, or auditions a pressing, the ambient stage radials update smoothly (`transition: background 0.65s cubic-bezier(0.22, 1, 0.36, 1)`):
- `--glow-primary`: default `rgba(139, 44, 245, 0.28)` -> dynamic `${wax.primary}44`
- `--glow-secondary`: default `rgba(6, 182, 212, 0.24)` -> dynamic `${wax.secondary}40`
- `--glow-accent`: default `rgba(244, 63, 94, 0.18)` -> dynamic `${wax.accent}33`

### 1.4 Lighting & Theme Profiles (Hotkey `U`)

1. **Studio Obsidian (Default in Sniper / Daylight Toggle in Vault):**
   - Clean obsidian `#05060b` base with subtle multi-point wax ambient glow and crisp `rgba(255,255,255,0.12)` aluminum borders.
2. **UV 395nm Blacklight (`body.uv-blacklight` / `body.mode-uv`):**
   - Deep ultraviolet floor: `background-color: #030108`, radials `rgba(168, 85, 247, 0.36)`, `rgba(6, 182, 212, 0.30)`, `rgba(236, 72, 153, 0.22)` over `linear-gradient(180deg, #020006 0%, #060212 52%, #020005 100%)`.
   - Reactive vinyl discs (`.uv-reactive`): `filter: saturate(1.45) contrast(1.1) drop-shadow(0 0 18px var(--glow-primary)) drop-shadow(0 0 28px var(--glow-secondary))`.
   - Card elevation borders shift to `rgba(168, 85, 247, 0.34)` with `0 10px 30px -10px rgba(139, 44, 245, 0.32)` underglow; plinth border shifts to `rgba(168, 85, 247, 0.65)`.
3. **Vacuum Tube Amp (`body.mode-tube` — Sniper Optional 3rd Cycle Profile):**
   - Warm dark walnut/carbon (`#090806` -> `#120f0b`), warm amber phosphor accents (`#ffb020` / `#ff6b35`) and emerald VU glow (`#19f08a`), disabling neon wax chroma shifts.

---

## 2. Anodized Hardware Surface Idioms

```css
/* Brushed dark anodized aluminum chassis */
.machined-plinth {
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.012) 0px, rgba(255, 255, 255, 0.012) 1px, transparent 1px, transparent 3px),
    var(--chassis-metal);
  box-shadow: var(--bevel-top), var(--bevel-bottom);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

/* Recessed instrument display panel */
.anodized-panel {
  background: var(--chassis-recess);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

/* Holographic album sleeve diagonal sheen */
.holo-sleeve::after {
  background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.15) 46%, rgba(34,211,238,0.22) 50%, rgba(236,72,153,0.18) 54%, transparent 65%);
  transform: translateX(-85%) rotate(12deg);
  transition: transform 0.75s ease;
}
.holo-sleeve:hover::after { transform: translateX(85%) rotate(12deg); }
```

- **Plinth Cyan Edge Brackets (`.plinth-edge-bracket-left/right`):** `6px × 156px` vertical rounded edge glow strips (`#22d3ee` -> `#67e8f9`) framing direct-drive turntable stages.
- **Hardware Status LEDs (`.hardware-led`):** `8px` circles with colored radial halos (`.is-on` cyan `#22d3ee`, `.is-amber` `#f59e0b`, `.is-rose` `#f43f5e`, emerald `#34d399` live pulse).

---

## 3. Typography, Spacing & Layout Rhythm

### 3.1 Authoritative Google Fonts Link (1:1 Parity with `discogs_collection`)
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&amp;family=JetBrains+Mono:wght@400;500;600;700;800&amp;family=Space+Grotesk:wght@600;700&amp;display=swap" rel="stylesheet" />
```

### 3.2 Font Stack & Type Hierarchy
- **Body / UI (`--font-sans`):** `'Inter', -apple-system, BlinkMacSystemFont, sans-serif` (`letter-spacing: -0.01em`, antialiased).
- **Display / Section & Brand Headings (`--font-display`):** `'Space Grotesk', 'Inter', sans-serif` (`font-weight: 700`–`800`).
- **Telemetry / Prices / Badges / IDs (`--font-mono`):** `'JetBrains Mono', ui-monospace, monospace` with `font-variant-numeric: tabular-nums`.
- **Sizing Ladder:**
  - Brand wordmark: `16px–18px` (`1rem–1.125rem`), `font-weight: 800–900`, tight tracking (`-0.02em`).
  - Hero / Section title: `20px–24px` (`1.25rem–1.5rem`), `Space Grotesk` bold.
  - Card title: `14px–15px` (`0.875rem–0.94rem`), `font-weight: 800`, 1–2 line clamp.
  - Telemetry KPI values: `22px–28px`, bold tabular mono/display.
  - Micro-labels, pills & badges: `10px–11px` (`0.625rem–0.69rem`), uppercase `JetBrains Mono`, tracking `+0.05em` to `+0.08em`.

### 3.3 Radius, Container, Breakpoints & Scrollbars
- **Radius Scale:**
  - `24px` (`rounded-3xl`): Hero plinths, filter toolbars, modal dialogs.
  - `16px` (`rounded-2xl`): Drop/record cards, recessed sub-panels, inputs, selects, toast banners.
  - `12px` (`rounded-xl`): Nav rail container, header action pills, brand icon tile, secondary buttons.
  - `8px` (`rounded-lg`): Active nav tab segments, compact inline badges.
  - `9999px` (`rounded-full`): Filter chips, status pills, LED indicators, sliders.
- **Containers & Header:** Sticky header `~58px` height (`--vault-header-h`), `backdrop-filter: blur(20px)`, max container width `1280px–1440px` (`max-w-7xl` / `1440px` for dense tactical tables).
- **Breakpoints:** `640px` (`sm`), `768px` (`md`), `1024px` (`lg`), `1280px` (`xl`), `1536px` (`2xl`). Card grids scale `1 -> 2 -> 3 -> 4` columns.
- **Slim Scrollbars:** `7px` width/height, track `#070a12`, thumb `#1e293b` (9999px radius), hover `#22d3ee`.

---

## 4. Component Idioms

### 4.1 Top Navigation Bar & Cross-App Suite Link
- **Brand Tile:** `36×36px` rounded-xl gradient frame (`from-fuchsia-600 via-purple-600 to-cyan-500`, `2px` padding) around `#020617` inner badge + pulsing emerald sync dot + `KRUNKED // DISCOGS SNIPER` wordmark.
- **Segmented Pill Navigation Rail:** Dark pill tray (`rgba(15, 23, 42, 0.90)`, `4px` padding, `12px` radius, `border-white/10`). Active tab uses `.nav-tab-active` gradient (`#c026d3 -> #7c3aed -> #06b6d4`, white bold text, violet elevation shadow + top inset specular highlight).
- **Utility Cluster:** `⌘K` Command Palette pill, Lighting Mode toggle (`U`), live Hydrator/API status pill, and direct **Vinyl Vault ↗** cross-link (`https://krunked-fpv.github.io/discogs_collection/`).

### 4.2 KPI Telemetry Ribbon
- Compact high-signal strip directly beneath header using anodized dark cards (`#0b0e16` / `--chassis-recess`, `16px` radius, `1px solid rgba(255,255,255,0.10)`, subtle 2px top accent hairline in cyan/emerald/amber/fuchsia/violet). Clickable cards act as quick-jump view filters.

### 4.3 Search & Filter Chip Console
- Enclosed inside `.machined-plinth` (`24px` radius).
- Search input: recessed `#020617` (`bg-slate-950/90`), `16px` radius, `border-white/15`, focus border `#22d3ee` with cyan focus ring.
- Horizontal filter chips (`.filter-chip`): `rounded-full`, `12px` bold; active chip uses `linear-gradient(90deg, #c026d3, #0891b2)` white text; idle chip uses `rgba(2, 6, 23, 0.80)`, `slate-300`, `border-white/10`.

### 4.4 Record / Drop Cards & Tactile Vinyl Platter Peek Physics
- Card shell (`.card-record` / `.drop-card`): `background: rgba(17, 21, 36, 0.95)`, `border: 1px solid rgba(255, 255, 255, 0.10)`, `border-radius: 16px`, `content-visibility: auto`, hover `translateY(-4px)` + `border-color: rgba(6, 182, 212, 0.45)`.
- **Sleeve-Peek Stage (`.sleeve-peek-stage`):**
  - Background: `radial-gradient(circle at 64% 50%, var(--card-wax-glow), transparent 62%), linear-gradient(180deg, rgba(15, 20, 35, 0.94), #070910)`.
  - Square album jacket (`.sleeve-peek-jacket`, `z-index: 20`, `border-radius: 10px`) with subtle 2px left spine highlight (`::before`) and `.holo-sleeve` hover sheen.
  - Overlapping colored vinyl disc peeking right (`.sleeve-peek-disc`, `z-index: 10`, negative left margin overlapping jacket by ~45%).
  - **Hover Physics:** Jacket tilts `transform: translateX(-7px) rotate(-1.6deg)` while the vinyl disc slides out and rotates `transform: translateX(26px) rotate(36deg)` over `0.38s cubic-bezier(0.22, 1, 0.36, 1)`.

### 4.5 Audio Preview Dock & Turntable Transport
- **Zero Autoplay:** Audio plays strictly on explicit user gesture (card preview button, `Space`, or tonearm drop).
- **Audio Sources:** iTunes Search API with automatic Deezer JSONP fallback; 30-second previews piped through Web Audio DSP (`AnalyserNode` FFT visualizer, `preservesPitch = false` RPM/pitch control, synthesized vinyl crackle).
- **Visual Treatment:** Fixed bottom glass dock (`rgba(6, 9, 17, 0.92)`, `backdrop-filter: blur(18px)`, cyan/violet top border), `.audiophile-slider` seek track (`#f8fafc -> #22d3ee` thumb), animated `.eq-bar-1/2/3` equalizer bars, rose `#e11d48` / cyan transport buttons, and 1-Click Add-to-Cart action.

### 4.6 Modals, Command Palette & Toasts
- **Backdrop:** `backdrop-filter: blur(12px); background: rgba(3, 5, 10, 0.78);`.
- **Modal Shell:** `.machined-plinth`, `border-radius: 24px`, `border: 1px solid rgba(34, 211, 238, 0.35)`, max height `90–94vh` with slim internal scroll.
- **Command Palette (`Ctrl/Cmd + K`):** Active item highlight `linear-gradient(90deg, rgba(34, 211, 238, 0.18), rgba(168, 85, 247, 0.16))` with `rgba(34, 211, 238, 0.55)` border.
- **Toast Notifications:** Fixed bottom-right, `rounded-2xl`, `background: rgba(15, 23, 42, 0.95)`, `border-cyan-400/50` (semantic variants in emerald/amber/rose), `JetBrains Mono` `12px` bold, `toastSlideUp` `0.2s` entrance, `3400–3600ms` auto-dismiss.

---

## 5. Accessibility, Motion & Persistence Rules

- **Reduced Motion:** Honor `@media (prefers-reduced-motion: reduce)` by disabling turntable transitions, pulse loops, and slide animations.
- **Keyboard First:** Maintain visible focus rings (`#22d3ee`) on all interactive controls, semantic `role="dialog" aria-modal="true"` on modals, `aria-pressed` on mode toggles, and `Escape` dismissal for all popovers/modals.
- **Shadow-Cookie Security Boundary:** Any integration with `discogs_collection`'s `krunked-cookie-vault-v1` auto-healer MUST keep `krunked_discogs_token`, `krunked_sniper_github_pat_v3`, and any `*pat*` / `*token*` / `*auth*` keys strictly excluded from cookie mirroring so credentials never leave browser `localStorage`.
