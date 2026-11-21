// Casella Outlook finta per «Persone con cui mi scrivo» in locale e nei test (senza Microsoft 365 collegato).
// Stessa forma delle risposte di Graph usate da routes/crm-scrivo.js.
const day = n => new Date(Date.now() - n * 864e5).toISOString();
const from = (name, address) => ({ emailAddress: { name, address } });

const SIGS = {
  'l.rossi@studiotecnicorossi.it': 'Buongiorno Dante,\nvi mando il computo aggiornato del lotto 3.\n\nCordiali saluti\nIng. Luca Rossi · Direttore tecnico\nStudio Tecnico Rossi s.r.l. · Via Roma 12, 65121 Pescara (PE)\nTel. 085 123 4567 · Cell. 333 765 4321',
  'andrea.pace@studiopace-ing.com': 'Ciao,\nok per giovedì.\n\nSaluti\nAndrea Pace\nResponsabile progettazione\nStudio Pace Ingegneria\nCell. 347 112 2334',
};

function createMailFake() {
  const inbox = [], sent = [];
  const add = (name, address, n, m, last) => {
    for (let i = 0; i < n; i++) inbox.push({ id: `in-${address}-${i}`, from: from(name, address), receivedDateTime: day(last + i * 6) });
    for (let i = 0; i < m; i++) sent.push({ id: `out-${address}-${i}`, toRecipients: [from(name, address)], ccRecipients: [], sentDateTime: day(last + 1 + i * 7) });
  };
  add('Luca Rossi', 'l.rossi@studiotecnicorossi.it', 7, 5, 3);
  add('Sara Marini', 's.marini@studiolegalebianchi.it', 2, 4, 7);
  add('Andrea Pace', 'andrea.pace@studiopace-ing.com', 3, 1, 12);
  add('Giorgio De Santis', 'giorgio.desantis.studio@gmail.com', 2, 1, 19);
  add('', 'info@studioverdi.it', 2, 0, 24);
  add('Newsletter ANCE', 'newsletter@ance.it', 9, 0, 2);
  add('Microsoft', 'no-reply@microsoft.com', 4, 0, 1);
  add('Marco Bianchi', 'marco.bianchi@almacis.it', 12, 10, 1);
  return {
    async graphAll(_t, path) { return path.includes('/inbox/') ? inbox : path.includes('/sentitems/') ? sent : []; },
    async graph(_t, _m, path) {
      // come Outlook vero: con $orderby il campo dell'ordinamento deve essere il primo del $filter (Graph risponde 400 → 502)
      const p = decodeURIComponent(path);
      const order = p.match(/\$orderby=(\w+)/)?.[1];
      const filter = p.match(/\$filter=([^&]+)/)?.[1];
      if (order && filter && !filter.trim().startsWith(order)) {
        const { HttpError } = require('./http');
        throw new HttpError(502, 'The restriction or sort order is too complex for this operation.');
      }
      const m = p.match(/address eq '([^']+)'/);
      const a = m && m[1];
      return { value: a && SIGS[a] ? [{ subject: 'Re: lotto 3', receivedDateTime: day(3), body: { content: SIGS[a] } }] : [] };
    },
    async messages(email) { return inbox.filter(x => x.from.emailAddress.address === email).map(x => x.id); },
  };
}

module.exports = { createMailFake };
