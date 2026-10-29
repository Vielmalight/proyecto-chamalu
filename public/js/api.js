import { state } from './state.js';

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.csrf_token) headers['X-CSRF-Token'] = state.csrf_token;
  const res = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Error del servidor');
  }
  return data;
}
