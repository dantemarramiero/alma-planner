// Ora italiana e giorni lavorativi (niente sabato, domenica e festività nazionali, Pasquetta compresa).
// Le date sono stringhe 'YYYY-MM-DD'.

const ROME = 'Europe/Rome';

// Data e minuti dalla mezzanotte, in ora italiana, per un istante (di default adesso).
function romeNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Pasqua (algoritmo di Meeus/Jones/Butcher).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const holidayCache = new Map();
function holidays(y) {
  if (!holidayCache.has(y)) {
    holidayCache.set(y, new Set([
      iso(y, 1, 1), iso(y, 1, 6), iso(y, 4, 25), iso(y, 5, 1), iso(y, 6, 2), iso(y, 8, 15),
      iso(y, 11, 1), iso(y, 12, 8), iso(y, 12, 25), iso(y, 12, 26), addDays(easter(y), 1),
    ]));
  }
  return holidayCache.get(y);
}

function isWorkday(day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays(Number(day.slice(0, 4))).has(day);
}

// n-esimo giorno lavorativo dopo (n > 0) o prima (n < 0) di day.
function addWorkdays(day, n) {
  let d = day;
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0;) {
    d = addDays(d, step);
    if (isWorkday(d)) left--;
  }
  return d;
}

module.exports = { romeNow, isWorkday, addWorkdays, addDays, easter };
