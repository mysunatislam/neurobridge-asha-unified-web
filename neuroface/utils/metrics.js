/* NeuroFace Sense — pure geometry metrics (no DOM, no TF). Tested helpers. */
(function () {
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }
  // Eye Aspect Ratio: (up1-low1 + up2-low2) / (2 * outer-inner)
  function ear(lm, eye) {
    const v1 = dist(lm[eye.up1], lm[eye.low1]);
    const v2 = dist(lm[eye.up2], lm[eye.low2]);
    const h = Math.max(1e-6, dist(lm[eye.outer], lm[eye.inner]));
    return (v1 + v2) / (2 * h);
  }
  // Pixel-space EAR: immune to webcam aspect-ratio distortion.
  // Pass video.videoWidth / video.videoHeight; falls back to normalized.
  function earPx(lm, eye, W, H) {
    W = W || 1; H = H || 1;
    function d(a, b) { return Math.hypot((a.x - b.x) * W, (a.y - b.y) * H); }
    const v1 = d(lm[eye.up1], lm[eye.low1]);
    const v2 = d(lm[eye.up2], lm[eye.low2]);
    const h = Math.max(1e-6, d(lm[eye.outer], lm[eye.inner]));
    return (v1 + v2) / (2 * h);
  }
  // Mouth Aspect Ratio: inner height / width
  function mar(lm) {
    const h = dist(lm[13], lm[14]);
    const w = Math.max(1e-6, dist(lm[61], lm[291]));
    return h / w;
  }
  function mouthWidth(lm) { return dist(lm[61], lm[291]); }
  // Smile intensity 0..1 from corner lift + width expansion vs neutral baseline
  function smileIntensity(lm, neutral) {
    const w = mouthWidth(lm);
    const w0 = (neutral && neutral.mouthW) || w;
    const stretch = Math.max(0, Math.min(1, (w / Math.max(1e-6, w0) - 1) * 4));
    const midY = (lm[13].y + lm[14].y) / 2;
    const liftL = ((midY - lm[61].y) / Math.max(1e-6, w));
    const liftR = ((midY - lm[291].y) / Math.max(1e-6, w));
    const lift = Math.max(0, Math.min(1, (liftL + liftR) * 2.2));
    return Math.max(0, Math.min(1, stretch * 0.55 + lift * 0.45));
  }
  // Compare signed corner lift relative to the mouth midline, corrected for
  // head roll. Absolute corner travel also contains face translation and yaw,
  // which falsely makes a normal symmetric smile appear one-sided.
  function numOr(value, fallback) {
    return (typeof value === "number" && isFinite(value)) ? value : fallback;
  }
  function smileSideExcursions(lm, neutral) {
    const valid = neutral && [neutral.cornerLY, neutral.cornerRY].every(Number.isFinite);
    if (!valid) return { left: 0, right: 0, score: 100, valid: false };
    const w = Math.max(1e-6, mouthWidth(lm));
    const eyeDx = lm[263].x - lm[33].x;
    const eyeDy = lm[263].y - lm[33].y;
    const roll = Math.atan2(eyeDy, eyeDx);
    const midpoint = (lm[61].x + lm[291].x) / 2;
    function correctedY(point) { return point.y - (point.x - midpoint) * Math.tan(roll); }
    const currentL = correctedY(lm[61]), currentR = correctedY(lm[291]);
    const neutralL = numOr(neutral.cornerLY, lm[61].y);
    const neutralR = numOr(neutral.cornerRY, lm[291].y);
    const neutralRoll = numOr(neutral.head && neutral.head.roll, 0) * Math.PI / 180;
    const neutralWidth = numOr(neutral.cornerRX, lm[291].x) - numOr(neutral.cornerLX, lm[61].x);
    const baseDifference = neutralL - neutralR + neutralWidth * Math.tan(neutralRoll);
    const imbalance = Math.abs((currentL - currentR) - baseDifference) / w;
    // A few hundredths of mouth width is normal landmark/head-pose noise.
    const score = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, imbalance - 0.035) * 430)));
    const baseL = neutralL + neutralWidth * Math.tan(neutralRoll) / 2;
    const baseR = neutralR - neutralWidth * Math.tan(neutralRoll) / 2;
    return { left: Math.max(0, (baseL - currentL) / w), right: Math.max(0, (baseR - currentR) / w), score: score, valid: true };
  }
  function symmetryScore(lm, neutral) { return smileSideExcursions(lm, neutral).score; }
  // Head pose heuristic in degrees (calibrated neutral subtracted by caller)
  function headPose(lm) {
    const faceW = Math.max(1e-6, dist(lm[234], lm[454]));
    const faceH = Math.max(1e-6, dist(lm[10], lm[152]));
    const midX = (lm[234].x + lm[454].x) / 2;
    const midEyeY = (lm[33].y + lm[263].y) / 2;
    const yaw = ((lm[1].x - midX) / faceW) * 130;
    const pitch = ((lm[1].y - midEyeY) / faceH) * 120 - 8;
    const roll = Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x) * 180 / Math.PI;
    return { yaw, pitch, roll };
  }
  // Gaze from iris centre vs eye corners (-1 left … +1 right, -1 up … +1 down)
  function gaze(lm) {
    // Iris refinement (478 pts) is optional; without it there is no gaze.
    var ids = window.NF_LM.irisL.concat(window.NF_LM.irisR);
    for (var k = 0; k < ids.length; k++) {
      var p = lm[ids[k]];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return { x: 0, y: 0, available: false };
    }
    function side(irisIdx, outer, inner, upY, lowY) {
      let cx = 0, cy = 0;
      irisIdx.forEach(i => { cx += lm[i].x; cy += lm[i].y; });
      cx /= irisIdx.length; cy /= irisIdx.length;
      const w = Math.max(1e-6, lm[inner].x - lm[outer].x);
      const h = Math.max(1e-6, lowY - upY);
      return { x: ((cx - lm[outer].x) / w) * 2 - 1, y: ((cy - upY) / h) * 2 - 1 };
    }
    const L = side(window.NF_LM.irisL, 33, 133, (lm[160].y + lm[158].y) / 2, (lm[153].y + lm[144].y) / 2);
    const R = side(window.NF_LM.irisR, 362, 263, (lm[385].y + lm[387].y) / 2, (lm[373].y + lm[380].y) / 2);
    // Note: mirrored selfie view — average then flip handled in app label
    return { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2, available: true };
  }
  function gazeLabel(g) {
    if (g.x < -0.35) return "looking right";
    if (g.x > 0.35) return "looking left";
    if (g.y < -0.4) return "looking up";
    if (g.y > 0.45) return "looking down";
    return "center";
  }
  // Signed lateral lip deviation: mouth-centre x minus nose-tip x, in face-widths.
  // + = lips pulled toward patient's right, − = toward left (image is mirrored).
  // Subtract the calibrated neutral offset (dev0) before thresholding.
  function lipDeviation(lm, dev0) {
    var fw = Math.max(1e-6, dist(lm[234], lm[454]));
    var mouthCx = (lm[61].x + lm[291].x) / 2;
    return (mouthCx - lm[1].x) / fw - (dev0 || 0);
  }
  function lipAsymmetry(lm, neutral) {
    const fw = Math.max(1e-6, dist(lm[234], lm[454]));
    const roll = Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x);
    const current = lm[61].y - lm[291].y + (lm[291].x - lm[61].x) * Math.tan(roll);
    let reference = 0;
    if (neutral && [neutral.cornerLY, neutral.cornerRY].every(Number.isFinite)) {
      const baseRoll = numOr(neutral.head && neutral.head.roll, 0) * Math.PI / 180;
      const baseWidth = numOr(neutral.cornerRX, lm[291].x) - numOr(neutral.cornerLX, lm[61].x);
      reference = neutral.cornerLY - neutral.cornerRY + baseWidth * Math.tan(baseRoll);
    }
    return (current - reference) / fw;
  }
  // Mouth-corner downturn: avg corner height below lip-centre line, in face-widths.
  // Positive = downturned (sad/pain cue); negative = lifted (smile).
  function cornerDepression(lm) {
    var fw = Math.max(1e-6, dist(lm[234], lm[454]));
    var midY = (lm[13].y + lm[14].y) / 2;
    return ((lm[61].y + lm[291].y) / 2 - midY) / fw;
  }
  window.NF_metrics = { dist, ear, earPx, mar, mouthWidth, smileIntensity, smileSideExcursions, symmetryScore, headPose, gaze, gazeLabel, lipDeviation, lipAsymmetry, cornerDepression };
})();
