// Alma Strategy: dati di partenza del 2026, presi dal file «Hoshin Kanri 2026.xlsx» (True North, pillar, KPI di livello 0,
// BU e funzioni con le aree e gli sponsor). I progetti sono esempi dal 2025, tranne l'A3 «Tecnologie innovative per il
// monitoraggio sismico», preso dal format A3 di Almacis. Si caricano una volta sola, la prima volta che si apre l'anno.

const TRUE_NORTH = 'Guidare la trasformazione delle costruzioni, delle infrastrutture e dell’energia, attraverso soluzioni innovative e digitali, generando crescita sostenibile e creando valore per tutti gli Stakeholders coinvolti';

const PILLARS = [
  ['Human & Digital Operational Excellence', 'Valore per i partner, persone che crescono, AI e digitale in esecuzione', '#E3BE00'],
  ['E2E value & reliability', 'Sicurezza, etica, ambiente, fiducia nel lungo periodo', '#4E9FCF'],
  ['Design the future', 'Innovazione, economia circolare, nuovo assetto software', '#BF62B6'],
];

// [nome, sponsor, colore, tipo, aree [nome, sponsor di area]]
const FUNCTIONS = [
  ['ICT', 'D. Marramiero', '#4F8FCC', 'staff', [['ICT', 'D. Marramiero']]],
  ['Engineering', 'M. Franchi', '#D45577', 'staff', [['Progettazione', 'M. Franchi'], ['ISA', 'E. Grande'], ['Ufficio tecnico', 'F. Marinucci']]],
  ['AFC', 'D. Berardinucci', '#34A88B', 'staff', [['AFC', 'D. Berardinucci']]],
  ['HR', 'E. Marramiero', '#E09A2D', 'staff', [['HR', 'E. Marramiero']]],
  ['HQSE', 'M. Panara', '#3570B5', 'staff', [['HSE', 'M. Panara'], ['SGI', 'F. Febbo']]],
  ['Supply Chain', 'F. Di Giuseppe', '#4A9A4C', 'staff', [['Procurement & WH', 'F. Basile'], ['Ufficio gare', 'V. Marinelli']]],
  ['Energy', 'da nominare', '#2A9FCB', 'bu', [['Consulenza energetica', 'E. Marramiero'], ['ESCO', 'E. Marramiero']]],
  ['Facility Management', 'G. Di Nicola', '#5C6B6B', 'bu', [['Manutenzione impiantistica', 'N. Tauro'], ['Facility Management', 'G. Ricci']]],
  ['Building', 'da nominare', '#8E62B0', 'bu', [['Restauro', 'A. Antonucci'], ['Construction', 'A. Erbivendolo']]],
  ['Impianti', 'da nominare', '#C9503F', 'bu', [['Industriali / Utilities', 'S. Mancinelli'], ['Produzione di energia', 'S. Mancinelli'], ['Renewables', 'S. Mancinelli'], ['Water', 'L. Di Febo']]],
  ['Network Utilities', 'da nominare', '#9A5A28', 'bu', [['Reti BP/MP', 'L. Fragassi'], ['Reti AP', 'S. Recchia'], ['Acquedotti', 'L. Fragassi'], ['Reti elettriche', 'D. Marramiero'], ['Reti ferroviarie', 'D. Marramiero']]],
];

// [lettera, pillar (indice), nome, owner, target, valori mensili]
const KPIS = [
  ['A', 0, 'Ricavi', 'D. Berardinucci', 'da definire', ['3,0', '6,6', '10,8', '15,2', '20,2', '25,3', '30,4', '34,2']],
  ['B', 0, 'EBITDA %', 'D. Berardinucci', 'da definire', ['6,7', '2,5', '3,4', '2,6', '6,2', '4,7', '3,7', '5,1']],
  ['C', 0, 'Commesse completate nei tempi contrattuali', 'da assegnare', '≥ 95%', []],
  ['D', 0, 'Commesse completate entro il budget', 'da assegnare', '≥ 95%', []],
  ['E', 0, 'Nuove commesse oltre 10 M€', 'P. Di Cintio', '≥ 3 l’anno', []],
  ['F', 0, 'Fatturato sul singolo cliente', 'D. Berardinucci', '≤ 20%', []],
  ['G', 1, 'FCFO positivo', 'D. Berardinucci', 'ogni trimestre', []],
  ['H', 1, 'Riduzione emissioni CO₂', 'M. Panara', 'da definire', []],
  ['I', 1, 'Infortuni', 'M. Panara', '0', []],
  ['M', 2, 'Digitalizzazione del flusso di gestione commessa', 'D. Marramiero', '100%', []],
  ['N', 2, 'POC innovative', 'T. Natale', '≥ 2', []],
];

// Progetti di esempio: [area, nome, owner, KPI, target, tappe [mese 0-11, atteso %, reale % o null]].
// Le tappe diventano contromisure: peso = salto dell'atteso, scadenza = fine del mese, chiusa quando il reale la raggiunge.
const EXAMPLES = [
  ['ICT', 'Budget, RDA e ODA su BOSS', 'D. Marramiero', ['B', 'D', 'M'], '3 moduli in produzione entro Q4', [[2, 15, 15], [5, 35, 40], [9, 55, 60], [11, 100, null]]],
  ['ICT', 'CRM: analisi per generare l’offerta', 'M. Mancini', ['E', 'F'], '100% completato entro Q3', [[2, 50, 50], [6, 70, 70], [7, 80, 80], [8, 100, null]]],
  ['ICT', 'Dashboard BI per il controllo di commessa', 'D. Marramiero', ['C', 'D'], 'Dashboard in uso su tutte le commesse', [[3, 25, 25], [6, 50, 50], [9, 75, 60], [11, 100, null]]],
  ['ISA', 'Progetto ABES (+ business model)', 'E. Grande', ['H', 'N'], 'Impianto pilota acceso entro Q4', [[6, 30, 30], [8, 50, 50], [9, 70, 70], [10, 85, null], [11, 100, null]]],
  ['Ufficio tecnico', 'Iniziative di efficientamento energetico', 'F. Marinucci', ['H'], 'Report interventi di riduzione fabbisogno', [[4, 33, 33], [8, 66, 66], [11, 100, null]]],
  ['HR', 'Zoho Recruit e Zoho People', 'E. Marramiero', ['M'], 'Entrambi in uso entro Q3', [[2, 30, 30], [5, 60, 60], [8, 100, 100]]],
  ['HSE', 'Gemba interni sui cantieri', 'S. Mancinelli', ['I', 'C'], 'N. 22 gemba svolti entro Q4', [[2, 40, 5], [4, 40, 35], [5, 70, 35], [8, 85, null], [11, 100, null]]],
  ['SGI', 'Carbon footprint (Scope 1, 2)', 'J. Di Gregorio', ['H'], '100% entro Q4, piano di decarbonizzazione', [[0, 5, 5], [1, 32, 22], [2, 42, 32], [4, 62, 32], [5, 67, 42], [6, 72, 51], [7, 77, 56], [8, 82, 82], [10, 92, null], [11, 100, null]]],
  ['Manutenzione impiantistica', 'Applicazione AI alla manutenzione predittiva', 'N. Tauro', ['D', 'N'], 'Piattaforma AI in esercizio', [[0, 5, 5], [1, 20, 20], [3, 45, 45], [6, 80, 80], [10, 90, null], [11, 100, null]]],
  ['Construction', 'Gestione di commessa 2.0', 'R. Della Valle', ['C', 'D', 'M'], 'N. 3 processi ottimizzati entro Q4', [[4, 30, 30], [5, 60, 60], [7, 80, 80], [8, 100, null]]],
  ['Reti BP/MP', 'Leader Standard Work area metano', 'F. Giuliani', ['C', 'D', 'I'], 'Standard su tutti i cantieri metano', [[2, 15, 15], [5, 35, 15], [8, 55, 35], [9, 70, 35], [10, 90, null], [11, 100, null]]],
  ['Reti BP/MP', 'Rapportini digitali reti metano', 'L. Fragassi', ['C', 'M'], 'Tutte le squadre sull’app entro Q4', [[3, 20, 20], [6, 50, 55], [9, 75, 75], [11, 100, null]]],
];

// L'A3 vero, dal format di Almacis.
const SEISMIC = {
  area: 'Construction', name: 'Tecnologie innovative per il monitoraggio sismico', owner: 'Antonio Erbivendolo', team: 'Antonio Erbivendolo',
  kpis: ['N'], target: 'Monitoraggio in fibra ottica offerto al Committente', start_year: 2026,
  background: 'POC per il monitoraggio sismico mediante tecnologia con fibra ottica su edificio in costruzione.',
  current_conditions: 'Avviata corrispondenza con Theya Sense (spin-off del Politecnico di Torino) per testare la tecnologia in fibra ottica su un nostro progetto interno.',
  target_conditions: 'Testare il monitoraggio in fibra ottica durante le fasi operative dell’edificio in costruzione e, successivamente, avviare un monitoraggio condiviso con il Committente ad edificio ultimato, per offrirlo come soluzione definitiva di utilizzo.',
  effect: 'Monitoraggio sismico in fibra ottica non ancora validato sul campo',
  tasks: [
    ['Avviare corrispondenza con Theya Sense e condividere le modalità operative di intervento', 15, '2026-04-30', '2026-04-30'],
    ['Effettuare test sul campo e raccolta dati a seguito del monitoraggio', 15, '2026-06-30', '2026-08-31'],
    ['Reportistica e sponsorizzazione della POC per l’evento SOFIA 2026', 15, '2026-09-07', '2026-09-07'],
    ['Predisporre il nuovo piano operativo di monitoraggio da presentare al Committente per l’installazione conclusiva', 15, '2026-12-31', null],
    ['Accettazione da parte del Committente', 15, '2027-02-26', null],
    ['Installazione della componentistica e monitoraggio continuo per un semestre', 15, '2027-08-31', null],
    ['Reportistica e sponsorizzazione per un nuovo evento', 10, '2027-09-30', null],
  ],
};

const lastDay = (year, m) => new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);

// Tappe → contromisure (vedi sopra).
function tasksFromPlan(year, plan) {
  let prev = 0;
  return plan.map(([m, exp], i) => {
    const weight = exp - prev;
    prev = exp;
    const reach = plan.slice(i).find(([, , act]) => act !== null && act >= exp);
    return [`Tappa ${i + 1}`, weight, lastDay(year, m), reach ? lastDay(year, reach[0]) : null];
  });
}

async function seedStrategy(db, year) {
  await db.tx(async t => {
    const { rows: [exists] } = await t.query('SELECT 1 FROM hk_years WHERE year = $1', [year]);
    if (exists) return;
    await t.query('INSERT INTO hk_years (year, true_north) VALUES ($1, $2)', [year, TRUE_NORTH]);
    const pillarIds = [];
    for (const [i, [name, description, color]] of PILLARS.entries()) {
      const { rows: [r] } = await t.query('INSERT INTO hk_pillars (year, position, name, description, color) VALUES ($1,$2,$3,$4,$5) RETURNING id', [year, i, name, description, color]);
      pillarIds.push(r.id);
    }
    const areaIds = {};
    let pos = 0;
    for (const [i, [name, sponsor, color, kind, areas]] of FUNCTIONS.entries()) {
      const { rows: [f] } = await t.query('INSERT INTO hk_functions (year, position, kind, name, sponsor, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [year, i, kind, name, sponsor, color]);
      for (const [aname, asponsor] of areas) {
        const { rows: [a] } = await t.query('INSERT INTO hk_areas (year, function_id, position, name, sponsor) VALUES ($1,$2,$3,$4,$5) RETURNING id', [year, f.id, pos++, aname, asponsor]);
        areaIds[aname] = a.id;
      }
    }
    const kpiIds = {};
    for (const [i, [letter, p, name, owner, target, monthly]] of KPIS.entries()) {
      const { rows: [k] } = await t.query('INSERT INTO hk_kpis (year, pillar_id, position, letter, name, owner, target, monthly) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [year, pillarIds[p], i, letter, name, owner, target, JSON.stringify(monthly)]);
      kpiIds[letter] = k.id;
    }
    const addProject = async (p, i, tasks) => {
      const { rows: [r] } = await t.query(
        `INSERT INTO hk_projects (year, area_id, position, name, owner, team, target, start_year, kpi_ids, background, current_conditions, target_conditions, effect)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [year, areaIds[p.area], i, p.name, p.owner, p.team || p.owner, p.target, p.start_year || year, JSON.stringify(p.kpis.map(l => kpiIds[l])),
          p.background || '', p.current_conditions || '', p.target_conditions || '', p.effect || '']);
      for (const [j, [activity, weight, due, closed]] of tasks.entries()) {
        await t.query('INSERT INTO hk_tasks (project_id, position, area, activity, weight, owner, due_date, closed_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [r.id, j, p.taskArea || '', activity, weight, p.owner, due, closed]);
      }
    };
    let i = 0;
    for (const [area, name, owner, kpis, target, plan] of EXAMPLES) {
      await addProject({ area, name, owner, kpis, target }, i++, tasksFromPlan(year, plan));
    }
    await addProject({ ...SEISMIC, taskArea: 'Edilizia · Cantiere Tai Prora Cepagatti' }, i++, SEISMIC.tasks);
  });
}

module.exports = { seedStrategy };
