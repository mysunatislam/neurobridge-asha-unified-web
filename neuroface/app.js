/* ============================================================================
   NeuroFace Sense — app.js
   Browser-only facial movement analysis: MediaPipe Face Mesh + landmark heuristics
   Research/demo prototype. NOT a medical device. No backend, no uploads.
   ============================================================================ */
(function () {
"use strict";

var $ = function (id) { return document.getElementById(id); };
var video = $("video"), overlay = $("overlay"), octx = overlay.getContext("2d");
var earChart = $("earChart"), marChart = $("marChart"), motionChart = $("motionChart");
var eyeSignal = new window.NF_eyeSignal.Detector();
var lipWatch = new window.NF_lipWatch.Watch(60);
var activity = new window.NF_activity.Tracker();

/* ---------------- state ---------------- */
var S = {
  running: false, demo: false, faceMesh: null, meshReady: false,
  lastLm: null, prevLm: null, facePresent: false, conf: 0,
  fps: 0, lastT: performance.now(), emaFps: 30,
  lastResultAt: 0, procMs: 0,
  t: 0, frame: 0,
  earL: 0.25, earR: 0.25, mar: 0.2,
  blink: { closed: false, t0: 0, minEar: 1, events: [], times: [], lastType: "—", lastDur: 0, trkPeak: 0, trkPeakT: 0 },
  prevEarAvg: 0.3, prevSlope: 0, prevFrameT: 0, lastCountT: 0,
  earHist: [], blinkTotal: 0, lmCount: 0, eyeTh: { close: 0.15, open: 0.21 }, eyeRef: 0.26,
  gaze: { x: 0, y: 0, label: "—", holdR: 0 },
  smile: { intensity: 0, sym: 100, l: 0, r: 0, hold: 0 },
  aus: { AU1: 0, AU4: 0, AU6: 0, AU12: 0, AU20: 0, AU25: 0 },
  auInvalid: false,
  lip: { gesture: "—", pucker: 0, invol: "none", dev: 0, devHold: 0, devDir: "—", devLatch: false, devKind: "lateral" },
  affect: { sad: 0, sadHold: 0, sadLatch: false, pain: 0, painHold: 0, painLatch: false },
  test: null, prevT: 0,
  head: { yaw: 0, pitch: 0, roll: 0, pose: "—", nod: "—", hist: [] },
  motion: { disp: 0, accel: 0, state: "—", tremor: "—", hist: [], prevDisp: 0 },
  flow: { eye: 0, lip: 0, cheek: 0 },
  cnnActivity: 0, temporal: { label: "warming…", probs: [], conf: 0 },
  scores: { eye: 0, lip: 0, smile: 0, head: 0, motor: 0 },
  twin: null,
  cal: { active: false, step: 0, frames: [], collecting: false, data: null },
  log: [], cmdCooldowns: {}, intentSeq: [], waterArmed: true, openRun: 0,
  headTurns: { left: [], right: [] }, headArmed: null,
  lastNod: false, lastNodT: -10, okayFiredNod: -10,
  mouthW0hist: [], smileThr: 0.4, devThr: 0.035,
  smileCheck: null, devCheck: null, eyeCheck: null,
  sent: 0, results: 0, errors: 0, consecFails: 0, lastError: "—", testBlinkUntil: 0,
  lastVideoT: -1, lastAdvanceT: 0, stalled: false,
  prevPts: null, identFrames: 0, smooth: null, headBase: null,
  sessionStart: Date.now(),
};
var TWIN_KEY = "neuroface_twin_v1";
try { var raw = localStorage.getItem(TWIN_KEY); if (raw) S.twin = JSON.parse(raw); } catch (e) {}

/* ---------------- small charts ---------------- */
function Chart(cv, color, min, max) {
  this.cv = cv; this.c = cv.getContext("2d"); this.d = []; this.n = 90;
  this.color = color; this.min = min; this.max = max;
}
Chart.prototype.push = function (v) {
  this.d.push(v); if (this.d.length > this.n) this.d.shift();
};
Chart.prototype.draw = function () {
  var c = this.c, W = this.cv.width, H = this.cv.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = "rgba(120,180,255,.15)"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  if (this.d.length < 2) return;
  c.strokeStyle = this.color; c.lineWidth = 2; c.beginPath();
  for (var i = 0; i < this.d.length; i++) {
    var v = Math.max(this.min, Math.min(this.max, this.d[i]));
    var y = H - ((v - this.min) / (this.max - this.min)) * (H - 8) - 4;
    var x = (i / (this.n - 1)) * W;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
};
var chEar = new Chart(earChart, "#38e1ff", 0, 0.45);
var chMar = new Chart(marChart, "#ff7ad9", 0, 0.8);
var chMot = new Chart(motionChart, "#3dff9e", 0, 0.05);

/* ---------------- AU grid ---------------- */
var AU_DEFS = [
  ["AU1", "Inner brow raise"], ["AU4", "Brow lowering"], ["AU6", "Cheek raise"],
  ["AU12", "Smile (zygomatic)"], ["AU20", "Lip stretch"], ["AU25", "Lip opening"],
];
var auGrid = $("auGrid");
auGrid.innerHTML = AU_DEFS.map(function (a) {
  return '<div class="au"><label>' + a[0] + " · " + a[1] + ' <b id="au_' + a[0] + '">—</b></label><div class="track"><i id="aub_' + a[0] + '"></i></div></div>';
}).join("");

/* ---------------- log / alerts ---------------- */
function fmtT() { var d = new Date(); return d.toLocaleTimeString(); }
function addLog(msg, kind) {
  var el = document.createElement("div");
  el.className = "log-item" + (kind === "info" ? " info" : "");
  el.textContent = fmtT() + "  " + msg;
  var list = $("logList");
  var empty = list.querySelector(".log-empty"); if (empty) empty.remove();
  list.prepend(el);
  while (list.children.length > 60) list.lastChild.remove();
  S.log.unshift({ t: new Date().toISOString(), msg: msg });
  if (S.log.length > 200) S.log.pop();
}
var lastAlertsKey = null;
function setAlerts(items) {
  var key = items.slice(0, 4).join("\n");
  if (key === lastAlertsKey) return;
  lastAlertsKey = key;
  var box = $("alertStrip"); box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = '<div class="alert ok">✓ No abnormal activity — facial motion within baseline.</div>';
    return;
  }
  items.slice(0, 4).forEach(function (m) {
    var d = document.createElement("div"); d.className = "alert"; d.textContent = "⚠ " + m;
    box.appendChild(d);
  });
}

/* Untrained TF models were consuming CPU/GPU time without valid predictions. */
function initModelStatus() {
  S.temporal = { label: "excluded (untrained)", probs: [], conf: 0 };
  $("modelStatus").innerHTML = typeof FaceMesh === "undefined"
    ? '<span class="dot bad"></span> Face Mesh unavailable — check connection'
    : '<span class="dot ok"></span> Face Mesh ready · untrained models excluded';
  $("tfBackend").textContent = "untrained CNN/LSTM excluded";
}

/* ---------------- FaceMesh ---------------- */
function setCamStatus(txt, cls) {
  $("camStatus").innerHTML = '<span class="dot ' + (cls || "idle") + '"></span> camera: ' + txt;
}
async function initMesh() {
  if (typeof FaceMesh === "undefined") {
    S.lastError = "FaceMesh library missing (CDN blocked/offline?)";
    addLog("MediaPipe script blocked (offline?). Use Demo Mode or check connection.", "info");
    return false;
  }
  try {
    var fm = new FaceMesh({ locateFile: function (f) { return "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + f; } });
    fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    fm.onResults(onMesh);
    S.faceMesh = fm; S.meshReady = true;
    return true;
  } catch (e) {
    S.lastError = "FaceMesh init failed: " + (e && e.message || e);
    S.errors++;
    addLog("Face engine failed to start: " + S.lastError, "info");
    return false;
  }
}
async function listCameras() {
  try {
    var devs = await navigator.mediaDevices.enumerateDevices();
    var sel = $("selCamera"); sel.innerHTML = '<option value="">default camera</option>';
    devs.filter(function (d) { return d.kind === "videoinput"; }).forEach(function (d, i) {
      var o = document.createElement("option");
      o.value = d.deviceId; o.textContent = d.label || ("camera " + (i + 1));
      sel.appendChild(o);
    });
  } catch (e) {}
}
async function startCamera() {
  if (S.running) return;
  var ok = S.meshReady || await initMesh();
  if (!ok) return;
  try {
    var devId = $("selCamera").value || undefined;
    // 640x480: the mesh runs ~2-3x faster than at 720p, so quick blinks
    // are actually sampled instead of falling between frames.
    var videoConstraints = devId ? { deviceId: { exact: devId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" };
    var stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    video.srcObject = stream;
    await video.play();
    S.running = true; S.demo = false;
    S.frame = 0; S.earHist = []; S.blinkTotal = 0; S.blink.closed = false; eyeSignal.reset(); lipWatch.reset(); activity.reset();
    $("auStatus").textContent = "Learning neutral activity baseline — relax your face for about 2 seconds.";
    S.waterArmed = true; S.openRun = 0; S.intentSeq = [];
    S.blink.trkPeak = 0; S.prevEarAvg = 0.3; S.prevSlope = 0; S.prevFrameT = 0; S.lastCountT = 0;
    S.sent = 0; S.results = 0; S.errors = 0; S.consecFails = 0; S.lastError = "—";
    S.lastResultAt = 0; S.procMs = 0; S.emaFps = 30; S.fps = 0; lastVisualAt = 0;
    S.stalled = false; S.lastVideoT = -1; S.prevPts = null; S.identFrames = 0; S.smooth = null; S.headBase = null;
    $("btnCamera").textContent = "⏸ Stop";
    setCamStatus("live", "ok");
    sizeCanvas();
    requestAnimationFrame(pump);
    addLog("Camera live — face tracking started.", "info");
    setTimeout(function () {
      if (S.running && !S.demo && S.frame === 0) {
        setCamStatus("no face data", "warn");
        addLog("Camera runs but no face data arrived — check lighting, face distance, HTTPS, and that the MediaPipe CDN loaded. Try Demo Mode to verify the dashboard.", "info");
      }
    }, 6000);
  } catch (e) {
    setCamStatus("denied", "bad");
    addLog("Camera denied: " + e.name + ". Try Demo Mode.", "info");
  }
}
function stopCamera() {
  S.running = false;
  try { (video.srcObject || {}).getTracks && video.srcObject.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  video.srcObject = null;
  $("btnCamera").textContent = "▶ Start Camera";
  setCamStatus("off", "idle");
}
function sizeCanvas() {
  var cw = overlay.clientWidth || 640, ch = overlay.clientHeight || 360;
  overlay.width = cw; overlay.height = ch;
}

/* Demo mode: synthetic-but-honest animation so judges see the dashboard alive */
var demoT = 0;
function startDemo() {
  stopCamera();
  S.demo = true; S.running = true;
  S.frame = 0; S.earHist = new Array(45).fill(0.25); S.blinkTotal = 0; eyeSignal.reset(); lipWatch.reset(); activity.reset();
  S.lastDemoAt = 0; S.procMs = 0;
  $("auStatus").textContent = "Synthetic demo signals — start the camera for your own movement indicators.";
  $("btnCamera").textContent = "▶ Start Camera";
  setCamStatus("demo synthetic", "warn");
  sizeCanvas();
  addLog("Demo Mode: synthetic facial signal (no camera).", "info");
  requestAnimationFrame(pump);
}

/* main pump: send frames to FaceMesh, or synthesize */
var sending = false;
async function pump(now) {
  if (!S.running) return;
  if (S.demo) {
    if (!S.lastDemoAt || (now || performance.now()) - S.lastDemoAt >= 32) {
      S.lastDemoAt = now || performance.now();
      demoFrame();
    }
    requestAnimationFrame(pump); return;
  }
  // Frozen-camera check: the video clock must advance, or every frame
  // fed to the mesh is identical (landmarks frozen, blinks impossible).
  var advanced = false;
  if (video.readyState >= 2) {
    if (video.currentTime !== S.lastVideoT) {
      advanced = true;
      S.lastVideoT = video.currentTime;
      S.lastAdvanceT = (now || performance.now());
      if (S.stalled) { S.stalled = false; addLog("Camera frames flowing again.", "info"); }
    } else if (!S.stalled && (now || performance.now()) - S.lastAdvanceT > 3000) {
      S.stalled = true;
      addLog("Camera frame FROZEN (video clock stuck) — the mesh is re-reading one still image. Another app may hold the camera; re-select it or restart the browser.", "info");
    }
  }
  if (video.readyState >= 2 && advanced && !sending) {
    sending = true;
    S.sent++;
    var processingStart = performance.now();
    try {
      await S.faceMesh.send({ image: video });
      var elapsed = performance.now() - processingStart;
      S.procMs = S.procMs ? S.procMs * 0.85 + elapsed * 0.15 : elapsed;
      S.consecFails = 0;
    } catch (e) {
      S.errors++;
      S.consecFails++;
      S.lastError = "frame send failed: " + (e && e.message || e);
      if (S.consecFails === 30) {
        addLog("Face engine failing repeatedly (" + S.lastError + "). Likely WebGL blocked or model download failed — try another browser or Demo Mode.", "info");
      }
    }
    sending = false;
  }
  requestAnimationFrame(pump);
}

/* ---------------- per-result analysis ---------------- */
var lastVisualAt = 0;
function renderFrame(lm, force) {
  var now = performance.now();
  if (!force && now - lastVisualAt < 50) return;
  lastVisualAt = now;
  try { drawOverlay(lm); }
  catch (e) { S.errors++; S.lastError = "overlay crashed: " + (e && e.message || e); }
  chEar.draw(); chMar.draw(); chMot.draw();
  updateHud();
}
function onMesh(res) {
  var lms = (res.multiFaceLandmarks && res.multiFaceLandmarks[0]) || null;
  var resultAt = performance.now(), wasPresent = S.facePresent;
  if (S.lastResultAt > 0) {
    var actualFps = 1000 / Math.max(1, resultAt - S.lastResultAt);
    S.emaFps += (actualFps - S.emaFps) * 0.15;
    S.fps = Math.round(S.emaFps);
  }
  S.lastResultAt = resultAt;
  S.frame++;
  S.results++;
  if (!lms || lms.length < 468) {
    S.facePresent = false; S.conf = Math.max(0, S.conf - 0.08);
    eyeSignal.reset(); S.blink.closed = false; lipWatch.reset(); S.lip.devHold = 0; S.lip.devLatch = false;
    $("auStatus").textContent = "Face not tracked — activity readings paused.";
    if (wasPresent) setAlerts([]);
    renderFrame(null, wasPresent);
    return;
  }
  S.lmCount = lms.length;
  // Identical-output check: live landmarks always jitter; bit-identical
  // points across many results mean the mesh input itself is frozen.
  var probe = [lms[1].x, lms[1].y, lms[160].x, lms[160].y, lms[61].x, lms[61].y];
  var same = S.prevPts && probe.every(function (v, i) { return v === S.prevPts[i]; });
  S.prevPts = probe;
  if (same) {
    S.identFrames++;
    if (S.identFrames === 120) addLog("Mesh output identical 120× in a row — input frame is frozen upstream (see camera check).", "info");
  } else {
    S.identFrames = 0;
  }
  S.facePresent = true; S.conf = Math.min(0.99, S.conf + 0.06);
  S.prevLm = S.lastLm; S.lastLm = lms;
  var blinkBefore = S.blinkTotal, lipBefore = S.lip.devLatch;
  try {
    analyze(lms);
  } catch (e) {
    S.errors++;
    S.lastError = "analyze crashed: " + (e && e.message || e);
  }
  if (S.autoGuidePending && !S.guide && S.running && !S.demo) {
    S.autoGuidePending = false;
    faceGuided();
  }
  renderFrame(lms, !wasPresent || S.blinkTotal !== blinkBefore || S.lip.devLatch !== lipBefore);
}

function neutral() { return (S.twin && S.twin.neutral) || null; }

function analyze(lm) {
  var M = window.NF_metrics, N = neutral();
  var t = performance.now() / 1000; S.t = t;
  var dt = Math.min(0.5, Math.max(0.001, t - (S.prevT || t))); S.prevT = t;

  /* eyes — pixel-space EAR + self-calibrating thresholds */
  var vW = video.videoWidth || 0, vH = video.videoHeight || 0;
  var earL = (vW && vH) ? M.earPx(lm, window.NF_LM.eyeL, vW, vH) : M.ear(lm, window.NF_LM.eyeL);
  var earR = (vW && vH) ? M.earPx(lm, window.NF_LM.eyeR, vW, vH) : M.ear(lm, window.NF_LM.eyeR);
  var earAvg = (earL + earR) / 2;
  S.earL = earL; S.earR = earR;
  if (t < S.testBlinkUntil) { earAvg = 0.05; S.earL = S.earR = 0.05; } // injected test blink
  // Guided eye-signal check: measures YOUR open vs closed EAR for a verdict.
  if (S.eyeCheck && t >= S.testBlinkUntil) {
    var EC = S.eyeCheck;
    if (EC.phase === "open") {
      EC.open.push(earAvg);
      if (t - EC.t0 > 2.0) { EC.phase = "closed"; EC.t0 = t; addLog("Eye check: CLOSE your eyes now and hold…"); }
    } else {
      EC.closed.push(earAvg);
      if (t - EC.t0 > 2.5) finishEyeCheck();
    }
  }
  chEar.push(earAvg);
  // Rolling open-eye baseline: eyes are open ~95% of the time, so the 90th
  // percentile of recent EAR is the patient's personal open-eye value.
  // Do not teach a long eyes-closed plateau as the new open-eye baseline.
  if (eyeSignal.phase === 'open') S.earHist.push(earAvg);
  if (S.earHist.length > 240) S.earHist.shift();
  var thClose, thOpen, eyeCalibrated = S.earHist.length >= 45;
  if (eyeCalibrated) {
    var sorted = S.earHist.slice().sort(function (a, b) { return a - b; });
    var openEar = sorted[Math.floor(0.9 * (sorted.length - 1))];
    var savedEar = N && Number.isFinite(N.earMean) ? N.earMean : openEar;
    var refEar = Math.abs(savedEar - openEar) <= openEar * 0.2 ? Math.max(savedEar, openEar) : openEar;
    S.eyeRef = refEar;
    thClose = refEar - Math.max(0.022, refEar * 0.065);
    thOpen = refEar - 0.012;
  } else {
    thClose = 0.15; thOpen = 0.21;
  }
  // Closing the eyes is never an emergency command: sleep, fatigue and camera
  // occlusion can all look identical to a sustained closure.
  S.eyeTh = { close: thClose, open: thOpen };
  // Water-command re-arm: after firing, require 2.5 s of continuous open
  // eyes before a new triple-hold can trigger — breaks repeat-fire loops
  // from slow EAR wobble (talking, tracker noise).
  if (eyeCalibrated && earAvg > thOpen) S.openRun += dt; else S.openRun = 0;
  if (!S.waterArmed && S.openRun > 2.5) { S.waterArmed = true; S.intentSeq = []; }
  var B = S.blink;
  var blinkEvent = eyeCalibrated ? eyeSignal.update(t, S.earL, S.earR, S.eyeRef) : null;
  B.closed = eyeSignal.phase === 'dip';
  if (blinkEvent) registerBlink(classifyBlink(blinkEvent.duration, blinkEvent.minimum, S.eyeRef), blinkEvent.duration, t);
  S.prevSlope = earAvg - S.prevEarAvg;
  S.prevEarAvg = earAvg;
  S.prevFrameT = t;
  // blink rate (rolling 60 s, scaled)
  var cutoff = t - 60;
  B.times = B.times.filter(function (x) { return x > cutoff; });
  S.blinkRate = B.times.length * (B.times.length >= 4 ? 1 : 2.2); // estimate when short session

  /* gaze */
  var g = M.gaze(lm);
  if (g.available === false) { S.gaze.label = "n/a (no iris)"; S.gaze.holdR = 0; }
  else {
    S.gaze.label = M.gazeLabel(g);
    if (S.gaze.label === "looking left") S.gaze.holdR += 1 / 30; else S.gaze.holdR = 0;
  }
  S.gaze.x = g.x; S.gaze.y = g.y;

  /* mouth / smile — rolling neutral width so stretch works with no twin */
  var marV = M.mar(lm); S.mar = marV; chMar.push(marV);
  var wNow = M.mouthWidth(lm);
  S.mouthW0hist.push(wNow);
  if (S.mouthW0hist.length > 300) S.mouthW0hist.shift();
  var rollW0 = median(S.mouthW0hist);
  var Neff = N || {};
  if (!N) Neff = { mouthW: rollW0 };
  var auResult = activity.update(lm);
  S.aus = auResult.values;
  S.auInvalid = !!auResult.invalid;
  $("auStatus").textContent = auResult.invalid ? "Landmark geometry unavailable — activity readings paused."
    : auResult.ready ? "Neutral reference ready. Move one feature at a time; 0% at rest is normal."
    : "Learning neutral reference — keep your face relaxed (" + auResult.progress + "/" + activity.count + " frames).";
  var sm = M.smileIntensity(lm, Neff);
  if (auResult.ready) sm = Math.max(sm, S.aus.AU12 / 100 * .85);
  var smileSides = M.smileSideExcursions(lm, Neff);
  var sym = smileSides.score;
  var w = M.mouthWidth(lm);
  var w0 = (Neff && Neff.mouthW) || w;
  var asymmetryNow = smileSides.valid && sm > 0.45 && sym < 55 && Math.abs(S.head.yaw) < 10;
  S.smile = { intensity: sm, sym: sym, l: smileSides.left, r: smileSides.right,
    valid: smileSides.valid, hold: sm > 0.45 ? S.smile.hold + dt : 0,
    symLowHold: asymmetryNow ? (S.smile.symLowHold || 0) + dt : 0 };
  // Smile-hold detector: sustained smile (time-based) → Yes gesture.
  S.smileHoldSec = sm > S.smileThr ? (S.smileHoldSec || 0) + dt : 0;
  if (S.smileHoldSec >= 1.5 && !S.smileHoldFired) { S.smileHoldFired = true; faceDispatch("smileHold"); }
  if (sm <= S.smileThr) S.smileHoldFired = false;

  /* Fixed neutral-relative geometry; untrained CNN outputs do not affect bars. */
  var au1 = S.aus.AU1 / 100, au4 = S.aus.AU4 / 100;
  var au6 = S.aus.AU6 / 100, au20 = S.aus.AU20 / 100;

  /* lips */
  var pucker = clamp01((1 - w / Math.max(1e-6, w0)) * 2.2) * clamp01(marV / 0.35);
  var gesture = "neutral";
  if (sm > 0.45) gesture = "smile";
  else if (marV < 0.07) gesture = "lip closure";
  else if (marV > 0.38) gesture = "lip open";
  else if (pucker > 0.45) gesture = "lip pucker";
  S.lip = { gesture: gesture, pucker: pucker, invol: S.lip.invol,
    dev: S.lip.dev || 0, devHold: S.lip.devHold || 0, devDir: S.lip.devDir || "—", devLatch: !!S.lip.devLatch, devKind: S.lip.devKind || "lateral" };

  /* head — relative to calibrated twin, else a slow adaptive baseline
     (instant re-zeroing would pin yaw/pitch at 0 and erase all movement) */
  var hp = M.headPose(lm);
  if (!S.headBase) S.headBase = { yaw: hp.yaw, pitch: hp.pitch, roll: hp.roll };
  var nH = (N && N.head) || S.headBase;
  var yaw = hp.yaw - nH.yaw, pitch = hp.pitch - nH.pitch, roll = hp.roll - nH.roll;
  if (!(N && N.head)) {
    var hk = 0.008; // ~12 s time constant: turns stay visible, slow drift fades
    S.headBase.yaw += (hp.yaw - S.headBase.yaw) * hk;
    S.headBase.pitch += (hp.pitch - S.headBase.pitch) * hk;
    S.headBase.roll += (hp.roll - S.headBase.roll) * hk;
  }
  S.head.yaw = yaw; S.head.pitch = pitch; S.head.roll = roll;
  S.head.hist.push(pitch); if (S.head.hist.length > 90) S.head.hist.shift();
  var pose = "center";
  if (yaw > 12) pose = "head right"; else if (yaw < -12) pose = "head left";
  else if (pitch > 10) pose = "head down"; else if (pitch < -10) pose = "head up";
  else if (Math.abs(roll) > 10) pose = "head tilt";
  S.head.pose = pose;
  S.head.nod = detectNod(S.head.hist) ? "yes ✓" : "—";
  /* patient commands: 3 head turns per side (excursion + return) within 6 s */
  if (yaw < -12) { if (S.headArmed !== "left") S.headArmed = "left"; }
  else if (yaw > 12) { if (S.headArmed !== "right") S.headArmed = "right"; }
  else if (Math.abs(yaw) < 6 && S.headArmed) {
    var side = S.headArmed; S.headArmed = null;
    var turns = S.headTurns[side];
    turns.push(t);
    while (turns.length && t - turns[0] > 6) turns.shift();
    if (turns.length >= 3) {
      S.headTurns.left = []; S.headTurns.right = [];
      faceDispatch(side === "left" ? "headL" : "headR");
    }
  }
  /* patient command: nod while smiling → okay/thank-you (rising edge) */
  var nodNow = S.head.nod !== "—";
  if (nodNow && !S.lastNod) {
    S.lastNodT = t;
    if (S.smile.intensity > S.smileThr) { S.okayFiredNod = t; faceDispatch("nodSmile"); }
  }
  S.lastNod = nodNow;

  S.lastNod = nodNow;

  /* motion: landmark displacement + accel + tremor band */
  if (S.prevLm) {
    var idx = [1, 33, 263, 61, 291, 13, 14, 105, 334, 152];
    var dsum = 0;
    for (var i = 0; i < idx.length; i++) {
      var a = S.prevLm[idx[i]], b = lm[idx[i]];
      dsum += Math.hypot(a.x - b.x, a.y - b.y);
    }
    var disp = dsum / idx.length;
    var accel = Math.abs(disp - S.motion.prevDisp) * 30;
    S.motion.disp = disp; S.motion.accel = accel; S.motion.prevDisp = disp;
    S.motion.hist.push(disp); if (S.motion.hist.length > 120) S.motion.hist.shift();
    chMot.push(disp);
    var st = "normal movement", tr = "none";
    var recent = S.motion.hist.slice(-60);
    var mean = recent.reduce(function (s, v) { return s + v; }, 0) / Math.max(1, recent.length);
    var crossings = 0;
    for (var k = 1; k < recent.length; k++) {
      if ((recent[k - 1] - mean) * (recent[k] - mean) < 0) crossings++;
    }
    var hz = crossings / 2 / 2; // ~2 s window
    if (mean > 0.012 && hz >= 3 && hz <= 12) { st = "possible tremor"; tr = hz.toFixed(1) + " Hz"; }
    else if (mean > 0.016) { st = "possible twitch/spasm"; }
    else if (mean < 0.0012) { st = "stable / resting"; }
    S.motion.state = st; S.motion.tremor = tr;
    S.lip.invol = (st === "normal movement" || st === "stable / resting") ? "none" : st;
  }

  /* ---- abnormality detectors: sustained lateral lip deviation + sad/pain affect ---- */
  var lateral = M.lipDeviation(lm, (N && N.dev0) || 0);
  var corner = M.lipAsymmetry(lm, N);
  if (S.test && S.test.dev && t < S.test.devUntil) lateral = S.test.devVal;
  var cornerThr = 0.04;
  var useCorner = Math.abs(corner) / cornerThr > Math.abs(lateral) / S.devThr;
  var devRaw = useCorner ? corner : lateral;
  var devThr = useCorner ? cornerThr : S.devThr;
  var yawOk = Math.abs(yaw) < 20 && Math.abs(roll) < 12; // allow supplied -13° yaw, reject strong pose artefacts
  var devActive = yawOk && (sm < S.smileThr || sym < 75) && Math.abs(devRaw) >= devThr;
  var devSide = useCorner ? (devRaw > 0 ? "right mouth corner" : "left mouth corner")
    : (devRaw > 0 ? "image-right shift" : "image-left shift");
  if (lipWatch.update(t, devActive, devRaw > 0 ? "right" : "left")) {
    addLog("Sustained " + devSide + " displacement for 60s — abnormality flag; check camera angle and patient comfort (not a diagnosis)");
  }
  S.lip.dev = devRaw; S.lip.devHold = lipWatch.duration;
  S.lip.devDir = devActive ? devSide : (lipWatch.duration > 0 ? S.lip.devDir : "—");
  S.lip.devLatch = lipWatch.latched; S.lip.devKind = useCorner ? "corner asymmetry" : "lateral shift";
  // sad composite: inner-brow raise + downturned corners + brow lowering + absent smile
  var depress = clamp01(M.cornerDepression(lm) / 0.03);
  var sadScore = 0.35 * au1 + 0.30 * depress + 0.20 * au4 + 0.15 * (1 - sm);
  if (S.test && S.test.sad && t < S.test.sadUntil) sadScore = S.test.sadVal;
  if (sadScore >= 0.55) S.affect.sadHold += dt;
  else if (sadScore < 0.40) { S.affect.sadHold = 0; S.affect.sadLatch = false; }
  S.affect.sad = sadScore;
  if (S.affect.sadHold >= 10 && !S.affect.sadLatch) {
    S.affect.sadLatch = true;
    addLog("Sad-like expression sustained 10s (score " + Math.round(sadScore * 100) + "%) — possible distress/low mood");
  }
  // pain composite: brow lowering + cheek raise + eye squeeze + mouth tension
  var squint = clamp01((0.28 - earAvg) * 4);
  var tension = Math.max(au20, clamp01((0.09 - marV) * 6));
  var painScore = 0.30 * au4 + 0.25 * au6 + 0.20 * squint + 0.25 * tension;
  if (S.test && S.test.pain && t < S.test.painUntil) painScore = S.test.painVal;
  if (painScore >= 0.60) S.affect.painHold += dt;
  else if (painScore < 0.45) { S.affect.painHold = 0; S.affect.painLatch = false; }
  S.affect.pain = painScore;
  if (S.affect.painHold >= 8 && !S.affect.painLatch) {
    S.affect.painLatch = true;
    addLog("Pain-like expression sustained 8s (score " + Math.round(painScore * 100) + "%) — check patient comfort");
  }

  /* guided personal checks: smile range + one-sided hold adopt YOUR thresholds */
  if (S.smileCheck) {
    var SC = S.smileCheck;
    if (SC.phase === "neutral") {
      SC.base.push(sm);
      if (t - SC.t0 > 2.0) { SC.phase = "grin"; SC.t0 = t; addLog("Smile check: BIG smile now, hold…"); }
    } else {
      SC.peak.push(sm);
      if (t - SC.t0 > 2.5) finishSmileCheck();
    }
  }
  if (S.devCheck) {
    var DC = S.devCheck;
    if (DC.phase === "neutral") {
      DC.base.push(Math.abs(lateral));
      if (t - DC.t0 > 2.0) { DC.phase = "hold"; DC.t0 = t; addLog("Deviation check: pull lips to ONE SIDE and hold…"); }
    } else {
      DC.peak.push(lateral);
      if (t - DC.t0 > 3.0) finishDevCheck();
    }
  }

  /* Optional low-rate flow preview; the landmark detectors still run on every frame. */
  if ($("tglFlow").checked && S.frame % 6 === 0) computeFlowROIs(lm);

  /* scores */
  computeScores();

  /* calibration capture */
  if (S.cal.collecting) captureCalFrame({ earAvg: earAvg, mar: marV, sm: sm, sym: sym, gaze: { x: g.x, y: g.y }, head: { yaw: yaw, pitch: pitch, roll: roll } });

  /* alerts + comm */
  emitAlerts();
  commTick(t);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function pct(v) { return Math.round(Math.max(0, Math.min(1, v)) * 100); }
function median(a) {
  if (!a.length) return 0;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.floor(s.length / 2)];
}
function finiteOr(value, fallback) {
  return (typeof value === "number" && isFinite(value)) ? value : fallback;
}
function registerBlink(type, dur, t) {
  var B = S.blink;
  // Burst override: blinks arriving <0.5 s after the previous one are a
  // rapid-flutter sequence, whatever each dip's own duration says.
  if ((type === "normal blink" || type === "incomplete blink") && S.lastCountT > 0 && t - S.lastCountT < 0.5) {
    type = "rapid blink";
  }
  B.lastType = type; B.lastDur = dur; S.blinkTotal++;
  S.lastCountT = t;
  B.events.push({ t: t, dur: dur, type: type });
  B.times.push(t);
  if (B.times.length > 40) B.times.shift();
  onBlinkEvent(type, dur);
}
function classifyBlink(dur, minEar, openEar) {
  if (dur >= 1.6) return "held shut";
  if (dur > 0.6) return "intentional blink";
  if (dur > 0.4) return "slow blink";
  if (dur < 0.12) return "rapid blink";
  if (minEar > openEar * 0.8) return "incomplete blink";
  return "normal blink";
}
var lastLogT = {};
function throttledLog(msg, key, ms) {
  key = key || msg; ms = ms || 8000;
  var now = performance.now();
  if (lastLogT[key] && now - lastLogT[key] < ms) return;
  lastLogT[key] = now;
  addLog(msg);
}
function onBlinkEvent(type, dur) {
  if (type === "slow blink") throttledLog("Slow blink detected (" + dur.toFixed(2) + "s)", "slow", 10000);
  if (type === "incomplete blink") throttledLog("Incomplete blink — eyelid didn't fully close", "inc", 12000);
  if (type === "rapid blink") throttledLog("Rapid blink (" + dur.toFixed(2) + "s)", "rapid", 10000);
  // Patient command: 3 intentional blinks in a row while looking at camera.
  // Gated by waterArmed so one noisy stretch can't loop the command.
  if (type === "intentional blink" && S.waterArmed) {
    var nowT = S.t || performance.now() / 1000;
    S.intentSeq.push({ t: nowT, centered: S.gaze.label === "center" });
    while (S.intentSeq.length && nowT - S.intentSeq[0].t > 8) S.intentSeq.shift();
    var seq = S.intentSeq.slice(-3);
    if (seq.length === 3 && seq.every(function (e) { return e.centered; })) {
      S.intentSeq = [];
      S.waterArmed = false; S.openRun = 0;
      faceDispatch("blink3");
    }
  }
}

function finishSmileCheck() {
  var SC = S.smileCheck; S.smileCheck = null;
  if (!SC || SC.base.length < 10 || SC.peak.length < 10) {
    addLog("Smile check aborted — face lost mid-check.", "info");
    return;
  }
  var peak = Math.max.apply(0, SC.peak);
  S.smileThr = Math.max(0.22, Math.min(0.6, peak * 0.55));
  if (peak < 0.25) {
    addLog("Smile check FAILED: biggest smile read " + Math.round(peak * 100) + "% — mouth landmarks aren't moving. Try brighter frontal light, no glasses, face ~50cm.", "info");
  } else if (peak < 0.45) {
    addLog("Smile check MARGINAL: max " + Math.round(peak * 100) + "% — threshold set to " + Math.round(S.smileThr * 100) + "%. Nod+smile and smile scores now use it.", "info");
  } else {
    addLog("Smile check PASSED: max " + Math.round(peak * 100) + "% — threshold set to " + Math.round(S.smileThr * 100) + "%.", "info");
  }
}

function finishDevCheck() {
  var DC = S.devCheck; S.devCheck = null;
  if (!DC || DC.base.length < 10 || DC.peak.length < 10) {
    addLog("Deviation check aborted — face lost mid-check.", "info");
    return;
  }
  var mags = DC.peak.map(function (v) { return Math.abs(v); });
  var maxDev = Math.max.apply(0, mags);
  var side = DC.peak[mags.indexOf(maxDev)] > 0 ? "right" : "left";
  S.devThr = Math.max(0.02, Math.min(0.06, maxDev * 0.5));
  if (maxDev < 0.02) {
    addLog("Deviation check FAILED: max pull only " + (maxDev * 100).toFixed(1) + "% — lateral motion isn't tracked. Check light, glasses, and head-facing-camera.", "info");
  } else {
    addLog("Deviation check PASSED: pulled " + side + " to " + (maxDev * 100).toFixed(1) + "% — threshold set to " + (S.devThr * 100).toFixed(1) + "%. Hold past it to test the 60s watch.", "info");
  }
}

function finishEyeCheck() {
  var EC = S.eyeCheck; S.eyeCheck = null;
  if (!EC || EC.open.length < 10 || EC.closed.length < 10) {
    addLog("Eye check aborted — face lost mid-check. Keep facing the camera.", "info");
    return;
  }
  var oMed = median(EC.open), cMed = median(EC.closed);
  var ratio = cMed / Math.max(1e-6, oMed);
  S.earHist = [];
  for (var i = 0; i < 240; i++) S.earHist.push(oMed); // adopt YOUR measured open eye
  if (ratio < 0.6) {
    addLog("Eye check PASSED: open " + oMed.toFixed(2) + " → closed " + cMed.toFixed(2) + ". Detector calibrated to your eyes — blink now.", "info");
  } else if (ratio < 0.85) {
    addLog("Eye check MARGINAL: open " + oMed.toFixed(2) + " → closed " + cMed.toFixed(2) + ". Partial dips will still count as blinks.", "info");
  } else {
    addLog("Eye check FAILED: lids read " + oMed.toFixed(2) + " open vs " + cMed.toFixed(2) + " with eyes shut — landmarks are not following your eyelids. Try: bright frontal light, remove glasses, face ~50cm away, and confirm the mesh sits on YOUR face in the overlay.", "info");
  }
}

function computeScores() {
  // Signal-consistency proxy, NOT ability. Resting stillness, no smile and an
  // ordinary blink rate must never be treated as lost motor control.
  var eye = Math.round(Math.max(0, 100 - Math.max(0, Math.abs(S.earL - S.earR) - 0.025) * 350));
  var lip = S.lip.invol === "none" ? 100 : 80;
  var smile = S.smile.valid && S.smile.intensity > 0.45 ? S.smile.sym : 100;
  var head = 100;
  var motor = Math.round(eye * 0.3 + lip * 0.25 + smile * 0.25 + head * 0.2);
  eye = finiteOr(eye, 100); lip = finiteOr(lip, 100); smile = finiteOr(smile, 100); head = finiteOr(head, 100);
  motor = finiteOr(motor, 100);
  S.scores = { eye: eye, lip: lip, smile: smile, head: head, motor: motor };
}

function emitAlerts() {
  var a = [];
  if (S.blink.lastType === "slow blink") a.push("Slow blink detected (" + S.blink.lastDur.toFixed(2) + "s)");
  if (S.smile.valid && S.smile.symLowHold >= 1.5 && S.smile.sym < 55) {
    var weak = S.smile.l < S.smile.r ? "right" : "left";
    a.push("Smile motion looks uneven on the " + weak + " side — check camera angle and recalibrate");
  }
  if (/twitch|spasm/i.test(S.motion.state)) a.push("Possible muscle twitch/spasm — check Activity Log");
  if (/tremor/i.test(S.motion.state)) a.push("Repetitive movement in tremor band (" + S.motion.tremor + ")");
  if (S.lip.devHold >= 3) a.push(S.lip.devDir + " " + S.lip.devKind + " for " + Math.round(S.lip.devHold) + "s" + (S.lip.devLatch ? " — sustained abnormality flag (not a diagnosis)" : " (watching · 60s threshold)"));
  if (S.affect.sadHold >= 3) a.push("Sad-like expression for " + Math.round(S.affect.sadHold) + "s" + (S.affect.sadLatch ? " — ABNORMALITY flagged" : " (watching · 10s threshold)"));
  if (S.affect.painHold >= 2) a.push("Pain-like expression for " + Math.round(S.affect.painHold) + "s" + (S.affect.painLatch ? " — ABNORMALITY flagged" : " (watching · 8s threshold)"));
  setAlerts(a);
}

/* ---------------- optical flow lite ---------------- */
var flowCanvas = document.createElement("canvas");
flowCanvas.width = 48; flowCanvas.height = 48;
var flowCtx = flowCanvas.getContext("2d", { willReadFrequently: true });
function roiDiff(nx0, ny0, nx1, ny1) {
  // map normalized face bbox approx to video pixels; fallback to center crops
  try {
    var vw = video.videoWidth || 640, vh = video.videoHeight || 360;
    var sx = Math.max(0, nx0 * vw), sy = Math.max(0, ny0 * vh);
    var sw = Math.max(8, (nx1 - nx0) * vw), sh = Math.max(8, (ny1 - ny0) * vh);
    flowCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 48, 48);
    var cur = flowCtx.getImageData(0, 0, 48, 48).data;
    var prev = S.flowPrev;
    var sad = 0;
    if (prev) {
      for (var i = 0; i < cur.length; i += 16) {
        sad += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
      }
      sad /= (48 * 48);
    }
    return sad;
  } catch (e) { return 0; }
}
function computeFlowROIs(lm) {
  if (!video.videoWidth) return;
  // eyelid strip, mouth, cheek — normalized coords from landmarks
  function bb(indices, pad) {
    var xs = indices.map(function (i) { return lm[i].x; }), ys = indices.map(function (i) { return lm[i].y; });
    return [Math.max(0, Math.min.apply(0, xs) - pad), Math.max(0, Math.min.apply(0, ys) - pad),
            Math.min(1, Math.max.apply(0, xs) + pad), Math.min(1, Math.max.apply(0, ys) + pad)];
  }
  // NOTE: video is mirrored in display only; flow uses raw pixels (unmirrored) — fine for magnitude
  var eye = bb([33, 133, 160, 144, 362, 263], 0.03);
  var lip = bb([61, 291, 13, 14], 0.04);
  var cheek = bb([116, 123, 147, 345, 352, 376], 0.03);
  // draw sequentially into shared buffer is lossy; approximate by sampling current frame thrice
  S.flow.eye += ((roiDiff(eye[0], eye[1], eye[2], eye[3]) || 0) - S.flow.eye) * 0.4;
  S.flowPrev = null;
  try { S.flowPrev = flowCtx.getImageData(0, 0, 48, 48).data.slice(0); } catch (e) {}
  S.flow.lip += ((roiDiff(lip[0], lip[1], lip[2], lip[3]) || 0) - S.flow.lip) * 0.4;
  S.flow.cheek += ((roiDiff(cheek[0], cheek[1], cheek[2], cheek[3]) || 0) - S.flow.cheek) * 0.4;
}

/* ---------------- demo synthesizer ---------------- */
function demoFrame() {
  S.frame++;
  demoT += 1 / 30;
  var t = demoT;
  var earAvg = 0.26 + Math.sin(t * 0.7) * 0.015 - (Math.sin(t * 2.3) > 0.985 ? 0.16 : 0);
  var marV = 0.18 + Math.max(0, Math.sin(t * 0.5)) * 0.25 + Math.sin(t * 7) * 0.008;
  var sm = Math.max(0, Math.min(1, (Math.sin(t * 0.45) + 0.4) * 0.7));
  var sym = 72 + Math.sin(t * 0.3) * 8;
  S.earL = earAvg + 0.008; S.earR = earAvg - 0.008; S.mar = marV;
  chEar.push(earAvg); chMar.push(marV);
  var disp = 0.004 + Math.abs(Math.sin(t * 3.1)) * 0.006 + (Math.sin(t * 9) > 0.93 ? 0.02 : 0);
  S.motion.disp = disp; S.motion.hist.push(disp);
  if (S.motion.hist.length > 120) S.motion.hist.shift();
  chMot.push(disp);
  if (S.frame % 2 === 0) { chEar.draw(); chMar.draw(); chMot.draw(); }
  S.motion.state = disp > 0.016 ? "possible twitch/spasm" : "normal movement";
  S.motion.tremor = "none";
  S.gaze.label = Math.sin(t * 0.4) > 0.7 ? "looking left" : "center";
  S.smile = { intensity: sm, sym: sym, l: 0.02, r: 0.028, hold: sm > 0.45 ? S.smile.hold + 1 / 30 : 0 };
  S.aus = { AU1: 30 + Math.round(20 * Math.sin(t)), AU4: 12, AU6: Math.round(sm * 70), AU12: Math.round(sm * 100), AU20: Math.round(sm * 55), AU25: Math.round(marV * 160) };
  S.lip = { gesture: sm > 0.45 ? "smile" : (marV > 0.38 ? "lip open" : "neutral"), pucker: 0.1, invol: S.motion.state === "normal movement" ? "none" : S.motion.state,
    dev: S.lip.dev || 0, devHold: S.lip.devHold || 0, devDir: S.lip.devDir || "—", devLatch: !!S.lip.devLatch, devKind: "lateral shift" };
  S.head = { yaw: Math.sin(t * 0.5) * 8, pitch: Math.sin(t * 0.33) * 6, roll: Math.sin(t * 0.2) * 3, pose: "center", nod: "—", hist: S.head.hist };
  S.flow = { eye: 4 + Math.random() * 3, lip: 6 + Math.random() * 4, cheek: 3 + Math.random() * 2 };
  S.cnnActivity += ((0.35 + sm * 0.5) - S.cnnActivity) * 0.05;
  S.facePresent = true; S.conf = 0.92; S.fps = Math.round(S.emaFps) || 30;
  S.blinkRate = 15 + Math.round(3 * Math.sin(t * 0.2));
  S.blink.lastType = "normal blink"; S.blink.lastDur = 0.24;
  S.temporal = { label: sm > 0.6 && sym < 75 ? "Asymmetric movement" : "Normal movement", probs: [], conf: 0.72 };
  S.scores = { eye: 100, lip: S.lip.invol === "none" ? 100 : 80,
    smile: sm > 0.45 ? Math.round(sym) : 100, head: 100,
    motor: Math.round(30 + (S.lip.invol === "none" ? 25 : 20) + (sm > 0.45 ? sym * 0.25 : 25) + 20) };
  drawDemoOverlay(t);
  /* demo abnormality detectors (same thresholds as live pipeline) */
  var detAl = [], nowS = performance.now() / 1000;
  (function () {
    var devRaw = 0.008 * Math.sin(t * 0.23);
    if (S.test && S.test.dev && nowS < S.test.devUntil) devRaw = S.test.devVal;
    S.lip.dev = devRaw;
    if (lipWatch.update(nowS, Math.abs(devRaw) >= S.devThr, devRaw >= 0 ? "right" : "left"))
      addLog("Synthetic sustained one-sided lip displacement for 60s — abnormality flag (demo only)");
    S.lip.devHold = lipWatch.duration; S.lip.devLatch = lipWatch.latched;
    S.lip.devDir = Math.abs(devRaw) >= S.devThr ? "one side" : "—";
    var sad = 0.25 + 0.1 * Math.sin(t * 0.4), pain = 0.2 + 0.08 * Math.sin(t * 0.31 + 1);
    if (S.test && S.test.sad && nowS < S.test.sadUntil) sad = S.test.sadVal;
    if (S.test && S.test.pain && nowS < S.test.painUntil) pain = S.test.painVal;
    S.affect.sad = sad; S.affect.pain = pain;
    if (sad >= 0.55) S.affect.sadHold += 1 / 30; else if (sad < 0.40) { S.affect.sadHold = 0; S.affect.sadLatch = false; }
    if (S.affect.sadHold >= 10 && !S.affect.sadLatch) { S.affect.sadLatch = true; addLog("Sad-like expression sustained 10s — possible distress/low mood"); }
    if (pain >= 0.60) S.affect.painHold += 1 / 30; else if (pain < 0.45) { S.affect.painHold = 0; S.affect.painLatch = false; }
    if (S.affect.painHold >= 8 && !S.affect.painLatch) { S.affect.painLatch = true; addLog("Pain-like expression sustained 8s — check patient comfort"); }
    if (S.lip.devHold >= 3) detAl.push("Synthetic one-sided lip shift " + Math.round(S.lip.devHold) + "s" + (S.lip.devLatch ? " — sustained abnormality flag" : " (60s threshold)"));
    if (S.affect.sadHold >= 3) detAl.push("Sad-like expression " + Math.round(S.affect.sadHold) + "s" + (S.affect.sadLatch ? " — ABNORMALITY flagged" : ""));
    if (S.affect.painHold >= 2) detAl.push("Pain-like expression " + Math.round(S.affect.painHold) + "s" + (S.affect.painLatch ? " — ABNORMALITY flagged" : ""));
  })();
  setAlerts(detAl);
  updateHud();
  commTick(t);
}

/* Exact video→overlay mapping for object-fit:contain (any camera aspect).
   Normalized landmark (nx,ny) sits at source pixel (nx*vw, ny*vh), drawn
   mirrored into the letterboxed content rect. */
function viewXform() {
  var vw = (typeof video !== "undefined" && video.videoWidth) || 640;
  var vh = (typeof video !== "undefined" && video.videoHeight) || 360;
  var cw = overlay.width || 640, ch = overlay.height || 360;
  var s = Math.min(cw / vw, ch / vh);
  return { s: s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2, vw: vw, vh: vh };
}

/* Exponential landmark smoothing: kills jitter so the mesh sits still. */
function smoothLandmarks(lm) {
  if (!S.smooth || S.smooth.length !== lm.length) {
    S.smooth = lm.map(function (p) { return { x: p.x, y: p.y }; });
    return S.smooth;
  }
  var a = 0.75; // 15–20 FPS visualization follows the current face without smearing fast events
  for (var i = 0; i < lm.length; i++) {
    var s = S.smooth[i], p = lm[i];
    s.x += (p.x - s.x) * a; s.y += (p.y - s.y) * a;
  }
  return S.smooth;
}

function roundRectPath(x, y, w, h, r) {
  octx.beginPath();
  if (octx.roundRect) { octx.roundRect(x, y, w, h, r); return; }
  octx.moveTo(x + r, y);
  octx.arcTo(x + w, y, x + w, y + h, r); octx.arcTo(x + w, y + h, x, y + h, r);
  octx.arcTo(x, y + h, x, y, r); octx.arcTo(x, y, x + w, y, r);
  octx.closePath();
}

/* Slim iris ring + center dot (quiet, precise). */
function drawIris(pts, P, dy) {
  if (pts.length < 478) return;
  [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]].forEach(function (ids) {
    var cx = 0, cy = 0;
    ids.forEach(function (i) { var q = P(pts[i], dy); cx += q.x; cy += q.y; });
    cx /= ids.length; cy /= ids.length;
    var e1 = P(pts[ids[1]], dy), e3 = P(pts[ids[3]], dy);
    var r = Math.max(2.5, Math.hypot(e1.x - e3.x, e1.y - e3.y) / 2);
    octx.strokeStyle = "rgba(224,251,255,0.85)"; octx.lineWidth = 1.1;
    octx.beginPath(); octx.arc(cx, cy, r, 0, 7); octx.stroke();
    octx.fillStyle = "rgba(224,251,255,0.9)";
    octx.beginPath(); octx.arc(cx, cy, 1.3, 0, 7); octx.fill();
  });
}

function drawOverlay(lm) {
  var W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  if (!lm) {
    S.smooth = null;
    octx.fillStyle = "rgba(147,163,196,.9)"; octx.font = "14px sans-serif";
    octx.fillText("no face — align your face with the camera", 16, 30);
    return;
  }
  var pts = smoothLandmarks(lm);
  var showDots = $("tglOverlay").checked, showMesh = $("tglMesh").checked, showR = $("tglFlow").checked;
  // No cosmetic offsets: display == detection truth. If features sit off the
  // face, that is the model fit (lighting/glasses/distance), not rendering.
  var EYE_DY = 0, LIP_DY = 0;
  var VX = viewXform();
  function P(p, dy) {
    return {
      x: VX.ox + (1 - p.x) * VX.vw * VX.s,
      y: VX.oy + (p.y + (dy || 0)) * VX.vh * VX.s,
    };
  } // exact contain-mapping, mirrored to match selfie video

  function strokeLoop(ids, color, width, dy, close) {
    octx.strokeStyle = color; octx.lineWidth = width;
    octx.lineJoin = "round"; octx.lineCap = "round";
    octx.beginPath();
    ids.forEach(function (idx, j) { var r = P(pts[idx], dy); if (j === 0) octx.moveTo(r.x, r.y); else octx.lineTo(r.x, r.y); });
    if (close) octx.closePath();
    octx.stroke();
  }

  var INK = "rgba(232,244,255,0.7)";
  if (showMesh) {
    // Sparse reference style: thin feature lines + dots, no dense fill.
    // Face oval passes over the forehead and under the chin (both lined).
    strokeLoop(window.NF_LM.contour, "rgba(56,225,255,0.55)", 1.2, 0, true);
    strokeLoop([70, 63, 105, 66, 107], INK, 1.3, 0, false);
    strokeLoop([336, 296, 334, 293, 300], INK, 1.3, 0, false);
    strokeLoop([33, 160, 158, 133, 153, 144], INK, 1.4, EYE_DY, true);
    strokeLoop([362, 385, 387, 263, 373, 380], INK, 1.4, EYE_DY, true);
    strokeLoop([168, 6, 197, 195, 5, 4, 1], INK, 1.2, 0, false);
    strokeLoop([98, 1, 327], INK, 1.2, 0, false);
    strokeLoop([61, 185, 40, 39, 37, 0, 267, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146], "rgba(255,138,212,0.85)", 1.4, LIP_DY, true);
    drawIris(pts, P, EYE_DY);
  }
  if (showDots) {
    // Dots only on the drawn feature vertices (like the reference).
    var EYE_VERTS = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380];
    var LIP_VERTS = [61, 185, 40, 39, 37, 0, 267, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
    var VERTS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
      168, 6, 197, 195, 5, 4, 1, 98, 327, 10, 152]
      .concat(EYE_VERTS).concat(LIP_VERTS);
    octx.fillStyle = "rgba(240,248,255,0.9)";
    VERTS.forEach(function (idx) {
      var dy = (EYE_VERTS.indexOf(idx) >= 0) ? EYE_DY : ((LIP_VERTS.indexOf(idx) >= 0) ? LIP_DY : 0);
      var s = P(pts[idx], dy);
      octx.beginPath(); octx.arc(s.x, s.y, 1.4, 0, 7); octx.fill();
    });
  }
  if (showR) {
    // Subtle labeled regions where optical flow is measured.
    [["lid", [33, 133, 362, 263, 160, 380]], ["lip", [61, 291, 13, 14]], ["cheek", [116, 123, 345, 352]]].forEach(function (entry) {
      var ids = entry[1];
      var xs = ids.map(function (i) { return P(pts[i]).x; });
      var ys = ids.map(function (i) { return P(pts[i]).y; });
      var x0 = Math.min.apply(0, xs) - 12, y0 = Math.min.apply(0, ys) - 12;
      var x1 = Math.max.apply(0, xs) + 12, y1 = Math.max.apply(0, ys) + 12;
      octx.strokeStyle = "rgba(255,206,77,0.45)"; octx.lineWidth = 1;
      roundRectPath(x0, y0, x1 - x0, y1 - y0, 7); octx.stroke();
      octx.fillStyle = "rgba(255,206,77,0.7)"; octx.font = "9px sans-serif";
      octx.fillText(entry[0], x0 + 5, y0 - 3);
    });
  }
}
function drawDemoOverlay(t) {
  var W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  octx.strokeStyle = "rgba(56,225,255,.5)"; octx.lineWidth = 1.5;
  octx.beginPath(); octx.ellipse(W / 2, H / 2, W * 0.22, H * 0.32, 0, 0, 7); octx.stroke();
  var blink = (Math.sin(t * 2.3) > 0.985) ? 0.15 : 1;
  octx.strokeStyle = "#3dff9e";
  [-0.09, 0.09].forEach(function (dx) {
    octx.beginPath(); octx.ellipse(W / 2 + dx * W, H * 0.42, 26, 26 * blink, 0, 0, 7); octx.stroke();
  });
  var sm = S.smile.intensity;
  octx.strokeStyle = "#ff7ad9"; octx.lineWidth = 3;
  octx.beginPath(); octx.arc(W / 2, H * 0.58, 40, 0.3, Math.PI - 0.3); octx.stroke();
  octx.fillStyle = "rgba(255,206,77,.9)"; octx.font = "13px sans-serif";
  octx.fillText("DEMO SYNTHETIC — no camera", 16, 26);
}

/* ---------------- HUD ---------------- */
function num(v, d) { return (v === undefined || isNaN(v)) ? "—" : Number(v).toFixed(d === undefined ? 2 : d); }
function updateHud() {
  $("vFps").textContent = S.fps || "—";
  $("vInferMs").textContent = S.procMs ? S.procMs.toFixed(0) + " ms" : "—";
  $("vConf").textContent = S.facePresent ? Math.round(S.conf * 100) + "%" : "—";
  $("vFace").textContent = S.facePresent ? ("yes (" + (S.lmCount || "?") + " pts)") : "no";
  $("pdCam").textContent = (!S.running ? "off" : (S.demo ? "demo" : ((video.videoWidth || 0) + "×" + (video.videoHeight || 0)))) + (S.stalled ? " · FROZEN" : "");
  $("pdSent").textContent = String(S.sent);
  $("pdResults").textContent = String(S.results);
  $("pdLm").textContent = S.facePresent ? String(S.lmCount || "?") : "—";
  $("pdErr").textContent = String(S.errors);
  $("pdErrMsg").textContent = S.lastError || "—";
  $("vCnn").textContent = S.cnnActivity ? Math.round(S.cnnActivity * 100) + "%" : "—";
  $("vTemporal").textContent = (S.temporal.label || "—") + (S.temporal.conf ? " " + Math.round(S.temporal.conf * 100) + "%" : "");
  $("fpsBadge").textContent = "FPS " + (S.fps || "—") + " · conf " + (S.facePresent ? Math.round(S.conf * 100) + "%" : "—");
  $("hudGaze").textContent = "gaze: " + S.gaze.label;
  $("hudHead").textContent = "yaw " + num(S.head.yaw, 0) + "° · pitch " + num(S.head.pitch, 0) + "° · roll " + num(S.head.roll, 0) + "°";
  // motor
  var sc = S.scores;
  $("vMotor").textContent = (sc.motor || 0) + "%";
  var C = 326.7;
  $("ringMotor").style.strokeDashoffset = C - (C * (sc.motor || 0)) / 100;
  $("ringMotor").style.stroke = sc.motor >= 75 ? "#3dff9e" : sc.motor >= 50 ? "#38e1ff" : "#ff6b7a";
  setBar("bEye", "vEyeScore", sc.eye); setBar("bLip", "vLipScore", sc.lip);
  setBar("bSmile", "vSmileScore", sc.smile); setBar("bHead", "vHeadScore", sc.head);
  // eye
  $("vBlink").textContent = S.blink.lastType || "—";
  $("vBlinkDur").textContent = S.blink.lastDur ? S.blink.lastDur.toFixed(2) + "s" : "—";
  $("vBlinkRate").textContent = S.blinkRate !== undefined ? Math.round(S.blinkRate) + "/min" : "—";
  $("vEarL").textContent = num(S.earL); $("vEarR").textContent = num(S.earR);
  $("vEarDiff").textContent = num(Math.abs(S.earL - S.earR), 3);
  if (S.eyeCheck) {
    $("vEyeDbg").textContent = S.eyeCheck.phase === "open"
      ? ("CHECK: keep eyes OPEN… " + S.eyeCheck.open.length + " samples")
      : ("CHECK: CLOSE eyes now… " + S.eyeCheck.closed.length + " samples");
  } else $("vEyeDbg").textContent = !S.facePresent ? "no face"
    : (S.earHist.length < 45 ? ("learning open eye… " + S.earHist.length + "/45")
    : ("EAR " + num(S.earL, 2) + "/" + num(S.earR, 2)
      + " · close<" + num(S.eyeTh.close, 2) + " open>" + num(S.eyeTh.open, 2)
      + " · " + (S.blink.closed ? "CLOSED" : "open")
      + " · blinks " + S.blinkTotal));
  $("vGaze").textContent = S.gaze.label + " (" + num(S.gaze.x) + "," + num(S.gaze.y) + ")";
  // AU
  Object.keys(S.aus).forEach(function (k) {
    var visible = S.demo || (S.facePresent && !!activity.baseline && !S.auInvalid);
    $("au_" + k).textContent = visible ? S.aus[k] + "%" : "—";
    $("aub_" + k).style.width = visible ? S.aus[k] + "%" : "0%";
  });
  // smile
  var symVisible = S.demo || !!S.smile.valid;
  $("vSym").textContent = symVisible ? Math.round(S.smile.sym) + "%" : "—";
  $("ringSym").style.strokeDashoffset = C - (C * (symVisible ? S.smile.sym : 0)) / 100;
  $("vSmileInt").textContent = Math.round(S.smile.intensity * 100) + "%";
  $("vSmileL").textContent = num(S.smile.l, 3); $("vSmileR").textContent = num(S.smile.r, 3);
  $("vSymNote").textContent = S.smile.intensity <= 0.3 ? "neutral — smile to test"
    : !S.smile.valid ? "Smile seen; calibrate neutral face for a symmetry comparison"
    : S.smile.symLowHold >= 1.5 ? "Sustained uneven smile motion — check camera angle" : "Smile motion tracked";
  // lip
  $("vLipGesture").textContent = S.lip.gesture;
  $("vMar").textContent = num(S.mar); $("vPucker").textContent = Math.round(S.lip.pucker * 100) + "%";
  $("vLipInv").textContent = S.lip.invol;
  var devPct = Math.abs(S.lip.dev || 0) * 100;
  var devThrPct = (S.lip.devKind === "corner asymmetry" ? 0.04 : S.devThr) * 100;
  $("vDev").textContent = (S.facePresent || S.demo)
    ? (devPct >= devThrPct ? S.lip.devDir + " · " + S.lip.devKind + " " + devPct.toFixed(1) + "% · " + Math.round(S.lip.devHold) + "/60s" : "centered " + devPct.toFixed(1) + "%")
    : "—";
  var affTxt = "sad " + Math.round((S.affect.sad || 0) * 100) + "% · pain " + Math.round((S.affect.pain || 0) * 100) + "%";
  if (S.affect.painLatch) affTxt += " · PAIN ⚠";
  else if (S.affect.sadLatch) affTxt += " · SAD ⚠";
  else if (S.lip.devLatch) affTxt += " · DEV ⚠";
  $("vAffect").textContent = (S.facePresent || S.demo) ? affTxt : "—";
  // twitch
  $("vFlowEye").textContent = S.demo || $("tglFlow").checked ? num(S.flow.eye, 1) : "paused";
  $("vFlowLip").textContent = S.demo || $("tglFlow").checked ? num(S.flow.lip, 1) : "paused";
  $("vFlowCheek").textContent = S.demo || $("tglFlow").checked ? num(S.flow.cheek, 1) : "paused";
  $("vMotion").textContent = S.motion.state; $("vTremor").textContent = S.motion.tremor;
  // head
  $("vYaw").textContent = num(S.head.yaw, 1) + "°"; $("vPitch").textContent = num(S.head.pitch, 1) + "°"; $("vRoll").textContent = num(S.head.roll, 1) + "°";
  $("vPose").textContent = S.head.pose; $("vNod").textContent = S.head.nod;
  // command progress (guarded: rows re-render when detectors are remapped)
  var nowT = S.t || 0;
  function recent(arr, win) { return arr.filter(function (x) { return nowT - (x.t !== undefined ? x.t : x) <= win; }); }
  var iw = recent(S.intentSeq, 8);
  var lastCentered = !iw.length || iw[iw.length - 1].centered;
  setText("progWater", !S.waterArmed ? "locked — keep eyes open to re-arm"
    : (iw.length + "/3 intentional blinks" + (iw.length && !lastCentered ? " — look at camera" : "")));
  setText("progFood", recent(S.headTurns.left, 6).length + "/3 head-left turns");
  setText("progToilet", recent(S.headTurns.right, 6).length + "/3 head-right turns");
  setText("progOkay", "smile " + Math.round(S.smile.intensity * 100) + "%" + (S.head.nod !== "—" ? " + nod ✓" : ""));
  if (S.frame % 30 === 0) refreshFaceEval();
}
function setText(id, txt) {
  var el = $(id);
  if (el) el.textContent = txt;
}
function setBar(bid, vid, v) {
  $(bid).style.width = (v || 0) + "%";
  $(vid).textContent = (v || 0) + "%";
}
function detectNod(hist) {
  if (hist.length < 40) return false;
  var seg = hist.slice(-50), turns = 0;
  for (var i = 2; i < seg.length; i++) {
    var d1 = seg[i - 1] - seg[i - 2], d2 = seg[i] - seg[i - 1];
    if (d1 * d2 < 0 && Math.abs(d1) + Math.abs(d2) > 3) turns++;
  }
  return turns >= 3;
}

/* ---------------- FaceSpeak: trainable gesture→phrase studio ----------------
   Gesture rows (Rest protected + user rows) bind a live detector to a phrase.
   Recording stores steady feature snapshots; Train builds per-gesture
   prototypes against shared Rest. Only live verified events can be trained;
   untrained gestures never speak. */
var FACE_DETECTORS = ["rest", "blink3", "headL", "headR", "nodSmile", "smileHold"];
var FACE_DETECTOR_LABELS = {
  rest: "Rest (neutral)", blink3: "3× deliberate blink",
  headL: "3× head left + return", headR: "3× head right + return",
  nodSmile: "Nod + smile", smileHold: "Smile hold 1.5s",
};
var FACE_GUIDE_HINTS = {
  rest: "relax: neutral face, look at camera",
  blink3: "blink deliberately 3 times, then rest",
  headL: "turn head left + back, 3 times",
  headR: "turn head right + back, 3 times",
  nodSmile: "nod while smiling",
  smileHold: "hold a big smile",
};
// v2 deliberately does not import snapshots from the old timer-based capture.
var FACE_STORE_KEY = "neuroface_facespeak_v2";
var FACE_SCALES = { ear: 0.5, smile: 1, dev: 0.08, yaw: 45, mar: 0.8 };

function defaultFaceGestures() {
  return [
    { id: "rest", name: "Rest", detector: "rest", phrase: "", protected: true, samples: [], trained: null },
    { id: "water", name: "Water", detector: "blink3", phrase: "I need water", samples: [], trained: null },
    { id: "food", name: "Food", detector: "headL", phrase: "I need food", samples: [], trained: null },
    { id: "toilet", name: "Toilet", detector: "headR", phrase: "I need to go to toilet", samples: [], trained: null },
    { id: "okay", name: "Okay", detector: "nodSmile", phrase: "I am okay, thank you", samples: [], trained: null },
    { id: "yes", name: "Yes", detector: "smileHold", phrase: "Yes.", samples: [], trained: null },
  ];
}
function findFaceGesture(gid) {
  for (var i = 0; i < S.faceGestures.length; i++) {
    if (S.faceGestures[i].id === gid) return S.faceGestures[i];
  }
  return null;
}
function faceGestureFor(detector) {
  for (var i = 0; i < S.faceGestures.length; i++) {
    if (S.faceGestures[i].detector === detector) return S.faceGestures[i];
  }
  return null;
}
function persistFaceSpeak() {
  try {
    localStorage.setItem(FACE_STORE_KEY, JSON.stringify({
      gestures: S.faceGestures.map(function (g) {
        return { id: g.id, name: g.name, detector: g.detector, phrase: g.phrase, samples: (g.samples || []).slice(-6), trained: g.trained || null };
      }),
      rest: (S.faceRest || []).slice(-12),
    }));
  } catch (e) {}
}
function loadFaceSpeak() {
  S.faceGestures = defaultFaceGestures();
  S.faceRest = [];
  S.faceStats = {};
  S.guide = null;
  try {
    var raw = localStorage.getItem(FACE_STORE_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.gestures)) {
      var byId = {};
      S.faceGestures.forEach(function (g) { byId[g.id] = g; });
      saved.gestures.forEach(function (sg) {
        if (!sg || typeof sg.id !== "string" || sg.id === "emergency" || sg.detector === "eyesShut") return;
        var g = byId[sg.id];
        if (g) {
          if (g.id !== "rest") {
            if (typeof sg.name === "string" && sg.name) g.name = sg.name.slice(0, 40);
            if (FACE_DETECTORS.indexOf(sg.detector) >= 0) g.detector = sg.detector;
            if (typeof sg.phrase === "string") g.phrase = sg.phrase.slice(0, 120);
          }
          if (sg.trained && sg.trained.verified === true && Array.isArray(sg.samples)) g.samples = sg.samples.filter(Array.isArray).slice(-6);
          g.trained = sg.trained && sg.trained.verified === true ? sg.trained : null;
        } else if (S.faceGestures.length < 12 && FACE_DETECTORS.indexOf(sg.detector) >= 0) {
          S.faceGestures.push({
            id: sg.id.slice(0, 24), name: String(sg.name || "Custom").slice(0, 40),
            detector: sg.detector, phrase: String(sg.phrase || "").slice(0, 120),
            samples: sg.trained && sg.trained.verified === true && Array.isArray(sg.samples) ? sg.samples.filter(Array.isArray).slice(-6) : [], trained: sg.trained && sg.trained.verified === true ? sg.trained : null,
          });
        }
      });
    }
    if (saved && Array.isArray(saved.rest)) S.faceRest = saved.rest.filter(Array.isArray).slice(-12);
  } catch (e) {}
}
function faceSnapshotNorm() {
  return [
    ((S.earL + S.earR) / 2) / FACE_SCALES.ear,
    S.smile.intensity / FACE_SCALES.smile,
    Math.abs(S.lip.dev || 0) / FACE_SCALES.dev,
    Math.abs(S.head.yaw) / FACE_SCALES.yaw,
    S.mar / FACE_SCALES.mar,
  ];
}
function faceVecMean(vecs) {
  var n = Math.max(1, vecs.length), out = [0, 0, 0, 0, 0], i, j;
  for (i = 0; i < vecs.length; i++) {
    for (j = 0; j < 5; j++) out[j] += (Number(vecs[i][j]) || 0);
  }
  for (j = 0; j < 5; j++) out[j] /= n;
  return out;
}
function faceDist(a, b) {
  var s = 0;
  for (var j = 0; j < 5; j++) { var d = a[j] - b[j]; s += d * d; }
  return Math.sqrt(s);
}
function faceMatchMargin(detector) {
  var g = faceGestureFor(detector);
  if (!g || !g.trained || !g.trained.active || !g.trained.rest) return null;
  var live = faceSnapshotNorm();
  return faceDist(live, g.trained.rest) - faceDist(live, g.trained.active);
}
function faceStat(gid) {
  if (!S.faceStats[gid]) S.faceStats[gid] = { fires: 0, lastMargin: null };
  return S.faceStats[gid];
}
function faceDispatch(detector) {
  if (S.guide) {
    var target = findFaceGesture(S.guide.queue[S.guide.idx]);
    if (target && target.detector === detector && S.running && !S.demo && S.facePresent) {
      target.samples.push(faceSnapshotNorm());
      if (target.samples.length > 6) target.samples.shift();
      target.trained = null;
      S.guide.count++;
      persistFaceSpeak();
      faceGuideAdvance();
    }
    return; // calibration cannot speak or issue a command
  }
  if (!$("tglComm").checked) return;
  var g = faceGestureFor(detector);
  if (!g || !g.trained || g.trained.verified !== true) return;
  var phrase = g.phrase;
  var gid = g.id;
  if (!phrase) { throttledLog("FaceSpeak: no phrase set for " + detector, "fs-nophrase-" + detector, 15000); return; }
  var now = performance.now() / 1000;
  if (now - (S.cmdCooldowns[gid] || -10) < 5) return;
  var margin = faceMatchMargin(detector);
  var st = faceStat(gid);
  st.lastMargin = margin;
  // Dynamic events (especially a blink) end at neutral, so a still-frame
  // prototype margin is not a valid gate. Detector completion is the gate.
  S.cmdCooldowns[gid] = now;
  st.fires++;
  setFaceSpeakStatus((g ? g.name : detector) + " → " + phrase);
  showCommand(phrase, gid);
  addLog("FaceSpeak [" + (g ? g.name : detector) + "]: " + phrase, "info");
  refreshFaceEval();
}
function setFaceSpeakStatus(text) {
  var el = $("faceSpeakStatus");
  if (el) el.textContent = text;
}
function faceRecord(gid, isRest) {
  if (!S.running || S.demo || !S.facePresent) {
    addLog("FaceSpeak record needs the live camera with your face tracked.", "info");
    return;
  }
  if (isRest) {
    if (!faceRestIsNeutral()) { setFaceGuidePrompt("Relax your face, open your eyes and face the camera before recording Rest."); return; }
    S.faceRest.push(faceSnapshotNorm());
    if (S.faceRest.length > 12) S.faceRest.shift();
  } else {
    var g = findFaceGesture(gid);
    if (!g || g.id === "rest") return;
    startFaceGuide([gid]);
    return;
  }
  persistFaceSpeak(); renderFaceTable(); refreshFaceEval();
}
function faceTrainAll() {
  if ((S.faceRest || []).length < 3) {
    setFaceGuidePrompt("Record 3 verified Rest samples first.");
    return;
  }
  var restProto = faceVecMean(S.faceRest);
  var trained = 0;
  S.faceGestures.forEach(function (g) {
    if (g.id === "rest") return;
    if ((g.samples || []).length >= 3) {
      g.trained = { active: faceVecMean(g.samples), rest: restProto, verified: true };
      trained++;
    }
  });
  persistFaceSpeak(); renderFaceTable(); refreshFaceEval();
  setFaceGuidePrompt(trained ? "Calibrated " + trained + " live gesture(s). Open Speak mode to use them." : "No gestures have 3 verified events yet. Follow the prompts and retry.");
  addLog("FaceSpeak: trained " + trained + " gesture(s) against " + S.faceRest.length + " rest samples.", "info");
}
function stopFaceGuide(msg) {
  if (S.guide && S.guide.timer) clearInterval(S.guide.timer);
  S.guide = null;
  var btn = $("btnFaceGuide");
  if (btn) btn.textContent = "▶ Start guided calibration";
  renderFaceTable();
  if (msg) addLog(msg, "info");
}
function setFaceGuidePrompt(message) {
  var prompt = $("faceGuidePrompt");
  if (prompt) prompt.textContent = message;
}
function faceRestIsNeutral() {
  return S.facePresent && S.earL > S.eyeTh.open && S.earR > S.eyeTh.open
    && S.smile.intensity < 0.25 && Math.abs(S.head.yaw) < 10
    && Math.abs(S.head.pitch) < 22 && S.mar < 0.25;
}
function faceGuideInstruction() {
  if (!S.guide) return;
  var gid = S.guide.queue[S.guide.idx];
  var g = findFaceGesture(gid);
  var hint = gid === "rest" ? "relax your face and look at the camera" : FACE_GUIDE_HINTS[g && g.detector] || "perform the movement";
  var message = "Step " + (S.guide.idx + 1) + "/" + S.guide.queue.length + " · "
    + (g ? g.name : "Rest") + ": " + hint + ". Verified samples " + S.guide.count + "/3.";
  setFaceGuidePrompt(message);
  renderFaceTable();
  if (S.guide.count === 0 && $("tglVoice").checked && window.speechSynthesis) {
    try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(message)); } catch (e) {}
  }
}
function faceGuideAdvance() {
  if (!S.guide) return;
  if (S.guide.count >= 3) {
    S.guide.idx++;
    S.guide.count = 0;
    if (S.guide.idx >= S.guide.queue.length) {
      stopFaceGuide("Guided calibration captured verified live movements.");
      faceTrainAll();
      return;
    }
  }
  faceGuideInstruction();
  refreshFaceEval();
}
function startFaceGuide(queue) {
  if (!S.running || S.demo || !S.facePresent) {
    setFaceGuidePrompt("Start the live camera and wait until your face is tracked. Demo Mode cannot calibrate.");
    return;
  }
  if (S.guide) stopFaceGuide();
  if (queue.indexOf("rest") >= 0) S.faceRest = [];
  queue.forEach(function (gid) {
    var g = findFaceGesture(gid);
    if (g && gid !== "rest") { g.samples = []; g.trained = null; }
  });
  S.guide = { queue: queue, idx: 0, count: 0, timer: null };
  $("btnFaceGuide").textContent = "⏹ Stop guided calibration";
  faceGuideInstruction();
  S.guide.timer = setInterval(faceGuideTick, 1200);
  persistFaceSpeak();
}
function faceGuided() {
  if (S.guide) { stopFaceGuide("Guided calibration stopped."); setFaceGuidePrompt("Calibration stopped. Start again when ready."); return; }
  var seen = {};
  var queue = ["rest"].concat(S.faceGestures.filter(function (g) {
    if (g.id === "rest" || !g.phrase || seen[g.detector]) return false;
    seen[g.detector] = true;
    return true;
  }).map(function (g) { return g.id; }));
  startFaceGuide(queue);
}
function faceGuideTick() {
  var G = S.guide;
  if (!G) return;
  if (!S.running || S.demo || !S.facePresent) { setFaceGuidePrompt("Tracking paused. Return to the live camera; no sample is being saved."); return; }
  if (G.queue[G.idx] !== "rest") return; // movement steps wait for detector completion
  if (!faceRestIsNeutral()) { setFaceGuidePrompt("Rest: open your eyes, relax your mouth and face the camera. No sample saved yet."); return; }
  S.faceRest.push(faceSnapshotNorm());
  if (S.faceRest.length > 12) S.faceRest.shift();
  G.count++;
  persistFaceSpeak();
  faceGuideAdvance();
}
function detectorOptions(selected) {
  return FACE_DETECTORS.filter(function (d) { return d !== "rest" || selected === "rest"; }).map(function (d) {
    return '<option value="' + d + '"' + (d === selected ? " selected" : "") + ">" + FACE_DETECTOR_LABELS[d] + "</option>";
  }).join("");
}
function renderFaceTable() {
  var box = $("faceGestureTable");
  if (!box || !S.faceGestures) return;
  var guideId = S.guide ? S.guide.queue[S.guide.idx] : null;
  box.innerHTML = S.faceGestures.map(function (g) {
    var isRest = g.id === "rest";
    var prog = "<i>" + (isRest ? (S.faceRest || []).length : (g.samples || []).length) + "/3 verified</i>";
    return '<div class="fg-row' + (guideId === g.id ? " guiding" : "") + '" data-gid="' + esc(g.id) + '">'
      + '<label>Gesture<input data-f="name" value="' + esc(g.name) + '"' + (isRest ? " disabled" : "") + "></label>"
      + '<label>Detector<select data-f="detector"' + (isRest ? " disabled" : "") + ">" + detectorOptions(g.detector) + "</select></label>"
      + '<label>Says<input data-f="phrase" value="' + esc(g.phrase) + '" placeholder="—"' + (isRest ? " disabled" : "") + "></label>"
      + '<span class="fg-samples">' + prog + "</span>"
      + '<button class="btn small ghost" data-act="record">' + (isRest ? "Record Rest" : "Capture 3×") + '</button>'
      + (isRest ? '<span class="badge-protected">protected</span>' : '<button class="btn small ghost" data-act="del" aria-label="Delete">×</button>')
      + "</div>";
  }).join("");
}
function refreshFaceEval() {
  var box = $("faceEvalTable");
  if (!box || !S.faceGestures) return;
  box.innerHTML = S.faceGestures.map(function (g) {
    var st = faceStat(g.id);
    var margin = st.lastMargin === null || st.lastMargin === undefined ? "—" : st.lastMargin.toFixed(2);
    return '<div class="fg-row eval"><span><b>' + esc(g.name) + "</b><small>" + esc(FACE_DETECTOR_LABELS[g.detector] || g.detector) + "</small></span>"
      + "<span>samples " + (g.id === "rest" ? (S.faceRest || []).length : (g.samples || []).length) + "</span>"
      + "<span>" + (g.id === "rest" ? "reference" : (g.trained ? "trained ✓" : "untrained")) + "</span>"
      + "<span>fires " + st.fires + "</span>"
      + "<span>margin " + margin + "</span></div>";
  }).join("");
}
function showFaceTab(name) {
  ["calibrate", "speak", "evaluate", "log"].forEach(function (t) {
    var pane = $("faceTab-" + t);
    if (pane) pane.hidden = t !== name;
  });
  var tabs = document.querySelectorAll ? document.querySelectorAll(".face-tab") : [];
  for (var i = 0; i < tabs.length; i++) {
    var active = tabs[i].getAttribute("data-ftab") === name;
    if (active) tabs[i].classList.add("active");
    else tabs[i].classList.remove("active");
  }
}
function showCommand(cmd, kind) {
  $("cmdDisplay").textContent = cmd;
  var el = document.createElement("div");
  el.className = "log-item info"; el.textContent = fmtT() + "  [" + kind + "] → " + cmd;
  var box = $("cmdLog"); box.prepend(el);
  while (box.children.length > 20) box.lastChild.remove();
  if ($("tglVoice").checked && window.speechSynthesis) {
    try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(cmd)); } catch (e) {}
  }
}
function commTick(t) {
  if (!$("tglComm").checked) return;
  // Nod-then-smile order: nod fired first, smile arrives within 2.5 s.
  if (S.lastNodT > 0 && t - S.lastNodT < 2.5 && S.smile.intensity > S.smileThr && S.okayFiredNod < S.lastNodT) {
    S.okayFiredNod = S.lastNodT;
    faceDispatch("nodSmile");
  }
}

/* ---------------- calibration (13 steps) ---------------- */
var CAL_STEPS = [
  "Neutral face: relax, look at camera", "Normal blink: blink naturally", "Slow blink: close slowly, open slowly",
  "Rapid blink: blink fast 3 times", "Intentional blink: long deliberate blink", "Smile: big natural smile",
  "Lip close: press lips together", "Lip open: open mouth wide", "Look left: eyes only",
  "Look right: eyes only", "Look up", "Look down", "Nod: nod yes twice",
];
function openCal() { $("calModal").classList.remove("hidden"); renderCal(); refreshTwin(); }
function closeCal() { $("calModal").classList.add("hidden"); S.cal.collecting = false; }
function renderCal() {
  $("calStep").textContent = S.cal.step < CAL_STEPS.length
    ? "Step " + (S.cal.step + 1) + "/" + CAL_STEPS.length + " — " + CAL_STEPS[S.cal.step] + (S.cal.collecting ? "  ● recording…" : "")
    : "Done ✓ — Digital Twin updated.";
  $("calBar").style.width = (S.cal.step / CAL_STEPS.length * 100) + "%";
}
function captureCalFrame(f) {
  S.cal.frames.push(f);
  if (S.cal.frames.length >= 60) finishCalStep(); // ~2 s @30fps
}
function finishCalStep() {
  var F = S.cal.frames; S.cal.frames = []; S.cal.collecting = false;
  function avg(k) { return F.reduce(function (s, x) { return s + x[k]; }, 0) / Math.max(1, F.length); }
  S.cal.data = S.cal.data || {};
  S.cal.data["step" + S.cal.step] = {
    label: CAL_STEPS[S.cal.step], ear: avg("earAvg"), mar: avg("mar"), sm: avg("sm"), sym: avg("sym"),
    n: F.length, at: new Date().toISOString(),
  };
  // rolling neutral from step 0
  if (S.cal.step === 0 && window.__lastLmForTwin) {
    S.cal.data.neutralFace = true;
  }
  S.cal.step++;
  if (S.cal.step >= CAL_STEPS.length) buildTwin();
  renderCal();
}
function buildTwin() {
  var d = S.cal.data || {};
  var s0 = d.step0 || { ear: 0.26, mar: 0.18, sm: 0, sym: 95 };
  S.twin = {
    neutral: {
      earMean: s0.ear, mouthW: (window.__twinMouthW || 0.12), browGap: (window.__twinBrowGap || 0.05),
      dev0: (window.__twinDev0 || 0),
      cornerLX: window.__twinCLX, cornerLY: window.__twinCLY, cornerRX: window.__twinCRX, cornerRY: window.__twinCRY,
      head: window.__twinHead || { yaw: 0, pitch: 0, roll: 0 },
    },
    steps: d, savedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(TWIN_KEY, JSON.stringify(S.twin)); } catch (e) {}
  addLog("Digital Twin saved — scores now personalized to patient baseline.", "info");
  refreshTwin();
}
function refreshTwin() {
  $("twinStatus").innerHTML = S.twin
    ? '<span class="dot ok"></span> twin: saved ' + new Date(S.twin.savedAt).toLocaleString()
    : '<span class="dot idle"></span> twin: none — using population defaults';
}
// stash neutral geometry mid step-0 (latched: the exact frame-30 check races mesh rate)
setInterval(function () {
  if (S.cal.collecting && S.lastLm && S.cal.step === 0 && !window.__twinCaptured && S.cal.frames.length >= 25) {
    window.__twinCaptured = true;
    try {
      var lm = S.lastLm, M = window.NF_metrics;
      window.__twinMouthW = M.mouthWidth(lm);
      window.__twinBrowGap = ((lm[133].y - lm[105].y) + (lm[362].y - lm[334].y)) / 2;
      window.__twinCLX = lm[61].x; window.__twinCLY = lm[61].y;
      window.__twinCRX = lm[291].x; window.__twinCRY = lm[291].y;
      var hp = M.headPose(lm); window.__twinHead = hp;
      var mCx = (lm[61].x + lm[291].x) / 2;
      window.__twinDev0 = (mCx - lm[1].x) / Math.max(1e-6, M.dist(lm[234], lm[454]));
      window.__lastLmForTwin = true;
    } catch (e) {}
  }
}, 100);

/* ---------------- snapshot / export ---------------- */
function snapshot() {
  try {
    var c = document.createElement("canvas");
    c.width = overlay.width; c.height = overlay.height;
    var x = c.getContext("2d");
    if (!S.demo && video.videoWidth) {
      var vw = video.videoWidth, vh = video.videoHeight;
      var sc = Math.min(c.width / vw, c.height / vh);
      var dw = vw * sc, dh = vh * sc, dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      x.fillStyle = "#02040a"; x.fillRect(0, 0, c.width, c.height);
      x.save(); x.translate(c.width, 0); x.scale(-1, 1);
      x.drawImage(video, dx, dy, dw, dh);
      x.restore();
    } else { x.fillStyle = "#0b1226"; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(overlay, 0, 0);
    var a = document.createElement("a");
    a.download = "neuroface-" + Date.now() + ".png"; a.href = c.toDataURL("image/png"); a.click();
  } catch (e) {}
}
function exportLog() {
  var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), twin: !!S.twin, events: S.log }, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "neuroface-log.json"; a.click();
}

/* ---------------- Maira cloud AI (premium second opinion, opt-in) ---------------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function setMairaStatus(text, cls) {
  $("mairaStatus").innerHTML = '<span class="dot ' + (cls || "idle") + '"></span> ' + esc(text);
}
function refreshMairaStatus() {
  var cfg = window.NF_maira.loadSettings();
  setMairaStatus(
    window.NF_maira.configured(cfg) ? "ready — keys stored locally" : "local only — add keys to unlock",
    window.NF_maira.configured(cfg) ? "ok" : "idle",
  );
}
function sessionDigest() {
  function r(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; }
  return {
    app: "neuroface-sense",
    research_demo_only: true,
    session_seconds: Math.round((Date.now() - S.sessionStart) / 1000),
    face_tracked: !!S.facePresent,
    tracking_confidence: r(S.conf),
    motor_scores: S.scores,
    eyes: {
      ear_l: r(S.earL), ear_r: r(S.earR),
      blink_status: S.blink.lastType, blink_last_duration_s: r(S.blink.lastDur),
      blink_total: S.blinkTotal, blink_rate_per_min: Math.round(S.blinkRate || 0),
    },
    gaze: S.gaze.label,
    muscle_au_percent: S.aus,
    smile: { intensity_pct: Math.round(S.smile.intensity * 100), symmetry_pct: Math.round(S.smile.sym), threshold_pct: Math.round(S.smileThr * 100) },
    lips: { gesture: S.lip.gesture, involuntary: S.lip.invol, deviation: S.lip.devDir + " " + r(S.lip.dev) + " held " + Math.round(S.lip.devHold) + "s", deviation_threshold: r(S.devThr) },
    motion: { state: S.motion.state, tremor_band: S.motion.tremor },
    head: { yaw_deg: r(S.head.yaw), pitch_deg: r(S.head.pitch), roll_deg: r(S.head.roll), pose: S.head.pose, nod: S.head.nod },
    affect: {
      sad_pct: Math.round((S.affect.sad || 0) * 100), pain_pct: Math.round((S.affect.pain || 0) * 100),
      flags: [S.affect.sadLatch && "sad", S.affect.painLatch && "pain", S.lip.devLatch && "deviation"].filter(Boolean),
    },
    temporal_ai: { label: S.temporal.label, confidence: r(S.temporal.conf) },
    calibrated_twin: !!S.twin,
    recent_events: S.log.slice(0, 12).map(function (e) { return e.t + " " + e.msg; }),
  };
}
function renderMaira(res) {
  var box = $("mairaResult");
  if (!res.ok) {
    box.innerHTML = '<div class="maira-err">Maira unavailable: ' + esc(res.error) + ' — local pipeline unaffected.</div>';
    return;
  }
  var p = res.parsed, html = "";
  if (p && (p.refined_assessment || p.key_findings)) {
    html += "<b>Premium assessment</b><br>" + esc(p.refined_assessment || "") + "<br>";
    if (Array.isArray(p.key_findings)) html += "<br><b>Key findings</b><br>• " + p.key_findings.map(esc).join("<br>• ");
    if (Array.isArray(p.suggested_focus)) html += "<br><br><b>Suggested focus</b><br>• " + p.suggested_focus.map(esc).join("<br>• ");
    if (p.confidence !== undefined || p.needs_attention !== undefined) {
      html += "<br><br><b>Confidence</b> " + esc(p.confidence) + (p.needs_attention ? " · ⚠ needs attention" : "");
    }
  } else if (p && (p.eyes || p.mouth || p.visible_symmetry)) {
    html += "<b>Vision second opinion</b><br>"
      + "eyes: " + esc(p.eyes) + "<br>mouth: " + esc(p.mouth)
      + "<br>symmetry: " + esc(p.visible_symmetry) + "<br>confidence: " + esc(p.confidence);
    if (Array.isArray(p.notable_observations)) html += "<br>• " + p.notable_observations.map(esc).join("<br>• ");
  } else {
    html = esc(res.answer || "(empty response)");
  }
  box.innerHTML = '<div class="maira-answer">' + html + '<br><br><small>Research second opinion — not a diagnosis.</small></div>';
}
function captureFaceDataUrl() {
  try {
    var c = document.createElement("canvas");
    c.width = overlay.width || 640; c.height = overlay.height || 360;
    var x = c.getContext("2d");
    if (!S.demo && video.videoWidth) {
      var vw = video.videoWidth, vh = video.videoHeight;
      var sc = Math.min(c.width / vw, c.height / vh);
      var dw = vw * sc, dh = vh * sc, dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      x.fillStyle = "#02040a"; x.fillRect(0, 0, c.width, c.height);
      x.save(); x.translate(c.width, 0); x.scale(-1, 1);
      x.drawImage(video, dx, dy, dw, dh);
      x.restore();
    } else { x.fillStyle = "#0b1226"; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(overlay, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
  } catch (e) { return null; }
}
function mairaBoot() {
  var cfg = window.NF_maira.loadSettings();
  $("mairaBase").value = cfg.baseUrl || "";
  $("mairaUser").value = cfg.userId || "";
  $("mairaProject").value = cfg.projectKey || "";
  $("mairaKey").value = cfg.apiKey || "";
  $("mairaBearer").value = cfg.bearer || "";
  $("mairaProfile").value = cfg.gptProfileId || "";
  refreshMairaStatus();
}

/* ---------------- wire up ---------------- */
$("btnCamera").onclick = function () { S.running && !S.demo ? stopCamera() : startCamera(); };
$("btnDemo").onclick = startDemo;
$("btnCalibrate").onclick = function () {
  showFaceTab("calibrate");
  $("facespeak").scrollIntoView({ behavior: "smooth", block: "start" });
  if (!S.running || S.demo || !S.facePresent) {
    S.autoGuidePending = true;
    setFaceGuidePrompt("Starting the live camera. Guided calibration begins when your face is tracked.");
    if (S.demo) stopCamera();
    if (!S.running) startCamera();
  } else if (!S.guide) {
    faceGuided();
  }
};
$("btnCalClose").onclick = closeCal;
$("btnCalNext").onclick = function () {
  if (S.cal.step >= CAL_STEPS.length) return;
  if (!S.facePresent && !S.demo) { addLog("No face — start camera or demo before capturing.", "info"); return; }
  if (S.cal.step === 0) activity.reset();
  S.cal.frames = []; S.cal.collecting = true; S.cal.active = true;
  renderCal();
  setTimeout(function () { if (S.cal.collecting) finishCalStep(); }, 6000); // safety
};
$("btnCalSkip").onclick = function () { S.cal.frames = []; S.cal.collecting = false; S.cal.step++; renderCal(); };
$("btnCalReset").onclick = function () {
  try { localStorage.removeItem(TWIN_KEY); } catch (e) {}
  window.__twinCaptured = false;
  S.twin = null; S.cal = { active: false, step: 0, frames: [], collecting: false }; activity.reset(); refreshTwin(); renderCal();
};
$("btnAuReset").onclick = function () {
  activity.reset();
  $("auStatus").textContent = S.running && !S.demo
    ? "Learning neutral activity baseline — relax your face for about 2 seconds."
    : "Start the camera, then hold a relaxed face to learn the neutral reference.";
  updateHud();
  addLog("Muscle activity neutral reference reset. Hold a relaxed face until the panel says ready.", "info");
};
$("btnSnapshot").onclick = snapshot;
$("btnExport").onclick = exportLog;
$("btnClearLog").onclick = function () { $("logList").innerHTML = '<div class="log-empty">No events yet.</div>'; S.log = []; };
$("btnTestBlink").onclick = function () {
  if (!S.running || S.demo || !S.facePresent) {
    addLog("Test blink needs the live camera with your face tracked.", "info");
    return;
  }
  var before = S.blinkTotal;
  S.testBlinkUntil = performance.now() / 1000 + 0.3;
  addLog("Test blink injected (0.3s dip through the real detector)…", "info");
  setTimeout(function () {
    if (S.blinkTotal > before) addLog("Test blink COUNTED — detector logic is healthy; the issue is the live lid signal. Run the eye check.", "info");
    else addLog("Test blink NOT counted — detector fault. Copy the Signal debug line to me.", "info");
  }, 1500);
};
$("btnEyeCheck").onclick = function () {
  if (!S.running || S.demo || !S.facePresent) {
    addLog("Eye check needs the live camera with your face tracked.", "info");
    return;
  }
  S.eyeCheck = { phase: "open", t0: performance.now() / 1000, open: [], closed: [] };
  addLog("Eye check started: keep your eyes OPEN and still…", "info");
};
$("btnTestDev").onclick = function () {
  var now = performance.now() / 1000;
  S.test = S.test || {};
  S.test.dev = true; S.test.devVal = 0.06; S.test.devUntil = now + 75;
  lipWatch.duration = Math.max(lipWatch.duration, 50);
  S.lip.devHold = lipWatch.duration;
  addLog("Test: forcing rightward lip deviation — detector should fire in ~10s (60s rule pre-loaded).", "info");
};
$("btnTestSad").onclick = function () {
  var now = performance.now() / 1000;
  S.test = S.test || {};
  S.test.sad = true; S.test.sadVal = 0.75; S.test.sadUntil = now + 20;
  S.affect.sadHold = Math.max(S.affect.sadHold || 0, 6);
  addLog("Test: forcing sad-like affect — fires in ~4s (10s rule pre-loaded).", "info");
};
$("btnTestPain").onclick = function () {
  var now = performance.now() / 1000;
  S.test = S.test || {};
  S.test.pain = true; S.test.painVal = 0.8; S.test.painUntil = now + 15;
  S.affect.painHold = Math.max(S.affect.painHold || 0, 5);
  addLog("Test: forcing pain-like affect — fires in ~3s (8s rule pre-loaded).", "info");
};
$("btnSmileCheck").onclick = function () {
  if (!S.running || S.demo || !S.facePresent) {
    addLog("Smile check needs the live camera with your face tracked.", "info");
    return;
  }
  S.smileCheck = { phase: "neutral", t0: performance.now() / 1000, base: [], peak: [] };
  addLog("Smile check started: relaxed mouth, stay still…", "info");
};
$("btnDevCheck").onclick = function () {
  if (!S.running || S.demo || !S.facePresent) {
    addLog("Deviation check needs the live camera with your face tracked.", "info");
    return;
  }
  S.devCheck = { phase: "neutral", t0: performance.now() / 1000, base: [], peak: [] };
  addLog("Deviation check started: relaxed mouth, stay still…", "info");
};
window.addEventListener("resize", sizeCanvas);
window.addEventListener("pagehide", stopCamera);

function wireFaceStudio() {
  var tabs = document.querySelectorAll(".face-tab");
  for (var i = 0; i < tabs.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () { showFaceTab(btn.getAttribute("data-ftab")); });
    })(tabs[i]);
  }
  var table = $("faceGestureTable");
  if (table) {
    table.addEventListener("change", function (ev) {
      var row = ev.target && ev.target.closest ? ev.target.closest("[data-gid]") : null;
      if (!row || !ev.target.getAttribute("data-f")) return;
      var g = findFaceGesture(row.getAttribute("data-gid"));
      if (!g || g.id === "rest") return;
      var field = ev.target.getAttribute("data-f");
      if (field === "name") g.name = String(ev.target.value || "Custom").slice(0, 40);
      else if (field === "phrase") g.phrase = String(ev.target.value || "").slice(0, 120);
      else if (field === "detector" && FACE_DETECTORS.indexOf(ev.target.value) >= 0) {
        if (S.faceGestures.some(function (other) { return other.id !== g.id && other.detector === ev.target.value; })) {
          setFaceGuidePrompt("That detector is already assigned. Edit its existing phrase, or choose an unused detector.");
        } else if (g.detector !== ev.target.value) { g.detector = ev.target.value; g.samples = []; g.trained = null; }
      }
      persistFaceSpeak(); renderFaceTable(); refreshFaceEval();
    });
    table.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!btn) return;
      var row = btn.closest("[data-gid]");
      if (!row) return;
      var gid = row.getAttribute("data-gid");
      if (btn.getAttribute("data-act") === "record") {
        faceRecord(gid, gid === "rest");
      } else if (gid !== "rest") {
        S.faceGestures = S.faceGestures.filter(function (g) { return g.id !== gid; });
        persistFaceSpeak(); renderFaceTable(); refreshFaceEval();
      }
    });
  }
  var add = $("btnFaceAdd");
  if (add) add.addEventListener("click", function () {
    if (S.faceGestures.length >= 12) { addLog("FaceSpeak: gesture table is full (12).", "info"); return; }
    var n = 1;
    while (findFaceGesture("custom" + n)) n++;
    S.faceGestures.push({ id: "custom" + n, name: "Custom " + n, detector: "smileHold", phrase: "", samples: [], trained: null });
    persistFaceSpeak(); renderFaceTable(); refreshFaceEval();
  });
  var guide = $("btnFaceGuide");
  if (guide) guide.addEventListener("click", faceGuided);
  var train = $("btnFaceTrain");
  if (train) train.addEventListener("click", faceTrainAll);
}

/* ---------------- boot ---------------- */
refreshTwin();
initModelStatus();
listCameras();
loadFaceSpeak();
updateHud();
renderFaceTable();
showFaceTab("calibrate");
wireFaceStudio();
addLog("NeuroFace Sense ready. Start camera or Demo Mode. Research demo — not a medical device.", "info");
})();
