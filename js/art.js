// © 2026 Mduduzi Gwija. All rights reserved. Proprietary: see LICENSE. Unauthorised copying or use is prohibited.
// Page illustrations. Flat drawings coloured by the theme tokens, so they follow the admin's
// palette and dark mode. The admin can replace any of them with a photo (Settings → Appearance).
const S = (body, label) => `<svg viewBox="0 0 200 120" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
const soft = 'var(--accent-soft)';
const acc = 'var(--accent)';
const line = 'var(--scene-line)';
const paper = 'var(--scene-paper)';
const warm = '#e3a93b';

export const ART = {
  dashboard: S(`
    <circle cx="150" cy="40" r="22" fill="${warm}" opacity=".85"/>
    <path d="M150 8v8M150 64v8M118 40h8M174 40h8M128 18l6 6M166 56l6 6M172 18l-6 6M134 56l-6 6" stroke="${warm}" stroke-width="3" stroke-linecap="round"/>
    <rect x="20" y="100" width="170" height="6" rx="3" fill="${line}" opacity=".5"/>
    <path d="M48 64h40v26a10 10 0 0 1-10 10H58a10 10 0 0 1-10-10z" fill="${acc}"/>
    <path d="M88 70c12 0 12 18 0 18" stroke="${acc}" stroke-width="5" fill="none"/>
    <path d="M60 56c-4-6 4-10 0-16M72 56c-4-6 4-10 0-16" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>
    <rect x="112" y="80" width="20" height="20" rx="3" fill="${line}" opacity=".7"/>
    <path d="M122 80c0-14 4-22 12-28M122 80c0-10-6-18-14-22M122 80c0-12 0-20 2-30" stroke="var(--brand-plant)" stroke-width="4" fill="none" stroke-linecap="round"/>`, 'Morning coffee and a plant'),

  calendar: S(`
    <rect x="46" y="18" width="110" height="92" rx="8" fill="${paper}" stroke="${line}" stroke-width="2"/>
    <rect x="46" y="18" width="110" height="24" rx="8" fill="${acc}"/><rect x="46" y="32" width="110" height="10" fill="${acc}"/>
    <path d="M70 12v14M132 12v14" stroke="${line}" stroke-width="5" stroke-linecap="round"/>
    ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect x="${56 + c * 19}" y="${50 + r * 14}" width="13" height="9" rx="2" fill="${(r === 1 && c > 0 && c < 4) ? acc : (r === 2 && c === 3) ? warm : soft}"/>`).join('')).join('')}`, 'A wall calendar with leave days marked'),

  apply: S(`
    <circle cx="160" cy="30" r="16" fill="${warm}" opacity=".85"/>
    <path d="M10 104c40-10 140-10 180 0v8H10z" fill="${warm}" opacity=".35"/>
    <path d="M44 104V48" stroke="${line}" stroke-width="4"/>
    <path d="M44 50c-4-18-24-24-34-18M44 50c2-18 22-26 34-18M44 50c-12-10-12-26-4-34M44 50c10-10 30-6 34 4" stroke="var(--brand-plant)" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="96" y="58" width="64" height="46" rx="7" fill="${acc}"/>
    <path d="M114 58v-8a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v8" stroke="${line}" stroke-width="4" fill="none"/>
    <path d="M110 58v46M146 58v46" stroke="${soft}" stroke-width="4"/>`, 'A suitcase packed for a holiday'),

  mine: S(`
    <path d="M10 106h180" stroke="${warm}" stroke-width="10" opacity=".35" stroke-linecap="round"/>
    <path d="M96 104L112 30" stroke="${line}" stroke-width="4"/>
    <path d="M60 40c20-26 84-26 104 0z" fill="${acc}"/>
    <path d="M82 40c8-18 50-18 60 0" fill="${soft}" opacity=".6"/>
    <path d="M122 104l14-30h34" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M132 84h34l-8 20" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="40" cy="92" r="12" fill="${warm}" opacity=".6"/>`, 'A beach umbrella and deck chair'),

  approvals: S(`
    <rect x="52" y="16" width="84" height="98" rx="8" fill="${paper}" stroke="${line}" stroke-width="2"/>
    <rect x="76" y="10" width="36" height="14" rx="4" fill="${line}"/>
    <path d="M66 46l6 6 12-12M66 72l6 6 12-12" stroke="${acc}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M92 48h32M92 74h32M92 98h24" stroke="${line}" stroke-width="4" stroke-linecap="round" opacity=".5"/>
    <g transform="rotate(-14 160 80)"><rect x="138" y="70" width="46" height="24" rx="4" fill="none" stroke="${acc}" stroke-width="3"/>
    <text x="161" y="87" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="12" fill="${acc}">OK</text></g>`, 'A checklist with an approval stamp'),

  employees: S(`
    <circle cx="100" cy="46" r="18" fill="${acc}"/><path d="M68 108c0-24 14-36 32-36s32 12 32 36z" fill="${acc}"/>
    <circle cx="52" cy="58" r="14" fill="${soft}" stroke="${line}" stroke-width="2"/><path d="M26 108c0-20 12-30 26-30s26 10 26 30z" fill="${soft}" stroke="${line}" stroke-width="2"/>
    <circle cx="148" cy="58" r="14" fill="${soft}" stroke="${line}" stroke-width="2"/><path d="M122 108c0-20 12-30 26-30s26 10 26 30z" fill="${soft}" stroke="${line}" stroke-width="2"/>`, 'A team of people'),

  register: S(`
    <rect x="44" y="14" width="76" height="98" rx="6" fill="${line}" opacity=".85"/>
    ${[0, 1, 2].map((i) => `<rect x="52" y="${22 + i * 30}" width="60" height="24" rx="3" fill="${paper}"/><rect x="72" y="${31 + i * 30}" width="20" height="5" rx="2.5" fill="${acc}"/>`).join('')}
    <rect x="132" y="50" width="42" height="56" rx="4" fill="${acc}"/><rect x="138" y="56" width="30" height="44" rx="2" fill="${soft}"/>
    <path d="M144 66h18M144 76h18M144 86h12" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`, 'A filing cabinet and ledger'),

  transmittals: S(`
    <rect x="60" y="16" width="70" height="64" rx="4" fill="${paper}" stroke="${line}" stroke-width="2" transform="rotate(-8 95 48)"/>
    <rect x="72" y="22" width="70" height="64" rx="4" fill="${paper}" stroke="${line}" stroke-width="2"/>
    <path d="M82 36h50M82 46h50M82 56h34" stroke="${line}" stroke-width="3" stroke-linecap="round" opacity=".5"/>
    <rect x="46" y="58" width="112" height="54" rx="6" fill="${acc}"/>
    <path d="M46 62l56 30 56-30" stroke="${soft}" stroke-width="4" fill="none" stroke-linejoin="round"/>`, 'Forms going into an envelope'),

  templates: S(`
    <rect x="50" y="12" width="78" height="100" rx="6" fill="${paper}" stroke="${line}" stroke-width="2"/>
    <rect x="60" y="24" width="40" height="8" rx="3" fill="${acc}"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="60" y="${42 + i * 12}" width="${i % 2 ? 36 : 56}" height="6" rx="3" fill="${soft}" stroke="${line}" stroke-width=".5"/>`).join('')}
    <g transform="rotate(35 150 70)"><rect x="142" y="20" width="14" height="80" rx="3" fill="${acc}"/><path d="M142 100l7 16 7-16z" fill="${line}"/><rect x="142" y="20" width="14" height="10" rx="2" fill="${warm}"/></g>`, 'A form and a pen'),

  acting: S(`
    <rect x="20" y="100" width="170" height="6" rx="3" fill="${line}" opacity=".5"/>
    <rect x="28" y="66" width="110" height="10" rx="3" fill="${line}" opacity=".85"/><path d="M40 76v24M126 76v24" stroke="${line}" stroke-width="5"/>
    <path d="M52 66l8-18h46l8 18z" fill="${acc}"/>
    <text x="83" y="62" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="10" fill="${paper}">ACTING</text>
    <rect x="150" y="34" width="30" height="36" rx="8" fill="${soft}" stroke="${line}" stroke-width="2"/><rect x="146" y="66" width="38" height="10" rx="4" fill="${acc}"/>
    <path d="M165 76v18M152 100l13-6 13 6" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="160" cy="18" r="10" fill="${warm}" opacity=".85"/><path d="M150 28l-8 8" stroke="${warm}" stroke-width="3" stroke-linecap="round"/>`, 'A desk name plate that says acting, and an empty chair'),

  settings: S(`
    <g transform="translate(78 62)"><circle r="30" fill="${acc}"/>${[0, 45, 90, 135].map((a) => `<rect x="-7" y="-40" width="14" height="80" rx="3" fill="${acc}" transform="rotate(${a})"/>`).join('')}<circle r="13" fill="${paper}"/></g>
    <path d="M130 60c0-22 44-26 50 0 4 16-12 14-14 24-2 12-14 16-24 10-10-6-12-18-12-34z" fill="${paper}" stroke="${line}" stroke-width="2"/>
    <circle cx="146" cy="58" r="5" fill="${warm}"/><circle cx="162" cy="52" r="5" fill="${acc}"/><circle cx="170" cy="66" r="5" fill="var(--brand-plant)"/><circle cx="148" cy="80" r="5" fill="#b3261e" opacity=".8"/>`, 'A gear and a paint palette'),
};

export const ART_NAMES = {
  dashboard: 'Dashboard', calendar: 'Team calendar', apply: 'Apply for leave', mine: 'My leave', approvals: 'Approvals',
  employees: 'Employees', register: 'Leave register', transmittals: 'Transmittal slips', templates: 'Form templates', acting: 'Acting', settings: 'Settings',
};
