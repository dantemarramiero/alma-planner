// Alma nel Calendario del CRM (ALM2-65, tavola I approvata da Dante il 22/11/2026): solo al clic, col costo, come nella
// Posta (stessa catena di modelli economici di lib/crm-posta-ai.js). Senza chiave (test, locale) regole semplici.
// - prepare: «Prepara l'incontro»: da sapere, ultima volta, da chiedere, da portare (da note, email, progetti, Radar).
// - recap: riepilogo ai partecipanti dalle note dell'incontro.
// - invite: testo dell'invito di un incontro nuovo.
const { HttpError } = require('./http');
const { askLight } = require('./crm-posta-ai');

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const first = name => String(name || '').split(' ').filter(w => !/^(ing|arch|geom|dott|avv)\.?$/i.test(w))[0] || '';
const down = what => new HttpError(502, `Alma non riesce a ${what} adesso: riprova tra poco`, 'ai');

function contextText(c) {
  return [
    `Incontro: «${c.event.subject}» il ${c.event.start.slice(0, 16).replace('T', ' ')}${c.event.location ? `, ${c.event.location}` : ''}.`,
    `Partecipanti: ${c.event.attendees.map(a => `${a.name || a.address}${a.crm ? ` (${a.crm})` : ''}`).join('; ') || 'nessuno'}.`,
    c.subjects.length ? `Aziende del CRM: ${c.subjects.join('; ')}.` : '',
    c.projects.length ? `Progetti e trattative: ${c.projects.map(p => `${p.name}${p.summary ? ` — ${clip(p.summary, 300)}` : ''}`).join(' | ')}.` : '',
    c.signals.length ? `Nel Radar: ${c.signals.map(s => `${s.title}${s.deadline ? ` (scadenza ${s.deadline})` : ''}`).join(' | ')}.` : '',
    c.notes.length ? `Note precedenti:\n${c.notes.map(n => `- ${n.date} ${n.title ? `${n.title}: ` : ''}${clip(n.body, 400)}`).join('\n')}` : 'Nessuna nota precedente.',
    c.emails.length ? `Ultime email:\n${c.emails.map(e => `- ${e.date} da ${e.from}: «${e.subject}» ${clip(e.body, 500)}`).join('\n')}` : 'Nessuna email nel CRM.',
  ].filter(Boolean).join('\n');
}

async function prepare(c, ctx = {}) {
  const fallback = {
    da_sapere: [c.projects[0]?.name, c.signals[0] ? `${c.signals[0].title}${c.signals[0].deadline ? `, scadenza ${c.signals[0].deadline.split('-').reverse().join('/')}` : ''}` : null].filter(Boolean).join(' · ') || (c.subjects[0] ? `Con ${c.subjects[0]}.` : 'Niente nel CRM su queste persone.'),
    ultima_volta: c.notes[0] ? `${c.notes[0].date.split('-').reverse().join('/')}: ${clip(c.notes[0].title || c.notes[0].body, 160)}` : c.emails[0] ? `Ultima email ${c.emails[0].date.split('-').reverse().join('/')}: «${c.emails[0].subject}»` : '',
    da_chiedere: '',
    porta: '',
  };
  const ai = await askLight({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 450,
    system: 'Prepari un dirigente di Almacis (costruzioni e impianti) a un incontro. Rispondi SOLO con JSON {"da_sapere","ultima_volta","da_chiedere","porta"}: frasi brevi in italiano, al massimo 2 righe ciascuna, "" se non c\'è niente. Usa solo i fatti dati, non inventare.',
    input: contextText(c),
  }).catch(err => { console.warn('[calendario] preparazione AI non riuscita:', err.message); return null; });
  if (!ai) { if (ctx.key) throw down('preparare l\'incontro'); return { ...fallback, eur: 0, ai: false }; }
  const d = ai.data || {};
  const pick = k => (typeof d[k] === 'string' ? d[k].trim().slice(0, 400) : fallback[k]);
  return { da_sapere: pick('da_sapere'), ultima_volta: pick('ultima_volta'), da_chiedere: pick('da_chiedere'), porta: pick('porta'), eur: ai.eur, ai: true };
}

async function recap({ event, notes, meName, tu }, ctx = {}) {
  const ext = event.attendees.filter(a => !a.internal);
  const hi = ext.length === 1 ? `${tu ? 'Ciao' : 'Buongiorno'} ${first(ext[0].name)},` : 'Buongiorno a tutti,';
  const fallback = { oggetto: `Riepilogo: ${event.subject}`, testo: `${hi}\n\ngrazie per l'incontro di oggi. Riassumo i punti principali:\n${notes.map(n => `- ${clip(n.title || n.body, 200)}`).join('\n') || '- '}\n\nResto a disposizione.\n${first(meName)}` };
  const ai = await askLight({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 700,
    system: `Scrivi in italiano l'email di riepilogo di un incontro ai partecipanti, a nome di ${meName} (Almacis). Breve e concreta: punti decisi, chi fa cosa, prossimi passi. Solo i fatti delle note. Niente firma con i contatti (la aggiunge Alma): chiudi con un saluto e il nome. Rispondi SOLO con JSON {"oggetto","testo"}.`,
    input: `Incontro «${event.subject}» del ${event.start.slice(0, 10)}. Partecipanti: ${event.attendees.map(a => a.name || a.address).join(', ')}.\nNote:\n${notes.map(n => `- ${n.title ? `${n.title}: ` : ''}${clip(n.body, 1200)}`).join('\n') || '(nessuna nota)'}`,
  }).catch(err => { console.warn('[calendario] riepilogo AI non riuscito:', err.message); return null; });
  if (!ai) { if (ctx.key) throw down('scrivere il riepilogo'); return { ...fallback, eur: 0, ai: false }; }
  const d = ai.data || {};
  return { oggetto: clip(d.oggetto, 200) || fallback.oggetto, testo: String(d.testo || fallback.testo).trim().slice(0, 8000), eur: ai.eur, ai: true };
}

async function invite({ titolo, quando, con, collega, meName }, ctx = {}) {
  const ext = con.filter(p => !p.internal);
  const hi = ext.length === 1 ? `Buongiorno ${first(ext[0].name)},` : 'Buongiorno,';
  const fallback = `${hi}\n\ncome d'accordo vi invio l'invito per «${titolo}»${quando ? ` (${quando})` : ''}.${collega ? ` Parleremo di ${collega}.` : ''}\n\nA presto,\n${first(meName)}`;
  const ai = await askLight({
    key: ctx.key, fetchImpl: ctx.fetchImpl, maxTokens: 400,
    system: `Scrivi in italiano il breve testo di un invito a un incontro, a nome di ${meName} (Almacis): 3-5 righe, cortese e concreto, con lo scopo dell'incontro. Niente firma con i contatti: chiudi col nome. Rispondi SOLO con JSON {"testo"}.`,
    input: `Titolo: ${titolo}\nQuando: ${quando || ''}\nCon: ${con.map(p => p.name || p.address).join(', ')}\nArgomento nel CRM: ${collega || ''}`,
  }).catch(err => { console.warn('[calendario] invito AI non riuscito:', err.message); return null; });
  if (!ai) { if (ctx.key) throw down('scrivere l\'invito'); return { testo: fallback, eur: 0, ai: false }; }
  return { testo: String(ai.data?.testo || fallback).trim().slice(0, 4000), eur: ai.eur, ai: true };
}

// Orari liberi: busy = [{ start, end }] di tutti (ora italiana, 'YYYY-MM-DDTHH:MM'), giorni lavorativi 9–18, passo 30'
function freeSlots(busy, { from, days = 7, minutes = 60, max = 3, now = '' }) {
  const out = [];
  const add = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const toMin = t => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  const pad = n => String(n).padStart(2, '0');
  for (let i = 0; i < days && out.length < max; i++) {
    const day = add(from, i);
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const today = busy.filter(b => b.start.slice(0, 10) <= day && b.end.slice(0, 10) >= day)
      .map(b => [b.start.slice(0, 10) < day ? 0 : toMin(b.start), b.end.slice(0, 10) > day ? 24 * 60 : toMin(b.end)]);
    for (let s = 9 * 60; s + minutes <= 18 * 60 && out.length < max; s += 30) {
      const start = `${day}T${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
      if (now && start <= now) continue;
      if (s < 14 * 60 && s + minutes > 13 * 60) continue; // pausa pranzo 13–14
      if (today.some(([a, b]) => s < b && s + minutes > a)) continue;
      const e = s + minutes;
      out.push({ start, end: `${day}T${pad(Math.floor(e / 60))}:${pad(e % 60)}` });
      s += 90; // non tre proposte attaccate
    }
  }
  return out;
}

module.exports = { prepare, recap, invite, freeSlots, contextText };
