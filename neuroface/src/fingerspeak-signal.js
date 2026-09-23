/* FingerSpeak sequence sampling and rejection helpers. No camera or DOM dependency. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NF_fingerspeakSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var RAW_LEN = 128, FEATURE_LEN = 201;
  var tips = [4, 8, 12, 16, 20];
  var chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var d = Math.hypot.apply(null, a) || 1e-6; return a.map(function (v) { return v / d; }); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function angle(a, b, c) {
    var x = norm(sub(a, b)), y = norm(sub(c, b));
    return Math.acos(Math.max(-1, Math.min(1, dot(x, y)))) / Math.PI;
  }
  function flattened(lm) {
    var out = [];
    for (var i = 0; i < 21; i++) out.push(lm[i].x, lm[i].y, lm[i].z || 0);
    return out;
  }
  function orderedHands(result) {
    var landmarks = result && result.landmarks || [];
    var handedness = result && (result.handednesses || result.handedness) || [];
    var hands = landmarks.slice(0, 2).map(function (lm, i) {
      var category = handedness[i] && handedness[i][0] || {};
      var label = category.categoryName || category.displayName || '';
      return { lm: lm, label: /^(left|right)$/i.test(label) ? label.toLowerCase() : '', x: lm[0].x };
    }).filter(function (h) {
      return h.lm && h.lm.length === 21 && h.lm.every(function (p) {
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z || 0);
      });
    });
    if (hands.length === 2) {
      if (hands[0].label && hands[1].label && hands[0].label !== hands[1].label)
        hands.sort(function (a, b) { return a.label === 'left' ? -1 : 1; });
      else hands.sort(function (a, b) { return a.x - b.x; });
    }
    return hands;
  }
  function packHands(hands) {
    if (!Array.isArray(hands) || hands.length < 1 || hands.length > 2) return null;
    var out = flattened(hands[0].lm);
    out.push.apply(out, hands[1] ? flattened(hands[1].lm) : Array(63).fill(0));
    out.push(1, hands.length === 2 ? 1 : 0);
    return out;
  }
  function upgradeLegacyFrame(raw) {
    if (!Array.isArray(raw) || raw.length !== 63 || !raw.every(Number.isFinite)) return null;
    return raw.concat(Array(63).fill(0), [1, 0]);
  }
  function singleFeatures(raw) {
    var P = function (i) { return raw.slice(i * 3, i * 3 + 3); };
    var wrist = P(0), mid = P(9), index = P(5), pinky = P(17);
    var scale = Math.hypot.apply(null, sub(mid, wrist)) || 1e-6;
    var ey = norm(sub(mid, wrist)), horizontal = sub(pinky, index);
    var projected = dot(horizontal, ey);
    horizontal = horizontal.map(function (v, i) { return v - projected * ey[i]; });
    var ex = norm(horizontal), ez = norm(cross(ex, ey));
    var coords = [];
    for (var i = 0; i < 21; i++) {
      var rel = sub(P(i), wrist).map(function (v) { return v / scale; });
      coords.push(dot(rel, ex), dot(rel, ey), dot(rel, ez));
    }
    var angles = [];
    chains.forEach(function (chain) {
      for (var j = 0; j < 2; j++) angles.push(angle(P(chain[j]), P(chain[j + 1]), P(chain[j + 2])));
    });
    var distances = [];
    for (var a = 0; a < tips.length; a++) for (var b = a + 1; b < tips.length; b++)
      distances.push(Math.hypot.apply(null, sub(P(tips[a]), P(tips[b]))) / scale);
    return coords.concat(angles, distances); // 83 features
  }
  function buildModelInput(rawSeq) {
    var base = rawSeq.map(function (raw) {
      if (!Array.isArray(raw) || raw.length !== RAW_LEN || raw[126] !== 1 || ![0, 1].includes(raw[127]))
        throw new Error('FingerSpeak requires dual-hand landmark samples');
      var first = singleFeatures(raw.slice(0, 63));
      var second = raw[127] ? singleFeatures(raw.slice(63, 126)) : Array(83).fill(0);
      var relation = [1, raw[127], 0, 0, 0];
      if (raw[127]) {
        var a = raw.slice(0, 3), b = raw.slice(63, 66);
        var scaleA = Math.hypot.apply(null, sub(raw.slice(27, 30), a));
        var scaleB = Math.hypot.apply(null, sub(raw.slice(90, 93), b));
        var scale = Math.max(1e-6, (scaleA + scaleB) / 2);
        relation[2] = (b[0] - a[0]) / scale;
        relation[3] = (b[1] - a[1]) / scale;
        relation[4] = Math.hypot(relation[2], relation[3]);
      }
      return first.concat(second, relation); // 171
    });
    return base.map(function (frame, i) {
      var prev = i ? base[i - 1] : frame, velocity = [];
      [0, 83].forEach(function (offset) {
        tips.forEach(function (tip) {
          var start = offset + tip * 3;
          for (var d = 0; d < 3; d++) velocity.push(frame[start + d] - prev[start + d]);
        });
      });
      return frame.concat(velocity); // 201
    });
  }
  function fingerOpenness(lm) {
    var P = function (i) { return [lm[i].x, lm[i].y, lm[i].z || 0]; };
    return chains.map(function (chain) {
      var pip = angle(P(chain[0]), P(chain[1]), P(chain[2]));
      var dip = angle(P(chain[1]), P(chain[2]), P(chain[3]));
      return Math.round(100 * clamp01((Math.min(pip, dip) - 0.48) / 0.42));
    });
  }
  function classifyPose(lm) {
    if (!Array.isArray(lm) || lm.length !== 21) return { name: 'Unclear', openness: [0, 0, 0, 0, 0] };
    var openness = fingerOpenness(lm), states = openness.slice(1).map(function (v) {
      return v >= 75 ? 1 : v <= 30 ? 0 : -1;
    });
    var key = states.join('');
    var labels = { '1111': 'Open palm', '0000': 'Closed fingers', '1000': 'Index extended',
      '1100': 'Two fingers extended', '1110': 'Three fingers extended' };
    return { name: labels[key] || 'Other hand pose', openness: openness };
  }
  function PoseTracker(holdMs) { this.holdMs = holdMs || 180; this.states = new Map(); }
  PoseTracker.prototype.update = function (hands, t) {
    var seen = new Set(), self = this;
    var result = hands.map(function (hand, i) {
      var key = hand.label || 'slot-' + i, pose = classifyPose(hand.lm);
      seen.add(key);
      var state = self.states.get(key);
      if (!state || state.candidate !== pose.name) state = { candidate: pose.name, since: t, stable: 'Observing…' };
      if (t - state.since >= self.holdMs) state.stable = pose.name;
      self.states.set(key, state);
      return { label: hand.label ? hand.label[0].toUpperCase() + hand.label.slice(1) : 'Hand ' + (i + 1),
        pose: state.stable, openness: pose.openness };
    });
    for (var key of this.states.keys()) if (!seen.has(key)) this.states.delete(key);
    return result;
  };

  function resampleSequence(frames, count, windowMs) {
    if (!Array.isArray(frames) || count < 2 || windowMs <= 0) return null;
    var width = frames[0] && frames[0].feat && frames[0].feat.length;
    if (width !== 63 && width !== RAW_LEN) return null;
    var valid = frames.filter(function (f) {
      return f && Number.isFinite(f.t) && Array.isArray(f.feat) && f.feat.length === width &&
        f.feat.every(Number.isFinite);
    });
    if (valid.length !== frames.length) return null;
    var minFrames = Math.max(6, Math.ceil(windowMs / 1000 * 12));
    if (valid.length < minFrames) return null;
    var end = valid[valid.length - 1].t, start = end - windowMs;
    valid = valid.filter(function (f) { return f.t >= start - 50; });
    if (valid.length < minFrames || valid[0].t > start + windowMs * 0.15) return null;
    for (var i = 1; i < valid.length; i++) {
      // A missing hand, stalled camera, or duplicate timestamp must not be
      // interpolated into a convincing-looking training/live gesture.
      if (valid[i].t <= valid[i - 1].t || valid[i].t - valid[i - 1].t > Math.max(180, windowMs * 0.2)) return null;
      if (width === RAW_LEN) {
        if (valid[i].feat[126] !== 1 || valid[i].feat[127] !== valid[0].feat[127]) return null;
        for (var slot = 0; slot < 1 + valid[0].feat[127]; slot++) {
          var off = slot * 63, a = valid[i - 1].feat, b = valid[i].feat;
          if (Math.hypot(a[off] - b[off], a[off + 1] - b[off + 1]) > 0.3) return null;
        }
      }
    }
    var output = [], cursor = 0;
    for (var k = 0; k < count; k++) {
      var target = start + k * windowMs / (count - 1);
      while (cursor + 1 < valid.length && valid[cursor + 1].t < target) cursor++;
      var lo = valid[cursor], hi = valid[Math.min(cursor + 1, valid.length - 1)];
      // Clamp short edge gaps; never extrapolate beyond observed landmarks.
      var alpha = hi.t > lo.t ? Math.max(0, Math.min(1, (target - lo.t) / (hi.t - lo.t))) : 0;
      output.push(lo.feat.map(function (value, j) { return value + (hi.feat[j] - value) * alpha; }));
    }
    return output;
  }

  function inDistribution(querySummary, prototypes, predictedIndex, multiplier) {
    if (!Array.isArray(querySummary) || !Array.isArray(prototypes) ||
        !Number.isInteger(predictedIndex) || predictedIndex < 0 || predictedIndex >= prototypes.length) return false;
    var entry = prototypes[predictedIndex];
    if (!entry || !Array.isArray(entry.centroid) || entry.centroid.length !== querySummary.length ||
        !Number.isFinite(entry.spread) || entry.spread <= 0) return false;
    var distanceSq = 0;
    for (var i = 0; i < querySummary.length; i++) {
      if (!Number.isFinite(querySummary[i]) || !Number.isFinite(entry.centroid[i])) return false;
      var delta = querySummary[i] - entry.centroid[i];
      distanceSq += delta * delta;
    }
    return Math.sqrt(distanceSq) <= entry.spread * (multiplier || 2.2);
  }

  return { RAW_LEN: RAW_LEN, FEATURE_LEN: FEATURE_LEN, orderedHands: orderedHands,
    packHands: packHands, upgradeLegacyFrame: upgradeLegacyFrame, buildModelInput: buildModelInput,
    classifyPose: classifyPose, PoseTracker: PoseTracker,
    resampleSequence: resampleSequence, inDistribution: inDistribution };
});
