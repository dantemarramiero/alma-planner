// Alma Energy · assegnare le opportunità (ALM2-78, canvas approvato da Dante il 24/11/2026).
// Un solo punto per cambiare il responsabile: dalla pagina, dall'elenco, in blocco o creando dall'email.
// - il responsabile dev'essere un membro del modulo (se il modulo ha membri);
// - se l'opportunità ha un progetto, il responsabile del progetto cambia insieme e chi lo era resta membro;
// - nello storico resta «Assegnata a X» (to_stage 'owner', from_stage NULL: non conta come cambio di stadio);
// - chi la riceve ha la campanella e la notifica sul telefono, un solo avviso se sono più di una; chi se la assegna
//   da solo non riceve niente.
const { HttpError } = require('./http');

function createEnergyAssign({ db, notifier, push }) {
  async function checkOwner(ownerId, q = db) {
    if (ownerId === null) return null;
    const { rows: [u] } = await q.query(
      `SELECT u.id, u.name, (NOT EXISTS (SELECT 1 FROM energy_members) OR EXISTS (SELECT 1 FROM energy_members m WHERE m.email = lower(u.email))) AS member
         FROM users u WHERE u.id = $1`, [ownerId]);
    if (!u) throw new HttpError(400, 'Persona non trovata');
    if (!u.member) throw new HttpError(400, `${u.name} non è tra i membri di Alma Energy: aggiungilo da Impostazioni › Membri`);
    return u;
  }

  // Avviso a chi riceve: «Dante ti ha assegnato l'opportunità «X»» oppure «… 3 opportunità: «X» e altre 2».
  async function notifyAssigned(ownerId, opps, actor) {
    if (!ownerId || !opps.length || ownerId === actor.id) return;
    const first = opps[0];
    const body = opps.length === 1
      ? `${actor.name || 'Un collega'} ti ha assegnato l'opportunità «${first.title}»`
      : `${actor.name || 'Un collega'} ti ha assegnato ${opps.length} opportunità: «${first.title}» e altre ${opps.length - 1}`;
    const link = opps.length === 1 ? `/energy/opportunita/${first.id}` : '/energy/opportunita?owner=me';
    await notifier.notify({ userIds: [ownerId], actorId: actor.id, kind: 'energy', body, link });
    try {
      await push?.send([ownerId], { title: opps.length === 1 ? 'Nuova opportunità per te' : 'Nuove opportunità per te', body: `${body}. Tocca per aprirla.`, url: `/app#${link}`, tag: `energy-assegna-${first.id}` });
    } catch { /* il telefono non è obbligatorio */ }
  }

  // Cambia il responsabile di più opportunità; ritorna quelle cambiate davvero.
  async function assign(ids, ownerId, actor) {
    const owner = await checkOwner(ownerId);
    const changed = await db.tx(async q => {
      const { rows } = await q.query('SELECT id, title, owner_id, project_id FROM energy_opportunities WHERE id = ANY($1::int[]) FOR UPDATE', [ids]);
      if (rows.length !== new Set(ids).size) throw new HttpError(404, 'Opportunità non trovata');
      const out = [];
      for (const cur of rows) {
        if ((cur.owner_id || null) === ownerId) continue;
        await q.query('UPDATE energy_opportunities SET owner_id = $2, updated_at = now() WHERE id = $1', [cur.id, ownerId]);
        if (cur.project_id) {
          if (ownerId) await q.query('UPDATE projects SET owner_id = $2, updated_at = now() WHERE id = $1', [cur.project_id, ownerId]);
          // chi era responsabile resta nel progetto come membro
          if (cur.owner_id) await q.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cur.project_id, cur.owner_id, actor.id]);
          if (ownerId) await q.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [cur.project_id, ownerId]);
        }
        await q.query("INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, 'owner', $2, $3)",
          [cur.id, owner ? `Assegnata a ${owner.name}` : 'Senza responsabile', actor.id]);
        out.push(cur);
      }
      return out;
    });
    await notifyAssigned(ownerId, changed, actor);
    return changed;
  }

  return { assign, checkOwner, notifyAssigned };
}

module.exports = { createEnergyAssign };
