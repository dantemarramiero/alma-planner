// Thread a parte per un mese di ANAC (21/11/2026): scarica e legge i quattro file, manda indietro solo le gare da tenere.
// Il database lo scrive il processo del server (lib/crm-anac.js, importMonth).
const { parentPort, workerData } = require('worker_threads');
const { collectMonth } = require('./crm-anac');

collectMonth(workerData.month, workerData.settings, { initiativeCats: workerData.initiativeCats, log: m => parentPort.postMessage({ log: m }) })
  .then(done => parentPort.postMessage({ done }), e => parentPort.postMessage({ error: String((e && e.message) || e) }));
