// Organisation branding: colour palette and background pictures, chosen by the admin in Settings.
// Stored in settings.theme as { palette, accent, out_image, app_image, app_strength }.

export const PALETTES = {
  teal: { name: 'Teal', accent: '#146c5f' },
  ocean: { name: 'Ocean blue', accent: '#1d5fa8' },
  navy: { name: 'Government navy', accent: '#1f3a68' },
  forest: { name: 'Forest green', accent: '#2f6b2f' },
  purple: { name: 'Royal purple', accent: '#5b3fa0' },
  berry: { name: 'Berry', accent: '#a3244f' },
  sunset: { name: 'Sunset orange', accent: '#b4531d' },
  charcoal: { name: 'Charcoal', accent: '#3a4550' },
};

export const DEFAULT_THEME = { palette: 'teal', accent: PALETTES.teal.accent, out_image: 'builtin:desk', app_image: '', app_strength: 15 };

export const themeOf = (settings) => ({ ...DEFAULT_THEME, ...(settings?.theme || {}) });

// ---- colour maths (sRGB hex) ----
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = [255, 255, 255];
const LIGHT_BG = [255, 255, 255];
const DARK_BG = [27, 34, 32];

// Makes the chosen colour readable on white (light mode) and on the dark surface (dark mode).
export function paletteVars(accentHex) {
  let light = hex(accentHex) || hex(DEFAULT_THEME.accent);
  for (let i = 0; i < 12 && contrast(light, LIGHT_BG) < 4.5; i++) light = mix(light, [0, 0, 0], 0.12);
  let dark = mix(light, WHITE, 0.45);
  for (let i = 0; i < 12 && contrast(dark, DARK_BG) < 5; i++) dark = mix(dark, WHITE, 0.15);
  return {
    '--brand': toHex(light),
    '--brand-text': contrast(light, WHITE) >= 4.5 ? '#ffffff' : '#10201c',
    '--brand-soft': toHex(mix(light, WHITE, 0.86)),
    '--brand-dark': toHex(dark),
    '--brand-dark-text': '#0d1a17',
    '--brand-dark-soft': toHex(mix(dark, DARK_BG, 0.78)),
  };
}

// Applies the theme to the page and remembers it so the sign-in page matches next time.
export function applyTheme(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(paletteVars(t.accent))) root.style.setProperty(k, v);
  if (t.app_image && !t.app_image.startsWith('builtin:')) {
    root.style.setProperty('--app-image', `url("${t.app_image.replace(/"/g, '%22')}")`);
    root.style.setProperty('--app-strength', String(Math.max(0, Math.min(60, Number(t.app_strength) || 15)) / 100));
    root.classList.add('has-app-image');
  } else {
    root.classList.remove('has-app-image');
    root.style.removeProperty('--app-image');
  }
  try { localStorage.setItem('leave-theme', JSON.stringify({ accent: t.accent, app_image: t.app_image, app_strength: t.app_strength })); } catch { /* storage blocked */ }
}

export function applyCachedTheme() {
  try { const t = JSON.parse(localStorage.getItem('leave-theme')); if (t) applyTheme(t); } catch { /* none saved */ }
}

// Shrinks a photo in the browser before upload so pages stay fast (max 1600px wide, JPEG).
export async function shrinkImage(file, maxWidth = 1600) {
  if (!/^image\//.test(file.type)) throw new Error('Please choose a picture (JPG, PNG or WebP).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture could not be opened. Try a JPG or PNG.')); i.src = url; });
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
}

// Built-in "empty desk and chair" illustration for the Who's out today card.
// Drawn with the theme colours so it matches the chosen palette in light and dark mode.
export const DESK_SVG = `<svg class="scene" viewBox="0 0 600 180" preserveAspectRatio="xMidYMax slice" role="img" aria-label="An empty office desk and chair">
  <rect width="600" height="180" fill="var(--scene-wall)"/>
  <rect x="0" y="146" width="600" height="34" fill="var(--scene-floor)"/>
  <g transform="translate(58 24)">
    <rect width="120" height="84" rx="4" fill="var(--scene-window)"/>
    <path d="M60 0v84M0 42h120" stroke="var(--scene-wall)" stroke-width="6"/>
    <rect x="-6" y="84" width="132" height="6" rx="2" fill="var(--scene-line)"/>
  </g>
  <g transform="translate(470 38)" fill="var(--scene-line)">
    <rect x="0" y="0" width="44" height="30" rx="3" fill="var(--scene-paper)"/>
    <path d="M8 10h28M8 17h20" stroke="var(--scene-line)" stroke-width="3" stroke-linecap="round"/>
    <text x="22" y="48" text-anchor="middle" font-size="11" font-family="system-ui,sans-serif" fill="var(--scene-line)">OUT</text>
  </g>
  <g transform="translate(250 70)">
    <rect x="0" y="40" width="210" height="10" rx="3" fill="var(--scene-desk)"/>
    <rect x="10" y="50" width="8" height="26" fill="var(--scene-desk-dark)"/>
    <rect x="192" y="50" width="8" height="26" fill="var(--scene-desk-dark)"/>
    <rect x="140" y="50" width="52" height="26" rx="2" fill="var(--scene-desk-dark)"/>
    <rect x="152" y="58" width="28" height="3" rx="1.5" fill="var(--scene-desk)"/>
    <rect x="70" y="0" width="64" height="40" rx="3" fill="var(--scene-screen)"/>
    <rect x="96" y="40" width="12" height="4" fill="var(--scene-screen)"/>
    <rect x="30" y="30" width="16" height="10" rx="2" fill="var(--scene-paper)"/>
    <path d="M46 33c6 0 6 6 0 6" stroke="var(--scene-paper)" stroke-width="2.5" fill="none"/>
    <path d="M178 40c0-14 4-24 10-30M186 40c0-10 6-18 14-22M182 40c0-8-4-16-10-20" stroke="var(--brand-plant)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="174" y="30" width="18" height="12" rx="2" fill="var(--scene-desk-dark)"/>
  </g>
  <g transform="translate(192 72)">
    <rect x="0" y="0" width="44" height="46" rx="10" fill="var(--accent)"/>
    <rect x="-4" y="44" width="54" height="10" rx="5" fill="var(--accent)"/>
    <rect x="21" y="54" width="6" height="16" fill="var(--scene-line)"/>
    <path d="M4 76h40M24 70v6" stroke="var(--scene-line)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="6" cy="78" r="3" fill="var(--scene-line)"/><circle cx="42" cy="78" r="3" fill="var(--scene-line)"/>
  </g>
</svg>`;
