// All sound effects synthesized via Web Audio API — zero asset files.
// Call audioInit() after the first user gesture (browsers require it).

let actx = null;

export function audioInit() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    actx = null;
  }
}

function blip(freq, dur = 0.1, type = 'sine', vol = 0.15, slide = 0) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  }
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(actx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

function noiseHit(dur = 0.15, vol = 0.2) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = actx.createBufferSource();
  src.buffer = buf;
  const gain = actx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const filt = actx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 2000;
  src.connect(filt).connect(gain).connect(actx.destination);
  src.start(t0);
}

export const SFX = {
  swing:    () => blip(620, 0.12, 'triangle', 0.1, -300),
  hit:      () => { noiseHit(0.12, 0.22); blip(180, 0.08, 'square', 0.12, -80); },
  enemyDie: () => { noiseHit(0.25, 0.25); blip(120, 0.18, 'sawtooth', 0.15, -80); },
  pickup:   () => {
    blip(880, 0.08, 'sine', 0.15);
    setTimeout(() => blip(1320, 0.12, 'sine', 0.12), 60);
  },
  heart: () => {
    blip(660, 0.1, 'sine', 0.15);
    setTimeout(() => blip(990, 0.15, 'sine', 0.15), 80);
  },
  dash:     () => blip(440, 0.15, 'sawtooth', 0.1, 300),
  hurt:     () => { noiseHit(0.15, 0.3); blip(200, 0.15, 'sawtooth', 0.15, -100); },
  stairs:   () => {
    blip(523, 0.12, 'sine', 0.12);
    setTimeout(() => blip(659, 0.12, 'sine', 0.12), 80);
    setTimeout(() => blip(784, 0.18, 'sine', 0.15), 160);
  },
  death: () => {
    noiseHit(0.5, 0.3);
    blip(160, 0.4, 'sawtooth', 0.18, -120);
    setTimeout(() => blip(80, 0.6, 'sawtooth', 0.18, -40), 200);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => blip(f, 0.2, 'sine', 0.18), i * 120);
    });
  },
  arrow:    () => blip(880, 0.08, 'square', 0.08, -200),
  bossRoar: () => { noiseHit(0.4, 0.3); blip(80, 0.5, 'sawtooth', 0.25, -20); },
};
