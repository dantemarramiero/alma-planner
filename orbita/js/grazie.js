// «Grazie a…»: ringraziare un collega (con un pillar dell'Hoshin Kanri, facoltativo). Lo usano la Home e la Bacheca.
import { h, modal, toast } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';

// «Grazie a…»: un collega, un pillar, due righe
export function openGrazie(pillars, onDone) {
  const who = h('select.select', h('option', { value: '' }, 'Scegli il collega…'),
    store.users.filter(u => u.active !== false && u.id !== store.me.id).map(u => h('option', { value: String(u.id) }, u.name)));
  const pillar = h('select.select', h('option', { value: '' }, 'Nessun pillar'), pillars.map(p => h('option', { value: p.name }, p.name)));
  const text = h('textarea.input', { rows: 3, maxlength: 2000, placeholder: 'Per cosa lo ringrazi?' });
  const m = modal({
    title: 'Ringrazia un collega',
    body: [h('label.field', h('span', 'Chi'), who), h('label.field', h('span', 'Grazie per…'), text),
      h('label.field', h('span', 'Su quale pillar dell’Hoshin Kanri (facoltativo)'), pillar),
      h('p.muted.small', 'Compare nella bacheca e nella pagina di benvenuto; il collega riceve una notifica.')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!who.value || !text.value.trim()) { toast('Scegli il collega e scrivi il ringraziamento', 'err'); return; }
        await post('/api/welcome/grazie', { user_id: Number(who.value), body: text.value.trim(), pillar: pillar.value });
        m.close(); toast('Grazie pubblicato'); onDone?.();
      } } }, 'Pubblica')],
  });
}

// i pillar dell'anno, se la strategia c'è (altrimenti si ringrazia senza pillar)
export async function openGrazieLoading(onDone) {
  const hk = await get(`/api/strategy?year=${new Date().getFullYear()}`, { quiet: true }).catch(() => null);
  openGrazie(hk?.pillars || [], onDone);
}
