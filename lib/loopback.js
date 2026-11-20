// Chiamate alle API di Alma Space con la sessione di chi sta usando la pagina (stessi permessi delle pagine).
// Come in routes/assistente.js: servono per riusare le regole del CRM (doppioni, azienda dal dominio, lead al volo).
function base(req) { return `http://127.0.0.1:${req.socket.localPort}`; }
function check(path) {
  if (!/^\/api\/[^?]*$/.test(String(path).split('?')[0]) || String(path).includes('..')) throw new Error('Percorso non valido.');
}
async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error((data && data.error) || 'Non hai il permesso per farlo.');
  if (res.status === 404) throw new Error((data && data.error) || 'Non trovato.');
  if (!res.ok) throw new Error((data && data.error) || `Errore ${res.status}.`);
  return data;
}
function getter(req) {
  return async path => { check(path); return parse(await fetch(base(req) + path, { headers: { cookie: req.headers.cookie || '' } })); };
}
function caller(req) {
  return async (method, path, body) => {
    check(path);
    return parse(await fetch(base(req) + path, { method, headers: { cookie: req.headers.cookie || '', 'content-type': 'application/json', 'X-Alma': '1' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body || {}) }));
  };
}
module.exports = { getter, caller };
