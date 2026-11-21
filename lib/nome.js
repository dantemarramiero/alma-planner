// Il nome di battesimo per i saluti («Ciao Dante», non «Ciao Marramiero»; Dante 21/11/2026).
// Da Microsoft arriva solo il nome completo e in Almacis è quasi sempre «Cognome Nome»; l'email invece è nome.cognome@…
// Quindi: la parola del nome che corrisponde alla prima parte dell'email; se l'email è i.cognome@… si prende l'altra parola
// (quella che non è il cognome); senza indizi, la prima parola come prima. Copia identica in orbita/js/store.js.
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

function givenName(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(email || '').split('@')[0];
  const parts = String(email || '').split('@')[0].split(/[._-]+/).map(fold).filter(Boolean);
  if (parts.length >= 2 && words.length >= 2) {
    const [first, ...rest] = parts;
    if (first.length > 1) {
      const hit = words.find(w => fold(w) === first);
      if (hit) return hit;
    }
    // i.cognome@…: il cognome è nelle parti dopo la prima, il nome è una delle altre parole
    const surnameWords = words.filter(w => rest.includes(fold(w)));
    if (surnameWords.length) {
      const others = words.filter(w => !surnameWords.includes(w));
      if (others.length) return others.find(w => !first || fold(w).startsWith(first)) || others[0];
    }
  }
  return words[0];
}

module.exports = { givenName };
