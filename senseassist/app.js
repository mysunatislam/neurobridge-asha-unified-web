const $ = (id) => document.getElementById(id);
const relay = 'https://neurobridge-asha-maira-relay.vercel.app';
const userId = `asha-demo-${Date.now()}`;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;
let lastSuggestion = '';

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.88;
  utterance.lang = 'en-US';
  speechSynthesis.speak(utterance);
}

function setTab(tab) {
  const practice = tab === 'practice';
  $('practicePanel').hidden = !practice;
  $('understandPanel').hidden = practice;
  $('practiceTab').classList.toggle('active', practice);
  $('understandTab').classList.toggle('active', !practice);
  $('practiceTab').setAttribute('aria-selected', String(practice));
  $('understandTab').setAttribute('aria-selected', String(!practice));
  if (listening) listening.stop();
}

function normalizedWords(text) {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function practiceFeedback(heard) {
  const target = normalizedWords($('targetPhrase').value);
  const spoken = normalizedWords(heard);
  if (!target.length) return 'Choose a phrase first.';
  const matches = target.filter((word) => spoken.includes(word)).length;
  if (matches === target.length && spoken.length === target.length) {
    return 'The browser heard the whole phrase. Nice work! You can try again whenever you like.';
  }
  return `The browser heard ${matches} of ${target.length} target words. You can listen and try again. This reflects speech-to-text output, not your speech ability.`;
}

function capture(mode) {
  const button = $(mode === 'practice' ? 'practiceMic' : 'understandMic');
  const status = $(mode === 'practice' ? 'practiceStatus' : 'understandStatus');
  if (listening) { listening.stop(); return; }
  if (!SpeechRecognition) {
    status.textContent = 'Speech recognition is unavailable in this browser. Type the heard words instead.';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const heard = event.results[0]?.[0]?.transcript?.trim() || '';
    if (mode === 'practice') {
      $('practiceHeard').textContent = heard || 'No words recognized.';
      $('practiceFeedback').textContent = heard ? practiceFeedback(heard) : 'No words recognized. Try again or use the other tool to type what was heard.';
    } else {
      $('heardText').value = heard;
      $('interpretResult').hidden = true;
      status.textContent = heard ? 'Review and edit these words before asking Maira.' : 'No words recognized. Please type what you heard.';
    }
  };
  recognition.onerror = (event) => {
    status.textContent = event.error === 'not-allowed'
      ? 'Microphone permission was denied. You can still type the words.'
      : `Speech recognition stopped (${event.error}). You can type the words instead.`;
  };
  recognition.onend = () => {
    listening = null;
    button.textContent = mode === 'practice' ? '🎙 Start speaking' : '🎙 Capture words';
    if (status.textContent === 'Listening…') status.textContent = 'Capture finished.';
  };
  try {
    recognition.start();
    listening = recognition;
    button.textContent = '■ Stop listening';
    status.textContent = 'Listening…';
  } catch {
    status.textContent = 'Could not start the microphone. You can type the words instead.';
  }
}

async function interpret() {
  const text = $('heardText').value.trim();
  const context = $('contextText').value.trim();
  const status = $('understandStatus');
  const button = $('interpret');
  if (!text) { status.textContent = 'Type or capture the words first.'; return; }
  if (!$('cloudConsent').checked) { status.textContent = 'Please confirm text-only cloud consent first.'; return; }
  button.disabled = true;
  status.textContent = 'Asking Maira for a possible meaning…';
  $('interpretResult').hidden = true;
  try {
    const response = await fetch(`${relay}/api/v1/maira/interpret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, heard_text: text, context }),
      signal: AbortSignal.timeout(25000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Service returned ${response.status}`);
    lastSuggestion = String(body.candidate || '').trim();
    if (!lastSuggestion) throw new Error('Maira returned no suggestion');
    $('candidate').textContent = lastSuggestion;
    $('interpretResult').hidden = false;
    status.textContent = 'A possible meaning is ready. Please confirm it with the speaker.';
  } catch (error) {
    status.textContent = `Could not interpret the words: ${error.message}. The original text is still here.`;
  } finally {
    button.disabled = false;
  }
}

$('practiceTab').addEventListener('click', () => setTab('practice'));
$('understandTab').addEventListener('click', () => setTab('understand'));
$('hearPhrase').addEventListener('click', () => speak($('targetPhrase').value.trim()));
$('practiceMic').addEventListener('click', () => capture('practice'));
$('understandMic').addEventListener('click', () => capture('understand'));
$('interpret').addEventListener('click', interpret);
$('speakCandidate').addEventListener('click', () => speak(lastSuggestion));
document.querySelectorAll('[data-phrase]').forEach((button) => button.addEventListener('click', () => {
  $('targetPhrase').value = button.dataset.phrase;
  $('practiceHeard').textContent = 'Your words will appear here.';
  $('practiceFeedback').textContent = 'Listen, then try this phrase at your own pace.';
}));
