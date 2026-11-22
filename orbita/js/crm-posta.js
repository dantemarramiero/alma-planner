// Posta e «Progetto da email» (ALM2-55, canvas «Progetto da email» approvato da Dante il 22/11/2026).
// - postaPage (tavola A): la propria casella nel CRM; «Crea progetto commerciale» o il link al progetto/Radar.
// - openProposal (tavola B): cosa ha capito Alma dalla conversazione, persone, email e legami nel CRM.
// - dealHero / dealOverview (tavola D): la scheda del progetto nato da una email: in breve, a chi tocca, termometro,
//   prossima mossa, cronologia unica con le note, impegni presi nelle email, chi conta, legami nel CRM.
import { h, fill, toast, loading, fmtDate, timeAgo, today, addDays, initials, debounce } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { ic, pill, cvModal, emptyState } from './crm-v2.js';
import { withMentions } from './social.js';
import { uploadNoteFiles } from './project-meetings.js';

const eur = n => (!Number(n) ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : Number(n) >= 1e4 ? `${Math.round(Number(n) / 1e3).toLocaleString('it-IT')} k€` : `${Number(n).toLocaleString('it-IT')} €`);
const when = d => { if (!d) return ''; const s = String(d); const day = s.slice(0, 10); return day === today() ? s.slice(11, 16) : fmtDate(day); };
const firstName = n => String(n || '').replace(/^(Ing|Arch|Geom|Dott|Avv)\.?\s+/i, '').split(' ')[0];
const userName = id => store.users.find(u => u.id === id)?.name || '';
const handleOf = u => String(u?.email || '').split('@')[0];

// ═══ Posta (tavola A) ═════════════════════════════════════════════════════════════════════════════
export async function postaPage(container) {
  // folder: 'arrivo' | 'inviate' | id di una cartella di Outlook (ALM2-60); picked = email spuntate nella lista
  const st = { folder: 'arrivo', q: '', list: [], next: null, sel: null, picked: new Set(), folders: null };
  const listBox = h('div.pm-items', loading());
  const reader = h('article.pm-reader', emptyState('mail', 'Scegli un\'email a sinistra.'));
  const search = h('input.pm-search', { type: 'search', placeholder: 'Cerca nella posta', 'aria-label': 'Cerca nella posta' });
  const folders = h('div.pm-folders');
  const bulk = h('div.pm-bulk', { hidden: true });
  const other = () => (st.folder !== 'arrivo' && st.folder !== 'inviate' ? (st.folders || []).find(f => f.id === st.folder) : null);
  // id Outlook della cartella aperta, per non proporla come destinazione
  const here = () => (st.folder === "arrivo" || st.folder === "inviate" ? (st.folders || []).find(f => f.well_known === (st.folder === "arrivo" ? "inbox" : "sentitems"))?.id : st.folder);
  const inTrash = () => other()?.well_known === 'deleteditems';
  const go = k => { st.folder = k; st.sel = null; st.picked.clear(); drawFolders(); load(); };
  const drawFolders = () => fill(folders,
    [['arrivo', 'In arrivo'], ['inviate', 'Inviate']].map(([k, l]) => h('button.cv-pill.big', { type: 'button', class: st.folder === k ? 'dark' : 'line', 'aria-pressed': String(st.folder === k), on: { click: () => go(k) } }, l)),
    h('button.cv-pill.big.pm-fold', { type: 'button', class: other() ? 'dark' : 'line', 'aria-haspopup': 'dialog', on: { click: async () => { const f = await pickFolder('Apri una cartella di Outlook'); if (f) go(f.id); } } }, ic('folder', 14), h('span', other() ? other().name : 'Cartelle'), ic('chevron-down', 13)));
  drawFolders();
  fill(container, h('div.pm',
    h('section.pm-list', h('div.pm-list-h', h('strong', 'Posta'), folders, h('div.pm-search-w', ic('search', 15), search)), bulk, listBox),
    reader));
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.picked.clear(); load(); }, 300));

  async function loadFolders() {
    if (!st.folders) st.folders = (await get('/api/crm/posta/cartelle')).folders;
    return st.folders;
  }
  // Scelta della cartella: albero delle cartelle di Outlook, con ricerca
  async function pickFolder(title, { exclude } = {}) {
    let list;
    try { list = await loadFolders(); } catch (err) { toast(err?.message || 'Cartelle di Outlook non lette', 'err'); return null; }
    return new Promise(resolve => {
      let done = false;
      const q = h('input.input', { type: 'search', placeholder: 'Cerca una cartella', 'aria-label': 'Cerca una cartella' });
      const box = h('div.pm-tree');
      const WK = { inbox: 'inbox', sentitems: 'send', archive: 'archive', deleteditems: 'trash', junkemail: 'x' };
      const draw = () => {
        const s = q.value.trim().toLowerCase();
        const ex = typeof exclude === "function" ? exclude() : exclude;
        const rows = list.filter(f => f.id !== ex && (!s || f.name.toLowerCase().includes(s)));
        fill(box, rows.length ? rows.map(f => h('button.pm-tree-i', { type: 'button', style: s ? '' : `padding-left:${12 + f.depth * 22}px`, on: { click: () => { done = true; m.close(); resolve(f); } } },
          ic(WK[f.well_known] || 'folder', 15), h('span', f.name), f.total ? h('small', String(f.total)) : null)) : emptyState('folder', 'Nessuna cartella con questo nome.'));
      };
      q.addEventListener('input', draw);
      const m = cvModal({ title, body: h('div.pm-treebox', q, box), onClose: () => { if (!done) resolve(null); } });
      draw();
      setTimeout(() => q.focus(), 50);
    });
  }

  async function load(more = false) {
    if (!more) fill(listBox, loading());
    const qs = new URLSearchParams({ cartella: st.folder, ...(st.q ? { q: st.q } : {}), ...(more && st.next ? { next: st.next } : {}) });
    let r;
    try { r = await get(`/api/crm/posta?${qs}`, { quiet: true }); } catch (err) {
      fill(listBox, emptyState('mail', err?.message || 'La posta non si legge: Microsoft 365 non è collegato o manca il permesso Mail.Read.'));
      return;
    }
    st.list = more ? [...st.list, ...r.messages] : r.messages;
    st.next = r.next;
    drawList();
    if (!more && !st.sel) { if (st.list[0]) open(st.list[0]); else fill(reader, emptyState('mail', 'Nessuna email in questa cartella.')); }
  }
  function drawBulk() {
    const n = st.picked.size;
    bulk.hidden = !n;
    if (!n) return fill(bulk);
    const ids = [...st.picked];
    fill(bulk, h('b', n === 1 ? '1 email scelta' : `${n} email scelte`),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => move(ids) } }, ic('folder', 14), 'Sposta'),
      inTrash() ? null : h('button.btn.btn-sm.pm-del', { type: 'button', on: { click: () => move(ids, { del: true }) } }, ic('trash', 14), 'Elimina'),
      h('button.cv-lnk', { type: 'button', on: { click: () => { st.picked.clear(); drawList(); } } }, 'Deseleziona'));
  }
  function drawList() {
    drawBulk();
    if (!st.list.length) return fill(listBox, emptyState('mail', st.q ? `Nessuna email per «${st.q}».` : 'Nessuna email.'));
    const sentLike = st.folder === 'inviate' || other()?.well_known === 'sentitems';
    fill(listBox, st.list.map(m => {
      const on = st.picked.has(m.id);
      return h('div.pm-row', { class: on ? 'picked' : '' },
        h('button.pm-chk', { type: 'button', role: 'checkbox', 'aria-checked': String(on), 'aria-label': `Scegli «${m.subject}»`, on: { click: () => { if (on) st.picked.delete(m.id); else st.picked.add(m.id); drawList(); } } }, ic(on ? 'square-check' : 'square', 17)),
        h('button.pm-item', { type: 'button', class: st.sel === m.id ? 'on' : '', on: { click: () => open(m) } },
          h('span.pm-item-r', h('b', sentLike ? (m.to[0]?.name || m.to[0]?.address || '—') : (m.from.name || m.from.address)), h('small', when(m.date))),
          h('span.pm-item-s', m.subject),
          h('small.pm-item-m', m.project ? [ic('folder', 12), ` nel progetto «${m.project.name}»`] : m.signal ? [ic('radar', 12), ' nel Radar'] : m.in_page > 1 ? `${m.in_page} email` : m.preview.slice(0, 70))),
        // cestino sulla riga (Dante 22/11): elimina con un clic, senza aprire l'email
        inTrash() ? null : h('button.pm-rowdel', { type: 'button', title: 'Elimina (va in «Posta eliminata» di Outlook)', 'aria-label': `Elimina «${m.subject}»`, on: { click: () => move([m.id], { del: true }) } }, ic('trash', 15)));
    }),
    st.next ? h('button.btn.btn-sm.pm-more', { type: 'button', on: { click: () => load(true) } }, 'Altre email') : null);
  }

  // Sposta in una cartella di Outlook o elimina (va in «Posta eliminata», si recupera): toglie dalla lista, apre la
  // successiva e offre «Annulla», che riporta le email nella cartella da cui venivano.
  async function move(ids, { del = false } = {}) {
    const dest = del ? null : await pickFolder(ids.length === 1 ? 'Sposta l\'email in' : `Sposta ${ids.length} email in`, { exclude: here });
    if (!del && !dest) return;
    const back = new Map(ids.map(id => [id, st.list.find(m => m.id === id)?.folder_id]).filter(([, f]) => f));
    let r;
    try { r = await post('/api/crm/posta/sposta', del ? { ids, elimina: true } : { ids, cartella: dest.id }); } catch (err) {
      toast(err?.message || 'Email non spostate', 'err', 9000);
      return;
    }
    const gone = new Set(r.moved.map(x => x.old_id));
    const at = st.list.findIndex(m => gone.has(m.id));
    st.list = st.list.filter(m => !gone.has(m.id));
    for (const id of gone) st.picked.delete(id);
    st.folders = null; // i numeri delle cartelle cambiano
    if (gone.has(st.sel)) {
      st.sel = null;
      const nx = st.list[Math.min(at, st.list.length - 1)];
      if (nx) open(nx); else fill(reader, emptyState('mail', 'Nessuna email in questa cartella.'));
    }
    drawList();
    const n = r.moved.length;
    const label = del ? (n === 1 ? 'Email eliminata' : `${n} email eliminate`) : `${n === 1 ? 'Email spostata' : `${n} email spostate`} in «${dest.name}»`;
    const undo = async () => {
      const groups = new Map();
      for (const x of r.moved) { const f = back.get(x.old_id); if (f) groups.set(f, [...(groups.get(f) || []), x.id]); }
      try {
        for (const [f, list] of groups) await post('/api/crm/posta/sposta', { ids: list, cartella: f });
        st.folders = null; st.sel = null; toast('Fatto: le email sono tornate dov\'erano'); load();
      } catch (err) { toast(err?.message || 'Non sono riuscito a riportarle indietro', 'err'); }
    };
    if (n) toast(h('span.pm-toast', label, back.size ? h('button.pm-undo', { type: 'button', on: { click: ev => { ev.currentTarget.closest('.toast')?.remove(); undo(); } } }, 'Annulla') : null), 'ok', 8000);
    if (r.failed.length) toast(`${r.failed.length} email non spostate: ${r.failed[0].error}`, 'err', 8000);
  }

  async function open(m) {
    st.sel = m.id;
    drawList();
    fill(reader, loading());
    const e = await get(`/api/crm/posta/${encodeURIComponent(m.id)}`);
    if (st.sel !== m.id) return;
    const place = e.project ? h('a.btn.pm-in', { href: `#/crm/progetto/${e.project.id}` }, ic('folder', 15), `Nel progetto ${e.project.name}`, ic('chevron-right', 14))
      : e.signal ? h('a.btn.pm-in', { href: `#/crm/lancio/s/${e.signal.id}` }, ic('radar', 15), 'Nel Radar · portala avanti', ic('chevron-right', 14)) : null;
    st.cur = e;
    const aiBox = h('div.pm-ai');
    const long = e.conversation_count >= 3 || (e.body.match(/\S+/g) || []).length > 150;
    st.act = {
      riassumi: long ? () => summary(e, aiBox) : null,
      rispondi: () => composePanel(e, aiBox, 'rispondi'),
      tutti: () => composePanel(e, aiBox, 'tutti'),
      inoltra: () => composePanel(e, aiBox, 'inoltra'),
      sposta: () => move([e.id]),
      elimina: inTrash() ? null : () => move([e.id], { del: true }),
    };
    const many = rcptOf(e, true).length > 1;
    fill(reader,
      h('div.pm-tools',
        long ? h('button.btn.btn-sm.pm-aib', { type: 'button', title: `Riassunto di tutta la conversazione con Alma: costa circa ${guess(e, 'riassunto')} (tasto S)`, on: { click: st.act.riassumi } }, ic('sparkles', 14), 'Riassumi', h('small.pm-est', `≈ ${guess(e, 'riassunto')}`), h('kbd', 'S')) : null,
        h('span.pm-sep'),
        h('button.btn.btn-sm', { type: 'button', title: `Rispondi a ${rcptOf(e, false)[0]?.name || rcptOf(e, false)[0]?.address || ''} (tasto R)`, on: { click: st.act.rispondi } }, ic('reply', 14), 'Rispondi', h('kbd', 'R')),
        many ? h('button.btn.btn-sm', { type: 'button', title: `Rispondi a tutti: ${rcptOf(e, true).map(p => p.name || p.address).join(', ')} (tasto A)`, on: { click: st.act.tutti } }, ic('reply-all', 14), 'Rispondi a tutti', h('kbd', 'A')) : null,
        h('button.btn.btn-sm', { type: 'button', title: 'Inoltra con gli allegati (tasto F)', on: { click: st.act.inoltra } }, ic('forward', 14), 'Inoltra', h('kbd', 'F')),
        h('button.btn.btn-sm', { type: 'button', title: 'Sposta in una cartella di Outlook (tasto V)', on: { click: () => move([e.id]) } }, ic('folder', 14), 'Sposta'),
        inTrash() ? null : h('button.btn.btn-sm.pm-del', { type: 'button', title: 'Va in «Posta eliminata» di Outlook: si recupera (tasto Canc)', on: { click: () => move([e.id], { del: true }) } }, ic('trash', 14), 'Elimina')),
      h('div.pm-rhead',
        h('div.pm-rtitle', h('h1', e.subject), h('span.pm-rmeta', `${e.from.name || ''} <${e.from.address}> · a ${e.to.map(x => x.name || x.address).join(', ')}${e.cc.length ? `, cc ${e.cc.map(x => x.name || x.address).join(', ')}` : ''}`), h('small.cv-muted', `${fmtDate(String(e.date).slice(0, 10), { year: true })} ${String(e.date).slice(11, 16)}${e.conversation_count > 1 ? ` · ${e.conversation_count} email nella conversazione` : ''}`)),
        place || h('button.btn.btn-primary.pm-create', { type: 'button', on: { click: () => openProposal(e.id) } }, ic('sparkles', 15), 'Crea progetto commerciale'),
        place ? null : h('button.btn', { type: 'button', on: { click: () => addToProject(e) } }, 'Aggiungi a un progetto')),
      aiBox,
      fromMailBar(e, () => open({ id: e.id })),
      h('div.pm-body', e.body.trim()),
      e.attachments.length ? h('div.pm-atts', e.attachments.map(a => h('span.pm-att', ic('paperclip', 13), `${a.name} · ${(a.size / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`))) : null,
      h('div.pm-also',
        h('div.pm-hint', h('span.pm-hint-k', 'Anche da qui'), h('span', h('b', 'Persone con cui mi scrivo'), ': nel menu di una riga, «Crea progetto dalle sue email».'), h('span', h('b', 'Scheda contatto o azienda'), ', tab Email: «Crea progetto» su una conversazione.')),
        h('div.pm-hint', h('span.pm-hint-k', 'Se è già in un progetto'), h('span', 'Al posto del pulsante arancione compare il progetto in cui sta, come nelle righe a sinistra.'))));
  }
  // ── Riassunto, Rispondi / Rispondi a tutti con la bozza di Alma (ALM2-61, tavola G) ─────────────
  const cents = eur => (!(eur > 0) ? '' : eur * 100 < 0.01 ? 'meno di 0,01 cent' : `${(eur * 100).toLocaleString('it-IT', { maximumFractionDigits: eur * 100 < 0.1 ? 2 : 1 })} cent`);
  // stima prima del clic: parole della conversazione → token, al prezzo del modello leggero che risponde (gpt-4o-mini)
  const guess = (e, kind) => {
    const words = Math.min(12000, (e.body.match(/\S+/g) || []).length * Math.max(1, Math.min(e.conversation_count || 1, 6)));
    const tin = words * 1.4 + (kind === 'bozza' ? 1400 : 300);
    const tout = kind === 'bozza' ? 350 : 250;
    return cents((tin * 0.15 + tout * 0.6) / 1e6 * 0.95) || 'meno di 0,01 cent';
  };
  // a chi va la risposta: chi ha scritto l'email aperta (se l'ho scritta io, il primo destinatario); a tutti = anche copie
  const rcptOf = (e, tutti) => {
    const me = String(store.me?.email || '').toLowerCase();
    const target = e.from.address !== me ? e.from : (e.to[0] || e.from);
    if (!tutti) return [target];
    return [...new Map([e.from, ...e.to, ...e.cc].filter(p => p.address && p.address !== me).map(p => [p.address, p])).values()];
  };
  const box = (cls, title, cost, ...body) => h(`section.pm-aip.${cls}`, h('div.pm-aip-h', h('span.pm-aip-k', title), cost ? h('small', cost) : null), ...body);
  async function summary(e, aiBox) {
    const old = aiBox.querySelector('.pm-sum');
    if (old) { old.remove(); return; }
    const wait = box('pm-sum', 'Riassunto di Alma', '', loading());
    aiBox.prepend(wait);
    let r;
    try { r = await post(`/api/crm/posta/${encodeURIComponent(e.id)}/riassunto`, {}); } catch (err) { wait.remove(); toast(err?.message || 'Riassunto non riuscito', 'err', 8000); return; }
    const tile = (k, v, dark) => (v ? h('div.pm-sum-t', { class: dark ? 'dark' : '' }, h('span', k), h('p', v)) : null);
    wait.replaceWith(box('pm-sum', `Riassunto di Alma · ${r.emails === 1 ? '1 email' : `${r.emails} email`}, ${r.words.toLocaleString('it-IT')} parole`, r.ai ? `costato ${cents(r.eur) || 'meno di 0,01 cent'}` : 'senza AI (regole semplici)',
      h('p.pm-sum-b', r.breve),
      h('div.pm-sum-g', tile('Cosa chiedono', r.chiedono), tile('Cifre e date', r.cifre_date), tile('Tocca a te', r.tocca_a_te, true)),
      h('button.cv-lnk.pm-aip-x', { type: 'button', on: { click: ev => ev.currentTarget.closest('.pm-sum').remove() } }, 'Chiudi')));
  }

  // Riquadro unico (ALM2-64, tavola H): Rispondi, Rispondi a tutti, Inoltra. A e Cc modificabili (colleghi, contatti del
  // CRM o un indirizzo), allegati dal computer (fino a 25 MB), allegati originali da togliere (inoltra), firma Almacis,
  // «Scrivi con Alma» (bozza col tuo tono, solo al clic). Si manda o si salva tra le bozze di Outlook.
  const MAX_FILES = 25 * 1024 * 1024;
  const mb = n => `${(n / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
  async function myFirma() {
    if (!st.firma) st.firma = await get('/api/firma', { quiet: true }).catch(() => null);
    return st.firma;
  }
  function composePanel(e, aiBox, mode) {
    const old = aiBox.querySelector('.pm-draft');
    if (old && old.dataset.mode === mode) { old.querySelector('textarea')?.focus(); return; }
    old?.remove();
    const me = String(store.me?.email || '').toLowerCase();
    const all = rcptOf(e, true);
    const startCc = mode === 'tutti' ? e.cc.filter(p => p.address !== me) : [];
    const people = {
      a: mode === 'inoltra' ? [] : mode === 'tutti' ? all.filter(p => !startCc.some(c => c.address === p.address)) : rcptOf(e, false),
      cc: startCc,
    };
    const files = [];           // { name, type, size, data }
    const drop = new Set();     // allegati originali tolti (inoltra)
    let firmaOn = true;
    let spent = 0;

    // A / Cc: pillole con ×, campo che cerca tra colleghi e contatti, Invio o virgola per un indirizzo scritto a mano
    const row = key => {
      const box = h('div.pm-rcpt-row');
      const list = h('div.pm-sugg', { hidden: true });
      const field = h('input.pm-rcpt-i', { placeholder: key === 'a' ? 'cerca un collega o un contatto del CRM, o scrivi un indirizzo' : 'aggiungi in copia', 'aria-label': key === 'a' ? 'Destinatari' : 'In copia' });
      const add = p => {
        const address = String(p.address || '').trim().toLowerCase();
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) { toast('Indirizzo email non valido', 'err'); return; }
        if (![...people.a, ...people.cc].some(x => x.address === address)) people[key].push({ name: p.name || '', address });
        field.value = ''; list.hidden = true; draw(); field.focus();
      };
      const draw = () => fill(box, h('span.pm-rcpt-k', key === 'a' ? 'A' : 'Cc'),
        people[key].map(p => h('span.pm-rcpt', { title: p.address }, p.name || p.address,
          h('button', { type: 'button', 'aria-label': `Togli ${p.name || p.address}`, on: { click: () => { people[key] = people[key].filter(x => x.address !== p.address); draw(); } } }, '×'))),
        h('span.pm-rcpt-w', field, list));
      const search = debounce(async () => {
        const q = field.value.trim();
        if (q.length < 2) { list.hidden = true; return; }
        const r = await get(`/api/crm/posta/destinatari?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ people: [] }));
        const opts = r.people.filter(p => ![...people.a, ...people.cc].some(x => x.address === p.address));
        list.hidden = !opts.length;
        fill(list, opts.map(p => h('button', { type: 'button', on: { mousedown: ev => { ev.preventDefault(); add(p); } } },
          h('b', p.name || p.address), h('small', [p.address, p.kind === 'collega' ? 'collega' : p.company || 'contatto del CRM'].filter(Boolean).join(' · ')))));
      }, 200);
      field.addEventListener('input', search);
      field.addEventListener('keydown', ev => {
        if ((ev.key === 'Enter' || ev.key === ',' || ev.key === ';') && field.value.trim()) { ev.preventDefault(); add({ address: field.value.replace(/[,;]/g, '') }); }
        else if (ev.key === 'Backspace' && !field.value && people[key].length) { people[key].pop(); draw(); }
      });
      field.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 150); if (field.value.includes('@')) add({ address: field.value }); });
      draw();
      return box;
    };

    // allegati: originali (inoltra, si possono togliere) + file dal computer
    const attBox = h('div.pm-atts2');
    const picker = h('input', { type: 'file', multiple: true, hidden: true });
    const total = () => files.reduce((s, f) => s + f.size, 0);
    const drawAtts = () => fill(attBox,
      h('button.btn.btn-sm', { type: 'button', on: { click: () => picker.click() } }, ic('paperclip', 14), 'Allega file'),
      mode === 'inoltra' ? e.attachments.filter(a => !drop.has(a.name)).map(a => h('span.pm-file', ic('paperclip', 12), `${a.name} · ${mb(a.size)} · dall'email`,
        h('button', { type: 'button', 'aria-label': `Togli ${a.name}`, on: { click: () => { drop.add(a.name); drawAtts(); } } }, '×'))) : null,
      files.map(f => h('span.pm-file', ic('paperclip', 12), `${f.name} · ${mb(f.size)}`,
        h('button', { type: 'button', 'aria-label': `Togli ${f.name}`, on: { click: () => { files.splice(files.indexOf(f), 1); drawAtts(); } } }, '×'))),
      files.length ? h('small.cv-muted', `${mb(total())} di 25 MB`) : null);
    picker.addEventListener('change', async () => {
      for (const file of picker.files) {
        if (total() + file.size > MAX_FILES) { toast(`«${file.name}» non ci sta: in tutto al massimo 25 MB`, 'err', 6000); continue; }
        const data = await new Promise((ok, ko) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(',')[1] || ''); rd.onerror = ko; rd.readAsDataURL(file); });
        files.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data });
      }
      picker.value = '';
      drawAtts();
    });

    // firma
    const sigBox = h('div.pm-sig');
    const drawSig = f => fill(sigBox,
      f && f.enabled ? [h('span.pm-chip', firmaOn ? `+ firma Almacis · ${f.name}` : 'senza firma'),
        h('a', { href: '#/firma' }, 'Modifica'), h('span', '·'),
        h('button.cv-lnk', { type: 'button', on: { click: () => { firmaOn = !firmaOn; drawSig(f); } } }, firmaOn ? 'togli da questa email' : 'rimetti la firma')]
        : [h('span.pm-chip', 'firma spenta'), h('a', { href: '#/firma' }, 'Accendila')]);
    myFirma().then(drawSig);

    const text = h('textarea.pm-draft-t', { rows: 7, 'aria-label': 'Testo', placeholder: mode === 'inoltra' ? 'Scrivi due righe per chi lo riceve (facoltativo)' : 'Scrivi la risposta, oppure fattela preparare da Alma col tuo tono' });
    const cost = h('small');
    const tone = h('div.pm-tone');
    const busy = on => { panel.classList.toggle('busy', on); text.disabled = on; };
    const ask = async (extra = {}) => {
      busy(true);
      try {
        const x = await post(`/api/crm/posta/${encodeURIComponent(e.id)}/bozza`, { tutti: mode === 'tutti', ...extra, ...(text.value.trim() && Object.keys(extra).length ? { attuale: text.value } : {}) });
        text.value = x.text;
        spent += x.eur;
        cost.textContent = x.ai ? `costata ${cents(spent) || 'meno di 0,01 cent'}` : 'senza AI (regole semplici)';
        fill(tone, h('span', x.tone.n ? `Col tuo tono: dalle tue ultime ${x.tone.n} email a ${firstName(x.target?.name) || 'questa persona'}` : 'Non le hai ancora scritto: tono cortese, col «lei».'), x.tone.chips.map(c => h('span.pm-chip', c)));
        redoRow.hidden = false;
        alma.querySelector('.pm-alma-l').textContent = 'Riscrivi con Alma';
      } catch (err) { toast(err?.message || 'Bozza non riuscita', 'err', 8000); }
      busy(false);
      text.focus();
    };
    const alma = h('button.btn.btn-sm.pm-aib', { type: 'button', title: `Alma scrive la bozza col tono che usi con questa persona: costa circa ${guess(e, 'bozza')}`, on: { click: () => ask() } }, ic('sparkles', 14), h('span.pm-alma-l', 'Scrivi con Alma'), h('small.pm-est', `≈ ${guess(e, 'bozza')}`));
    const free = h('input.pm-draft-i', { placeholder: 'oppure scrivi cosa vuoi dire, es. «chiedi il computo in pdf», e premi Invio', 'aria-label': 'Cosa vuoi dire' });
    free.addEventListener('keydown', ev => { if (ev.key === 'Enter' && free.value.trim()) { ev.preventDefault(); ask({ istruzione: free.value.trim() }); } });
    const redoRow = h('div.pm-redo', { hidden: true }, h('span', 'Rifalla:'), [['breve', 'più breve'], ['formale', 'più formale'], ['declina', 'declina con garbo']].map(([k, l]) => h('button.cv-pill.line', { type: 'button', on: { click: () => ask({ stile: k }) } }, l)));

    const send = async draft => {
      if (!people.a.length) { toast('Scegli almeno un destinatario', 'err'); panel.querySelector('.pm-rcpt-i')?.focus(); return; }
      if (mode !== 'inoltra' && !text.value.trim()) { text.focus(); return; }
      busy(true);
      try {
        const x = await post(`/api/crm/posta/${encodeURIComponent(e.id)}/componi`, {
          modo: mode, a: people.a, cc: people.cc, testo: text.value, firma: firmaOn, bozza: draft, togli: [...drop],
          allegati: files.map(f => ({ name: f.name, type: f.type, data: f.data })),
        });
        panel.remove();
        const who = x.to.length === 1 ? (x.to[0].name || x.to[0].address) : `${x.to.length} persone`;
        toast(draft ? 'Salvata tra le bozze di Outlook' : mode === 'inoltra' ? `Inoltrata a ${who}` : `Risposta inviata a ${who}`);
        if (draft && x.web_link) window.open(x.web_link, '_blank', 'noopener');
      } catch (err) { busy(false); toast(err?.message || 'Non è partita', 'err', 8000); }
    };
    const titleOf = { rispondi: `Rispondi a ${firstName(people.a[0]?.name) || people.a[0]?.address || ''}`, tutti: 'Rispondi a tutti', inoltra: `Inoltra · «${e.subject}»` }[mode];
    const panel = box('pm-draft', titleOf, '',
      h('div.pm-rcpt-box', row('a'), row('cc')),
      mode === 'inoltra' ? null : h('div.pm-alma', alma, free),
      tone,
      text,
      redoRow,
      attBox, picker,
      sigBox,
      h('div.pm-draft-f',
        h('span', 'Non parte niente da solo: la mandi tu, oppure la trovi tra le Bozze di Outlook. Sotto la firma va l\'email originale.'),
        h('button.cv-lnk', { type: 'button', on: { click: () => panel.remove() } }, 'Chiudi'),
        h('button.btn', { type: 'button', on: { click: () => send(true) } }, 'Salva tra le bozze di Outlook'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => send(false) } }, ic(mode === 'inoltra' ? 'forward' : 'send', 14), mode === 'inoltra' ? 'Inoltra' : mode === 'tutti' ? 'Invia a tutti' : 'Invia')));
    panel.dataset.mode = mode;
    panel.querySelector('.pm-aip-h').append(cost);
    drawAtts();
    aiBox.append(panel);
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    (mode === 'inoltra' ? panel.querySelector('.pm-rcpt-i') : text).focus();
  }

  // Scorciatoie (Dante 22/11): S riassunto · R rispondi · A rispondi a tutti · V sposta · Canc elimina · J/K email dopo/prima.
  // Mai mentre si scrive in un campo.
  const keys = ev => {
    if (!container.isConnected) { document.removeEventListener('keydown', keys); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
    const t = ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('#overlay-root > *')) return;
    const k = ev.key.toLowerCase();
    const at = st.list.findIndex(m => m.id === st.sel);
    const run = fn => { if (fn) { ev.preventDefault(); fn(); } };
    if (k === 's') run(st.act?.riassumi);
    else if (k === 'r') run(st.act?.rispondi);
    else if (k === 'a') run(st.act?.tutti);
    else if (k === 'f') run(st.act?.inoltra);
    else if (k === 'v') run(st.act?.sposta);
    else if (k === 'delete' || k === '#') run(st.act?.elimina);
    else if (k === 'j') run(st.list[at + 1] ? () => open(st.list[at + 1]) : null);
    else if (k === 'k') run(at > 0 ? () => open(st.list[at - 1]) : null);
  };
  document.addEventListener('keydown', keys);

  async function addToProject(e) {
    const { projects } = await get('/api/crm/progetti?vista=miei');
    const m = cvModal({ title: 'Aggiungi a un progetto', body: projects.length ? h('div.pm-pick', projects.map(p => h('button.pm-pick-i', { type: 'button', on: { click: async () => {
      await post(`/api/projects/${p.id}/emails`, { message_ids: [e.id] });
      m.close(); toast(`Email aggiunta a «${p.name}»`); open({ id: e.id });
    } } }, h('b', p.name), h('small', p.steps?.[p.step] || '')))) : emptyState('folder', 'Non segui ancora nessun progetto del CRM.') });
  }
  load();
}

// ═══ Dalla email: contatto, azienda, opportunità (tavola F, ALM2-58) ══════════════════════════════
function fromMailBar(e, again) {
  const c = e.crm;
  if (!c) return null;
  const NOT = (t = 'non nel CRM') => pill(t, 'or');
  const IN = () => pill('nel CRM', 'gr');
  const people = c.people || [];
  const newPeople = people.filter(p => p.kind === 'nuova');
  const addContact = async p => {
    const pick = p || (newPeople.length === 1 ? newPeople[0] : await choosePerson(newPeople.length ? newPeople : people));
    if (!pick) return;
    const { openContactFromMail } = await import('./crm-scrivo.js');
    const r = await openContactFromMail({ email: pick.email, name: pick.name });
    if (r === 'ok') again();
  };
  const tiles = [];
  if (c.company && c.company.kind !== 'personale') {
    tiles.push(h('div.pm-ft', h('span.pm-ft-k', 'Azienda · dal dominio e dalla firma'), h('b', c.company.name), c.company.kind === 'crm' ? IN() : NOT(),
      c.company.kind === 'crm' ? h('a', { href: `#/crm/scheda/${c.company.subject_id}` }, 'Apri la scheda ›') : h('button.cv-lnk', { type: 'button', on: { click: () => addCompany(e, again) } }, 'Aggiungi azienda ›')));
  }
  for (const p of people.slice(0, 3)) {
    tiles.push(h('div.pm-ft', h('span.pm-ft-k', p.role === 'ha scritto' ? 'Ha scritto' : p.role === 'in copia' ? 'In copia' : 'Destinatario'), h('b', p.name || p.email),
      p.job || p.subject ? h('small', [p.job, p.subject].filter(Boolean).join(' · ')) : h('small', p.email), p.kind === 'crm' ? IN() : NOT(),
      p.kind === 'crm' ? h('a', { href: `#/crm/contatti/${p.contact_id}` }, 'Apri la scheda ›') : h('button.cv-lnk', { type: 'button', on: { click: () => addContact(p) } }, 'Aggiungi contatto ›')));
  }
  const o = c.opportunity || {};
  tiles.push(h('div.pm-ft', h('span.pm-ft-k', 'Opportunità'),
    o.project ? [h('b', o.project.name), pill('in un progetto', 'gr'), h('a', { href: `#/crm/progetto/${o.project.id}` }, 'Apri il progetto ›')]
      : o.signal ? [h('b', o.signal.title), pill('nel Radar', 'gr'), h('a', { href: `#/crm/lancio/s/${o.signal.id}` }, 'Portala avanti ›')]
        : [h('b', [o.title, o.importo ? `circa ${eur(o.importo)}` : null].filter(Boolean).join(', ')), o.scadenza ? h('small', `offerte entro ${fmtDate(o.scadenza, { year: true })}`) : null,
          pill('non nel Radar', ''), h('button.cv-lnk', { type: 'button', on: { click: () => addOpportunity(e) } }, 'Aggiungi opportunità ›')]));
  const btn = (label, fn, off) => h('button.btn.btn-sm', { type: 'button', disabled: off || undefined, on: { click: fn } }, ic('plus', 13), label);
  return h('section.pm-from',
    h('div.pm-from-h', h('span.pm-hint-k', 'Dalla email · cosa c\'è già nel CRM'),
      btn('Contatto', () => addContact(null), !people.length),
      btn('Azienda', () => addCompany(e, again), !c.company || c.company.kind === 'personale'),
      btn('Opportunità', () => addOpportunity(e), Boolean(o.project || o.signal))),
    h('div.pm-ftiles', tiles));
}

function choosePerson(list) {
  return new Promise(resolve => {
    let done = false;
    const m = cvModal({ title: 'Quale persona dell\'email?', body: h('div.pm-pick', list.map(p => h('button.pm-pick-i', { type: 'button', on: { click: () => { done = true; m.close(); resolve(p); } } },
      h('b', p.name || p.email), h('small', [p.role, p.email, p.kind === 'crm' ? 'già nel CRM' : null].filter(Boolean).join(' · '))))),
    onClose: () => { if (!done) resolve(null); } });
  });
}

// Aggiungi azienda: nome, sito, città dalla firma e dal dominio; categoria e ASA; l'email resta collegata
function addCompany(e, again) {
  const c = e.crm.company || {};
  const lead = (e.crm.people || []).find(p => p.role === 'ha scritto' && p.kind === 'nuova');
  const name = h('input.input', { value: c.name || '' });
  const site = h('input.input', { value: c.domain || '' });
  const city = h('input.input', { value: c.city || '' });
  let role = 'lead';
  const roles = h('div.pm-roles');
  const drawRoles = () => fill(roles, [['lead', 'Lead'], ['cliente', 'Cliente'], ['fornitore', 'Fornitore'], ['partner', 'Partner']].map(([k, l]) => h('button.cv-pill.big', { type: 'button', class: role === k ? 'dark' : 'line', 'aria-pressed': String(role === k), on: { click: () => { role = k; drawRoles(); } } }, l)));
  drawRoles();
  const asa = h('select.select', e.crm.asa.map(a => h('option', { value: a.key }, a.label)));
  const linkMail = h('input', { type: 'checkbox', checked: true });
  const alsoLead = h('input', { type: 'checkbox', checked: Boolean(lead) });
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!name.value.trim()) return toast('Scrivi il nome dell\'azienda', 'err');
    save.disabled = true;
    try {
      const s = await post('/api/crm/subjects/rapida', { name: name.value.trim(), website: site.value.trim() || undefined, city: city.value.trim() || undefined, roles: [role], asa: asa.value, origin: 'Posta Outlook' });
      if (linkMail.checked) await post(`/api/crm/subjects/${s.id}/emails`, { message_ids: [e.id] }, { quiet: true }).catch(() => {});
      m.close();
      toast(s.existing ? `«${s.name}» era già nel CRM: email collegata` : `«${s.name}» è nel CRM`);
      if (alsoLead.checked && lead) {
        const { openContactFromMail } = await import('./crm-scrivo.js');
        await openContactFromMail({ email: lead.email, name: lead.name });
      }
      again();
    } catch { save.disabled = false; }
  } } }, 'Crea azienda');
  const m = cvModal({ title: h('div.pp-title', h('span.pp-k', 'Aggiungi azienda · dal dominio e dalla firma'), h('h2', c.name || 'Nuova azienda')),
    body: h('div.dl-form',
      h('label.field', h('span', 'Nome'), name),
      h('div.dl-form2', h('label.field', h('span', 'Sito'), site), h('label.field', h('span', 'Città'), city)),
      h('div.field', h('span', 'Categoria'), roles),
      h('label.field', h('span', 'ASA'), asa),
      h('label.pm-chk', linkMail, 'Collega questa email all\'azienda'),
      lead ? h('label.pm-chk', alsoLead, `Aggiungi anche ${lead.name} (dalla firma)`) : null),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), save] });
}

// Aggiungi opportunità: Alma legge la conversazione, la scheda corta e «Salva nel Radar» (o tutti i dettagli)
async function addOpportunity(e) {
  const body = h('div.dl-form', h('div.pp-wait', loading(), h('p', 'Alma sta leggendo la conversazione…')));
  const m = cvModal({ title: h('div.pp-title', h('span.pp-k', 'Aggiungi opportunità'), h('h2', 'Alma sta leggendo la conversazione')), body });
  let r;
  try { r = await post('/api/crm/posta/proposta', { message_id: e.id }); } catch { m.close(); return; }
  if (r.already) { m.close(); location.hash = r.already.project_id ? `#/crm/progetto/${r.already.project_id}` : `#/crm/lancio/s/${r.already.signal_id}`; return; }
  m.head.querySelector('.pp-k').textContent = `Aggiungi opportunità · Alma ha letto ${r.messages.length} email`;
  m.head.querySelector('h2').textContent = r.fields.title;
  const f = { ...r.fields };
  const inp = (k, attrs = {}) => h('input.input', { value: f[k] ?? '', ...attrs, on: { input: ev => { f[k] = ev.target.value; } } });
  const amount = h('input.input', { value: f.importo ? `circa ${eur(f.importo)}` : (f.importo_testo || ''), on: { input: ev => { const v = ev.target.value; const n = Number(v.replace(/[^\d,]/g, '').replace(',', '.')); f.importo = /milion|mln|m€/i.test(v) && n ? Math.round(n * 1e6) : n > 1000 ? Math.round(n) : f.importo; } } });
  let company = r.company?.kind === 'crm' ? { subject_id: r.company.subject_id } : r.company?.kind === 'nuova' ? { new: { name: r.company.name, domain: r.company.domain } } : null;
  const coSel = h('select.select', { on: { change: ev => { const v = ev.target.value; company = v === 'new' ? { new: { name: r.company?.name || '', domain: r.company?.domain || '' } } : v ? { subject_id: Number(v) } : null; } } },
    r.company?.kind === 'nuova' ? h('option', { value: 'new' }, `${r.company.name} · nuova, lead`) : null,
    r.company_options.map(o => h('option', { value: String(o.subject_id), selected: r.company?.subject_id === o.subject_id }, `${o.name} · nel CRM`)),
    h('option', { value: '' }, 'Nessuna azienda'));
  const bu = h('select.select', { on: { change: ev => { f.bu = ev.target.value; } } }, h('option', { value: '' }, '—'), r.asa.map(a => h('option', { value: a.key, selected: a.key === f.bu }, a.label)));
  const radar = new Set(r.insights.filter(x => x.signal_id).map(x => x.signal_id));
  const top = r.insights.find(x => x.signal_id) || r.insights[0];
  fill(body,
    h('label.field', h('span', 'Titolo'), inp('title')),
    h('label.field', h('span', 'Cosa'), inp('cosa')),
    h('div.dl-form2', h('label.field', h('span', 'Importo'), amount), h('label.field', h('span', 'Offerte entro'), inp('scadenza', { type: 'date' }))),
    h('label.field', h('span', 'Azienda'), coSel),
    h('label.field', h('span', 'BU'), bu),
    top ? h('div.pm-know', h('span', 'Cosa sa già il CRM: '), top.text) : null,
    h('small.cv-muted', 'Finisce nel Radar con la conversazione collegata. La porti avanti quando vuoi, con la sala di lancio.'));
  const people = r.people.map(p => ({ ...p, on: p.kind !== 'nuova' }));
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!String(f.title || '').trim()) return toast('Scrivi il titolo', 'err');
    save.disabled = true;
    try {
      await post('/api/crm/posta/crea', { conversation_id: r.conversation_id, message_id: r.message_id, fields: f, company, people, extra_ids: [], link_signal_ids: [...radar] });
      m.close(); toast('Opportunità nel Radar, con la conversazione collegata'); location.hash = '#/crm/radar';
    } catch { save.disabled = false; }
  } } }, 'Salva nel Radar');
  m.box.append(h('div.modal-foot', h('div.left'), h('button.btn', { type: 'button', on: { click: () => { m.close(); openProposal(e.id); } } }, 'Tutti i dettagli'), save));
}

// ═══ Cosa ha capito Alma (tavola B) ═══════════════════════════════════════════════════════════════
// from: { message_id } oppure { email } (da «Persone con cui mi scrivo»: l'ultima email di quella persona)
export async function openProposal(messageId, from = {}) {
  const body = h('div.pp', h('div.pp-wait', loading(), h('p', 'Alma sta leggendo la conversazione…')));
  const m = cvModal({ title: h('div.pp-title', h('span.pp-k', 'Nuovo progetto commerciale · da email'), h('h2', 'Alma sta leggendo la conversazione')), body, size: 'xl' });
  m.box.classList.add('pp-dlg');
  let r;
  try { r = await post('/api/crm/posta/proposta', { ...(messageId ? { message_id: messageId } : {}), ...from }); } catch { m.close(); return; }
  if (r.already) { m.close(); location.hash = r.already.project_id ? `#/crm/progetto/${r.already.project_id}` : `#/crm/lancio/s/${r.already.signal_id}`; return; }
  m.head.querySelector('h2').textContent = `Alma ha letto ${r.messages.length} ${r.messages.length === 1 ? 'email' : 'email'} della conversazione «${r.subject}»`;
  const f = { ...r.fields };
  const people = r.people.map(p => ({ ...p }));
  const extra = new Set();
  const radar = new Set();
  let company = r.company?.kind === 'crm' ? { subject_id: r.company.subject_id } : r.company?.kind === 'nuova' ? { new: { name: r.company.name, domain: r.company.domain } } : null;
  const inp = (k, label, attrs = {}) => { const i = h('input.input', { value: f[k] ?? '', 'aria-label': label, ...attrs, on: { input: e => { f[k] = attrs.type === 'number' ? Number(e.target.value) || null : e.target.value; } } }); return i; };
  const tile = (k, label, tone = '') => h('label.pp-tile', { class: tone }, h('span', label), h('textarea', { rows: 2, 'aria-label': label, on: { input: e => { f[k] = e.target.value; } } }, f[k] || ''));
  const coSel = h('select.select', { 'aria-label': 'Azienda', on: { change: e => {
    const val = e.target.value;
    company = val === 'new' ? { new: { name: r.company?.name || '', domain: r.company?.domain || '' } } : val ? { subject_id: Number(val) } : null;
  } } },
  r.company?.kind === 'nuova' ? h('option', { value: 'new' }, `${r.company.name} · nuova, da creare`) : null,
  r.company_options.map(o => h('option', { value: String(o.subject_id), selected: r.company?.subject_id === o.subject_id }, `${o.name} · nel CRM`)),
  h('option', { value: '' }, 'Nessuna azienda'));
  const buSel = h('select.select', { 'aria-label': 'BU', on: { change: e => { f.bu = e.target.value; } } }, h('option', { value: '' }, '—'), r.asa.map(a => h('option', { value: a.key, selected: a.key === f.bu }, a.label)));
  const tipoSel = h('select.select', { 'aria-label': 'Tipo di progetto', on: { change: e => { f.tipo = e.target.value; } } }, [['trattativa', 'Trattativa privata'], ['gara', 'Gara']].map(([k, l]) => h('option', { value: k, selected: f.tipo === k }, l)));
  const tag = p => p.kind === 'crm' ? pill('nel CRM', 'gr') : p.kind === 'collega' ? pill('entra in squadra', '') : pill('nuova, dalla firma', 'or');
  const left = h('div.pp-l',
    h('label.pp-f', h('span', 'Titolo del progetto'), inp('title', 'Titolo del progetto')),
    h('div.pp-f', h('span', 'Il concetto, come l\'ha capito Alma'),
      h('div.pp-tiles', tile('cosa', 'Cosa'), tile('dove', 'Dove'), tile('per_chi', 'Per chi'),
        h('label.pp-tile', h('span', 'Importo'), h('textarea', { rows: 2, 'aria-label': 'Importo', on: { input: e => { f.importo_testo = e.target.value; const n = Number(String(e.target.value).replace(/[^\d,]/g, '').replace(',', '.')); if (/milion|mln|m€/i.test(e.target.value) && n) f.importo = Math.round(n * 1e6); else if (n > 1000) f.importo = Math.round(n); } } }, f.importo ? `circa ${eur(f.importo)}${f.importo_testo ? ` (${f.importo_testo})` : ''}` : (f.importo_testo || ''))),
        tile('tempi', 'Tempi'), tile('prossimo_passo', 'Prossimo passo', 'or'))),
    h('div.pp-row3',
      h('label.pp-f', h('span', 'Azienda'), coSel, h('small', f.committente ? `Committente: ${f.committente}` : 'Il committente si aggiunge quando ha un nome')),
      h('label.pp-f', h('span', 'BU'), buSel, h('small', 'dalle parole della email')),
      h('label.pp-f', h('span', 'Tipo di progetto'), tipoSel, h('small', 'gara se si parla di bando o CIG')),
      h('label.pp-f', h('span', 'Offerte entro'), inp('scadenza', 'Offerte entro', { type: 'date' }), h('small', 'dalla email'))),
    h('div.pp-f', h('span', 'Persone da collegare'),
      people.length ? h('div.pp-people', people.map(p => h('label.pp-person',
        h('input', { type: 'checkbox', checked: p.on, on: { change: e => { p.on = e.target.checked; } } }),
        h('span.pp-grow', h('b', p.name || p.email), [p.job, p.subject || (p.kind === 'nuova' ? p.company?.name : ''), p.mobile ? `cell. ${p.mobile}` : ''].filter(Boolean).length ? ` · ${[p.job, p.subject || (p.kind === 'nuova' ? p.company?.name : ''), p.mobile ? `cell. ${p.mobile}` : ''].filter(Boolean).join(', ')}` : ` · ${p.email}`),
        tag(p), h('small.cv-muted', p.role)))) : h('p.cv-muted', 'Nessuna persona oltre a te.')),
    h('div.pp-f', h('span', 'Email che entrano nel progetto'),
      h('div.pp-mails',
        h('span', h('b', `${r.messages.length} ${r.messages.length === 1 ? 'email' : 'email'}`), ` della conversazione${r.messages.length > 1 ? `, dal ${fmtDate(String(r.messages[0].date).slice(0, 10))} a oggi` : ''}${r.attachments.length ? `, con ${r.attachments.length} ${r.attachments.length === 1 ? 'allegato' : 'allegati'} (${r.attachments.join(', ')})` : ''}`),
        h('span.cv-muted', 'Le risposte nuove a questa conversazione si aggiungeranno da sole.'),
        r.extra.map(x => h('label.pp-extra', h('input', { type: 'checkbox', on: { change: e => { if (e.target.checked) extra.add(x.id); else extra.delete(x.id); } } }),
          h('span', `Anche «${x.subject}» di ${x.from.name || x.from.address} (${fmtDate(String(x.date).slice(0, 10))}): ${x.why}`))))));
  const right = h('aside.pp-r',
    h('div.pp-r-h', h('span.pp-k', 'Cosa sa già il CRM'), h('small', 'Legami trovati con persone, azienda e tema')),
    r.insights.length ? r.insights.map(x => h('div.pp-ins', { class: x.kind === 'attenzione' ? 'warn' : '' },
      h('b', x.title), h('span', x.text),
      x.signal_id ? h('label.pp-ins-c', h('input', { type: 'checkbox', checked: true, on: { change: e => { if (e.target.checked) radar.add(x.signal_id); else radar.delete(x.signal_id); } } }), 'collegala al progetto') : null,
      x.link ? h('a', { href: x.link, target: '_blank' }, `${x.link_label || 'Apri'} ›`) : null))
      : h('div.pp-ins', h('span', 'Niente nel CRM per ora: azienda, persone e tema sono nuovi.')),
    h('small.pp-r-f', 'Ogni legame dice da dove viene. Alma non inventa: se un dato manca, lo scrive.'));
  for (const x of r.insights) if (x.signal_id) radar.add(x.signal_id);
  fill(body, h('div.pp-grid', left, right));
  const save = async mode => {
    if (!String(f.title || '').trim()) return toast('Scrivi il titolo del progetto', 'err');
    btns.forEach(b => { b.disabled = true; });
    try {
      const out = await post('/api/crm/posta/crea', { conversation_id: r.conversation_id, message_id: r.message_id, fields: f, company, people, extra_ids: [...extra], link_signal_ids: [...radar] });
      m.close();
      if (mode === 'radar') { toast('Salvata nel Radar: la porti avanti quando vuoi'); location.hash = '#/crm/radar'; } else location.hash = `#/crm/lancio/s/${out.signal_id}`;
    } catch { btns.forEach(b => { b.disabled = false; }); }
  };
  const btns = [h('button.btn', { type: 'button', on: { click: () => save('radar') } }, 'Salva solo nel Radar'), h('button.btn.btn-primary', { type: 'button', on: { click: () => save('lancio') } }, 'Avanti: sala di lancio')];
  body.append(h('div.pp-foot', h('span.cv-muted', 'Niente è ancora salvato. Con «Avanti» vai alla sala di lancio.'), ...btns));
}

// L'ultima email di una persona (da «Persone con cui mi scrivo») → proposta
export async function proposalFromPerson(email) {
  const r = await get(`/api/crm/posta?q=${encodeURIComponent(email)}`);
  const m = r.messages.find(x => x.from.address === email) || r.messages[0];
  if (!m) return toast('Non trovo email di questa persona nella tua casella', 'err');
  if (m.project) { location.hash = `#/crm/progetto/${m.project.id}`; return; }
  return openProposal(m.id);
}

// ═══ Scheda del progetto nato da una email (tavola D) ═════════════════════════════════════════════
export async function loadDeal(id) { return get(`/api/crm/progetti/${id}/trattativa`, { quiet: true }).catch(() => null); }

// testata scura: in breve, a chi tocca, tappe, quattro numeri; sotto la prossima mossa
export function dealHero({ info, deal, p, member, stepper, actions, reload, id }) {
  const s = info.source || {};
  const ball = deal.ball;
  const temp = deal.temperature;
  const hoursGoal = deal.hours_goal || Number(info.goal.hours) || 0;
  const kind = info.kind === 'gara' ? 'Gara' : 'Trattativa privata';
  const glass = (k, v, sub, tone = '') => h('div.pv-glass', { class: tone }, h('span.pv-k', k), h('b', v), sub ? h('small', sub) : null);
  const hero = h('section.pv-hero.pv-phero.dl-hero', { style: { '--acc': '#FF8A26' } },
    h('div.pv-row.top',
      h('div.pv-grow',
        h('a.pv-back.light', { href: '#/crm/progetti' }, ic('chevron-left', 14), 'I miei progetti'),
        h('span.pv-kicker', [kind, s.bu_label, deal.has_mail ? 'nata da una email' : null].filter(Boolean).join(' · ')),
        h('h1.pv-ptitle', p.name),
        deal.summary ? h('p.dl-brief', h('span', 'In breve, secondo Alma: '), deal.summary) : h('p.pv-hero-sub', [s.entity, `responsabile ${info.owner_name || '—'}`].filter(Boolean).join(' · '))),
      h('div.pv-hero-r',
        ball ? h('span.dl-ball', { class: ball.who }, ball.who === 'noi' ? 'Tocca a noi rispondere' : 'Tocca a loro', ` · da ${timeAgo(ball.since).replace(/^\s*fa\s*/, '')}`) : null,
        h('div.pv-hero-act', actions))),
    stepper,
    h('div.pv-glasses',
      glass('Valore pesato', info.weighted ? eur(info.weighted) : '—', info.goal.value ? `${eur(info.goal.value)} al ${info.goal.probability || 0}%` : 'valore da fissare'),
      glass('Termometro', temp ? temp.label : '—', temp?.why || 'dalle email e dagli incontri', temp?.level === 'caldo' ? 'hot' : temp?.level === 'freddo' ? 'cold' : ''),
      glass('All\'offerta', deal.days_to_offer == null ? '—' : deal.days_to_offer < 0 ? 'scaduta' : `${deal.days_to_offer} ${deal.days_to_offer === 1 ? 'giorno' : 'giorni'}`, deal.deadline ? `consegna ${fmtDate(deal.deadline, { year: true })}` : 'scadenza da capire'),
      glass('Ore spese', `${deal.hours} di ${hoursGoal || '—'}`, 'dal rendiconto')));
  const nm = deal.next_move;
  const move = nm ? h('section.dl-move',
    h('span.dl-move-i', ic('sparkles', 20)),
    h('div.dl-move-t', h('b', 'La prossima mossa'), h('span', nm.text)),
    member ? [
      h('button.btn', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/mossa`, {}); toast('Fatto'); reload(); } } }, 'Fatto'),
      nm.kind === 'incontro' || /incontr|sopralluog/i.test(nm.text) ? h('button.btn', { type: 'button', on: { click: () => meetingDialog(id, guessMeeting(nm.text, deal, info), reload) } }, 'Crea l\'incontro') : null,
      deal.has_mail ? h('button.btn.btn-primary', { type: 'button', on: { click: () => replyDialog(id, reload) } }, 'Prepara la risposta') : null] : null) : null;
  return [hero, move];
}

// «giovedì 27 alle 10» → { date, time }
function guessMeeting(text, deal, info) {
  const t = String(text).toLowerCase();
  let date = addDays(today(), 3), time = '10:00';
  const d = t.match(/(lunedì|martedì|mercoledì|giovedì|venerdì|sabato)?\s*(\d{1,2})(?:[/.](\d{1,2}))?\s*(?:alle|ore)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (d) {
    const now = new Date(`${today()}T12:00:00`);
    let y = now.getFullYear(), mo = d[3] ? Number(d[3]) : now.getMonth() + 1;
    if (!d[3] && Number(d[2]) < now.getDate()) mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
    date = `${y}-${String(mo).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;
    time = `${String(d[4]).padStart(2, '0')}:${d[5] || '00'}`;
  }
  const subject = /sopralluog/.test(t) ? `Sopralluogo · ${info.source?.entity || ''}`.replace(/ · $/, '') : `Incontro · ${info.source?.entity || ''}`.replace(/ · $/, '');
  const attendees = [...new Set((deal.stakeholders || []).map(s => s.email).filter(Boolean))];
  return { subject, date, time, attendees };
}

function meetingDialog(id, g, done) {
  const subj = h('input.input', { value: g.subject });
  const day = h('input.input', { type: 'date', value: g.date });
  const from = h('input.input', { type: 'time', value: g.time });
  const to = h('input.input', { type: 'time', value: `${String(Math.min(23, Number(g.time.slice(0, 2)) + 1)).padStart(2, '0')}:${g.time.slice(3, 5)}` });
  const where = h('input.input', { placeholder: 'facoltativo' });
  const att = h('input.input', { value: g.attendees.join(', ') });
  const go = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    go.disabled = true;
    try {
      await post(`/api/projects/${id}/meetings/new`, { title: subj.value.trim(), start: `${day.value}T${from.value}`, end: `${day.value}T${to.value}`, location: where.value, attendees: att.value.split(/[,;\s]+/).filter(Boolean) });
      m.close(); toast('Incontro nel tuo calendario Outlook, collegato al progetto'); done?.();
    } catch { go.disabled = false; }
  } } }, 'Fissa l\'incontro');
  const m = cvModal({ title: 'Crea l\'incontro', body: h('div.dl-form', h('label.field', h('span', 'Titolo'), subj), h('div.dl-form3', h('label.field', h('span', 'Giorno'), day), h('label.field', h('span', 'Dalle'), from), h('label.field', h('span', 'Alle'), to)),
    h('label.field', h('span', 'Luogo'), where), h('label.field', h('span', 'Invitati'), att), h('small.cv-muted', 'Va nel tuo calendario di Outlook con gli invitati e resta collegato al progetto.')),
  actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go] });
}

async function replyDialog(id, done) {
  const text = h('textarea.input', { rows: 10 }, '');
  const info = h('div.cv-muted.dl-to', loading());
  const send = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: async () => {
    if (!text.value.trim()) return toast('Scrivi la risposta', 'err');
    send.disabled = true;
    try { await post(`/api/crm/progetti/${id}/risposta`, { text: text.value }); m.close(); toast('Risposta inviata a tutti, nella stessa conversazione'); done?.(); } catch { send.disabled = false; }
  } } }, 'Invia a tutti');
  const m = cvModal({ title: 'Prepara la risposta', body: h('div.dl-form', info, h('label.field', h('span', 'Risposta (Alma l\'ha preparata, cambiala come vuoi)'), text)), wide: true,
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send] });
  const d = await post(`/api/crm/progetti/${id}/risposta/bozza`, {}).catch(() => null);
  if (!d) return m.close();
  text.value = d.text;
  fill(info, h('span', h('b', d.subject), ` · a ${d.to.join(', ')}`), h('small', 'Parte dalla tua casella come «Rispondi a tutti».'));
  send.disabled = false;
  text.focus();
}

// Panoramica: cronologia con le note a sinistra; impegni, chi conta, legami a destra
export async function dealOverview(box, { id, p, info, deal, member, reload, team }) {
  const subjects = (info.links || []).filter(l => l.subject_id && !l.contact_id);
  const tl = h('div.dl-tl', loading());
  let filter = 'all';
  const filters = h('div.dl-filters');
  const drawFilters = () => fill(filters, [['all', 'Tutto'], ['email', 'Email'], ['note', 'Note'], ['meeting', 'Incontri']].map(([k, l]) => h('button.cv-pill', { type: 'button', class: filter === k ? 'dark' : 'line', 'aria-pressed': String(filter === k), on: { click: () => { filter = k; drawFilters(); drawTl(); } } }, l)));
  drawFilters();
  let items = [];
  const drawTl = () => {
    const shown = items.filter(i => filter === 'all' || i.type === filter);
    if (!shown.length) return fill(tl, emptyState('clock', 'Ancora niente qui.'));
    fill(tl, shown.slice(0, 14).map(i => h('div.dl-item', { class: i.type },
      h('span.dl-ico', i.type === 'email' ? '@' : i.type === 'note' ? 'N' : ic('calendar', 13)),
      h('div.dl-item-b',
        h('div.dl-item-h', h('b', i.type === 'note' ? `${userName(i.author_id) || '—'} · ${i.kind === 'nota' ? 'nota' : i.kind}` : i.type === 'email' ? `${i.who} · email` : `Incontro · ${i.title}`),
          h('small', [when(i.at), i.auto ? 'entrata da sola' : null].filter(Boolean).join(' · '))),
        h('span', i.type === 'email' ? (i.body || i.title) : i.type === 'note' ? [i.title ? `${i.title}: ` : '', i.body] : i.body),
        i.files ? h('small.cv-muted', `${i.files} ${i.files === 1 ? 'allegato' : 'allegati'}`) : null))),
    shown.length > 14 ? h('small.cv-muted', `+ ${shown.length - 14} voci più vecchie · email, note e incontri in un'unica fila`) : null);
  };
  const loadTl = async () => { items = (await get(`/api/crm/progetti/${id}/cronologia`)).items; drawTl(); };

  // nuova nota: @ per avvisare, «Squadra» menziona tutta la squadra, allegato, a voce; va anche sull'azienda
  const noteIn = h('textarea.dl-note-in', { rows: 2, placeholder: 'Scrivi una nota… @ per avvisare un collega', 'aria-label': 'Nuova nota' });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true });
  const filesLbl = h('small.cv-muted');
  fileIn.addEventListener('change', () => { filesLbl.textContent = fileIn.files.length ? `${fileIn.files.length} ${fileIn.files.length === 1 ? 'file' : 'file'}` : ''; });
  const alsoOn = h('input', { type: 'checkbox', checked: subjects.length > 0 });
  let rec = null;
  const voiceBtn = h('button.cv-pill.line', { type: 'button', on: { click: () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Questo browser non sa dettare: usa Chrome o Edge', 'err');
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) noteIn.value = `${noteIn.value}${noteIn.value && !/\s$/.test(noteIn.value) ? ' ' : ''}${e.results[k][0].transcript.trim()}`; };
    rec.onend = () => { rec = null; voiceBtn.classList.remove('rec'); voiceBtn.lastChild.textContent = 'A voce'; };
    rec.start(); voiceBtn.classList.add('rec'); voiceBtn.lastChild.textContent = 'Sto ascoltando… tocca per fermare';
  } } }, ic('mic', 13), h('span', 'A voce'));
  const saveNote = h('button.btn.btn-sm.dl-save', { type: 'button', on: { click: async () => {
    const text = noteIn.value.trim();
    if (!text && !fileIn.files.length) return toast('Scrivi la nota', 'err');
    saveNote.disabled = true;
    try {
      const n = await post(`/api/projects/${id}/notes`, { body: text || '(file)', note_date: today(), kind: 'nota' });
      if (fileIn.files.length) await uploadNoteFiles(n.id, [...fileIn.files]);
      if (alsoOn.checked) for (const s of subjects) await post(`/api/crm/subjects/${s.subject_id}/notes`, { body: `${text}\n\n(dal progetto «${p.name}»)`, note_date: today(), kind: 'nota' }).catch(() => {});
      noteIn.value = ''; fileIn.value = ''; filesLbl.textContent = '';
      toast('Nota salvata');
      loadTl();
    } finally { saveNote.disabled = false; }
  } } }, 'Salva nota');
  noteIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote.click(); });
  const composer = member ? h('div.dl-note',
    h('label.dl-note-k', { for: 'dl-note' }, 'Nuova nota'),
    withMentions(Object.assign(noteIn, { id: 'dl-note' })),
    h('div.dl-note-a',
      h('button.cv-pill.line', { type: 'button', title: 'Avvisa tutta la squadra', on: { click: () => {
        const tags = team.filter(u => u.id !== store.me.id).map(u => `@${handleOf(store.users.find(x => x.id === u.id))}`).filter(t => t.length > 1);
        noteIn.value = `${noteIn.value}${noteIn.value && !/\s$/.test(noteIn.value) ? ' ' : ''}${tags.join(' ')} `; noteIn.focus();
      } } }, ic('users', 13), 'Squadra'),
      h('button.cv-pill.line', { type: 'button', on: { click: () => fileIn.click() } }, ic('paperclip', 13), 'Allegato'), fileIn,
      voiceBtn, filesLbl,
      h('span.dl-grow'),
      subjects.length ? h('label.dl-also', alsoOn, `anche su ${subjects.map(s => s.subject_name).join(', ')}`) : null,
      saveNote)) : null;

  // destra
  const STATE = { compito: 'compito creato', promemoria: 'promemoria creato', fatto: 'fatto', in_calendario: 'in calendario' };
  const WHO = { noi: ['noi', 'rd'], loro: ['loro', 'bl'], fissato: ['fissato', 'gr'] };
  const act = async (i, azione) => { await post(`/api/crm/progetti/${id}/impegni/${i}`, { azione }); toast(azione === 'compito' ? 'Compito creato e assegnato a te' : azione === 'ricorda' ? 'Te lo ricordo: promemoria tra i tuoi compiti' : 'Segnato'); reload(); };
  const commitments = h('section.pv-card.dl-card', h('h3', 'Impegni presi nelle email'),
    deal.commitments.length ? deal.commitments.map(c => h('div.dl-cm', h('span.dl-who', { class: WHO[c.who][1] }, WHO[c.who][0]),
      h('span.dl-grow', c.text, c.by ? h('small.cv-muted', ` · ${c.by}${c.date ? `, ${fmtDate(c.date)}` : ''}`) : null),
      c.state ? h('small.dl-done', ic('check', 12), STATE[c.state]) : member ? (c.who === 'noi' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => act(c.i, 'compito') } }, 'Compito')
        : c.who === 'loro' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => act(c.i, 'ricorda') } }, 'Ricordamelo')
          : h('button.btn.btn-sm.btn-dark', { type: 'button', on: { click: () => meetingDialog(id, guessMeeting(c.text, deal, info), () => act(c.i, 'calendario')) } }, 'In calendario')) : null))
      : h('p.cv-muted', 'Nessun impegno trovato nelle email per ora.'));
  const ROLE = { decide: 'Decide', influenza: 'Influenza', operativa: 'Operativa' };
  const who = h('section.pv-card.dl-card', h('h3', 'Chi conta in questa trattativa'),
    deal.stakeholders.length ? ['decide', 'influenza', 'operativa'].flatMap(r => deal.stakeholders.filter(s => s.role === r).map(s => h('div.dl-sh',
      h('span.dl-sh-k', ROLE[r]),
      h('span', h('b', s.name), s.why ? ` · ${s.why}` : ''),
      r === 'decide' && !s.contact_id ? h('a', { href: `#/alma?q=${encodeURIComponent(`Chi conosce in Almacis ${s.name}? Cerca nel CRM, nelle email e negli incontri.`)}` }, 'Chi la conosce in Almacis? Chiedi ad Alma ›') : null)))
      : h('p.cv-muted', 'Lo capisco dalle email e dalle firme appena ce ne sono.'));
  const extraCards = [];
  if (deal.new_people.length && member) extraCards.push(h('section.pv-card.dl-card', h('h3', 'Persone nuove nella conversazione'),
    deal.new_people.map(x => h('div.dl-cm', h('span.dl-grow', h('b', x.name || x.email), h('small.cv-muted', ` · ${x.email}`)),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/persone-nuove`, { email: x.email, azione: 'ignora' }); reload(); } } }, 'Non serve'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/persone-nuove`, { email: x.email, azione: 'aggiungi' }); toast('Aggiunta al CRM e collegata al progetto'); reload(); } } }, 'Aggiungi al CRM')))));
  if (deal.suggestions.length && member) extraCards.push(h('section.pv-card.dl-card.dl-sug', h('h3', `Alma suggerisce ${deal.suggestions.length} ${deal.suggestions.length === 1 ? 'email' : 'email'}`),
    deal.suggestions.map(sg => h('div.dl-cm', h('span.dl-grow', h('b', sg.from_name || sg.from_address), `, ${fmtDate(String(sg.sent_at).slice(0, 10))}, «${sg.subject}»: ${sg.why}.`),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/suggerite/${sg.id}`, { azione: 'scarta' }); reload(); } } }, 'Non c\'entra'),
      h('button.btn.btn-sm.btn-dark', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/suggerite/${sg.id}`, { azione: 'aggiungi' }); toast('Email aggiunta al progetto'); reload(); } } }, 'Aggiungi')))));
  const legami = h('section.dl-legami', h('h3', 'Legami nel CRM'),
    deal.insights.length ? deal.insights.map(x => h('div.dl-lg', { class: x.kind === 'attenzione' ? 'warn' : '' }, h('b', `${x.title}: `), x.text, x.link ? [' ', h('a', { href: x.link }, `${x.link_label || 'Apri'} ›`)] : null)) : h('span.dl-lg', 'Niente di collegato per ora.'),
    deal.client ? h('div.dl-client', h('span', `Novità: nelle email compare il committente, «${deal.client.name}».${deal.client.subject_id ? ' È nel CRM ma non è collegato.' : ' Non è nel CRM.'}`),
      member ? h('div.dl-client-a',
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/committente`, { azione: 'aggiungi' }); toast('Committente nel CRM e collegato al progetto'); reload(); } } }, deal.client.subject_id ? 'Collegala' : 'Aggiungila al CRM'),
        h('button.btn.btn-sm.dl-ghost', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/committente`, { azione: 'dopo' }); reload(); } } }, 'Più tardi')) : null) : null,
    h('small.dl-lg-f', deal.updated_at ? `Si aggiornano quando entrano email nuove · ultimo controllo ${timeAgo(deal.updated_at)}` : 'Si aggiornano quando entrano email nuove.'),
    deal.has_mail ? h('button.dl-refresh', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post(`/api/crm/progetti/${id}/posta/aggiorna`, {}).catch(() => {}); reload(); } } }, ic('refresh', 12), 'Controlla adesso le email') : null);

  box.append(h('div.dl-over',
    h('section.pv-card.dl-main', h('div.dl-main-h', h('h3', 'Cronologia'), filters), composer, tl),
    h('aside.dl-side', commitments, ...extraCards, who, legami)));
  loadTl();
}
