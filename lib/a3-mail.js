// Email di invito a un A3: allegra, con la «stampa» dell'A3 come corpo e la nota di chi invita in evidenza.
// HTML da email (tabelle e stili in linea, niente SVG né CSS esterno: Outlook li ignora).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const first = name => String(name || '').trim().split(/\s+/)[0] || '';
const CAUSES = [['macchine', 'Macchine / Strumenti'], ['persone', 'Persone'], ['ambiente', 'Ambiente'], ['materiali', 'Materiali'], ['metodo', 'Metodo'], ['misurazioni', 'Misurazioni']];

function progressAt(tasks, iso) {
  let act = 0, exp = 0;
  for (const t of tasks) {
    if (t.closed_date && t.closed_date <= iso) act += t.weight;
    if (t.due_date && t.due_date <= iso) exp += t.weight;
  }
  return { act, exp };
}

const box = (title, num, inner, { dark = false } = {}) => `
  <td valign="top" style="padding:6px">
    <div style="background:${dark ? '#2C2C2C' : '#FFFFFF'};border:1px solid ${dark ? '#2C2C2C' : '#ECEAE6'};border-radius:14px;padding:16px;min-height:90px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${dark ? '#FFB370' : '#A84E00'};margin-bottom:6px">${num} · ${esc(title)}</div>
      <div style="font-size:13px;line-height:1.5;color:${dark ? '#FFFFFF' : '#2C2C2C'}">${inner || `<span style="color:${dark ? '#C9C4BE' : '#9A958F'}">Ancora da scrivere</span>`}</div>
    </div>
  </td>`;

// a3: riga di hk_projects con tasks; ctx: { inviter, invitee, note, link, func, area, kpis, today }
function buildInviteEmail(a3, { inviter, invitee, note, link, func, area, kpis = [], today }) {
  const color = func?.color || '#FF8A26';
  const pr = progressAt(a3.tasks || [], today);
  const done = (a3.tasks || []).filter(t => t.closed_date).length;
  const causes = a3.causes || {};
  const causeRows = CAUSES.filter(([k]) => (causes[k] || []).length)
    .map(([k, l]) => `<tr><td style="padding:3px 12px 3px 0;color:#6B6660;font-size:12px;white-space:nowrap" valign="top">${esc(l)}</td><td style="padding:3px 0;font-size:13px">${causes[k].map(esc).join(' · ')}</td></tr>`).join('');
  const tasks = (a3.tasks || []).map((t, i) => {
    const late = !t.closed_date && t.due_date && t.due_date < today;
    const st = t.closed_date ? ['#E7F5EC', '#1F6A41', 'chiusa'] : late ? ['#FCEBE9', '#A3261B', 'in ritardo'] : ['#F1EFEB', '#5E5A55', 'da fare'];
    return `<tr>
      <td style="padding:8px 6px;border-top:1px solid #ECEAE6;font-weight:700;color:${color}" valign="top">${i + 1}</td>
      <td style="padding:8px 6px;border-top:1px solid #ECEAE6;font-size:13px" valign="top">${esc(t.activity)}${t.area ? `<div style="font-size:11px;color:#9A958F">${esc(t.area)}</div>` : ''}</td>
      <td style="padding:8px 6px;border-top:1px solid #ECEAE6;font-size:12px;color:#6B6660;white-space:nowrap" valign="top">${esc(t.owner || '—')}</td>
      <td style="padding:8px 6px;border-top:1px solid #ECEAE6;font-size:12px;white-space:nowrap" valign="top">${itDate(t.due_date)}</td>
      <td style="padding:8px 6px;border-top:1px solid #ECEAE6;white-space:nowrap" valign="top"><span style="display:inline-block;padding:2px 9px;border-radius:10px;background:${st[0]};color:${st[1]};font-size:11px;font-weight:700">${st[2]}</span></td>
    </tr>`;
  }).join('');
  const kpiChips = kpis.map(k => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:12px;background:#FFF1E4;border:1px solid #FFD2AB;font-size:12px;color:#7A3900"><b>${esc(k.letter)}</b> ${esc(k.name)}</span>`).join('');
  const bar = Math.max(0, Math.min(100, pr.act));

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
@media (max-width: 520px) { .px { padding-left: 18px !important; padding-right: 18px !important; } .stack td { display: block !important; width: auto !important; } .big { font-size: 24px !important; } }
</style></head><body style="margin:0;padding:0;background:#F7F6F3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F3;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2C2C2C">
<tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">

  <!-- testata allegra -->
  <tr><td style="background:${color};border-radius:22px 22px 0 0;padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:28px 30px 8px;font-size:13px;color:#FFFFFF;letter-spacing:.08em;text-transform:uppercase;font-weight:700">Alma Strategy · Hoshin Kanri</td>
      <td align="right" style="padding:22px 26px 0;line-height:0;white-space:nowrap" aria-hidden="true">
        <span style="display:inline-block;width:16px;height:16px;border-radius:8px;background:#F2D85C;margin:0 4px 18px 0"></span>
        <span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:#FFFFFF;margin:0 6px 4px 0"></span>
        <span style="display:inline-block;width:24px;height:24px;border-radius:12px;background:#FF8A26;margin:0 6px 26px 0"></span>
        <span style="display:inline-block;width:11px;height:11px;border-radius:6px;background:#E2A9DC;margin:0 0 6px 0"></span>
      </td>
    </tr></table>
    <div class="px" style="padding:6px 30px 26px">
      <div class="big" style="font-size:30px;line-height:1.2;color:#FFFFFF;font-weight:300">Ciao ${esc(first(invitee.name))}, <b style="font-weight:700">benvenuto a bordo!</b></div>
      <div style="font-size:15px;color:#FFFFFF;opacity:.95;margin-top:8px">${esc(inviter.name)} ti ha invitato nel team dell’A3</div>
    </div>
    <div style="height:14px;background:#FFFFFF;border-radius:22px 22px 0 0;margin:0 0 -1px"></div>
  </td></tr>

  <tr><td class="px" style="background:#FFFFFF;padding:4px 30px 24px;border-radius:0 0 22px 22px">
    <div style="font-size:24px;font-weight:600;line-height:1.25;margin:4px 0 6px">${esc(a3.name)}</div>
    <div style="font-size:13px;color:#6B6660">${[func?.name, area?.name].filter(Boolean).map(esc).join(' · ')}${a3.owner ? ` · Proprietario <b style="color:#2C2C2C">${esc(a3.owner)}</b>` : ''}</div>

    ${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px"><tr>
      <td width="44" valign="top"><div style="width:40px;height:40px;border-radius:20px;background:#2C2C2C;color:#FFFFFF;font-weight:700;font-size:15px;line-height:40px;text-align:center">${esc((inviter.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</div></td>
      <td valign="top" style="padding-left:10px">
        <div style="background:#FFF7EF;border:2px solid #FFD2AB;border-radius:4px 18px 18px 18px;padding:14px 16px;font-size:15px;line-height:1.55;color:#2C2C2C">${nl(note)}</div>
        <div style="font-size:12px;color:#9A958F;margin-top:6px">— ${esc(inviter.name)}, perché vorrei proprio te in questo progetto</div>
      </td></tr></table>` : ''}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:999px;background:#2C2C2C">
      <a href="${esc(link)}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px">Entra nell’A3 →</a>
    </td></tr></table>

    <!-- a che punto siamo -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack" style="margin-top:22px;background:#F7F6F3;border-radius:16px"><tr>
      <td style="padding:16px 18px" width="34%"><div style="font-size:11px;color:#6B6660;text-transform:uppercase;letter-spacing:.06em">Avanzamento</div><div style="font-size:26px;font-weight:300">${pr.act}%</div><div style="font-size:12px;color:#6B6660">atteso a oggi ${pr.exp}%</div></td>
      <td style="padding:16px 18px" width="33%"><div style="font-size:11px;color:#6B6660;text-transform:uppercase;letter-spacing:.06em">Contromisure</div><div style="font-size:26px;font-weight:300">${done} / ${(a3.tasks || []).length}</div><div style="font-size:12px;color:#6B6660">chiuse</div></td>
      <td style="padding:16px 18px" width="33%"><div style="font-size:11px;color:#6B6660;text-transform:uppercase;letter-spacing:.06em">Team</div><div style="font-size:13px;line-height:1.4;margin-top:4px">${esc(a3.team || '—')}</div></td>
    </tr><tr><td colspan="3" style="padding:0 18px 16px">
      <div style="height:10px;border-radius:5px;background:#E6E3DE"><div style="height:10px;width:${bar}%;border-radius:5px;background:${pr.act >= pr.exp ? '#2E8B57' : '#C0392B'}"></div></div>
    </td></tr></table>

    ${kpiChips ? `<div style="margin-top:20px"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6B6660;margin-bottom:8px">I KPI di livello 0 su cui lavoriamo</div>${kpiChips}</div>` : ''}

    <!-- la stampa dell'A3 -->
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6B6660;margin:24px 0 4px">L’A3 in breve</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack" style="margin:0 -6px"><tr>
      ${box('Background', 1, nl(a3.background))}${box('Current conditions', 2, nl(a3.current_conditions))}
    </tr><tr>
      ${box('Target conditions', 3, nl(a3.target_conditions), { dark: true })}${box('Analysis', 4, `${a3.effect ? `<div style="margin-bottom:6px"><b>Effetto:</b> ${esc(a3.effect)}</div>` : ''}${causeRows ? `<table role="presentation" cellpadding="0" cellspacing="0">${causeRows}</table>` : ''}`)}
    </tr></table>

    ${tasks ? `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#A84E00;margin:18px 0 6px">5 · Countermeasures</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr><td style="font-size:11px;color:#9A958F;padding:0 6px 4px">Rif.</td><td style="font-size:11px;color:#9A958F;padding:0 6px 4px">Attività</td><td style="font-size:11px;color:#9A958F;padding:0 6px 4px">Owner</td><td style="font-size:11px;color:#9A958F;padding:0 6px 4px">Scadenza</td><td style="font-size:11px;color:#9A958F;padding:0 6px 4px">Stato</td></tr>
      ${tasks}
    </table>` : ''}

    ${a3.follow_up_quality ? `<div style="margin-top:18px;background:#F7F6F3;border-radius:14px;padding:14px 16px"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#A84E00;margin-bottom:6px">6 · Follow up</div><div style="font-size:13px;line-height:1.5">${nl(a3.follow_up_quality)}</div></div>` : ''}

    <div style="text-align:center;margin:26px 0 8px;line-height:0" aria-hidden="true">
      <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:#FF8A26;margin:0 4px"></span><span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#4E9FCF;margin:0 4px"></span><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:#E3BE00;margin:0 4px"></span><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#BF62B6;margin:0 4px"></span><span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:#2E8B57;margin:0 4px"></span>
    </div>
    <div style="text-align:center;font-size:14px;color:#6B6660">Ci vediamo nell’A3: ticket, Gantt e incontri sono già lì ad aspettarti.</div>
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto 0"><tr><td style="border-radius:999px;background:${color}">
      <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px">Apri l’A3 in Alma Strategy</a>
    </td></tr></table>
  </td></tr>

  <tr><td style="padding:16px 30px;text-align:center;font-size:11px;color:#9A958F">Ricevi questa email perché ${esc(inviter.name)} ti ha invitato in un A3 dell’Hoshin Kanri di Almacis, su Alma Planet.</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject: `${first(inviter.name)} ti invita nell’A3 «${a3.name}»`.slice(0, 250), html };
}

module.exports = { buildInviteEmail };
