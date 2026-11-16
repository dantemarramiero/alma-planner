// «Primo passo pronto» (Dante 16/11/2026, canvas «v3 · Segnale con primo passo pronto»): per un segnale il CRM
// sceglie la strada migliore (chi di noi → quale persona), il canale, la data e scrive l'email. Il responsabile approva,
// non scrive. L'email non parte mai da sola: si apre in Outlook come bozza (regola del 13/11: email solo proposte).

const MODEL = process.env.OPENAI_DRAFT_MODEL || process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6) };

// giorni lavorativi dopo oggi (sabato e domenica saltati)
function addWorkdays(today, n) {
  const d = new Date(`${today}T12:00:00Z`);
  let left = Math.max(0, n);
  while (left > 0 || d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
const sign = (signature, sender) => String(signature || '{nome}').replace(/\{nome\}/g, sender?.name || '').replace(/\{ruolo\}/g, sender?.job_title || '').replace(/\{telefono\}/g, '').replace(/\n{3,}/g, '\n\n').trim();

// email scritta col modello fisso (senza AI o se l'AI non risponde)
function draftTemplate({ signal, path, refs = [], tone = 'cordiale', signature, sender }) {
  const who = path?.contact || '';
  const hello = tone === 'formale' ? `Gentile ${who || 'Responsabile'},` : `Buongiorno${who ? ` ${who}` : ''},`;
  const known = path?.level === 'forte' || path?.level === 'media';
  const body = [
    hello,
    `${known ? 'come sta? ' : ''}abbiamo letto ${signal?.entity ? `che ${signal.entity}` : 'la notizia'}: «${signal?.title || ''}».`,
    `Almacis ha lavorato su interventi simili${refs.length ? ` (${refs.slice(0, 2).join(', ')})` : ''} e ci farebbe piacere capire tempi e procedura e raccontarvi come potremmo esservi utili.`,
    `${tone === 'formale' ? 'Avrebbe' : 'Ha'} dieci minuti nei prossimi giorni per una breve telefonata?`,
    '',
    tone === 'formale' ? 'Cordiali saluti,' : 'Un saluto,',
    sign(signature, sender),
  ].join('\n');
  return { subject: String(signal?.title || 'Contatto').slice(0, 120), body };
}

function aiPrompt({ signal, path, refs, tone, signature, sender, buLabel }) {
  return [
    'Scrivi in italiano una breve email commerciale (massimo 110 parole) per un primo contatto. Niente frasi fatte, niente punti elenco, niente promesse di prezzo.',
    `Mittente: ${sender?.name || 'il responsabile'}, responsabile della BU «${buLabel || ''}» di Almacis, impresa di costruzioni e impianti.`,
    path ? `Destinatario: ${path.contact}${path.job ? `, ${path.job}` : ''}. Rapporto: ${path.level || 'nessuno'}${path.why ? ` (${path.why})` : ''}.` : 'Destinatario: ufficio tecnico (non conosciamo nessuno).',
    `Occasione: ${signal.title}. Ente o azienda: ${signal.entity || '—'}. ${signal.summary || ''}`,
    refs.length ? `Lavori simili da citare se utili: ${refs.slice(0, 3).join('; ')}.` : '',
    `Tono: ${tone}. Obiettivo: ottenere 10 minuti di telefonata o un incontro.`,
    `Chiudi con questa firma, così com'è:\n${sign(signature, sender)}`,
    'Rispondi SOLO con JSON: {"subject": "oggetto breve", "body": "testo dell\'email con a capo \\n"}',
  ].filter(Boolean).join('\n');
}

async function draftAI({ apiKey, fetchImpl = fetch, ...ctx }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: aiPrompt(ctx) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const text = data.output_text || (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  const m = String(text).match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) : null;
  if (!j?.body) throw new Error('risposta senza email');
  const u = data.usage || {};
  return { subject: String(j.subject || ctx.signal.title).slice(0, 160), body: String(j.body).slice(0, 4000),
    costEur: Math.round((((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6) * 0.95 * 10000) / 10000 };
}

// il primo passo: { contact_id, contact, contact_email, job, owner_id, owner_name, channel, due_date, subject, body, level, why, paths, ai, generated_at }
function moveFrom({ paths, fallbackContact, ownerFallback, today, withinDays }) {
  const best = paths[0] || null;
  const contact = best || (fallbackContact ? { contact_id: fallbackContact.id, contact: fallbackContact.name, job: fallbackContact.job || '', level: '', why: '' } : null);
  const owner = best?.us || ownerFallback || null;
  return {
    contact_id: contact?.contact_id || null, contact: contact?.contact || '', job: contact?.job || '', level: best?.level || '', why: best?.why || '',
    owner_id: owner?.id || null, owner_name: owner?.name || '',
    channel: best?.level === 'forte' || best?.level === 'media' ? 'telefonata' : 'email',
    due_date: addWorkdays(today, withinDays),
  };
}

module.exports = { addWorkdays, draftTemplate, draftAI, aiPrompt, moveFrom, MODEL };
