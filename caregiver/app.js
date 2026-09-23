import {
  wireTheme, demoApi, linkFor, credentialsFromLink, caregiverPatients,
  saveCaregiverPatient, forgetCaregiverPatient, speak, formatWhen,
} from '../asha-flow.js';

const $ = (id) => document.getElementById(id);
let editing = null;
let busy = false;
let firstRefresh = true;
const seen = new Set();
let newLinks = null;
let audioContext = null;

wireTheme();
const incoming = credentialsFromLink('caregiver');
if (incoming) saveCaregiverPatient({ patientId: incoming.patientId, caregiverToken: incoming.token, label: 'Linked patient' });

function assessmentFromForm() {
  const fields = ['leftHand', 'rightHand', 'wrist', 'fingers', 'eyes', 'lips', 'head', 'speech'];
  return Object.fromEntries([
    ...fields.map((key) => [key, $(key).value]),
    ['canSee', $('canSee').checked], ['canHear', $('canHear').checked],
  ]);
}
function voiceFromForm() {
  return { style: $('voiceStyle').value, rate: Number($('voiceRate').value), pitch: Number($('voicePitch').value) };
}
function fillForm(profile) {
  $('label').value = profile.label;
  for (const key of ['leftHand', 'rightHand', 'wrist', 'fingers', 'eyes', 'lips', 'head', 'speech']) {
    $(key).value = profile.assessment[key] || 'none';
  }
  $('canSee').checked = profile.assessment.canSee;
  $('canHear').checked = profile.assessment.canHear;
  $('voiceStyle').value = profile.voice.style;
  $('voiceRate').value = profile.voice.rate;
  $('voicePitch').value = profile.voice.pitch;
  updateVoiceValues();
}
function updateVoiceValues() {
  $('voiceRateValue').textContent = Number($('voiceRate').value).toFixed(2);
  $('voicePitchValue').textContent = Number($('voicePitch').value).toFixed(2);
}
function status(text, bad = false) {
  $('formStatus').textContent = text;
  $('formStatus').style.color = bad ? 'var(--danger)' : 'var(--muted)';
}
function linkText(url, target) { $(target).textContent = url; }
async function copy(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const previous = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = previous; }, 1800);
  } catch { window.prompt('Copy this link:', value); }
}

$('voiceRate').addEventListener('input', updateVoiceValues);
$('voicePitch').addEventListener('input', updateVoiceValues);
$('voicePreview').addEventListener('click', () => speak('Hello, I am Asha. I will speak at this pace.', voiceFromForm()));
$('assessmentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('saveProfile');
  button.disabled = true;
  status('Saving secure demo setup…');
  try {
    const label = $('label').value.trim() || 'Patient demo';
    if (!/^[\w -]{1,40}$/.test(label)) throw new Error('Use an anonymous label with letters or numbers only.');
    const assessment = assessmentFromForm();
    const voice = voiceFromForm();
    if (editing) {
      const profile = await demoApi({ method: 'POST', token: editing.caregiverToken,
        body: { action: 'update', patientId: editing.patientId, label, assessment, voice } });
      saveCaregiverPatient({ ...editing, label: profile.label });
      status(`${profile.patientId}: setup saved. Asha recommends ${profile.route.label}.`);
    } else {
      const profile = await demoApi({ method: 'POST', body: { action: 'create', label, assessment, voice } });
      const entry = { patientId: profile.patientId, caregiverToken: profile.caregiverToken,
        patientToken: profile.patientToken, label: profile.label };
      saveCaregiverPatient(entry);
      editing = entry;
      $('saveProfile').textContent = 'Save assessment changes';
      newLinks = {
        patient: linkFor('patient', profile.patientId, profile.patientToken),
        caregiver: linkFor('caregiver', profile.patientId, profile.caregiverToken),
      };
      $('newPatientId').textContent = profile.patientId;
      linkText(newLinks.patient, 'patientLinkText');
      linkText(newLinks.caregiver, 'caregiverLinkText');
      $('sharePanel').hidden = false;
      status(`Setup created. Asha recommends ${profile.route.label}. Open the patient link on device two.`);
    }
    await refresh();
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
$('copyPatientLink').addEventListener('click', () => newLinks && copy(newLinks.patient, $('copyPatientLink')));
$('copyCaregiverLink').addEventListener('click', () => newLinks && copy(newLinks.caregiver, $('copyCaregiverLink')));
$('sharePatientLink').addEventListener('click', async () => {
  if (!newLinks) return;
  if (navigator.share) {
    try { await navigator.share({ title: 'Asha patient link', url: newLinks.patient }); } catch { /* dismissed */ }
  } else copy(newLinks.patient, $('sharePatientLink'));
});

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}
function makeButton(label, action, style = '') {
  const button = text('button', label, `btn ${style}`);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}
function online(statusValue) {
  return statusValue && Date.now() - Date.parse(statusValue.at) < 45000;
}
async function refresh() {
  if (busy) return;
  busy = true;
  const entries = caregiverPatients();
  const patients = $('patients');
  const alerts = $('alerts');
  if (!entries.length) {
    patients.innerHTML = '<div class="empty">No patient linked yet. Complete the assessment above.</div>';
    alerts.innerHTML = '<div class="empty">No events yet.</div>';
    $('pollState').textContent = 'Waiting for a patient profile.';
    busy = false;
    return;
  }
  try {
    const records = await Promise.all(entries.map(async (entry) => {
      try {
        const [profile, current, history] = await Promise.all([
          demoApi({ view: 'profile', patientId: entry.patientId, token: entry.caregiverToken }),
          demoApi({ view: 'status', patientId: entry.patientId, token: entry.caregiverToken }),
          demoApi({ view: 'events', patientId: entry.patientId, token: entry.caregiverToken }),
        ]);
        return { entry, profile, status: current.status, events: history.events };
      } catch (error) { return { entry, error: error.message, events: [] }; }
    }));
    patients.replaceChildren();
    for (const record of records) {
      const card = document.createElement('article');
      card.className = 'patient-card';
      const heading = document.createElement('div'); heading.className = 'row';
      heading.append(text('h3', `${record.profile?.label || record.entry.label} · ${record.entry.patientId}`));
      const live = text('span', record.error ? 'Unavailable' : online(record.status) ? 'Live' : 'Waiting / offline');
      heading.append(live); card.append(heading);
      if (record.error) card.append(text('p', record.error, 'small muted'));
      else {
        card.append(text('p', `Asha recommends ${record.profile.route.label}. ${record.profile.route.reason}`));
        card.append(text('p', record.status
          ? `Last signal: ${record.status.signal} · ${record.status.bpm ?? '—'} BPM · confidence ${record.status.confidence ?? '—'}% · ${formatWhen(record.status.at)}`
          : 'No live signal yet. Open the patient link and start monitoring.', 'small muted'));
      }
      const actions = document.createElement('div'); actions.className = 'actions';
      actions.append(makeButton('Edit assessment', () => {
        if (!record.profile) return;
        editing = record.entry;
        fillForm(record.profile);
        $('saveProfile').textContent = 'Save assessment changes';
        $('assessmentForm').scrollIntoView({ behavior: 'smooth' });
      }));
      if (record.entry.patientToken) {
        const copyPatient = makeButton('Copy patient link', () =>
          copy(linkFor('patient', record.entry.patientId, record.entry.patientToken), copyPatient));
        actions.append(copyPatient);
      }
      actions.append(makeButton('Remove demo profile', async () => {
        if (!confirm(`Permanently remove anonymous demo ${record.entry.patientId} and its events?`)) return;
        try {
          await demoApi({ method: 'POST', token: record.entry.caregiverToken,
            body: { action: 'delete', patientId: record.entry.patientId, confirm: 'DELETE' } });
          forgetCaregiverPatient(record.entry.patientId);
          if (editing?.patientId === record.entry.patientId) editing = null;
          setTimeout(refresh, 0);
        } catch (error) { alert(error.message); }
      }, 'danger'));
      card.append(actions); patients.append(card);
    }
    const allEvents = records.flatMap((record) => (record.events || []).map((item) => ({ ...item, label: record.profile?.label || record.entry.label })));
    allEvents.sort((a, b) => b.at.localeCompare(a.at));
    alerts.replaceChildren();
    if (!allEvents.length) alerts.append(text('div', 'No events yet.', 'empty'));
    for (const item of allEvents.slice(0, 50)) {
      const box = document.createElement('article'); box.className = `alert${item.simulated ? ' test' : ''}`;
      box.append(text('strong', `${item.label} · ${item.summary}`));
      if (item.bpm != null) box.append(text('div', `Camera signal ${item.bpm} BPM vs baseline ${item.baseline ?? '—'} · confidence ${item.confidence ?? '—'}%. This is not a diagnosis.`, 'small'));
      box.append(text('time', `${formatWhen(item.at)} · ID ${item.patientId}`));
      alerts.append(box);
      if (!firstRefresh && !seen.has(item.id)) announce(item);
      seen.add(item.id);
    }
    firstRefresh = false;
    $('pollState').textContent = `Last checked ${new Date().toLocaleTimeString()} · ${records.length} linked ID${records.length === 1 ? '' : 's'}`;
  } finally { busy = false; }
}

function announce(item) {
  document.title = '● New Asha alert · Caregiver';
  if (Notification.permission === 'granted') {
    new Notification(`Asha · ${item.label}`, { body: item.summary, tag: item.id });
  }
  if (audioContext) {
    const tone = audioContext.createOscillator();
    const volume = audioContext.createGain();
    tone.frequency.value = 660; volume.gain.value = 0.08;
    tone.connect(volume).connect(audioContext.destination);
    tone.start(); tone.stop(audioContext.currentTime + 0.18);
  }
}
$('notificationsButton').addEventListener('click', async () => {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    $('notificationsButton').textContent = permission === 'granted' ? 'Browser notifications enabled' : 'Notifications unavailable';
  } else $('notificationsButton').textContent = 'Browser notifications unsupported';
  try { audioContext ||= new AudioContext(); await audioContext.resume(); } catch { /* sound optional */ }
});
$('refreshButton').addEventListener('click', refresh);
refresh();
setInterval(refresh, 8000);
