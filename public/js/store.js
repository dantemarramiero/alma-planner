// Dati condivisi tra le viste: utente collegato, persone, progetti.
import { get } from './api.js';

export const store = { me: null, users: [], projects: [] };

export async function loadUsers() {
  store.users = await get('/api/users');
  return store.users;
}

export async function loadProjects() {
  store.projects = await get('/api/projects?all=1');
  return store.projects;
}

export const userById = id => store.users.find(u => u.id === id);
export const projectById = id => store.projects.find(p => p.id === id);
export const activeProjects = () => store.projects.filter(p => p.status !== 'archived');
