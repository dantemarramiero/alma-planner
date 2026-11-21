// «Ciao Dante», non «Ciao Marramiero» (Dante 21/11/2026): il nome di battesimo dal nome completo + email.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { givenName } = require('../lib/nome');

test('nome di battesimo: Microsoft dà «Cognome Nome», l\'email nome.cognome', () => {
  assert.equal(givenName('Marramiero Dante', 'dante.marramiero@almacis.it'), 'Dante');
  assert.equal(givenName('Dante Marramiero', 'dante.marramiero@almacis.it'), 'Dante');
  assert.equal(givenName('Di Carmine Gianni', 'gianni.dicarmine@almacis.it'), 'Gianni');
  assert.equal(givenName('Bianchi Nicolò', 'nicolo.bianchi@almacis.it'), 'Nicolò');
  assert.equal(givenName('Rossi Sara', 's.rossi@almacis.it'), 'Sara'); // iniziale.cognome
  assert.equal(givenName('Super Admin', 'admin@almacis.it'), 'Super'); // senza indizi: la prima parola
  assert.equal(givenName('', 'anna@almacis.it'), 'anna');
});
