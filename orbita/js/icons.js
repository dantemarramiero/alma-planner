// Icone Lucide (https://lucide.dev, licenza ISC), come vuole il brand di Alma Planet: tratto 1.75, 20px,
// colore currentColor. Niente emoji nell'interfaccia. Uso: h('button', icon('plus'), 'Crea progetto').
const P = {
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'alarm-clock': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sunrise: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'square-check': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  gantt: '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'log-out': '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  arrows: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><path d="M6 12H2"/><path d="M12 6V2"/><path d="M12 22v-4"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
  expand: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  car: '<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>',
};

// Mezzi aziendali: un'icona per categoria (vista di lato). «veh-autocarro» è il truck di Lucide; le altre sono
// disegnate nello stesso stile (tratto 1.75, 24×24) perché Lucide non ha escavatori, furgoni e cassoni.
Object.assign(P, {
  'veh-auto': '<path d="M2 15.5V12.5L4.5 8H14l3.5 4H21a1 1 0 0 1 1 1v2.5"/><path d="M4.5 12h13"/><path d="M10 8v4"/><path d="M8 16h7"/><path d="M2 16h2"/><path d="M19.5 16H22"/><circle cx="6" cy="16" r="2"/><circle cx="17.5" cy="16" r="2"/>',
  'veh-autocarro': '<rect x="1.5" y="4" width="13.5" height="12" rx="1"/><path d="M15 16V8h3.5l3.5 4.5V16h-1.5"/><path d="M15 12h7"/><circle cx="4.5" cy="17.5" r="1.8"/><circle cx="9" cy="17.5" r="1.8"/><circle cx="18.5" cy="17.5" r="1.8"/>',
  'veh-cassone-aperto': '<path d="M2 11v5h11"/><path d="M5 11v2"/><path d="M9 11v2"/><path d="M13 16V8h4l3 4h1a1 1 0 0 1 1 1v3h-2"/><path d="M8 16.5h7"/><circle cx="6" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  'veh-furgone': '<path d="M4 16.5H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12l4 4h2a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-1"/><path d="M15 6v4h4"/><path d="M8.5 16.5h6"/><circle cx="6.5" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  'veh-cassone-chiuso': '<rect x="2" y="4" width="11" height="12" rx="1"/><path d="M13 16V9h4l3 3.5h1a1 1 0 0 1 1 1V16h-2"/><path d="M8.5 16.5h6"/><circle cx="6" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  'veh-escavatore': '<rect x="2" y="16" width="12" height="4" rx="2"/><path d="M4 16v-5h6v5"/><path d="M6 11V9h3"/><path d="M10 12l5-6 5 4"/><path d="M20 10v3l-2.5 1"/>',
  'veh-gru': '<rect x="3" y="17" width="11" height="3" rx="1.5"/><path d="M5 17v-4h6v4"/><path d="M10 13 19 4"/><path d="M19 4v7"/><path d="M19 11a1.5 1.5 0 1 1-1.5 1.5"/>',
  'veh-moto': '<circle cx="5" cy="16.5" r="3"/><circle cx="19" cy="16.5" r="3"/><path d="M5 16.5 8 11h7l4 5.5"/><path d="M7 9h5"/><rect x="9.5" y="12.5" width="4.5" height="3" rx="1"/><path d="M15 11l1.5-4h2.5"/>',
  'veh-generico': '<rect x="3" y="6" width="18" height="10" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="18" r="2"/><circle cx="16.5" cy="18" r="2"/>',
});

const NS = 'http://www.w3.org/2000/svg';

// Un'icona come elemento SVG; title = testo per chi non vede l'icona (altrimenti è decorativa).
export function icon(name, { size = 18, title } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'ico');
  if (title) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
    const t = document.createElementNS(NS, 'title');
    t.textContent = title;
    svg.append(t);
  } else svg.setAttribute('aria-hidden', 'true');
  svg.insertAdjacentHTML('beforeend', P[name] || P.file);
  return svg;
}

// Le icone scritte nell'HTML come <span data-icon="nome"></span> (menu laterale).
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (!el.firstChild) el.append(icon(el.dataset.icon, { size: Number(el.dataset.size) || 18 }));
  }
}

// Icona del file secondo l'estensione (OneDrive, documenti del progetto).
const BY_EXT = [
  [/\.(xlsx?|xlsm|csv)$/i, 'sheet'], [/\.(docx?|rtf|odt|txt|md)$/i, 'file-text'], [/\.pdf$/i, 'file-text'],
  [/\.(pptx?|key)$/i, 'presentation'], [/\.(png|jpe?g|gif|webp|svg|heic)$/i, 'image'],
  [/\.(mp4|mov|avi|mkv)$/i, 'film'], [/\.(zip|rar|7z)$/i, 'archive'],
];
export const fileIconName = (name, folder = false) => (folder ? 'folder' : BY_EXT.find(([re]) => re.test(name || ''))?.[1] || 'file');
