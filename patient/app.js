import { wireTheme, demoApi, credentialsFromLink, siteBase, speak } from '../asha-flow.js';

const $ = (id) => document.getElementById(id);
let credentials = credentialsFromLink('patient');
let profile = null;
let monitoring = false;
let latestReading = null;
let lastDiscomfortAt = 0;

wireTheme();
if (!credentials) $('missingLink').hidden = false;
else { $('patientApp').hidden = false; loadProfile(); }

$('openLink').addEventListener('click', () => {
  try {
    const url = new URL($('linkInput').value.trim());
    if (url.origin !== location.origin || !url.pathname.endsWith('/patient/') || !url.hash) throw new Error();
    const fragment = new URLSearchParams(url.hash.slice(1));
    const patientId = fragment.get('patientId');
    const token = fragment.get('token');
    if (!/^[A-F0-9]{16}$/.test(patientId || '') || !/^[A-Za-z0-9_-]{32,64}$/.test(token || '')) throw new Error();
    localStorage.setItem('asha_patient_link', JSON.stringify({ patientId, token }));
    location.reload();
  } catch { alert('Use the full patient link shared by your caregiver.'); }
});

function actionStatus(message, bad = false) {
  $('actionStatus').textContent = message;
  $('actionStatus').style.color = bad ? 'var(--danger)' : 'var(--muted)';
}
function say(message) {
  if (profile) speak(message, profile.voice, profile.assessment.canHear);
}
function explanation() {
  if (!profile) return '';
  const visual = profile.assessment.canSee ? 'Visual prompts are enabled.' : 'Visual prompts may not be accessible.';
  const audio = profile.assessment.canHear ? 'I can speak aloud.' : 'Audio guidance is off because hearing was marked unavailable.';
  return `I am here. Your caregiver selected ${profile.route.label}. ${profile.route.reason} ${visual} ${audio}`;
}
async function loadProfile() {
  if (!credentials) return;
  try {
    profile = await demoApi({ view: 'profile', patientId: credentials.patientId, token: credentials.token });
    if (profile.role !== 'patient') throw new Error('This is not a patient access link.');
    $('patientId').textContent = profile.patientId;
    $('patientIntro').textContent = `Your caregiver set up ${profile.label}. Asha will adapt to the reported capabilities.`;
    $('modeName').textContent = profile.route.label;
    $('modeReason').textContent = profile.route.reason;
    $('modeLink').href = new URL(profile.route.path, siteBase).href;
    $('speakIntro').hidden = !profile.assessment.canHear;
    $('connectionText').textContent = 'Connected to caregiver channel';
    $('connectionDot').classList.add('online');
  } catch (error) {
    $('connectionText').textContent = error.message;
    $('connectionDot').classList.remove('online');
    actionStatus('The private link may be expired or unavailable. Ask your caregiver to create another.', true);
  }
}
$('speakIntro').addEventListener('click', () => say(explanation()));
$('refreshSetup').addEventListener('click', async () => { await loadProfile(); say(explanation()); });

async function sendEvent(kind, details = {}) {
  if (!profile) throw new Error('Patient link is not connected');
  return demoApi({ method: 'POST', token: credentials.token,
    body: { action: 'event', patientId: profile.patientId, kind, details } });
}
async function heartbeat() {
  if (!profile) return;
  try {
    await demoApi({ method: 'POST', token: credentials.token,
      body: { action: 'heartbeat', patientId: profile.patientId,
        mode: monitoring ? 'vitalsense' : profile.route.mode,
        reading: latestReading || { quality: 'none' } } });
    $('connectionText').textContent = 'Connected · status shared with caregiver';
    $('connectionDot').classList.add('online');
  } catch {
    $('connectionText').textContent = 'Connection interrupted · retrying';
    $('connectionDot').classList.remove('online');
  }
}

$('startMonitor').addEventListener('click', async () => {
  if (!profile) { actionStatus('Wait for the caregiver setup to connect.', true); return; }
  if (monitoring) return;
  monitoring = true;
  $('monitorFrame').hidden = false;
  $('monitorFrame').src = new URL('vitalsense/', siteBase).href;
  $('startMonitor').disabled = true;
  $('startMonitor').textContent = 'VitalSense open';
  $('monitorStatus').textContent = 'Tap Enable camera inside the monitor.';
  say('VitalSense is open. Please enable the camera inside the monitor and stay still during calibration.');
  await heartbeat();
});

window.addEventListener('message', async (event) => {
  if (event.origin !== location.origin || event.source !== $('monitorFrame').contentWindow || !profile) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'vitalsense:reading') {
    latestReading = {
      bpm: data.bpm,
      confidence: data.confidence,
      quality: data.quality,
    };
    $('monitorStatus').textContent = `Camera signal ${data.quality} · ${data.bpm} BPM estimate · confidence ${data.confidence}%.`;
    await heartbeat();
  }
  if (data.type === 'vitalsense:possible-discomfort') {
    if (Date.now() - lastDiscomfortAt < 60000) return;
    lastDiscomfortAt = Date.now();
    const details = { bpm: data.bpm, baseline: data.baseline, confidence: data.confidence };
    $('discomfortPrompt').hidden = false;
    try {
      await sendEvent('possible_discomfort', details);
      $('discomfortText').textContent = 'A possible signal change was sent to the caregiver dashboard. This is not a diagnosis or phone call. Would you like more help?';
      say('I noticed a possible change in the camera signal. I alerted your caregiver dashboard. Would you like more help?');
      actionStatus('Possible-discomfort alert reached the caregiver channel.');
    } catch {
      $('discomfortText').textContent = 'I noticed a possible signal change, but could not reach the caregiver dashboard. Please seek help directly.';
      say('I noticed a possible change, but I could not reach the caregiver dashboard. Please seek help directly.');
      actionStatus('Alert delivery failed. Seek direct help.', true);
    }
  }
});

$('sendTestAlert').addEventListener('click', async () => {
  try {
    await sendEvent('test_alert');
    actionStatus('Test alert sent. Check the caregiver device within a few seconds.');
    say('This was a test alert. The caregiver dashboard should show it soon.');
  } catch (error) { actionStatus(`Test alert failed: ${error.message}`, true); }
});
async function requestHelp() {
  try {
    await sendEvent('help_request');
    actionStatus('Caregiver help request sent to the live dashboard. No phone call was placed.');
    say('I sent a help request to the caregiver dashboard. No phone call was placed.');
  } catch (error) { actionStatus(`Help request failed: ${error.message}`, true); }
}
$('sendHelp').addEventListener('click', requestHelp);
$('requestHelp').addEventListener('click', requestHelp);
$('dismissPrompt').addEventListener('click', () => { $('discomfortPrompt').hidden = true; });
setInterval(() => { loadProfile(); heartbeat(); }, 20000);
