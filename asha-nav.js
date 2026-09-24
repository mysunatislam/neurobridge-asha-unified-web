(() => {
  if (document.getElementById('asha-pages-button')) return;
  const base = new URL('./', document.currentScript.src);
  const style = document.createElement('style');
  style.textContent = `
    #asha-pages-button{position:fixed;left:12px;bottom:12px;z-index:2147482500;min-width:56px;min-height:48px;padding:9px 14px;border:1px solid #6ce0e0;border-radius:14px;background:#102e46;color:#f4ffff;font:700 14px system-ui;box-shadow:0 8px 24px #0008;cursor:pointer}
    #asha-pages-menu{position:fixed;left:12px;bottom:68px;z-index:2147482500;width:min(320px,calc(100vw - 24px));max-height:min(520px,calc(100vh - 95px));overflow:auto;padding:10px;border:1px solid #6ce0e0;border-radius:15px;background:#102035;color:#f4ffff;box-shadow:0 15px 40px #0009;display:grid;grid-template-columns:1fr 1fr;gap:7px}
    #asha-pages-menu[hidden]{display:none}#asha-pages-menu a{display:flex;align-items:center;min-height:44px;padding:9px;border-radius:9px;background:#1b3954;color:#f4ffff;text-decoration:none;font:650 13px system-ui}#asha-pages-menu a:hover,#asha-pages-menu a:focus-visible{background:#2c6273;outline:2px solid #8df5f2}
    html[data-theme=light] #asha-pages-button,html[data-theme=light] #asha-pages-menu{background:#fff;color:#18344a;border-color:#00818b;box-shadow:0 8px 22px #5677a044}html[data-theme=light] #asha-pages-menu a{background:#e8f3f8;color:#18344a}
  `;
  document.head.append(style);
  const menu = document.createElement('nav'); menu.id = 'asha-pages-menu'; menu.hidden = true; menu.setAttribute('aria-label', 'Go to another page');
  const pages = [
    ['Asha home', ''], ['Assessment', 'caregiver/'], ['Pair devices', 'pair/'],
    ['Patient', 'patient/'], ['Modules', 'modules/'], ['NeuroFace', 'neuroface/'],
    ['FingerSpeak', 'neuroface/fingerspeak.html'], ['VitalSense', 'vitalsense/'],
    ['SenseAssist', 'senseassist/'], ['App preview', 'asha.html'],
  ];
  for (const [label, path] of pages) {
    const link = document.createElement('a'); link.href = new URL(path, base).href; link.textContent = label; menu.append(link);
  }
  const trigger = document.createElement('button'); trigger.id = 'asha-pages-button'; trigger.type = 'button'; trigger.textContent = '☰ Pages'; trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', menu.id);
  trigger.addEventListener('click', () => { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } });
  document.body.append(menu, trigger);
})();
