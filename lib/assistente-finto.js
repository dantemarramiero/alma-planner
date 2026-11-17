// Alma «finta», solo in locale (ALMA_FAKE=1 con DEV_LOGIN=1): risponde senza Claude, con una ricerca vera, così la chat si
// può vedere funzionare senza la chiave. «Crea …» / «Prepara …» → una proposta di ticket per chi chiede (scadenza domani);
// altrimenti primo giro «ticket_elenco» (i miei ticket), secondo giro una risposta in diretta con il numero preso dal
// risultato, la sua fonte e un blocco con le domande.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Fermata'), { name: 'AbortError' })); }, { once: true });
});
const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    const t = m.content.filter(b => b.type === 'text').map(b => b.text).pop();
    if (t) return t;
  }
  return '';
}
function lastToolResult(messages) {
  const last = messages[messages.length - 1];
  const b = Array.isArray(last?.content) ? last.content.find(x => x.type === 'tool_result') : null;
  if (!b) return null;
  try { return JSON.parse(b.content); } catch { return null; }
}
async function speak(text, signal, opts) {
  for (const piece of text.match(/.{1,12}/gs) || []) { await sleep(40, signal); opts?.onText?.(piece); }
}

async function fakeClaude(params, opts = {}) {
  const signal = opts?.signal;
  const result = lastToolResult(params.messages);
  const names = params.tools.map(t => t.name);
  const asked = lastUserText(params.messages);
  const toolUse = async (name, input) => {
    await sleep(200, signal);
    opts?.onTool?.(name);
    return { role: 'assistant', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: `toolu_finto_${Date.now()}`, name, input }] };
  };
  // Foto allegate: finge di aver letto due biglietti da visita (uno con un campo incerto), per vedere le proposte e «Conferma tutti».
  const photos = params.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'));
  if (!result && photos && names.includes('proponi_biglietto')) {
    await sleep(300, signal);
    opts?.onTool?.('proponi_biglietto');
    const nota = asked.split('\n')[0].replace(/^Crea i? ?contatt[oi].*$/i, '').trim() || undefined;
    return { role: 'assistant', stop_reason: 'tool_use', usage, content: [
      { type: 'tool_use', id: `toolu_finto_b1_${Date.now()}`, name: 'proponi_biglietto', input: { titolo: 'Ing.', nome: 'Paolo', cognome: 'Neri', azienda: 'Terna S.p.A.', qualifica: 'Responsabile lavori Centro Italia', email: 'paolo.neri@terna.it', cellulare: '+39 335 618 2290', tipo_ente: 'impresa', nota } },
      { type: 'tool_use', id: `toolu_finto_b2_${Date.now()}`, name: 'proponi_biglietto', input: { titolo: 'Arch.', nome: 'Sara', cognome: 'Conti', azienda: 'Comune di Lanciano', qualifica: 'RUP · Settore Lavori Pubblici', email: 's.conti@comune.lanciano.ch.it', telefono: '0872 707 411', citta: 'Lanciano', tipo_ente: 'ente_pubblico', incerti: ['email'], nota } },
    ] };
  }
  // «… grafico …»: progetti e poi il grafico dei ticket per progetto (costruito dal server).
  if (/grafic/i.test(asked) && names.includes('grafico')) {
    if (!result) return toolUse('progetti_elenco', {});
    if (Array.isArray(result.progetti) && result.fonte_id) {
      return toolUse('grafico', { fonte_id: result.fonte_id, elenco: 'progetti', etichetta: 'nome', valori: ['ticket_totali', 'ticket_aperti'], nomi: ['Ticket', 'Aperti'], tipo: 'barre', titolo: 'Ticket per progetto' });
    }
    if (result.grafico_id || (result.error && !result.fonte_id)) {
      const text = result.error ? `Il grafico non è riuscito: ${result.error}` : 'Ecco i ticket per progetto: si vede subito dove ce ne sono di più aperti. (Prova: Alma è in modalità finta.)';
      await speak(text, signal, opts);
      return { role: 'assistant', stop_reason: 'end_turn', usage, content: [{ type: 'text', text }] };
    }
  }
  // «Scrivi …»/«manda …»: cerca chi ricontattare e prepara un'email diversa per i primi 3 con l'email (gruppo di prova).
  if (!result && /\b(scrivi|manda)\b/i.test(asked) && names.includes('proponi_email') && names.includes('crm_da_ricontattare')) {
    return toolUse('crm_da_ricontattare', { giorni: 30 });
  }
  if (result && Array.isArray(result.aziende) && result.giorni && names.includes('proponi_email')) {
    const people = result.aziende.filter(a => a.contatto).slice(0, 3);
    if (people.length) {
      return toolUse('proponi_email', { criterio: `aziende senza contatti da ${result.giorni} giorni (prova)`, email: people.map(a => ({
        destinatario: `c:${a.contatto.id}`, oggetto: `Un aggiornamento da Almacis per ${a.nome}`.slice(0, 120),
        testo: `Buongiorno,\nè passato un po' dall'ultima volta che ci siamo sentiti: volevo aggiornarla sulle novità di Almacis e capire se ci sono lavori in vista per ${a.nome}.\nHa dieci minuti la prossima settimana per una telefonata?\n\nCordiali saluti,\nAlmacis (email di prova: Alma è in modalità finta)` })) });
    }
  }
  if (!result && /\b(crea|prepara)\b/i.test(asked) && names.includes('proponi_ticket')) {
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const titolo = asked.replace(/^.*?\b(crea|prepara)\b( un)?( ticket)?( per me)?( per)?:?/i, '').trim() || 'Ticket di prova';
    return toolUse('proponi_ticket', { titolo: titolo.slice(0, 80), assegnati: ['io'], scadenza: tomorrow, priorita: 'normale' });
  }
  if (!result) return toolUse(names.includes('ticket_elenco') ? 'ticket_elenco' : 'cerca', names.includes('ticket_elenco') ? { persona: 'io' } : { testo: 'progetto' });
  if (result.proposta_id || (result.error && !result.fonte_id)) {
    const text = result.error ? `Non ho preparato niente: ${result.error}`
      : photos ? 'Ho letto 2 biglietti: controlla i dati e conferma. (Risposta di prova: le foto non le ho lette davvero.)'
      : /\b(scrivi|manda)\b/i.test(asked) ? 'Ho preparato le email: controllale, togli quelle che non vuoi e conferma. (Prova: in locale non parte niente.)'
      : 'Ho preparato il ticket: controlla e conferma. (Risposta di prova, senza Claude.)';
    await speak(text, signal, opts);
    return { role: 'assistant', stop_reason: 'end_turn', usage, content: [{ type: 'text', text }] };
  }
  const f = result.fonte_id ? `{${result.fonte_id}}` : '';
  const text = result.aperti !== undefined
    ? `Hai **${result.aperti}**${f} ticket aperti, di cui **${result.in_ritardo}**${f} in ritardo. (Risposta di prova: Alma è in modalità finta, senza Claude.)`
    : `Ho trovato **${result.totale || 0}**${f} risultati. (Risposta di prova: Alma è in modalità finta, senza Claude.)`;
  const tail = `\n\n\`\`\`blocchi\n${JSON.stringify({ cifre: result.aperti !== undefined ? [{ etichetta: 'Ticket aperti', valore: `**${result.aperti}**${f}` }] : [],
    domande: ['Quali sono in ritardo?', 'Crea un ticket per me: chiamare il RUP'] })}\n\`\`\``;
  await speak(text, signal, opts);
  return { role: 'assistant', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: text + tail }] };
}

module.exports = { fakeClaude };
