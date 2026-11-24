// Alma Energy · fondi ed energivori come clienti potenziali (ALM2-83 tappa 2). Calcoli senza database:
// - quanto il mandato di un fondo combacia con un nostro progetto (tecnologia, taglia, regione, fase);
// - punteggio di un energivoro (consumo, tetto, regione, motivo recente) e risparmio stimato con un PPA sul tetto.
const { PPA_DEFAULTS } = require('./energy-scenarios');

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TECH_WORDS = {
  fotovoltaico: /(fotovolta|agrivolta|solare|\bfv\b|\bpv\b|photovolta)/, biometano: /(biometano|biogas|biomass)/,
  efficientamento: /(efficien|cogenera|pompe di calore|\bcer\b|comunita energetic)/, eolico: /(eolic|wind)/, accumuli: /(accumul|storage|bess|batteri)/,
};
// Tecnologie lette da un testo (notizia o mandato scritto a mano).
function techsOfText(...texts) {
  const t = norm(texts.join(' '));
  return Object.entries(TECH_WORDS).filter(([, re]) => re.test(t)).map(([k]) => k);
}

const REGIONS = ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise',
  'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino-Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto'];
const AREAS = { nord: ['Piemonte', "Valle d'Aosta", 'Lombardia', 'Liguria', 'Trentino-Alto Adige', 'Veneto', 'Friuli-Venezia Giulia', 'Emilia-Romagna'],
  centro: ['Toscana', 'Umbria', 'Marche', 'Lazio'], sud: ['Abruzzo', 'Molise', 'Campania', 'Puglia', 'Basilicata', 'Calabria'], isole: ['Sicilia', 'Sardegna'] };
function regionsOfText(...texts) {
  const t = norm(texts.join(' '));
  const out = new Set(REGIONS.filter(r => t.includes(norm(r))));
  for (const [area, list] of Object.entries(AREAS)) if (new RegExp(`\\b${area}\\b`).test(t)) list.forEach(r => out.add(r));
  return [...out];
}
const inRegions = (region, list) => !list?.length || list.some(r => {
  const n = norm(r);
  return n === norm(region) || (AREAS[n] || []).some(x => norm(x) === norm(region)) || n.includes('italia');
});

// Tecnologia e fase di un nostro progetto (opportunità o progetto selezionato).
const projectTech = p => (p.kind === 'ppa_onsite' || p.project_type === 'ppa_onsite' ? 'fotovoltaico' : 'fotovoltaico');
function projectPhase(p) {
  const t = p.project_type || (p.kind === 'revamping' ? 'revamping' : p.kind === 'ppa_onsite' ? 'ppa_onsite' : 'fv_nuovo');
  if (t === 'acquisizione' || t === 'revamping') return 'esercizio';
  if (t === 'ppa_onsite') return 'costruzione';
  if (p.stage === 'rtb' || p.stage === 'autorizzato' || p.selection === 'avviato') return 'autorizzato';
  return 'greenfield';
}

// Quanto un mandato combacia con un progetto: tecnologia 40, taglia 25, regione 20, fase 15. Restituisce 0–100.
function matchFund(m, p) {
  const reasons = [];
  let pct = 0;
  const techs = m.techs || [];
  if (!techs.length || techs.includes(projectTech(p))) { pct += 40; reasons.push('tecnologia'); }
  const capex = Number(p.capex) || null;
  const lo = m.ticket_min === null || m.ticket_min === undefined ? null : Number(m.ticket_min);
  const hi = m.ticket_max === null || m.ticket_max === undefined ? null : Number(m.ticket_max);
  if (capex === null || (lo === null && hi === null)) pct += 12;
  else if ((lo === null || capex >= lo * 0.8) && (hi === null || capex <= hi)) { pct += 25; reasons.push('taglia'); }
  if (inRegions(p.region, m.regions)) { pct += 20; reasons.push('regione'); }
  const phases = m.phases || [];
  if (!phases.length || phases.includes(projectPhase(p))) { pct += 15; reasons.push('fase'); }
  return { pct, reasons };
}

// Energivori: risparmio stimato all'anno con un PPA sul tetto (energia del tetto, non più del consumo, pagata al
// prezzo PPA invece che in bolletta), con le ipotesi di partenza del simulatore.
function savingEur(e, d = PPA_DEFAULTS) {
  const consMwh = (Number(e.consumption_gwh) || 0) * 1000;
  const roofMwh = (Number(e.roof_m2) || 0) * d.usableShare * d.kwpPerM2 * d.kwhPerKwp / 1000;
  const mwh = roofMwh ? Math.min(consMwh || roofMwh, roofMwh) : 0;
  return Math.round(mwh * (d.billPrice - d.ppaPrice));
}

// Punteggio 0–100: consumo 40 (più consuma, più conta), tetto 25, regione preferita 15, motivo recente 20.
function energivoroScore(e, { regions = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const gwh = Number(e.consumption_gwh) || 0;
  const consumption = Math.min(40, Math.round(Math.log10(1 + gwh) * 20));
  const roof = Math.min(25, Math.round(((Number(e.roof_m2) || 0) / 20000) * 25));
  const area = !regions.length || inRegions(e.region, regions) ? 15 : 4;
  let reason = 0;
  if (e.energy_reason && e.energy_reason_on) {
    const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${String(e.energy_reason_on).slice(0, 10)}T12:00:00Z`)) / 864e5;
    reason = days <= 30 ? 20 : days <= 90 ? 10 : 4;
  }
  return Math.min(100, consumption + roof + area + reason);
}

module.exports = { techsOfText, regionsOfText, inRegions, projectPhase, matchFund, savingEur, energivoroScore };
