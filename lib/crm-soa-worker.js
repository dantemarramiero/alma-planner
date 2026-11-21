// Thread a parte per le attestazioni SOA (ALM2-49): scarica e legge i due CSV di ANAC (100 + 60 MB) e manda
// indietro una riga per impresa. Il database lo scrive il processo del server (lib/crm-soa.js, syncSoa).
const { parentPort } = require('worker_threads');
const { collect } = require('./crm-soa');

collect({ log: m => parentPort.postMessage({ log: m }) })
  .then(done => parentPort.postMessage({ done }), e => parentPort.postMessage({ error: String((e && e.message) || e) }));
