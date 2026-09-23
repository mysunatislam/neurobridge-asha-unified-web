/* NeuroFace Sense — canonical MediaPipe Face Mesh (468 + iris 478) indices */
window.NF_LM = {
  // Eyes (6-point EAR each)
  eyeL: { outer: 33, inner: 133, up1: 160, up2: 158, low1: 153, low2: 144 },
  eyeR: { outer: 263, inner: 362, up1: 385, up2: 387, low1: 373, low2: 380 },
  irisL: [468, 469, 470, 471, 472],
  irisR: [473, 474, 475, 476, 477],
  // Brows
  browL: [70, 63, 105, 66, 107],
  browR: [336, 296, 334, 293, 300],
  // Nose / head pose anchors
  noseTip: 1, noseBridge: 6, chin: 152, forehead: 10,
  cheekL: 234, cheekR: 454, jawL: 132, jawR: 361,
  // Mouth
  mouthL: 61, mouthR: 291, lipUpIn: 13, lipLowIn: 14,
  lipUpOut: 0, lipLowOut: 17,
  cheekMuscleL: 116, cheekMuscleR: 345,
  // Sparse overlay contour (fast draw)
  contour: [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,121,120,119,118,117,111,0,37,39,40,185,61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,271,272,12,6,168,8,9,10],
};
