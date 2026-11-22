// Quota di Alma al giorno per persona (ALM2-62, 22/11/2026). Tutto sta nell'impostazione «alma.settings»:
// - daily_eur: la quota di tutti (Impostazioni → Costi AI);
// - admins_unlimited: gli amministratori non hanno limite al giorno (di serie sì; il tetto del mese vale per tutti);
// - user_daily: eccezioni per persona, { "<user_id>": <euro> | "unlimited" }, decise dagli amministratori.
// L'eccezione della persona vince sempre, anche su «amministratori senza limite».

const UNLIMITED = 'unlimited';

function overrideOf(raw, userId) {
  const v = raw && raw.user_daily && typeof raw.user_daily === 'object' ? raw.user_daily[String(userId)] : undefined;
  if (v === UNLIMITED) return UNLIMITED;
  const n = Number(v);
  return n > 0 ? n : null;
}

// → { unlimited, eur (null se senza limite), source: 'persona' | 'amministratore' | 'tutti' }
function quotaFor(raw, { userId, admin, daily }) {
  const o = overrideOf(raw, userId);
  if (o === UNLIMITED) return { unlimited: true, eur: null, source: 'persona' };
  if (o) return { unlimited: false, eur: o, source: 'persona' };
  if (admin && (raw || {}).admins_unlimited !== false) return { unlimited: true, eur: null, source: 'amministratore' };
  return { unlimited: false, eur: daily, source: 'tutti' };
}

// Valore arrivato dalla pagina: null/'' = come tutti, 'unlimited' = senza limite, numero = euro al giorno.
function parseOverride(v) {
  if (v === null || v === undefined || v === '' || v === 'default') return null;
  if (v === UNLIMITED) return UNLIMITED;
  const n = Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
  if (!(n > 0) || n > 1000) return undefined; // non valido
  return n;
}

module.exports = { UNLIMITED, quotaFor, overrideOf, parseOverride };
