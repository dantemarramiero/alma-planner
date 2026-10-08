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
export const firstName = u => (u?.name || '').split(/\s+/)[0];
export const projectById = id => store.projects.find(p => p.id === id);
export const areaById = id => store.areas.find(a => a.id === id);
export const activeProjects = () => store.projects.filter(p => p.status !== 'archived');
