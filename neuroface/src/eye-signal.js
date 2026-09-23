/* A completed EAR dip is one blink candidate: descent, trough, then recovery.
   This counts partial lid motion without mistaking every one-frame graph wiggle
   for a blink. No face images or patient data are stored here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NF_eyeSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function Detector() { this.reset(); }
  Detector.prototype.reset = function () {
    this.phase = 'open'; this.start = 0; this.minimum = Infinity;
    this.minLeft = Infinity; this.minRight = Infinity;
    this.reference = 0; this.recoveryAt = null; this.lastEvent = -Infinity; this.lowSamples = 0;
  };
  Detector.prototype.update = function (time, left, right, openReference) {
    if (![time, left, right, openReference].every(Number.isFinite) || openReference <= 0) {
      this.reset(); return null;
    }
    var ear = (left + right) / 2;
    var entry = Math.max(0.022, openReference * 0.065);
    if (this.phase === 'open') {
      if (time - this.lastEvent >= 0.12 && ear <= openReference - entry) {
        this.phase = 'dip'; this.start = time; this.minimum = ear;
        this.minLeft = left; this.minRight = right;
        this.reference = openReference; this.recoveryAt = null; this.lowSamples = 1;
      }
      return null;
    }
    this.minimum = Math.min(this.minimum, ear);
    this.minLeft = Math.min(this.minLeft, left);
    this.minRight = Math.min(this.minRight, right);
    var depth = this.reference - this.minimum;
    var recovered = ear >= this.reference - Math.max(0.012, depth * 0.35);
    if (!recovered) { this.lowSamples++; this.recoveryAt = null; return null; }
    if (this.recoveryAt === null) { this.recoveryAt = time; return null; }
    if (time - this.recoveryAt < 0.025) return null;
    var duration = time - this.start;
    var bothEyes = this.reference - this.minLeft >= Math.max(0.012, this.reference * 0.03)
      && this.reference - this.minRight >= Math.max(0.012, this.reference * 0.03);
    var valid = this.lowSamples >= 2 && duration >= 0.06 && duration <= 15 && depth >= entry && bothEyes;
    var event = valid ? { duration: duration, minimum: this.minimum,
      depth: depth, relativeDepth: depth / this.reference, held: duration > 1.6 } : null;
    this.phase = 'open'; this.recoveryAt = null;
    if (event) this.lastEvent = time;
    return event;
  };
  return { Detector: Detector };
});
