// Collegamenti del censimento software: ogni fonte legge da un sistema esterno i suoi software, le tipologie di
// licenza (piani) e chi le ha, e il censimento si allinea. Le righe messe a mano non si toccano mai.
//
// Una fonte è { label, scopes, read(token) } e read restituisce
//   [{ external_id, name, vendor, category, status?, plans: [{ external_id, name, seats, assigned, renewal_date,
//      unit_cost?, people: [{ oid, name, email }] }] }]
// Oggi: 'microsoft' (licenze Microsoft 365) ed 'entra' (software esterni in cui si entra con l'account Microsoft).
// Le prossime (Claude, Zoho…) si aggiungono qui con la loro read() e la chiave/API del fornitore.
const { graphAll } = require('./graph');

// Permesso Graph in sola lettura per leggere abbonamenti, rinnovi e app aziendali (consenso amministratore).
const DIRECTORY_SCOPES = ['Directory.Read.All'];

// Licenze Microsoft: nome leggibile e prezzo di listino INDICATIVO (€/utente/mese, impegno annuale, IVA esclusa),
// segnato come stimato finché un amministratore non mette quello della fattura.
const SKU = {
  O365_BUSINESS_PREMIUM: ['Microsoft 365 Business Standard', 11.7],
  O365_BUSINESS_ESSENTIALS: ['Microsoft 365 Business Basic', 5.6],
  SPB: ['Microsoft 365 Business Premium', 20.6],
  O365_BUSINESS: ['Microsoft 365 Apps for business', 9.8],
  EXCHANGESTANDARD: ['Exchange Online (Plan 1)', 3.7],
  EXCHANGEENTERPRISE: ['Exchange Online (Plan 2)', 7.5],
  PROJECTPROFESSIONAL: ['Project Plan 3', 28.1],
  PROJECT_PLAN3_DEPT: ['Project Plan 3 (per reparto)', 28.1],
  PROJECTPREMIUM: ['Project Plan 5', 51.7],
  Microsoft_365_Copilot: ['Microsoft 365 Copilot', 28.1],
  TEAMS_ESSENTIALS_AAD: ['Teams Essentials', 3.7],
  POWER_BI_PRO: ['Power BI Pro', 13.1],
  POWERAPPS_PER_USER: ['Power Apps Premium', 18.7],
  POWERAUTOMATE_ATTENDED_RPA: ['Power Automate Premium', 14],
  VISIOCLIENT: ['Visio Plan 2', 14],
  POWER_BI_STANDARD: ['Power BI (gratuito)', 0],
  FLOW_FREE: ['Power Automate (gratuito)', 0],
  POWERAPPS_VIRAL: ['Power Apps (prova gratuita)', 0],
  POWERAPPS_DEV: ['Power Apps Developer (gratuito)', 0],
  WINDOWS_STORE: ['Microsoft Store per le aziende', 0],
  Microsoft_Teams_Exploratory_Dept: ['Teams Exploratory (prova)', 0],
};
const UNLIMITED = 10000; // gli abbonamenti gratuiti dichiarano 10.000 o 1.000.000 licenze

const MICROSOFT_ORG = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a'; // tenant di Microsoft: le sue app non sono «software esterni»

// Tipo del software esterno, dal nome (si cambia a mano dalla scheda).
const CATEGORIES = [
  ['CRM e vendite', /zoho|salesforce|hubspot|jotform|pipedrive/i],
  ['Intelligenza artificiale', /claude|chatgpt|openai|gpt|copilot|fathom|fireflies|otter|tldv|read meeting|plus ai|use ai|gemini/i],
  ['Progetti e collaborazione', /notion|clickup|trello|atlassian|jira|gantt|lucid|visme|officeatwork|nearpod|slack|asana|monday|miro/i],
  ['Agenda e appuntamenti', /calendly|tidycal|zoom/i],
  ['Posta e dispositivi', /apple|samsung|google|gmail|spark|em client/i],
  ['Assistenza e sicurezza IT', /teamviewer|atera|livecare|sophos|anydesk/i],
  ['Viaggi e spese', /bizaway|expense|travel/i],
  ['Documenti e firma', /adobe|acrobat|docusign|sign|qr ?code|zapier|linkedin/i],
];
const category = name => CATEGORIES.find(([, re]) => re.test(name))?.[0] || '';

// Persone di Microsoft lette insieme alle licenze (servono anche alla fonte Entra).
async function readUsers(token) {
  const users = await graphAll(token, '/users?$select=id,displayName,mail,userPrincipalName,assignedLicenses,accountEnabled,userType&$top=999', { max: 20000 });
  return users.filter(u => u.userType !== 'Guest');
}
const person = u => ({ oid: u.id, name: u.displayName || u.mail || u.userPrincipalName, email: (u.mail || u.userPrincipalName || '').toLowerCase(), disabled: u.accountEnabled === false });

const SOURCES = {
  microsoft: {
    label: 'Microsoft 365',
    scopes: DIRECTORY_SCOPES,
    async read(token) {
      const [skus, subs, users] = await Promise.all([
        graphAll(token, '/subscribedSkus'),
        graphAll(token, '/directory/subscriptions').catch(() => []), // date di rinnovo: se manca, si va avanti senza
        readUsers(token),
      ]);
      const plans = skus.filter(s => s.capabilityStatus !== 'Deleted').map(s => {
        const [name, price] = SKU[s.skuPartNumber] || [s.skuPartNumber, null];
        const renewals = subs.filter(x => x.skuId === s.skuId && x.nextLifecycleDateTime && !x.nextLifecycleDateTime.startsWith('9999'))
          .map(x => x.nextLifecycleDateTime.slice(0, 10)).sort();
        const enabled = s.prepaidUnits?.enabled ?? 0;
        return {
          external_id: s.skuPartNumber,
          name,
          seats: enabled >= UNLIMITED ? null : enabled,
          assigned: s.consumedUnits ?? 0,
          renewal_date: renewals[0] || null,
          unit_cost: price,
          people: users.filter(u => u.assignedLicenses?.some(l => l.skuId === s.skuId)).map(person),
        };
      });
      return [{ external_id: 'microsoft-365', name: 'Microsoft 365', vendor: 'Microsoft', category: 'Produttività e posta', plans }];
    },
  },

  entra: {
    label: 'Software esterni (Entra)',
    scopes: DIRECTORY_SCOPES,
    async read(token) {
      const [sps, grants, users] = await Promise.all([
        graphAll(token, "/servicePrincipals?$filter=tags/any(t:t eq 'WindowsAzureActiveDirectoryIntegratedApp')&$select=id,appId,displayName,appOwnerOrganizationId,createdDateTime&$top=999", { max: 5000 }),
        graphAll(token, '/oauth2PermissionGrants?$top=999', { max: 20000 }),
        readUsers(token),
      ]);
      const byId = new Map(users.map(u => [u.id, u]));
      const own = new Set(['Alma Planner', 'Microsoft Graph Command Line Tools']); // questa app e lo strumento di lettura
      // un software per nome (Entra ha spesso due app con lo stesso nome)
      const byName = new Map();
      for (const sp of sps) {
        if (sp.appOwnerOrganizationId === MICROSOFT_ORG || own.has(sp.displayName)) continue;
        const key = sp.displayName.trim().toLowerCase();
        const cur = byName.get(key) || { name: sp.displayName.trim(), appIds: [], spIds: new Set(), people: new Map() };
        cur.appIds.push(sp.appId);
        cur.spIds.add(sp.id);
        byName.set(key, cur);
      }
      // chi è assegnato all'app (o l'ha collegata al proprio account)
      for (const cur of byName.values()) {
        for (const spId of cur.spIds) {
          const assigned = await graphAll(token, `/servicePrincipals/${spId}/appRoleAssignedTo?$top=999`).catch(() => []);
          for (const a of assigned) if (a.principalType === 'User' && byId.has(a.principalId)) cur.people.set(a.principalId, person(byId.get(a.principalId)));
        }
      }
      for (const g of grants) {
        if (g.consentType !== 'Principal' || !byId.has(g.principalId)) continue;
        const cur = [...byName.values()].find(c => c.spIds.has(g.clientId));
        if (cur) cur.people.set(g.principalId, person(byId.get(g.principalId)));
      }
      return [...byName.values()].map(c => ({
        external_id: c.appIds.sort()[0],
        name: c.name,
        vendor: '',
        category: category(c.name),
        status: 'da_verificare', // scoperto da Microsoft: un amministratore lo conferma o lo archivia
        plans: [{ external_id: 'collegati', name: 'Utenti collegati', seats: null, assigned: c.people.size, renewal_date: null, people: [...c.people.values()] }],
      }));
    },
  },
};

// Allinea il censimento a quello che la fonte ha letto. Software e piani della fonte si creano o si aggiornano;
// le assegnazioni con quella fonte si rifanno (chi non ce l'ha più esce), quelle manuali o da pacchetto restano.
// Nome, tipo, prezzo, stato e note cambiati a mano non si sovrascrivono.
async function applySource(db, source, list, userId) {
  const out = { software: 0, created: 0, plans: 0, assignments: 0 };
  await db.tx(async q => {
    for (const s of list) {
      let { rows: [sw] } = await q.query('SELECT id FROM software WHERE source = $1 AND external_id = $2', [source, s.external_id]);
      if (!sw) {
        // stesso nome già nel censimento (messo a mano): si collega a quello invece di crearne un doppione
        ({ rows: [sw] } = await q.query('SELECT id FROM software WHERE lower(name) = lower($1) AND external_id IS NULL', [s.name]));
        if (sw) await q.query('UPDATE software SET source = $2, external_id = $3, updated_at = now() WHERE id = $1', [sw.id, source, s.external_id]);
      }
      if (!sw) {
        ({ rows: [sw] } = await q.query(
          `INSERT INTO software (name, vendor, category, status, source, external_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [s.name, s.vendor || '', s.category || '', s.status || 'attivo', source, s.external_id, userId]));
        out.created++;
      }
      out.software++;
      for (const p of s.plans) {
        let { rows: [plan] } = await q.query('SELECT id FROM software_plans WHERE software_id = $1 AND external_id = $2', [sw.id, p.external_id]);
        if (!plan) {
          ({ rows: [plan] } = await q.query(
            `INSERT INTO software_plans (software_id, name, external_id, seats, unit_cost, cost_estimated, renewal_date, source_assigned)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (software_id, (lower(name))) DO UPDATE SET external_id = EXCLUDED.external_id
             RETURNING id`,
            [sw.id, p.name, p.external_id, p.seats, p.unit_cost ?? null, p.unit_cost != null && p.unit_cost > 0, p.renewal_date, p.assigned]));
        } else {
          await q.query(
            `UPDATE software_plans SET seats = $2, renewal_date = COALESCE($3, renewal_date), source_assigned = $4,
                    unit_cost = CASE WHEN unit_cost IS NULL AND $5::numeric IS NOT NULL THEN $5::numeric ELSE unit_cost END,
                    cost_estimated = CASE WHEN unit_cost IS NULL AND $5::numeric > 0 THEN true ELSE cost_estimated END
              WHERE id = $1`,
            [plan.id, p.seats, p.renewal_date, p.assigned, p.unit_cost ?? null]);
        }
        out.plans++;
        const oids = p.people.map(x => x.oid);
        await q.query('DELETE FROM software_assignments WHERE plan_id = $1 AND source = $2 AND NOT (person_oid = ANY($3::text[]))', [plan.id, source, oids]);
        for (const x of p.people) {
          await q.query(
            `INSERT INTO software_assignments (plan_id, person_oid, person_name, person_email, source, account_disabled)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (plan_id, person_oid) DO UPDATE SET person_name = EXCLUDED.person_name, person_email = EXCLUDED.person_email,
                    account_disabled = EXCLUDED.account_disabled`,
            [plan.id, x.oid, x.name, x.email, source, Boolean(x.disabled)]);
        }
        out.assignments += p.people.length;
      }
    }
    await q.query(
      `INSERT INTO software_sync (source, synced_at, synced_by, result) VALUES ($1, now(), $2, $3)
       ON CONFLICT (source) DO UPDATE SET synced_at = now(), synced_by = $2, result = $3`, [source, userId, out]);
  });
  return out;
}

module.exports = { SOURCES, applySource, category, SKU };
