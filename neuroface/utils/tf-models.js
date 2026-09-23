/* NeuroFace Sense — tiny in-browser TF.js models (built at runtime, no downloads).
   Model 1 (CNN): 64x64 grayscale face crop -> 16-D appearance embedding.
   Model 2 (Temporal): sequence [SEQ=150, FEAT=12] of fused features -> 5-class softmax.
   Random-init for MVP demo; calibration + heuristics ground the scores. */
window.NF_models = (function () {
  const FEAT = 12, SEQ = 150;
  const CLASSES = ["Normal movement", "Reduced movement", "Asymmetric movement", "Twitch detected", "Tremor detected"];
  let cnn = null, temporal = null;

  function buildCNN() {
    const m = tf.sequential();
    m.add(tf.layers.conv2d({ inputShape: [64, 64, 1], filters: 16, kernelSize: 3, activation: "relu", padding: "same" }));
    m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
    m.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu", padding: "same" }));
    m.add(tf.layers.maxPooling2d({ poolSize: 2 }));
    m.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: "relu", padding: "same" }));
    m.add(tf.layers.globalAveragePooling2d({}));
    m.add(tf.layers.dense({ units: 32, activation: "relu" }));
    m.add(tf.layers.dense({ units: 16, activation: "tanh" }));
    m.compile({ optimizer: "adam", loss: "meanSquaredError" });
    return m;
  }
  function buildTemporal() {
    const inp = tf.input({ shape: [SEQ, FEAT] });
    const lstm = tf.layers.lstm({ units: 32, returnSequences: false }).apply(inp);
    const d1 = tf.layers.dense({ units: 24, activation: "relu" }).apply(lstm);
    const drop = tf.layers.dropout({ rate: 0.2 }).apply(d1);
    const out = tf.layers.dense({ units: CLASSES.length, activation: "softmax" }).apply(drop);
    const m = tf.model({ inputs: inp, outputs: out });
    m.compile({ optimizer: "adam", loss: "categoricalCrossentropy" });
    return m;
  }
  async function init() {
    await tf.ready();
    try { await tf.setBackend("webgl"); } catch (e) { await tf.setBackend("cpu"); }
    if (!cnn) cnn = buildCNN();
    if (!temporal) temporal = buildTemporal();
    // warmup (allocates weights)
    tf.tidy(() => {
      cnn.predict(tf.zeros([1, 64, 64, 1]));
      temporal.predict(tf.zeros([1, SEQ, FEAT]));
    });
    return { backend: tf.getBackend(), classes: CLASSES.slice(), seqLen: SEQ, featDim: FEAT };
  }
  function cnnEmbed(faceGray64) { // faceGray64: tf.Tensor [64,64,1] 0..1
    return tf.tidy(() => {
      const batched = faceGray64.expandDims(0);
      const emb = cnn.predict(batched); // [1,16]
      return emb.squeeze().arraySync();
    });
  }
  function temporalClassify(sequence) { // sequence: number[SEQ][FEAT]
    return tf.tidy(() => {
      const t = tf.tensor3d([sequence]);
      const p = temporal.predict(t).arraySync()[0];
      let bi = 0;
      for (let i = 1; i < p.length; i++) if (p[i] > p[bi]) bi = i;
      return { classIndex: bi, label: CLASSES[bi], probs: p };
    });
  }
  return { init, cnnEmbed, temporalClassify, CLASSES, SEQ, FEAT };
})();
