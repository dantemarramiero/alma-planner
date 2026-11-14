// Nuovi business (Dante 14/11/2026, canvas «Nuovi business»): costanti, semaforo, assistente AI.
// L'assistente usa OpenAI con la ricerca web come il radar (OPENAI_API_KEY su Railway); senza chiave la chat è spenta.

const PHASES = [['esplorazione', 'Esplorazione'], ['analisi', 'Analisi'], ['piano', 'Piano'], ['ingresso', 'Ingresso'], ['consolidamento', 'Consolidamento']];
const PHASE_KEYS = PHASES.map(([k]) => k);
// gate n chiude la fase n-1 (G0 apre l'iniziativa)
const GATES = [
  'Aprire l\'iniziativa?',
  'Proseguire con l\'analisi e la qualifica?',
  'Approvare il piano e l\'investimento?',
  'Primo contratto firmato: si consolida?',
  'Diventa una BU?',
];
const TARGET_STATUS = [['da_contattare', 'Da contattare'], ['contattato', 'Contattato'], ['incontro', 'Incontro'], ['qualificati', 'Qualificati come fornitori'], ['opportunita', 'Opportunità'], ['scartato', 'Scartato']];
const GAP_STATUS = [['manca', 'manca'], ['in_corso', 'in corso'], ['ce', 'c\'è']];
const GAP_KINDS = ['Requisito', 'Qualifica', 'Persone', 'Mezzi e squadre', 'Referenze', 'Certificazioni', 'Processi', 'Altro'];
const HOW_KINDS = [['assumere', 'Assumere'], ['formare', 'Formare'], ['partner', 'Partner o ATI'], ['avvalimento', 'Avvalimento'], ['acquisire', 'Acquisire un\'azienda'], ['noleggiare', 'Noleggiare'], ['non_serve', 'Non serve ora']];
const NOTE_KINDS = [['ipotesi', 'Ipotesi'], ['decisione', 'Decisione'], ['chat', 'Dalla chat'], ['nota', 'Nota'], ['rischio', 'Rischio']];

const MODEL = process.env.OPENAI_BUSINESS_MODEL || process.env.OPENAI_RADAR_MODEL || 'gpt-4.1-mini';
const PRICE = { in: Number(process.env.OPENAI_PRICE_IN || 0.4), out: Number(process.env.OPENAI_PRICE_OUT || 1.6), search: Number(process.env.OPENAI_PRICE_SEARCH || 0.03) };
const USD_EUR = 0.95;

const dayDiff = (a, b) => Math.round((Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`) - Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`)) / 86400000);

// semaforo (canvas): giallo/rosso se un gate è scaduto, se non ci sono attività da 3 settimane, se la spesa passa il budget
function trafficLight({ phase, gate, lastActivity, spent, budget, openHypotheses = 0, lateTasks = 0, today }) {
  if (phase === 'abbandonata') return { color: 'n', reasons: [{ c: 'n', t: 'Iniziativa abbandonata' }] };
  const reasons = [];
  if (gate?.due_date && !gate.decision) {
    const late = dayDiff(today, gate.due_date);
    if (late > 30) reasons.push({ c: 'r', t: `Gate G${gate.n} scaduto da ${late} giorni` });
    else if (late > 0) reasons.push({ c: 'y', t: `Gate G${gate.n} scaduto il ${gate.due_date.split('-').reverse().join('/')}` });
  }
  const quiet = lastActivity ? dayDiff(today, lastActivity) : null;
  if (quiet === null || quiet >= 42) reasons.push({ c: 'r', t: quiet === null ? 'Nessuna attività registrata' : `Nessuna attività da ${Math.floor(quiet / 7)} settimane` });
  else if (quiet >= 21) reasons.push({ c: 'y', t: `Nessuna attività da ${Math.floor(quiet / 7)} settimane` });
  else reasons.push({ c: 'g', t: 'Attività nelle ultime 3 settimane' });
  if (budget > 0) {
    const p = Math.round((spent / budget) * 100);
    reasons.push({ c: spent > budget ? 'r' : p >= 90 ? 'y' : 'g', t: spent > budget ? `Spesa oltre il budget (${p}%)` : `Spesa nel budget (${p}%)` });
  }
  if (lateTasks) reasons.push({ c: 'y', t: lateTasks === 1 ? '1 passo scaduto' : `${lateTasks} passi scaduti` });
  if (openHypotheses) reasons.push({ c: 'y', t: openHypotheses === 1 ? '1 ipotesi da verificare' : `${openHypotheses} ipotesi da verificare` });
  const color = reasons.some(r => r.c === 'r') ? 'r' : reasons.some(r => r.c === 'y') ? 'y' : 'g';
  return { color, reasons };
}

// ── assistente ───────────────────────────────────────────────────────────────────────────────
function systemPrompt({ today, almacis, initiative }) {
  return [
    `Sei l'assistente strategico di Almacis, impresa italiana di costruzioni, impianti, reti e facility. Oggi è il ${today}.`,
    'Aiuti la direzione e i responsabili a entrare in nuove aree d\'affari: chi possono essere i clienti, cosa manca all\'azienda e come colmarlo (assumere, formare, partner o ATI, avvalimento, acquisire, noleggiare), quali passi fare, rischi, concorrenti, costi e tempi.',
    'Usa la ricerca in rete quando servono fatti aggiornati (piani di investimento, albi fornitori, normative, concorrenti) e cita sempre le fonti con il link. Usa i dati di Almacis qui sotto e indica le sinergie con aziende già nel CRM (clienti, partner, fornitori) quando ci sono.',
    'Scrivi in italiano semplice, frasi brevi, niente gergo. Non inventare dati: se non sai, dillo.',
    '',
    '## Almacis',
    almacis,
    initiative ? `\n## Iniziativa\n${initiative}` : '',
    '',
    'Rispondi SOLO con un oggetto JSON, senza testo prima o dopo:',
    '{"answer": "risposta in testo semplice; usa righe che iniziano con «- » per gli elenchi e **grassetto** per i nomi",',
    ' "sources": [{"title": "nome della fonte", "url": "https://…"}],',
    ' "crm": ["nomi esatti delle aziende del CRM citate nella risposta"],',
    ' "targets": [{"name": "azienda", "segment": "tipo di cliente", "why": "perché è un cliente possibile", "priority": "alta|media|bassa"}],',
    ' "gaps": [{"title": "cosa manca", "kind": "Requisito|Qualifica|Persone|Mezzi e squadre|Referenze|Certificazioni|Processi", "status": "manca|in_corso|ce", "how": "come colmarlo", "timing": "tempi"}],',
    ' "steps": [{"title": "passo concreto da fare", "days": giorni da oggi}],',
    ' "plan": [{"phase": "esplorazione|analisi|piano|ingresso|consolidamento", "when": "periodo", "steps": ["passo"], "gate": "domanda per la direzione alla fine della fase"}]}',
    'targets, gaps, steps e plan solo se la domanda li chiede o la risposta li contiene; altrimenti liste vuote. plan solo se si chiede il piano d\'ingresso.',
  ].filter(x => x !== null).join('\n');
}

const str = (x, max) => String(x ?? '').trim().slice(0, max);
function parseAnswer(text) {
  const raw = String(text || '');
  const m = raw.match(/\{[\s\S]*\}/);
  let o = null;
  if (m) { try { o = JSON.parse(m[0]); } catch { o = null; } }
  if (!o || typeof o !== 'object') return { answer: raw.trim().slice(0, 12000) || 'Non ho una risposta.', sources: [], crm: [], targets: [], gaps: [], steps: [], plan: [] };
  const arr = x => (Array.isArray(x) ? x : []);
  const PK = PHASE_KEYS;
  return {
    answer: str(o.answer, 12000) || 'Non ho una risposta.',
    sources: arr(o.sources).filter(s => /^https?:\/\//i.test(String(s?.url || ''))).slice(0, 12).map(s => ({ title: str(s.title, 200) || str(s.url, 200), url: str(s.url, 500) })),
    crm: arr(o.crm).map(x => str(x, 200)).filter(Boolean).slice(0, 20),
    targets: arr(o.targets).map(t => ({ name: str(t?.name, 200), segment: str(t?.segment, 80), why: str(t?.why, 500), priority: ['alta', 'media', 'bassa'].includes(t?.priority) ? t.priority : 'media' })).filter(t => t.name).slice(0, 15),
    gaps: arr(o.gaps).map(g => ({ title: str(g?.title, 200), kind: GAP_KINDS.includes(g?.kind) ? g.kind : 'Requisito', status: ['manca', 'in_corso', 'ce'].includes(g?.status) ? g.status : 'manca', how: str(g?.how, 500), timing: str(g?.timing, 60) })).filter(g => g.title).slice(0, 15),
    steps: arr(o.steps).map(s => ({ title: str(s?.title, 300), days: Math.min(365, Math.max(1, Number(s?.days) || 7)) })).filter(s => s.title).slice(0, 10),
    plan: arr(o.plan).filter(p => PK.includes(p?.phase)).map(p => ({ phase: p.phase, when: str(p.when, 60), steps: arr(p.steps).map(x => str(x, 300)).filter(Boolean).slice(0, 8), gate: str(p.gate, 200) })).slice(0, 5),
  };
}

async function ask({ apiKey, system, history, question, fetchImpl = fetch }) {
  const input = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.body })), { role: 'user', content: question }];
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview', search_context_size: 'medium' }], input }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'errore'}`);
  const text = data.output_text || (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  const searches = (data.output || []).filter(o => o.type === 'web_search_call').length;
  const u = data.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6 + searches * PRICE.search;
  return { ...parseAnswer(text), costEur: Math.round(usd * USD_EUR * 10000) / 10000 };
}

module.exports = { PHASES, PHASE_KEYS, GATES, TARGET_STATUS, GAP_STATUS, GAP_KINDS, HOW_KINDS, NOTE_KINDS, MODEL, trafficLight, systemPrompt, parseAnswer, ask, dayDiff };
