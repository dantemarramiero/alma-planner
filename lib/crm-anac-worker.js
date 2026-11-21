// Thread a parte per ANAC (21/11/2026): un mese (kind 'mese'), lo storico (kind 'storico', lib/crm-anac-storico.js) o
// i dati che arrivano dopo, subappalti e CUP (kind 'extra', lib/crm-anac-extra.js).
// Scarica e legge i file, manda indietro solo quello che serve; il database lo scrive il processo del server.
const { parentPort, workerData: w } = require('worker_threads');
const { collectMonth } = require('./crm-anac');
const { collectHistory } = require('./crm-anac-storico');
const { collectExtra } = require('./crm-anac-extra');

const log = m => parentPort.postMessage({ log: m });
const job = w.kind === 'storico' ? collectHistory(w.settings, { from: w.from, to: w.to, initiativeCats: w.initiativeCats, log })
  : w.kind === 'extra' ? collectExtra({ cigs: w.cigs, files: w.files, cup: w.cup }, { log })
    : collectMonth(w.month, w.settings, { initiativeCats: w.initiativeCats, log });
job.then(done => parentPort.postMessage({ done }), e => parentPort.postMessage({ error: String((e && e.message) || e) }));
