// Dati condivisi tra le viste: utente collegato, persone, progetti.
import { get } from './api.js';

export const store = { me: null, users: [], projects: [], areas: [] };

export async function loadUsers() {
  store.users = await get('/api/users');
  return store.users;
}

export async function loadProjects() {
  store.projects = await get('/api/projects?all=1');
  return store.projects;
}

// Macro aree: gruppi di progetti (vedi routes/areas.js).
export async function loadAreas() {
  store.areas = await get('/api/areas');
  return store.areas;
}

export const userById = id => store.users.find(u => u.id === id);
export const userByHandle = handle => store.users.find(u => u.handle === String(handle).toLowerCase());
// Nome di battesimo («Ciao Dante», non «Ciao Marramiero»: da Microsoft il nome è «Cognome Nome», l'email nome.cognome@…).
// Stessa logica di lib/nome.js (givenName) sul server.
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export function givenName(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(email || '').split('@')[0];
  const parts = String(email || '').split('@')[0].split(/[._-]+/).map(fold).filter(Boolean);
  if (parts.length >= 2 && words.length >= 2) {
    const [first, ...rest] = parts;
    if (first.length > 1) {
      const hit = words.find(w => fold(w) === first);
      if (hit) return hit;
    }
    const surnameWords = words.filter(w => rest.includes(fold(w)));
    if (surnameWords.length) {
      const others = words.filter(w => !surnameWords.includes(w));
      if (others.length) return others.find(w => !first || fold(w).startsWith(first)) || others[0];
    }
  }
  return words[0];
}
export const firstName = u => givenName(u?.name, u?.email || (u?.id ? userById(u.id)?.email : ''));
export const projectById = id => store.projects.find(p => p.id === id);
export const areaById = id => store.areas.find(a => a.id === id);
export const activeProjects = () => store.projects.filter(p => p.status !== 'archived');
