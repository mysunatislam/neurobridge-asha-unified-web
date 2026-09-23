export const siteBase = new URL('./', import.meta.url);
export const apiBase = 'https://neurobridge-asha-maira-relay.vercel.app/api/v1/demo/session';

export function applyTheme() {
  document.documentElement.dataset.theme = localStorage.getItem('asha_theme') === 'light' ? 'light' : 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.textContent = document.documentElement.dataset.theme === 'light' ? '☾ Dark' : '☀ Light';
  });
}
export function wireTheme() {
  applyTheme();
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
    localStorage.setItem('asha_theme', document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    applyTheme();
  }));
}

export async function demoApi({ method = 'GET', view, patientId, token, body }) {
  const url = new URL(apiBase);
  if (view) { url.searchParams.set('view', view); url.searchParams.set('patientId', patientId); }
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export function linkFor(role, patientId, token) {
  const url = new URL(`${role}/`, siteBase);
  url.hash = new URLSearchParams({ patientId, token }).toString();
  return url.href;
}
export function credentialsFromLink(role) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const patientId = fragment.get('patientId');
  const token = fragment.get('token');
  if (patientId && token) {
    if (role === 'patient') localStorage.setItem('asha_patient_link', JSON.stringify({ patientId, token }));
    history.replaceState(null, '', location.pathname + location.search);
    return { patientId, token };
  }
  if (role === 'patient') {
    try { return JSON.parse(localStorage.getItem('asha_patient_link') || 'null'); }
    catch { return null; }
  }
  return null;
}
export function caregiverPatients() {
  try {
    const list = JSON.parse(localStorage.getItem('asha_caregiver_patients') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
export function saveCaregiverPatient(patient) {
  const list = caregiverPatients().filter((entry) => entry.patientId !== patient.patientId);
  list.push(patient);
  localStorage.setItem('asha_caregiver_patients', JSON.stringify(list));
}
export function forgetCaregiverPatient(patientId) {
  localStorage.setItem('asha_caregiver_patients', JSON.stringify(
    caregiverPatients().filter((entry) => entry.patientId !== patientId),
  ));
}
export function speak(text, voice = {}, canHear = true) {
  if (!canHear || !('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = voice.rate || 0.9;
  utterance.pitch = voice.pitch || 1;
  const voices = speechSynthesis.getVoices();
  if (voice.style === 'male') {
    utterance.voice = voices.find((item) => /male|david|mark|daniel|alex/i.test(item.name)) || null;
  } else if (voice.style === 'female') {
    utterance.voice = voices.find((item) => /female|zira|samantha|aria|jenny/i.test(item.name)) || null;
  }
  speechSynthesis.speak(utterance);
  return true;
}
export function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
