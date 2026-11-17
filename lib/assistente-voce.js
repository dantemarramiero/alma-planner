// Alma a voce, prima parte (17/11/2026, canvas «v5 · Alma da ogni pagina, telefono e voce»; porting della voce di
// Bacco, CAN-172/175): il microfono detta la domanda, «Ascolta» legge la risposta.
// - Dettatura: l'audio registrato nel browser (webm/ogg/mp4/wav, al massimo 2 minuti) va a OpenAI gpt-4o-transcribe
//   con un vocabolario di Almacis e torna testo. L'audio non si salva.
// - «Ascolta»: una versione «da dire» della risposta (niente tabelle, simboli o link, ~450 caratteri) letta da
//   gpt-4o-mini-tts con la voce di Alma.
// - Costi stimati al minuto in assistant_usage, dentro le stesse quote di Alma. Stessa OPENAI_API_KEY del resto.
const { HttpError } = require('./http');

const STT_MODEL = 'gpt-4o-transcribe';
const STT_USD_PER_MIN = 0.006;
const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_USD_PER_MIN = 0.015;
const TTS_VOICE = 'coral';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const STT_PROMPT = 'Almacis, Alma Planet, Alma. Facility management, global service, ufficio gare, RUP, RDA, ATI, subappalto, SOA, OG1, OG2, OS28, ANAC, PNRR, '
  + 'Gantt, ticket, CRM, lead, BOSS, Zoho, Snam, Terna, ASL, Provincia, Comune, Pescara, Chieti, Teramo, L\'Aquila, Avellino, Sulmona, Lanciano, Ortona, Ecomondo.';
const MIMES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };

async function openaiTranscribe({ buffer, mime, filename }, key) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  form.append('model', STT_MODEL);
  form.append('language', 'it');
  form.append('prompt', STT_PROMPT);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HttpError(503, 'La chiave OpenAI (OPENAI_API_KEY) non è valida.');
  if (res.status === 429) throw new HttpError(503, 'Il servizio che trascrive è occupato: riprova tra un minuto.');
  if (!res.ok) throw new HttpError(502, `La trascrizione non è riuscita (${res.status}).`);
  return String(data.text || '').trim();
}

// La risposta come si dice a voce: niente tabelle riga per riga, niente Markdown, link, fonti {f1} o blocchi.
function speakable(text) {
  const lines = String(text || '').split('```blocchi')[0].replace(/\r/g, '').split('\n');
  const out = [];
  let table = false;
  for (const l of lines) {
    if (/^\s*\|/.test(l)) { if (!table) out.push('Il dettaglio è nella tabella sullo schermo.'); table = true; continue; }
    table = false;
    const t = l.replace(/\{f\d+\}/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>`]/g, '').replace(/^\s*[-•]\s+/, '').trim();
    if (t) out.push(t);
  }
  let said = out.join('. ').replace(/\.\s*\./g, '.').replace(/[:;]\./g, '.').replace(/€\s?(\d[\d.]*(?:,\d+)?)\s?(M|k)?/g, (m, n, u) => `${n}${u === 'M' ? ' milioni di' : u === 'k' ? ' mila' : ''} euro`).replace(/−/g, 'meno ');
  if (said.length > 450) said = `${said.slice(0, said.lastIndexOf(' ', 450))}… il resto è sullo schermo.`;
  return said;
}

async function openaiSpeech(text, key) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: 'mp3',
      instructions: 'Sei Alma, l\'assistente di Almacis: voce femminile calma, chiara e cordiale, professionale ma non fredda, ritmo sciolto. Parla in italiano senza accento regionale marcato. Numeri, importi e date detti in modo naturale.' }),
  });
  if (res.status === 401) throw new HttpError(503, 'La chiave OpenAI (OPENAI_API_KEY) non è valida.');
  if (!res.ok) throw new HttpError(502, `La voce non è disponibile adesso (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { STT_MODEL, TTS_MODEL, STT_USD_PER_MIN, TTS_USD_PER_MIN, MAX_AUDIO_BYTES, MIMES, openaiTranscribe, openaiSpeech, speakable };
