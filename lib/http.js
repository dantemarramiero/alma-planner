// Errori HTTP con messaggio da mostrare all'utente, e validatori per i corpi delle richieste.
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ogni validatore restituisce il valore pulito (undefined = campo assente) o lancia 400.
const v = {
  text(value, field, { max = 500, required = false } = {}) {
    if (value === undefined || value === null) {
      if (required) throw new HttpError(400, `Il campo «${field}» è obbligatorio`);
      return value === null ? '' : undefined;
    }
    if (typeof value !== 'string') throw new HttpError(400, `Il campo «${field}» non è valido`);
    const s = value.trim();
    if (required && !s) throw new HttpError(400, `Il campo «${field}» è obbligatorio`);
    if (s.length > max) throw new HttpError(400, `Il campo «${field}» supera ${max} caratteri`);
    return s;
  },
  date(value, field) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(Date.parse(value))) {
      throw new HttpError(400, `La data «${field}» non è valida`);
    }
    return value;
  },
  oneOf(value, field, allowed) {
    if (value === undefined) return undefined;
    if (!allowed.includes(value)) throw new HttpError(400, `Il valore di «${field}» non è valido`);
    return value;
  },
  int(value, field, { min = -Infinity, max = Infinity, nullable = false } = {}) {
    if (value === undefined) return undefined;
    if (value === null || value === '') {
      if (nullable) return null;
      throw new HttpError(400, `Il campo «${field}» è obbligatorio`);
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Il campo «${field}» non è valido`);
    return n;
  },
  ids(value, field) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new HttpError(400, `Il campo «${field}» non è valido`);
    return [...new Set(value.map(x => v.int(x, field, { min: 1 })))];
  },
  color(value, field) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new HttpError(400, `Il colore «${field}» non è valido`);
    return value;
  },
};

module.exports = { HttpError, v };
