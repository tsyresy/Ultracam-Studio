import { PairedDevice } from './devices';
import { SessionInfo } from './server';
import { PROTOCOL_VERSION, ProSettings } from './protocol';

export interface AppState {
  name: string;
  protocol: number;
  address: string | null;
  port: number;
  fingerprint: string;
  pairingCode: string | null;
  sessions: SessionInfo[];
  devices: PairedDevice[];
  /** Affiche l'écran de lancement (chargement initial de la fenêtre). */
  splash?: boolean;
  /** Derniers réglages Pro poussés par chaque téléphone. */
  settings: Record<string, ProSettings>;
  log: { level: string; time: string; message: string }[];
  obsUrl: string | null;
}

export const LOG_LIMIT = 300;

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type FieldType = 'number' | 'checkbox' | 'select';

interface FieldSpec {
  path: string;
  label: string;
  type: FieldType;
  step?: number;
  options?: string[];
}

/** Édition des réglages Pro : un formulaire par téléphone appairé. */
function renderSettingsCard(s: ProSettings, device: PairedDevice): string {
  const fields: FieldSpec[] = [
    { path: 'lens', label: 'Capteur', type: 'select', options: ['back', 'front'] },
    { path: 'torch', label: 'Torche', type: 'checkbox' },
    { path: 'zoom', label: 'Zoom', type: 'number', step: 0.1 },
    { path: 'focus', label: 'Mise au point (0–1)', type: 'number', step: 0.01 },
    { path: 'whiteBalance', label: 'Balance des blancs (−1…1)', type: 'number', step: 0.05 },
    { path: 'exposureCompensation', label: 'Exposition (−2…2 IL)', type: 'number', step: 0.1 },
    { path: 'hdr', label: 'HDR', type: 'checkbox' },
    { path: 'stabilization', label: 'Stabilisation', type: 'checkbox' },
    { path: 'mirror', label: 'Miroir', type: 'checkbox' },
    { path: 'cleanFrame', label: 'Image propre', type: 'checkbox' },
    { path: 'brightness', label: 'Luminosité', type: 'number', step: 0.05 },
    { path: 'contrast', label: 'Contraste', type: 'number', step: 0.05 },
    { path: 'saturation', label: 'Saturation', type: 'number', step: 0.05 },
    { path: 'gamma', label: 'Gamma', type: 'number', step: 0.05 },
    { path: 'sharpness', label: 'Netteté', type: 'number', step: 0.05 },
    { path: 'hue', label: 'Teinte (−180…180°)', type: 'number', step: 1 },
    { path: 'beauty', label: 'Beauté', type: 'number', step: 0.05 },
    {
      path: 'preset',
      label: 'Style',
      type: 'select',
      options: ['none', 'warm', 'cool', 'vivid', 'cinema'],
    },
    { path: 'resolution.width', label: 'Largeur', type: 'number', step: 2 },
    { path: 'resolution.height', label: 'Hauteur', type: 'number', step: 2 },
    { path: 'fps', label: 'Images/s', type: 'number', step: 1 },
    { path: 'bitrateKbps', label: 'Débit vidéo (kbit/s)', type: 'number', step: 500 },
    { path: 'codec', label: 'Codec', type: 'select', options: ['h264', 'hevc'] },
    { path: 'audioEnabled', label: 'Audio', type: 'checkbox' },
    { path: 'audioCodec', label: 'Codec audio', type: 'select', options: ['aac', 'opus'] },
    { path: 'audioBitrateKbps', label: 'Débit audio (kbit/s)', type: 'number', step: 8 },
  ];

  const rows = fields
    .map((f) => {
      const value = f.path
        .split('.')
        .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], s);
      const data = `data-pro="${escapeHtml(f.path)}"`;
      let control: string;
      if (f.type === 'checkbox') {
        control = `<input type="checkbox" ${data} ${value ? 'checked' : ''} />`;
      } else if (f.type === 'select') {
        const options = (f.options ?? [])
          .map(
            (opt) =>
              `<option value="${escapeHtml(opt)}" ${opt === value ? 'selected' : ''}>${escapeHtml(opt)}</option>`
          )
          .join('');
        control = `<select ${data}>${options}</select>`;
      } else {
        const step = f.step ? `step="${f.step}"` : '';
        control = `<input type="number" ${step} value="${escapeHtml(value ?? '')}" ${data} />`;
      }
      return `<label class="setting"><span>${escapeHtml(f.label)}</span>${control}</label>`;
    })
    .join('');

  return `
    <article class="card">
      <header><strong>${escapeHtml(device.deviceName)}</strong> <span class="badge">${escapeHtml(device.platform)}</span></header>
      <form data-settings="${escapeHtml(device.deviceId)}" class="settings">${rows}
        <button type="submit">Appliquer</button>
      </form>
    </article>`;
}

export function renderIndex(state: AppState): string {
  const sessions = state.sessions.length
    ? state.sessions
        .map(
          (s) => `
      <article class="card session">
        <header><strong>${escapeHtml(s.deviceName)}</strong> <span class="badge">${escapeHtml(s.platform)}</span></header>
        <dl>
          <dt>Vidéo</dt><dd>${escapeHtml(s.video?.codec ?? '—')} ${escapeHtml(s.video?.width ?? '')}x${escapeHtml(s.video?.height ?? '')} @ ${escapeHtml(s.video?.fps ?? '')} fps</dd>
          <dt>Débit</dt><dd>${escapeHtml(s.video?.bitrate ? Math.round(s.video.bitrate / 1000) + ' kbit/s' : '—')}</dd>
          <dt>Frames</dt><dd>${escapeHtml(s.frames)}</dd>
          <dt>Octets</dt><dd>${escapeHtml((s.bytes / 1_000_000).toFixed(1))} Mo</dd>
        </dl>
      </article>`
        )
        .join('')
    : '<p class="muted">Aucun téléphone connecté.</p>';

  const devices = state.devices.length
    ? state.devices
        .map(
          (d) => `
      <tr>
        <td>${escapeHtml(d.deviceName)}</td>
        <td>${escapeHtml(d.platform)}</td>
        <td>${escapeHtml(new Date(d.lastSeenAt).toLocaleString())}</td>
        <td><button data-unpair="${escapeHtml(d.deviceId)}">Dissocier</button></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="muted">Aucun appareil appairé.</td></tr>';

  const proDevices = state.devices.filter((d) => state.settings[d.deviceId]);
  const settings = proDevices.length
    ? proDevices.map((d) => renderSettingsCard(state.settings[d.deviceId], d)).join('')
    : '<p class="muted">Aucun réglage Pro reçu : ouvrez l\'écran « Réglages Pro » dans Ultracam Mobile.</p>';

  const logs = state.log
    .map(
      (entry) =>
        `<li class="log-${escapeHtml(entry.level)}"><time>${escapeHtml(entry.time)}</time> ${escapeHtml(entry.message)}</li>`
    )
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ultracam Studio — ${escapeHtml(state.name)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #10131a; color: #e7ecf3; }
  main { max-width: 1000px; margin: 0 auto; padding: 28px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; color: #8d9bb0; margin: 32px 0 12px; }
  .muted { color: #7f8da3; }
  .badge { background: #1d2a3d; color: #7cc4ff; border-radius: 999px; padding: 1px 9px; font-size: 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  .card { background: #171c26; border: 1px solid #232c3b; border-radius: 12px; padding: 16px 18px; }
  .card header { margin-bottom: 8px; }
  dl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin: 0; font-size: 14px; }
  dt { color: #7f8da3; }
  dd { margin: 0; }
  .pairing { font: 700 40px/1 ui-monospace, monospace; letter-spacing: .2em; color: #7cc4ff; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #232c3b; }
  th { color: #7f8da3; font-weight: 600; }
  button { background: #1d2a3d; color: #e7ecf3; border: 1px solid #2b3a52; border-radius: 8px;
           padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px; }
  button:hover { background: #243450; }
  ul.logs { list-style: none; padding: 0; margin: 0; font-family: ui-monospace, monospace; font-size: 12.5px;
            max-height: 260px; overflow: auto; background: #0c0f14; border-radius: 10px; border: 1px solid #1d2431; }
  ul.logs li { padding: 5px 12px; border-bottom: 1px solid #141a23; }
  ul.logs li time { color: #5f6d82; margin-right: 8px; }
  .log-warn { color: #f2c744; }
  .log-error { color: #ff7b72; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; background: #16371f; color: #7ee2a0; font-size: 12px; }
  .pill.off { background: #3a1a1a; color: #ff8f88; }
  form.settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px 14px; }
  form.settings .setting { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: #7f8da3; }
  form.settings input, form.settings select { background: #0c0f14; color: #e7ecf3; border: 1px solid #232c3b;
           border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; }
  form.settings input[type="checkbox"] { width: 18px; height: 18px; padding: 0; accent-color: #7cc4ff; }
  form.settings button { grid-column: 1 / -1; justify-self: start; margin-top: 4px; }
  #splash { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center;
            background: #10131a; transition: opacity .35s ease; }
  #splash img { max-width: 86%; max-height: 86%; object-fit: contain; }
  #splash.hidden { opacity: 0; pointer-events: none; }
</style>
</head>
<body>
${
  state.splash
    ? `<div id="splash"><img src="/splash.png" alt="Ultracam Studio" /></div>`
    : ''
}
<main>
  <h1>Ultracam Studio</h1>
  <p class="muted">
    ${escapeHtml(state.name)} · protocole v${escapeHtml(state.protocol)} ·
    <span class="pill" id="status">en écoute</span>
  </p>

  <div class="grid" style="margin-top:20px">
    <section class="card">
      <header><strong>Appairer un téléphone</strong></header>
      ${
        state.pairingCode
          ? `<div class="pairing" id="code">${escapeHtml(state.pairingCode)}</div>
             <p class="muted">À saisir dans Ultracam Mobile. Expire dans quelques minutes.</p>
             <button id="renew">Régénérer</button>`
          : `<p class="muted">Aucun code actif.</p><button id="renew">Générer un code</button>`
      }
    </section>
    <section class="card">
      <header><strong>Connexion réseau</strong></header>
      <dl>
        <dt>Serveur</dt><dd class="mono">${escapeHtml(state.address ?? 'non détecté')}:${escapeHtml(state.port)}</dd>
        <dt>mDNS</dt><dd class="mono">_ultracam._tcp</dd>
        <dt>Empreinte</dt><dd class="mono" style="word-break:break-all">${escapeHtml(state.fingerprint.slice(0, 47))}…</dd>
        <dt>OBS</dt><dd class="mono">${escapeHtml(state.obsUrl ?? 'inactif')}</dd>
      </dl>
    </section>
  </div>

  <h2>Réglages Pro</h2>
  <div class="grid">${settings}</div>

  <h2>Téléphones connectés</h2>
  <div class="grid">${sessions}</div>

  <h2>Appareils appairés</h2>
  <table>
    <thead><tr><th>Nom</th><th>Plateforme</th><th>Vu pour la dernière fois</th><th></th></tr></thead>
    <tbody>${devices}</tbody>
  </table>

  <h2>Journal</h2>
  <ul class="logs">${logs}</ul>
</main>
<script>
  document.querySelector('#renew')?.addEventListener('click', () => fetch('/api/pairing', { method: 'POST' }));
  document.querySelectorAll('[data-unpair]').forEach((btn) =>
    btn.addEventListener('click', () =>
      fetch('/api/unpair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: btn.dataset.unpair }),
      })
    )
  );
  document.querySelectorAll('form[data-settings]').forEach((form) =>
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const settings = {};
      form.querySelectorAll('[data-pro]').forEach((input) => {
        const path = input.dataset.pro;
        const keys = path.split('.');
        const leaf = keys.pop();
        const target = keys.reduce((node, key) => (node[key] = node[key] || {}), settings);
        if (input.type === 'checkbox') target[leaf] = input.checked;
        else if (input.type === 'number') {
          const value = Number(input.value);
          if (Number.isFinite(value)) target[leaf] = value;
        } else target[leaf] = input.value;
      });
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: form.dataset.settings, settings }),
      });
    })
  );
  const es = new EventSource('/api/events');
  es.onmessage = (event) => { if (JSON.parse(event.data).reload) location.reload(); };
  const splash = document.getElementById('splash');
  if (splash) {
    const hide = () => {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 400);
    };
    if (document.readyState === 'complete') setTimeout(hide, 600);
    else window.addEventListener('load', () => setTimeout(hide, 600));
  }
</script>
</body>
</html>`;
}
