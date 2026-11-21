// Lettura dei CSV di ANAC (21/11): un campo che va a capo si unisce, una virgoletta sbagliata non blocca il resto del file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { rowsOf } = require('../lib/crm-anac');

const read = async text => { const out = []; for await (const r of rowsOf(Readable.from([text]))) out.push(r); return out; };

test('ANAC: campo su più righe e virgoletta sbagliata', async () => {
  const ok = await read('"cig";"oggetto"\n"A000000001";"lavori\nsu due righe"\n"A000000002";"semplice"\n');
  assert.deepEqual(ok.map(r => r.cig), ['A000000001', 'A000000002']);
  assert.equal(ok[0].oggetto, 'lavori\nsu due righe');
  // una virgoletta che non si chiude: quel record si perde dopo 50 righe, le righe dopo si leggono
  const lines = ['"cig";"oggetto"', '"B000000001";"rotto 12" pollici'];
  for (let i = 0; i < 60; i++) lines.push(`"C${String(i).padStart(9, '0')}";"ok"`);
  const rows = await read(lines.join('\n'));
  assert.ok(rows.length >= 5, `lette ${rows.length}`);
  assert.equal(rows[rows.length - 1].cig, 'C000000059');
});
