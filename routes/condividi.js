// «Condividi» ovunque (ALM2-87, canvas «Condividi ovunque» approvato da Dante il 24/11/2026).
//   GET  /api/condividi/:kind/:id/persone   la scheda (nome, sintesi) e i colleghi, con chi può aprirla («!» se no)
//   POST /api/condividi/:kind/:id           { user_ids, message, teams, mail }  avviso in Alma sempre, più Teams/email
//   POST /api/condividi/:kind/:id/aperta    chi apre una scheda condivisa con lui (per la cronologia)
//   GET  /api/condividi/:kind/:id/storia    le condivisioni della scheda, con canale e aperta / non aperta
// kind: subjects | contacts | projects | business | energy | impianti (lib/condividi.js)
const { HttpError, v } = require('../lib/http');
const C = require('../lib/condividi');

const MAX_PEOPLE = 30;

function registerCondividi(app, { db, gov, notifier, access, crmAccess, energyAccess, auth, baseUrl, sender: fakeSender = null }) {
  const kinds = C.createKinds({ db, access, crmAccess, energyAccess, gov });
  const realSender = C.createGraphSender({ auth });
  // in locale senza Microsoft 365 (DEV_LOGIN) il server passa un invio finto; con Microsoft collegato si usa Graph
  const sender = () => (auth.msConfigured || !fakeSender ? realSender : fakeSender);

  async function target(req) {
    const kind = kinds[req.params.kind];
    if (!kind) throw new HttpError(404, 'Scheda sconosciuta');
    const id = v.int(req.params.id, 'id', { min: 1 });
    return { key: req.params.kind, kind, item: await kind.load(req, id) };
  }
  const people = async ids => (await db.query(
    `SELECT id, name, email, oid, suspended_at FROM users WHERE ${ids ? 'id = ANY($1::int[])' : 'suspended_at IS NULL'} ORDER BY name`, ids ? [ids] : [])).rows;

  app.get('/api/condividi/:kind/:id/persone', async (req, res) => {
    const { key, kind, item } = await target(req);
    const all = (await people()).filter(u => u.id !== req.user.id);
    const ok = await Promise.all(all.map(u => kind.canOpen(u, item)));
    res.json({
      kind: key, label: C.KIND_LABEL[key], item: { name: item.name, summary: item.summary, link: item.link }, blocked_reason: kind.noCrm,      teams: auth.msConfigured || Boolean(fakeSender),
      people: all.map((u, i) => ({ id: u.id, name: u.name, ok: Boolean(ok[i]) })),
    });
  });

  app.post('/api/condividi/:kind/:id', async (req, res) => {
    const { key, kind, item } = await target(req);
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(x => v.int(x, 'Collega', { min: 1 })))].filter(x => x !== req.user.id);
    if (!ids.length) throw new HttpError(400, 'Scegli almeno un collega');
    if (ids.length > MAX_PEOPLE) throw new HttpError(400, `Al massimo ${MAX_PEOPLE} colleghi alla volta`);
    const message = v.text(b.message, 'Messaggio', { max: 1000 }) || '';
    const useTeams = Boolean(b.teams), useMail = Boolean(b.mail);
    const users = await people(ids);
    if (users.length !== ids.length || users.some(u => u.suspended_at)) throw new HttpError(400, 'Collega non trovato');
    const ok = await Promise.all(users.map(u => kind.canOpen(u, item)));
    const blocked = users.filter((_, i) => !ok[i]);
    if (blocked.length) {
      const one = blocked.length === 1;
      throw Object.assign(new HttpError(409, `${blocked.map(u => u.name).join(', ')} ${kind.noCrm[one ? 0 : 1]} e non ${one ? 'potrebbe' : 'potrebbero'} aprire la scheda: ${one ? 'toglila' : 'toglile'} prima di condividere`, 'senza_accesso'),
        { extra: { blocked: blocked.map(u => u.id) } });
    }
    const from = (await people([req.user.id]))[0] || { id: req.user.id, name: req.user.name, email: req.user.email };
    const url = `${baseUrl}/app#${item.link}`;
    const subjectCol = key === 'subjects' ? item.id : null, contactCol = key === 'contacts' ? item.id : null;

    // avviso in Alma: sempre, per tutti (è quello che registra «l'ha aperta»)
    const rows = [];
    for (const u of users) {
      const { rows: [r] } = await db.query(
        `INSERT INTO crm_shares (kind, ref_id, subject_id, contact_id, from_user, to_user, message, teams, mail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [key, item.id, subjectCol, contactCol, req.user.id, u.id, message, useTeams ? 'invio' : '', useMail ? 'invio' : '']);
      rows.push({ user: u, id: r.id });
    }
    if (notifier) {
      await notifier.notify({ userIds: ids, actorId: req.user.id, kind: key === 'energy' ? 'energy' : 'crm', body: `ti ha condiviso ${item.name}${message ? `: «${message.slice(0, 160)}»` : ''}`, link: item.link })
        .catch(err => console.warn('[condividi] avviso non inviato', err.message));
    }

    // Teams ed email: uno per collega, a nome di chi condivide. Un errore non ferma gli altri: si scrive nella riga.
    const out = { sent: users.length, teams: { ok: 0, failed: [] }, mail: { ok: 0, failed: [] } };
    const s = sender();
    for (const { user: u, id } of rows) {
      const errors = [];
      let teams = '', mail = '';
      if (useTeams) {
        try { await s.teams(from, u, C.teamsHtml({ from, item, message, url, kind: key })); teams = 'ok'; out.teams.ok++; } catch (err) {
          teams = 'errore'; errors.push(`Teams: ${C.reason(err)}`); out.teams.failed.push({ id: u.id, name: u.name, error: C.reason(err) });
        }
      }
      if (useMail) {
        try { await s.mail(from, u, C.mailSubject({ from, item }), C.mailHtml({ from, to: u, item, message, url, kind: key })); mail = 'ok'; out.mail.ok++; } catch (err) {
          mail = 'errore'; errors.push(`Email: ${C.reason(err)}`); out.mail.failed.push({ id: u.id, name: u.name, error: C.reason(err) });
        }
      }
      if (useTeams || useMail) await db.query('UPDATE crm_shares SET teams = $2, mail = $3, error = $4 WHERE id = $1', [id, teams, mail, errors.join(' · ')]);
    }
    res.status(201).json(out);
  });

  app.post('/api/condividi/:kind/:id/aperta', async (req, res) => {
    if (!kinds[req.params.kind]) throw new HttpError(404, 'Scheda sconosciuta');
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query('UPDATE crm_shares SET opened_at = now() WHERE kind = $1 AND ref_id = $2 AND to_user = $3 AND opened_at IS NULL', [req.params.kind, id, req.user.id]);
    res.json({ opened: rowCount });
  });

  app.get('/api/condividi/:kind/:id/storia', async (req, res) => {
    const { key, item } = await target(req);
    res.json({ items: await history(db, key, item.id) });
  });
}

// Le condivisioni di una scheda, raggruppate per invio (stesso mittente, stesso messaggio, stesso minuto).
async function history(db, kind, id, limit = 40) {
  const { rows } = await db.query(
    `SELECT sh.id, sh.created_at, sh.opened_at, sh.message, sh.teams, sh.mail, sh.error, sh.from_user, f.name AS from_name, u.name AS to_name
       FROM crm_shares sh LEFT JOIN users f ON f.id = sh.from_user JOIN users u ON u.id = sh.to_user
      WHERE sh.kind = $1 AND sh.ref_id = $2 ORDER BY sh.created_at DESC, sh.id LIMIT $3`, [kind, id, limit]);
  const groups = [];
  for (const r of rows) {
    const at = new Date(r.created_at);
    const g = groups.find(x => x.from_user === r.from_user && x.message === r.message && Math.abs(new Date(x.date) - at) < 60000);
    const person = { name: r.to_name, opened: r.opened_at, teams: r.teams, mail: r.mail, error: r.error };
    if (g) g.to.push(person);
    else groups.push({ id: r.id, date: r.created_at, from_user: r.from_user, from_name: r.from_name, message: r.message, to: [person] });
  }
  return groups;
}

module.exports = { registerCondividi, history };
