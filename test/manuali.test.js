// Manuali d'uso di Alma CRM (ALM2-72): testi completi, ricerca e strumento di Alma.
const test = require('node:test');
const assert = require('node:assert/strict');
const manuali = require('../lib/manuali-crm');
const TOOLS = require('../lib/assistente-strumenti');

test('16 manuali numerati, ognuno con gruppo, pagina, indirizzi e capitoli non vuoti', () => {
  const { manuals, groups } = manuali.catalog();
  assert.equal(manuals.length, 16);
  assert.deepEqual(manuals.map(m => m.n), Array.from({ length: 16 }, (_, i) => i + 1));
  const ids = new Set();
  for (const m of manuals) {
    assert.ok(!ids.has(m.id), `id doppio ${m.id}`); ids.add(m.id);
    assert.ok(groups.some(g => g.id === m.group), `${m.id}: gruppo sconosciuto`);
    assert.ok(m.page?.startsWith('#/'), `${m.id}: manca la pagina`);
    assert.ok(m.routes.length, `${m.id}: manca l'indirizzo per «Come si usa»`);
    assert.ok(m.chapters.length >= 3, `${m.id}: troppo corto`);
    assert.ok(m.minutes >= 1);
    for (const c of m.chapters) {
      assert.ok(c.t && c.b.length, `${m.id}: capitolo vuoto`);
      for (const [kind, val] of c.b) {
        assert.ok(['p', 'steps', 'auto', 'info', 'bell', 'who'].includes(kind), `${m.id}: blocco ${kind}`);
        const text = Array.isArray(val) ? val.join(' ') : val;
        assert.equal((text.match(/«/g) || []).length, (text.match(/»/g) || []).length, `${m.id} «${c.t}»: virgolette non chiuse`);
        assert.equal((text.match(/\*\*/g) || []).length % 2, 0, `${m.id} «${c.t}»: grassetto non chiuso`);
      }
    }
  }
});

test('la ricerca trova il capitolo giusto e ignora le parole vuote', () => {
  const r = manuali.search('diventa cliente');
  assert.ok(r.length);
  assert.ok(r.slice(0, 3).some(x => x.manual === 'lead'));
  assert.equal(manuali.search('unire due aziende')[0].chapter_title, 'I doppioni'); // «unire» e «aziende» con le varianti
  assert.ok(manuali.search('biglietto da visita').some(x => x.manual === 'contatti'));
  assert.ok(manuali.search('primo passo')[0].title === 'Radar');
  assert.deepEqual(manuali.search('di la'), []);
});

test('Alma: lo strumento «manuali» c\'è per tutti e restituisce i capitoli con il link', async () => {
  const t = TOOLS.find(x => x.name === 'manuali');
  assert.ok(t);
  assert.equal(t.allowed, undefined);
  const out = await t.run({ domanda: 'trasforma in cliente' }, async () => ({}));
  assert.ok(out.trovati >= 1);
  assert.match(out.capitoli[0].link, /^#\/impostazioni\/manuali\/[a-z-]+\/\d+$/);
  assert.equal(out.ricevuta.link, '#/impostazioni/manuali');
});
