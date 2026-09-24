import { caregiverPatients, linkFor, siteBase, wireTheme } from '../asha-flow.js';

wireTheme();
const profiles = document.getElementById('pairProfiles');

async function copy(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const previous = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = previous; }, 1800);
  } catch { window.prompt('Copy this private value:', value); }
}
function button(label, value) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = 'btn'; element.textContent = label;
  element.addEventListener('click', () => copy(value, element));
  return element;
}
for (const entry of caregiverPatients()) {
  if (!/^[A-F0-9]{16}$/.test(entry.patientId) || !entry.patientToken) continue;
  if (profiles.querySelector('.empty')) profiles.replaceChildren();
  const card = document.createElement('article'); card.className = 'patient-card';
  const title = document.createElement('h3'); title.textContent = entry.label || 'Anonymous patient'; card.append(title);
  const id = document.createElement('p'); id.className = 'code'; id.textContent = `Patient ID: ${entry.patientId}`; card.append(id);
  const link = linkFor('patient', entry.patientId, entry.patientToken);
  const fullLink = document.createElement('div'); fullLink.className = 'link-box'; fullLink.textContent = link; card.append(fullLink);
  const actions = document.createElement('div'); actions.className = 'actions';
  actions.append(button('Copy patient link', link), button('Copy ID + private code', `${entry.patientId}:${entry.patientToken}`));
  if (navigator.share) {
    const share = document.createElement('button'); share.type = 'button'; share.className = 'btn'; share.textContent = 'Share patient link';
    share.addEventListener('click', () => navigator.share({ title: 'Asha patient link', url: link }).catch(() => {}));
    actions.append(share);
  }
  card.append(actions); profiles.append(card);
}

document.getElementById('connectPatient').addEventListener('click', () => {
  const value = document.getElementById('pairInput').value.trim();
  let patientId, token;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.origin !== location.origin || url.pathname !== new URL('patient/', siteBase).pathname) throw new Error();
      const fragment = new URLSearchParams(url.hash.slice(1));
      patientId = fragment.get('patientId'); token = fragment.get('token');
    } else {
      [patientId, token] = value.split(':');
    }
    if (!/^[A-F0-9]{16}$/.test(patientId || '') || !/^[A-Za-z0-9_-]{32,64}$/.test(token || '')) throw new Error();
    location.assign(linkFor('patient', patientId, token));
  } catch { document.getElementById('pairStatus').textContent = 'Paste the complete patient link or the patient ID and its private code. The ID alone is not enough.'; }
});
