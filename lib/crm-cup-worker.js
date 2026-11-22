// Thread a parte per OpenCUP (ALM2-49): scarica e legge i file delle aree (centinaia di MB zippati ciascuno) e manda
// indietro le opere tenute. Il database lo scrive il processo del server (lib/crm-cup.js, syncCup).
const { parentPort, workerData } = require('worker_threads');
const { collect } = require('./crm-cup');

collect({ ...workerData, log: m => parentPort.postMessage({ log: m }) })
  .then(done => parentPort.postMessage({ done }), e => parentPort.postMessage({ error: String((e && e.message) || e) }));
