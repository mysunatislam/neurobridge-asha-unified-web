/* AU-inspired geometry indicators. These are movement features, not FACS or
   clinical action-unit estimates. A short neutral hold establishes a fixed
   per-session reference so active movement is not compared with itself. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NF_activity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var KEYS = ['brow', 'cheek', 'corner', 'width', 'opening'];
  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function clamp(value) { return Math.max(0, Math.min(1, value)); }
  function features(lm) {
    if (!lm || lm.length < 455) return null;
    var fw = Math.hypot(lm[234].x - lm[454].x, lm[234].y - lm[454].y);
    var mouthW = Math.hypot(lm[61].x - lm[291].x, lm[61].y - lm[291].y);
    if (!Number.isFinite(fw) || fw < .05 || !Number.isFinite(mouthW) || mouthW < .01) return null;
    var midY = (lm[13].y + lm[14].y) / 2;
    var f = {
      brow: ((lm[133].y - lm[105].y) + (lm[362].y - lm[334].y)) / (2 * fw),
      cheek: ((lm[116].y - lm[33].y) + (lm[345].y - lm[263].y)) / (2 * fw),
      corner: (2 * midY - lm[61].y - lm[291].y) / (2 * fw),
      width: mouthW / fw,
      opening: Math.hypot(lm[13].x - lm[14].x, lm[13].y - lm[14].y) / mouthW
    };
    return KEYS.every(function (key) { return Number.isFinite(f[key]); }) ? f : null;
  }
  function Tracker(count) { this.count = count || 45; this.reset(); }
  Tracker.prototype.reset = function () {
    this.samples = []; this.baseline = null;
    this.values = { AU1: 0, AU4: 0, AU6: 0, AU12: 0, AU20: 0, AU25: 0 };
  };
  Tracker.prototype.update = function (lm) {
    var f = features(lm);
    if (!f) return { ready: false, invalid: true, progress: this.samples.length, values: this.values };
    if (!this.baseline) {
      this.samples.push(f);
      if (this.samples.length < this.count) return { ready: false, progress: this.samples.length, values: this.values };
      var baseline = {};
      KEYS.forEach(function (key) { baseline[key] = median(this.samples.map(function (s) { return s[key]; })); }, this);
      this.baseline = baseline;
    }
    var b = this.baseline;
    var target = {
      AU1: clamp((f.brow - b.brow - .004) / .035),
      AU4: clamp((b.brow - f.brow - .004) / .035),
      AU6: clamp((b.cheek - f.cheek - .004) / .035),
      AU12: clamp((f.corner - b.corner - .003) / .055),
      AU20: clamp((f.width - b.width - .005) / .065),
      AU25: clamp((f.opening - b.opening - .015) / .35)
    };
    var values = {};
    Object.keys(target).forEach(function (key) {
      this.values[key] += .45 * (target[key] * 100 - this.values[key]);
      values[key] = Math.round(this.values[key]);
    }, this);
    return { ready: true, progress: this.count, values: values, features: f, baseline: b };
  };
  return { Tracker: Tracker, features: features };
});
