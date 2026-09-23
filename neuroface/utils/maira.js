/* NeuroFace Sense — Maira (Gigalogy) cloud AI layer for premium precision.
 *
 * Local pipeline = real-time screening (always on, fully offline).
 * Maira cloud   = deep reasoning over session aggregates + vision second
 * opinion (manual, opt-in, fail-soft — local features never depend on it).
 *
 * SECURITY: no keys in code, ever. Credentials live ONLY in the browser's
 * localStorage (user-typed in the Maira card) and go only to the configured
 * base URL. If a key was ever pasted anywhere else, rotate it first.
 */
(function () {
  var STORE_KEY = "neuroface_maira_v1";
  var DEFAULT_BASE = "https://api.recommender.gigalogy.com";

  function loadSettings() {
    var fallback = { baseUrl: DEFAULT_BASE, userId: "", projectKey: "", apiKey: "", bearer: "", gptProfileId: "" };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw) || {};
      Object.keys(fallback).forEach(function (k) {
        if (typeof parsed[k] === "string") fallback[k] = parsed[k];
      });
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveSettings(s) {
    var clean = {
      baseUrl: String(s.baseUrl || DEFAULT_BASE).replace(/\/$/, ""),
      userId: String(s.userId || ""),
      projectKey: String(s.projectKey || ""),
      apiKey: String(s.apiKey || ""),
      bearer: String(s.bearer || ""),
      gptProfileId: String(s.gptProfileId || ""),
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(clean)); } catch (e) {}
    return clean;
  }

  function clearSettings() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    return loadSettings();
  }

  function configured(s) {
    var cfg = s || loadSettings();
    return Boolean(cfg.userId && (cfg.bearer || cfg.apiKey));
  }

  function headersFor(cfg) {
    var headers = { "Content-Type": "application/json" };
    if (cfg.bearer) headers.Authorization = "Bearer " + cfg.bearer;
    if (cfg.projectKey) headers["project-key"] = cfg.projectKey;
    if (cfg.apiKey) headers["api-key"] = cfg.apiKey;
    return headers;
  }

  function withTimeout(ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return { signal: ctrl.signal, done: function () { clearTimeout(timer); } };
  }

  function asText(value) {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }

  // Success envelope is {detail: {...}} — hunt for the answer string inside.
  function extractAnswer(payload) {
    if (!payload) return "";
    var detail = payload.detail !== undefined ? payload.detail : payload;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      var keys = ["answer", "response", "result", "text", "message", "output", "content", "summary"];
      for (var i = 0; i < keys.length; i++) {
        if (typeof detail[keys[i]] === "string" && detail[keys[i]]) return detail[keys[i]];
      }
      return JSON.stringify(detail, null, 2);
    }
    return asText(payload);
  }

  function tryParseJson(text) {
    if (!text || typeof text !== "string") return null;
    var candidate = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      var parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
      return null;
    } catch (e) {
      var start = candidate.indexOf("{");
      var end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          var inner = JSON.parse(candidate.slice(start, end + 1));
          if (inner && typeof inner === "object") return inner;
        } catch (ignored) {}
      }
      return null;
    }
  }

  function buildDigestQuery(digest) {
    var summary = JSON.stringify(digest, null, 1);
    return [
      "You are a biomedical signal-analysis assistant supporting stroke-rehabilitation research.",
      "This is a RESEARCH DEMO, not a medical diagnosis. Never diagnose; describe movement patterns only.",
      "Below is LOCAL_SESSION_SUMMARY: real-time facial-motor metrics from an on-device MediaPipe + TensorFlow.js pipeline",
      "(EAR blink stats, gaze, facial action units, smile symmetry, lip control, head pose, micro-twitch flow, affect scores, recent events).",
      "Task: give a PREMIUM second-opinion assessment. Refine and cross-check the local findings.",
      "Respond with JSON ONLY, exactly these keys:",
      '{"refined_assessment": string (2-4 sentences), "key_findings": string[3-6],',
      ' "suggested_focus": string[2-4] (which facial region/exercise to watch next),',
      ' "confidence": number 0-1, "needs_attention": boolean}',
      "LOCAL_SESSION_SUMMARY:",
      summary,
    ].join("\n");
  }

  function buildVisionQuery() {
    return [
      "You are a biomedical signal-analysis assistant supporting stroke-rehabilitation research.",
      "This is a RESEARCH DEMO, not a medical diagnosis. Never diagnose; describe visible movement patterns only.",
      "Look at this face snapshot and report ONLY observable facts as compact JSON:",
      '{"eyes": "open|closed|squinting|unclear", "mouth": "closed|open|smiling|asymmetric|unclear",',
      ' "visible_symmetry": "symmetric|left-weaker|right-weaker|unclear",',
      ' "notable_observations": string[1-3], "confidence": number 0-1}',
      "Respond with JSON ONLY.",
    ].join("\n");
  }

  function request(path, cfg, body, timeoutMs) {
    var t = withTimeout(timeoutMs || 30000);
    return fetch(cfg.baseUrl + path, {
      method: "POST",
      headers: headersFor(cfg),
      body: JSON.stringify(body),
      signal: t.signal,
    }).then(function (res) {
      t.done();
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error("Maira " + res.status + ": " + text.slice(0, 300));
        });
      }
      return res.json();
    }).catch(function (err) {
      t.done();
      if (err && err.name === "AbortError") throw new Error("Maira request timed out — check connectivity.");
      throw err instanceof Error ? err : new Error(String(err));
    });
  }

  // Premium reasoning over the local session digest. Returns {ok, answer, parsed, raw}.
  function askPremium(digest, overrides) {
    var cfg = loadSettings();
    if (!configured(cfg)) {
      return Promise.resolve({ ok: false, error: "Maira not configured — enter User ID plus a Bearer token or API key in the Maira card." });
    }
    var body = {
      user_id: cfg.userId,
      query: buildDigestQuery(digest),
      conversation_type: "question",
      top_k: 5,
      is_keyword_enabled: false,
      language: "en",
    };
    if (cfg.gptProfileId) body.gpt_profile_id = cfg.gptProfileId;
    if (overrides && overrides.session_id) body.session_id = overrides.session_id;
    body.conversation_metadata = { source: "neuroface-sense", kind: "facial-motor-digest" };
    return request("/v1/maira/ask", cfg, body, 30000).then(function (payload) {
      var answer = extractAnswer(payload);
      return { ok: true, answer: answer, parsed: tryParseJson(answer), raw: payload };
    }).catch(function (err) {
      return { ok: false, error: err.message || String(err) };
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    var mime = "image/jpeg";
    var match = /^data:([^;]+);base64/.exec(parts[0] || "");
    if (match) mime = match[1];
    var binary = atob(parts[1] || "");
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Vision second opinion on a face snapshot (dataURL). Returns {ok, answer, parsed, raw}.
  function visionPremium(dataUrl, overrides) {
    var cfg = loadSettings();
    if (!configured(cfg)) {
      return Promise.resolve({ ok: false, error: "Maira not configured — enter User ID plus a Bearer token or API key in the Maira card." });
    }
    var form = new FormData();
    try {
      form.append("image", dataUrlToBlob(dataUrl), "face.jpg");
    } catch (e) {
      return Promise.resolve({ ok: false, error: "Could not encode snapshot image." });
    }
    form.append("query", buildVisionQuery());
    form.append("conversation_type", "question");
    form.append("user_id", cfg.userId);
    if (overrides && overrides.session_id) form.append("session_id", overrides.session_id);
    var headers = {};
    if (cfg.bearer) headers.Authorization = "Bearer " + cfg.bearer;
    if (cfg.projectKey) headers["project-key"] = cfg.projectKey;
    if (cfg.apiKey) headers["api-key"] = cfg.apiKey;
    var t = withTimeout(60000);
    return fetch(cfg.baseUrl + "/v1/maira/vision", {
      method: "POST",
      headers: headers,
      body: form,
      signal: t.signal,
    }).then(function (res) {
      t.done();
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error("Maira vision " + res.status + ": " + text.slice(0, 300));
        });
      }
      return res.json();
    }).then(function (payload) {
      var answer = extractAnswer(payload);
      return { ok: true, answer: answer, parsed: tryParseJson(answer), raw: payload };
    }).catch(function (err) {
      t.done();
      if (err && err.name === "AbortError") return { ok: false, error: "Maira vision timed out — check connectivity." };
      return { ok: false, error: err.message || String(err) };
    });
  }

  // Plain connectivity check: tiny question, expects any 2xx + parseable body.
  function testConnection() {
    var cfg = loadSettings();
    if (!configured(cfg)) {
      return Promise.resolve({ ok: false, error: "Enter User ID plus a Bearer token or API key first." });
    }
    return request("/v1/maira/ask", cfg, {
      user_id: cfg.userId,
      query: "Reply with exactly: maira-link-ok",
      conversation_type: "question",
      top_k: 1,
      is_keyword_enabled: false,
      language: "en",
    }, 20000).then(function (payload) {
      return { ok: true, answer: extractAnswer(payload), raw: payload };
    }).catch(function (err) {
      return { ok: false, error: err.message || String(err) };
    });
  }

  window.NF_maira = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    clearSettings: clearSettings,
    configured: configured,
    askPremium: askPremium,
    visionPremium: visionPremium,
    testConnection: testConnection,
    buildDigestQuery: buildDigestQuery,
    buildVisionQuery: buildVisionQuery,
    extractAnswer: extractAnswer,
    tryParseJson: tryParseJson,
    DEFAULT_BASE: DEFAULT_BASE,
  };
})();
