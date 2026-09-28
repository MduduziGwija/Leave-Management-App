// Settings → Appearance (admin only): colour palette and background pictures.
import { PALETTES, DESK_SVG, themeOf, applyTheme, shrinkImage } from '../theme.js';
import { ART, ART_NAMES } from '../art.js';
import { esc, $, toast, busy } from '../ui.js';
import { reload } from '../app.js';

// `draft` holds unsaved choices when the form is redrawn (e.g. after "Back to default").
export function renderAppearance(box, ctx, draft = null) {
  const t = { ...(draft || themeOf(ctx.settings)) };
  t.pages = { ...(t.pages || {}) };
  const custom = !Object.values(PALETTES).some((p) => p.accent.toLowerCase() === String(t.accent).toLowerCase());
  const photo = (url) => `style="background-image:url('${esc(url).replace(/'/g, '%27')}')"`;

  box.innerHTML = `
    <form class="card" id="appearance-form">
      <h2>Appearance <small>only you (admin) can change this</small></h2>
      <p class="muted">Match the app to your organisation. Changes show straight away; press Save to keep them for everyone.</p>

      <h3>Colour</h3>
      <div class="swatches" role="radiogroup" aria-label="Colour palette">
        ${Object.entries(PALETTES).map(([key, p]) => `<label class="swatch"><input type="radio" name="palette" value="${key}" ${!custom && p.accent.toLowerCase() === String(t.accent).toLowerCase() ? 'checked' : ''}>
          <span class="dot" style="background:${p.accent}"></span>${esc(p.name)}</label>`).join('')}
        <label class="swatch"><input type="radio" name="palette" value="custom" ${custom ? 'checked' : ''}>
          <span class="dot" id="custom-dot" style="background:${esc(t.accent)}"></span>Your own colour</label>
      </div>
      <p class="actions"><label>Your own colour <input type="color" id="accent" value="${esc(t.accent)}"></label>
        <span class="muted">Pick your organisation's main colour. It is adjusted automatically so text stays readable in light and dark mode.</span></p>

      <h3>Picture on "Who's out today"</h3>
      <div class="pic-choices" role="radiogroup" aria-label="Who's out today picture">
        <label class="pic-choice"><input type="radio" name="out_image" value="builtin:desk" ${t.out_image === 'builtin:desk' ? 'checked' : ''}>
          <span class="thumb">${DESK_SVG}</span><span class="cap">Empty desk and chair</span></label>
        <label class="pic-choice"><input type="radio" name="out_image" value="" ${!t.out_image ? 'checked' : ''}>
          <span class="thumb">No picture</span><span class="cap">None</span></label>
        <label class="pic-choice" id="out-own" ${t.out_image && !t.out_image.startsWith('builtin:') ? '' : 'hidden'}><input type="radio" name="out_image" value="${t.out_image && !t.out_image.startsWith('builtin:') ? esc(t.out_image) : ''}" ${t.out_image && !t.out_image.startsWith('builtin:') ? 'checked' : ''}>
          <span class="thumb" ${t.out_image && !t.out_image.startsWith('builtin:') ? photo(t.out_image) : ''}></span><span class="cap">Your photo</span></label>
      </div>
      <p class="actions"><label class="btn file-btn">Upload a photo<input type="file" accept="image/*" id="out-file" hidden></label>
        <span class="muted">A wide photo works best, e.g. your office or reception.</span></p>

      <h3>Background picture for the whole app</h3>
      <div class="pic-choices" role="radiogroup" aria-label="App background">
        <label class="pic-choice"><input type="radio" name="app_image" value="" ${!t.app_image ? 'checked' : ''}>
          <span class="thumb">Plain</span><span class="cap">None</span></label>
        <label class="pic-choice" id="app-own" ${t.app_image ? '' : 'hidden'}><input type="radio" name="app_image" value="${esc(t.app_image || '')}" ${t.app_image ? 'checked' : ''}>
          <span class="thumb" ${t.app_image ? photo(t.app_image) : ''}></span><span class="cap">Your photo</span></label>
      </div>
      <p class="actions"><label class="btn file-btn">Upload a photo<input type="file" accept="image/*" id="app-file" hidden></label></p>
      <label class="range-label"><span>How strongly it shows: <output id="strength-out">${Number(t.app_strength)}%</output></span>
        <input type="range" id="strength" min="5" max="40" step="1" value="${Number(t.app_strength)}"></label>
      <p class="muted">The picture sits faintly behind the pages so text stays easy to read.</p>

      <h3>Page pictures</h3>
      <p class="muted">Each page has an illustration at the top. Replace any of them with your own photo, for example your building, team or region. Free photos for business use: unsplash.com or pexels.com.</p>
      <div class="pic-choices page-pics">
        ${Object.entries(ART_NAMES).map(([key, name]) => `<div class="pic-choice static" data-page="${key}">
          <span class="thumb" ${t.pages[key] ? photo(t.pages[key]) : ''}>${t.pages[key] ? '' : ART[key]}</span>
          <span class="cap">${esc(name)}</span>
          <span class="pic-actions"><label class="btn small file-btn">Photo<input type="file" accept="image/*" hidden></label>
          ${t.pages[key] ? '<button type="button" class="btn small" data-clear>Use drawing</button>' : ''}</span>
        </div>`).join('')}
      </div>

      <div class="actions"><button class="btn primary">Save appearance</button><button type="button" class="btn" id="reset-look">Back to default</button></div>
    </form>`;

  const form = $('#appearance-form', box);
  const preview = () => applyTheme(t);
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'palette') {
      if (el.value !== 'custom') t.accent = PALETTES[el.value].accent;
      else t.accent = $('#accent', box).value;
    }
    if (el.name === 'out_image') t.out_image = el.value;
    if (el.name === 'app_image') t.app_image = el.value;
    preview();
  });
  $('#accent', box).oninput = (e) => {
    t.accent = e.target.value;
    $('#custom-dot', box).style.background = t.accent;
    form.querySelector('input[name=palette][value=custom]').checked = true;
    preview();
  };
  $('#strength', box).oninput = (e) => { t.app_strength = Number(e.target.value); $('#strength-out', box).textContent = `${t.app_strength}%`; preview(); };

  const upload = (fileInput, which, choiceId) => {
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      busy(null, async () => {
        const url = await ctx.api.uploadBranding(await shrinkImage(file));
        const choice = $(`#${choiceId}`, box);
        const radio = choice.querySelector('input');
        radio.value = url;
        radio.checked = true;
        choice.querySelector('.thumb').style.backgroundImage = `url("${url}")`;
        choice.hidden = false;
        t[which] = url;
        preview();
        toast('Photo uploaded. Press Save appearance to keep it.');
      });
    };
  };
  box.querySelectorAll('[data-page]').forEach((card) => {
    const key = card.dataset.page;
    card.querySelector('input[type=file]').onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      busy(null, async () => {
        t.pages[key] = await ctx.api.uploadBranding(await shrinkImage(file, 1200));
        renderAppearance(box, ctx, t);
        toast(`Photo added for ${ART_NAMES[key]}. Press Save appearance to keep it.`);
      });
    };
    const clear = card.querySelector('[data-clear]');
    if (clear) clear.onclick = () => { delete t.pages[key]; renderAppearance(box, ctx, t); };
  });
  upload($('#out-file', box), 'out_image', 'out-own');
  upload($('#app-file', box), 'app_image', 'app-own');

  $('#reset-look', box).onclick = () => {
    const d = { ...t, accent: PALETTES.teal.accent, out_image: 'builtin:desk', app_image: '', app_strength: 15 };
    applyTheme(d);
    renderAppearance(box, ctx, d);
    toast('Default look shown. Press Save appearance to keep it.');
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const palette = Object.entries(PALETTES).find(([, p]) => p.accent.toLowerCase() === String(t.accent).toLowerCase())?.[0] || 'custom';
      await ctx.api.saveSettings({ theme: { ...t, palette } });
      toast('Appearance saved for everyone');
      reload();
    });
  };
  // Leaving the page without saving puts the saved look back.
  if (!draft) window.addEventListener('hashchange', () => applyTheme(themeOf(ctx.settings)), { once: true });
}
