/* Time a persistent one-sided lip observation, not a single-frame diagnosis. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NF_lipWatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function Watch(seconds) { this.limit = seconds || 60; this.reset(); }
  Watch.prototype.reset = function () {
    this.duration = 0; this.latched = false; this.side = null;
    this.lastTime = null; this.gap = 0;
  };
  Watch.prototype.update = function (time, active, side) {
    if (!Number.isFinite(time)) { this.reset(); return false; }
    var dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    if (!active) {
      this.gap += dt;
      if (this.gap > 0.5) this.reset();
      return false;
    }
    if (this.side && side !== this.side) { this.reset(); dt = 0; this.lastTime = time; }
    this.side = side;
    var hadGap = this.gap > 0;
    this.gap = 0;
    this.duration += hadGap ? 0 : Math.min(dt, 0.25);
    if (this.duration < this.limit || this.latched) return false;
    this.latched = true;
    return true;
  };
  return { Watch: Watch };
});
