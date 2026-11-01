// Lettura dei file Excel (.xlsx) senza dipendenze: un .xlsx è uno zip di file XML.
// Serve agli import di Alma Energy (screening dei tetti, Database impianti in Conto Energia): restituisce, per ogni
// foglio, le righe come array di valori (stringhe o numeri). Formule, stili e date non servono: si legge il valore.
const zlib = require('zlib');

// Elenco dei file dello zip dalla directory centrale.
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file non è un Excel (.xlsx) valido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Il file Excel è danneggiato');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return name => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + buf.readUInt16LE(f.local + 26) + buf.readUInt16LE(f.local + 28);
    const data = buf.subarray(start, start + f.size);
    if (f.method === 0) return data.toString('utf8');
    if (f.method === 8) return zlib.inflateRawSync(data).toString('utf8');
    throw new Error('Compressione del file Excel non supportata');
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTITIES[e.toLowerCase()]));
// Testo di un elemento con eventuali «run» di formattazione (<r><t>…</t></r>): si uniscono tutti i <t>.
const textOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

// Colonna «AB» → 27 (da zero).
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : rows.length;
    const row = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const col = ref ? colIndex(ref[1]) : row.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const inner = cm[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = null;
      if (type === 's') val = v === undefined ? null : shared[Number(v)] ?? null;
      else if (type === 'inlineStr') val = textOf(inner);
      else if (type === 'str' || type === 'e') val = v === undefined ? null : decode(v);
      else if (type === 'b') val = v === '1';
      else if (v !== undefined) val = Number(v);
      row[col] = val;
    }
    rows[rowIdx] = row;
  }
  // celle e righe vuote come null, senza «buchi» negli array
  return Array.from(rows, r => Array.from(r || [], c => (c === undefined ? null : c)));
}

// { nomeFoglio: [[...], ...] } per i fogli chiesti (tutti se `only` manca).
function readXlsx(buf, { only } = {}) {
  const get = unzip(buf);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('Il file non è un Excel (.xlsx) valido');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [
    /\bId="([^"]+)"/.exec(m[0])?.[1], /\bTarget="([^"]+)"/.exec(m[0])?.[1],
  ]));
  const sharedXml = get('xl/sharedStrings.xml') || '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(m[0])?.[1] || '');
    if (only && !only.includes(name)) continue;
    const target = targets.get(/\br:id="([^"]+)"/.exec(m[0])?.[1]);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = get(path);
    if (xml) out[name] = readSheet(xml, shared);
  }
  return out;
}

module.exports = { readXlsx };

// ── scrittura ──────────────────────────────────────────────────────────────────────────────────
// Un .xlsx semplice (zip senza compressione) con uno o più fogli: { nome: [[valori], …] }. Numeri come numeri,
// il resto come testo; la prima riga di ogni foglio in grassetto. Serve all'export degli scenari di Alma Energy.
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === null || v === undefined || v === '') return '';
    const ref = `${colName(ci)}${ri + 1}`;
    const style = ri === 0 ? ' s="1"' : '';
    return typeof v === 'number' && Number.isFinite(v)
      ? `<c r="${ref}"${style}><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
function zipStored(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
function writeXlsx(sheets) {
  const names = Object.keys(sheets).map(n => n.replace(/[\/?*[\]:]/g, ' ').slice(0, 31));
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
  };
  Object.values(sheets).forEach((rows, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(rows); });
  return zipStored(files);
}

module.exports.writeXlsx = writeXlsx;
