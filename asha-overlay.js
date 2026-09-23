(() => {
  if (document.getElementById('asha-guide-root')) return;
  const script = document.currentScript;
  const context = script?.dataset.ashaContext || document.title || 'NeuroBridge Asha';
  const assetUrl = new URL('./assets/assets/images/asha-avatar.png', script.src).href;
  const appUrl = new URL('./asha.html', script.src).href;
  const relay = 'https://neurobridge-asha-maira-relay.vercel.app';
  const userId = `asha-demo-${Date.now()}`;

  const style = document.createElement('style');
  style.textContent = `
    #asha-guide-root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:14px/1.45 Inter,system-ui,sans-serif;color:#eef8ff}
    #asha-guide-root *{box-sizing:border-box}
    #asha-float{pointer-events:auto;position:fixed;left:calc(100vw - 92px);top:calc(100vh - 100px);width:70px;height:70px;border:3px solid #5ce2dc;border-radius:50%;padding:0;background:#153c5c;box-shadow:0 8px 30px #000a;touch-action:none;cursor:grab;overflow:hidden}
    #asha-float:active{cursor:grabbing}#asha-float img{width:100%;height:100%;object-fit:cover}
    #asha-float:focus-visible,#asha-guide-root button:focus-visible,#asha-guide-root input:focus-visible{outline:3px solid #fff;outline-offset:3px}
    #asha-panel{pointer-events:auto;position:fixed;right:16px;bottom:105px;width:min(380px,calc(100vw - 24px));max-height:min(570px,calc(100vh - 120px));display:flex;flex-direction:column;border:1px solid #5a7795;border-radius:18px;background:#102138;box-shadow:0 20px 60px #000b;overflow:hidden}
    #asha-panel[hidden]{display:none}#asha-panel header{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;background:#19334e;color:#f1ffff}#asha-panel header strong{font-size:17px}
    #asha-panel button{cursor:pointer}#asha-close{border:0;background:transparent;color:#fff;font-size:23px;padding:0 4px}
    #asha-log{padding:14px;overflow-y:auto;min-height:100px;max-height:260px;display:flex;flex-direction:column;gap:10px}
    .asha-msg{max-width:93%;padding:10px 12px;border-radius:13px;background:#29445d;white-space:pre-wrap;word-break:break-word}.asha-msg.me{align-self:flex-end;background:#16585e}
    #asha-options{display:flex;gap:7px;flex-wrap:wrap;padding:0 14px 12px}#asha-options button{border:1px solid #56849a;background:#193f52;color:#e8feff;border-radius:50px;padding:6px 10px}
    #asha-consent,#asha-voice-label{display:flex;align-items:flex-start;gap:9px;padding:8px 14px;color:#c6d6e5;font-size:12px}#asha-consent input,#asha-voice-label input{margin-top:2px;accent-color:#59dad5}
    #asha-form{display:flex;gap:7px;padding:10px 13px 14px}#asha-input{min-width:0;flex:1;border:1px solid #57758e;border-radius:10px;padding:10px;background:#0b192c;color:#fff}#asha-send{border:0;border-radius:10px;padding:10px 13px;background:#63d8d7;color:#06292a;font-weight:700}
    #asha-panel footer{padding:0 14px 11px;font-size:11px;color:#a7bbc9}#asha-panel footer a{color:#8fe0e2}
    html[data-theme=light]{--bg:#f4f8fc;--bg2:#eaf2f8;--glass:#fffffff2;--stroke:#bfd3df;--txt:#173348;--muted:#526d80;--surface:#fff;--surface-2:#e9f2f8;--line:#bdd3df;--text:#173348;--text-dim:#526d80}
    html[data-theme=light] #asha-panel{background:#fff;color:#173348;border-color:#afcbd9}html[data-theme=light] #asha-panel header{background:#dfedf4;color:#173348}html[data-theme=light] #asha-close{color:#173348}html[data-theme=light] .asha-msg{background:#e2eff5;color:#173348}html[data-theme=light] .asha-msg.me{background:#bce9e5}html[data-theme=light] #asha-input{background:#fff;color:#173348}html[data-theme=light] #asha-consent,html[data-theme=light] #asha-voice-label,html[data-theme=light] #asha-panel footer{color:#426176}
  `;
  document.head.append(style);

  const root = document.createElement('div');
  root.id = 'asha-guide-root';
  root.innerHTML = `
    <button id="asha-float" type="button" aria-label="Asha guide. Drag to move, tap to chat"><img alt="" src="${assetUrl}"></button>
    <section id="asha-panel" aria-label="Asha companion" hidden>
      <header><strong>Asha · here to guide you</strong><button id="asha-close" type="button" aria-label="Close Asha">×</button></header>
      <div id="asha-log" role="log" aria-live="polite"></div>
      <div id="asha-options"><button type="button" data-asha-tip="guide">Guide me</button><button type="button" data-asha-tip="privacy">Privacy</button><button type="button" id="asha-theme-button">☀ Light</button></div>
      <label id="asha-consent"><input id="asha-opt-in" type="checkbox"><span>Send only my typed message to Maira for a cloud reply. Do not enter identifying patient details.</span></label>
      <label id="asha-voice-label"><input id="asha-voice" type="checkbox"><span>Speak Asha's replies aloud</span></label>
      <form id="asha-form"><input id="asha-input" maxlength="350" placeholder="Ask Asha…" aria-label="Message Asha"><button id="asha-send" type="submit">Send</button></form>
      <footer>Suggestions are not medical advice. <a id="asha-open-app" href="${appUrl}">Open Asha app</a></footer>
    </section>`;
  document.body.append(root);
  const bubble = root.querySelector('#asha-float');
  const panel = root.querySelector('#asha-panel');
  const log = root.querySelector('#asha-log');
  const input = root.querySelector('#asha-input');
  const send = root.querySelector('#asha-send');
  const consent = root.querySelector('#asha-opt-in');
  const voice = root.querySelector('#asha-voice');
  const themeButton = root.querySelector('#asha-theme-button');
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.body.classList.toggle('light', theme === 'light');
    themeButton.textContent = theme === 'light' ? '☾ Dark' : '☀ Light';
  }
  setTheme(localStorage.getItem('asha_theme') === 'light' ? 'light' : 'dark');
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('asha_theme', next);
    setTheme(next);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => { button.textContent = next === 'light' ? '☾ Dark' : '☀ Light'; });
    const vitalButton = document.getElementById('themeToggle');
    if (vitalButton) vitalButton.textContent = next === 'light' ? '☾ Dark' : '☀ Light';
  });

  function addMessage(message, mine = false) {
    const item = document.createElement('div');
    item.className = `asha-msg${mine ? ' me' : ''}`;
    item.textContent = message;
    log.append(item);
    log.scrollTop = log.scrollHeight;
    if (!mine && voice.checked && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    }
  }
  addMessage(`I'm Asha. I can guide you around ${context}. Move my bubble anywhere to keep the screen clear.`);

  let drag = null;
  let moved = false;
  bubble.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, left: bubble.offsetLeft, top: bubble.offsetTop };
    moved = false;
    bubble.setPointerCapture(event.pointerId);
  });
  bubble.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
    bubble.style.left = `${Math.min(Math.max(8, drag.left + dx), innerWidth - 78)}px`;
    bubble.style.top = `${Math.min(Math.max(8, drag.top + dy), innerHeight - 78)}px`;
  });
  bubble.addEventListener('pointerup', () => { drag = null; });
  bubble.addEventListener('click', () => {
    if (moved) { moved = false; return; }
    panel.hidden = !panel.hidden;
    if (!panel.hidden) input.focus();
  });
  root.querySelector('#asha-close').addEventListener('click', () => { panel.hidden = true; });
  root.querySelectorAll('[data-asha-tip]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.ashaTip === 'privacy') {
      addMessage('Camera processing stays in the module. Asha sends typed chat text to Maira only after you opt in. Never rely on this demo for emergencies.');
    } else if (context.toLowerCase().includes('speech')) {
      addMessage('Use Speech practice to hear and try a phrase. Use Understand my words to review unclear text, then ask Maira for a tentative meaning. Always confirm it with the speaker.');
    } else {
      addMessage('Choose a module to explore. Tap its on-screen help and keep a real caregiver available for important decisions.');
    }
  }));
  root.querySelector('#asha-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    if (!consent.checked) { addMessage('Please check the text-only cloud consent box before sending a message.'); return; }
    input.value = '';
    addMessage(message, true);
    send.disabled = true;
    try {
      const prompt = [
        'You are Asha, an assistive companion. Reply in one or two short sentences.',
        'Do not diagnose, prescribe, claim a call or alert was sent, or claim a sensor observation you did not receive.',
        'If help may be urgent, advise using a real caregiver or local emergency service.',
        `Patient/caregiver message: In ${context}: ${message}`,
      ].join('\n');
      const response = await fetch(`${relay}/api/v1/maira/ask`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: userId, query: prompt }),
        signal: AbortSignal.timeout(25000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Service returned ${response.status}`);
      addMessage(String(body.detail?.response || 'I could not understand that response.'));
    } catch (error) {
      addMessage(`Maira is unavailable right now: ${error.message}. Please ask a real caregiver if help is important.`);
    } finally { send.disabled = false; }
  });
})();
