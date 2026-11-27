/* コードルーレット: Web Audio による試聴 */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensureContext() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function newBus() {
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    return g;
  }

  function closeBus(bus) {
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0, t + 0.08);
    setTimeout(() => bus.disconnect(), 200);
  }

  function keyNote(bus, midi, t, dur, vel) {
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.value = f;
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    g2.gain.value = 0.22;
    filt.type = 'lowpass';
    filt.frequency.value = 2600;
    filt.Q.value = 0.5;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.008);
    env.gain.setTargetAtTime(vel * 0.3, t + 0.01, 0.45);
    env.gain.setTargetAtTime(0, t + dur, 0.07);
    o1.connect(filt);
    o2.connect(g2).connect(filt);
    filt.connect(env).connect(bus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.6);
    o2.stop(t + dur + 0.6);
  }

  function bassNote(bus, midi, t, dur, vel) {
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.value = f;
    o2.type = 'triangle';
    o2.frequency.value = f;
    filt.type = 'lowpass';
    filt.frequency.value = 700;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.01);
    env.gain.setTargetAtTime(vel * 0.6, t + 0.02, 0.6);
    env.gain.setTargetAtTime(0, t + dur, 0.06);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(env).connect(bus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.5);
    o2.stop(t + dur + 0.5);
  }

  function chordAt(bus, voicing, bass, t, dur) {
    const vel = 0.5 / Math.max(3, voicing.length);
    voicing.forEach((n) => keyNote(bus, n, t, dur, vel));
    if (bass != null) bassNote(bus, bass, t, dur, 0.32);
  }

  function arpSequence(voicing) {
    const up = voicing.concat([voicing[0] + 12]);
    const seq = up.concat(up.slice(1, -1).reverse());
    return Array.from({ length: 8 }, (_, i) => seq[i % seq.length]);
  }

  function scheduleBar(bus, style, voicing, bass, t, beat) {
    if (style === 'quarter') {
      for (let b = 0; b < 4; b++) chordAt(bus, voicing, null, t + b * beat, beat * 0.85);
      bassNote(bus, bass, t, beat * 1.9, 0.32);
      bassNote(bus, bass, t + 2 * beat, beat * 1.9, 0.3);
    } else if (style === 'arp') {
      const seq = arpSequence(voicing);
      const vel = 0.16;
      seq.forEach((n, i) => keyNote(bus, n, t + i * beat * 0.5, beat * 0.9, vel));
      bassNote(bus, bass, t, beat * 4 * 0.97, 0.32);
    } else {
      chordAt(bus, voicing, bass, t, beat * 4 * 0.97);
    }
  }

  // 空白で区切った1かたまりが1拍。拍の中は文字数で等分する（2文字=8分、3文字=3連、4文字=16分）。
  // x=通常、o=弱く、.=休み。8拍分書いたパターンは2小節でひと回りする。
  const DRUM_PATTERNS = {
    none: {},
    eight: { kick: 'x . x .', snare: '. x . x', hat: 'xx xx xx xx' },
    sixteen: { kick: 'x..x .... x.x. ....', snare: '. x . x', hat: 'xoxo xoxo xoxo xoxo' },
    four: { kick: 'x x x x', snare: '. x . x', hat: 'xx xx xx xx' },
    half: { kick: 'x . . .', snare: '. . x .', hat: 'xx xx xx xx' },
    shuffle: { kick: 'x.. ... x.x ...', snare: '. x . x', hat: 'x.x x.x x.x x.x' },
    ballad: { kick: 'x. .. x. .x', rim: '. x . x', hat: 'xo xo xo xo' },
    triplet: { kick: 'x.. ... x.. ...', snare: '. x . x', hat: 'xoo xoo xoo xoo' },
    disco: { kick: 'x x x x', snare: '. x . x', hat: 'xo.o xo.o xo.o xo.o', open: '..x. ..x. ..x. ..x.' },
    funk: {
      kick: 'x..x ..x. ..x. ....',
      snare: '.... x..o .o.. x..o',
      hat: 'xoxo xoxo xoxo xo..',
      open: '.... .... .... ..x.',
    },
    hiphop: { kick: 'x... ...x ..x. ....', snare: '. x . x', hat: 'xo xo xo xo' },
    trap: { kick: 'x..x .... ..x. .x..', clap: '. . x .', hat: 'xx xx xx xxxxxx' },
    reggaeton: { kick: 'x x x x', snare: '...x ..x. ...x ..x.', hat: 'xx xx xx xx' },
    jazz: { ride: 'x.. x.x x.. x.x', hat: '. x . x', snare: '... ... ..o ...' },
    bossa: { kick: 'x. .x x. .x', rim: 'x. .x .. x. .. x. .x ..', hat: 'xo xo xo xo' },
    reggae: { kick: '. . x .', rim: '. . x .', hat: 'x.o x.o x.o x.o' },
  };
  const SOFT = 0.45;

  function drumEvents(pattern, bar) {
    const parts = DRUM_PATTERNS[pattern] || {};
    const events = [];
    Object.keys(parts).forEach((sound) => {
      const groups = parts[sound].trim().split(/\s+/);
      const start = ((bar || 0) % (groups.length / 4)) * 4;
      groups.slice(start, start + 4).forEach((group, i) => {
        Array.from(group).forEach((ch, j) => {
          if (ch !== '.') events.push({ sound, beat: i + j / group.length, vel: ch === 'o' ? SOFT : 1 });
        });
      });
    });
    return events;
  }

  function noiseHit(bus, t, dur, frequency, type, vel) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    env.gain.setValueAtTime(vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter).connect(env).connect(bus);
    source.start(t);
    source.stop(t + dur);
  }

  function toneHit(bus, t, dur, frequency, vel) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    env.gain.setValueAtTime(vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(bus);
    osc.start(t);
    osc.stop(t + dur);
  }

  // 金属的なライド。周波数のずれた矩形波を重ねて高域だけ残す（TR-808のシンバルと同じ考え方）
  function metalHit(bus, t, dur, vel) {
    const band = ctx.createBiquadFilter();
    const high = ctx.createBiquadFilter();
    const env = ctx.createGain();
    band.type = 'bandpass';
    band.frequency.value = 9000;
    high.type = 'highpass';
    high.frequency.value = 6000;
    env.gain.setValueAtTime(vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    band.connect(high).connect(env).connect(bus);
    [205.3, 304.4, 369.6, 522.7, 540, 800].forEach((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(band);
      osc.start(t);
      osc.stop(t + dur);
    });
  }

  function drumHit(bus, sound, t, beat, vel) {
    if (sound === 'kick') {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      env.gain.setValueAtTime(0.65 * vel, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(env).connect(bus);
      osc.start(t);
      osc.stop(t + 0.19);
    } else if (sound === 'snare') {
      noiseHit(bus, t, beat * 0.35, 1800, 'lowpass', 0.28 * vel);
    } else if (sound === 'open') {
      noiseHit(bus, t, beat * 0.45, 7000, 'highpass', 0.07 * vel);
    } else if (sound === 'clap') {
      [0, 0.012, 0.024].forEach((d) => noiseHit(bus, t + d, 0.03, 1300, 'bandpass', 0.4 * vel));
      noiseHit(bus, t + 0.03, beat * 0.25, 1300, 'bandpass', 0.3 * vel);
    } else if (sound === 'rim') {
      toneHit(bus, t, 0.035, 1700, 0.12 * vel);
      toneHit(bus, t, 0.05, 480, 0.12 * vel);
      noiseHit(bus, t, 0.03, 4000, 'bandpass', 0.1 * vel);
    } else if (sound === 'ride') {
      metalHit(bus, t, Math.min(beat * 0.8, 0.9), 0.1 * vel);
    } else {
      noiseHit(bus, t, beat * 0.12, 7500, 'highpass', 0.12 * vel);
    }
  }

  function scheduleDrums(bus, pattern, bar, t, beat) {
    drumEvents(pattern, bar).forEach(({ sound, beat: offset, vel }) => {
      drumHit(bus, sound, t + offset * beat, beat, vel);
    });
  }

  // ループ再生。getState() は毎小節の頭で呼ばれ、最新のコード・テンポを返す
  const Player = {
    playing: false,
    bus: null,
    timer: null,
    raf: null,
    queue: [],
    start(getState, onBar) {
      ensureContext();
      this.stop();
      this.playing = true;
      this.bus = newBus();
      this.bar = 0;
      this.next = ctx.currentTime + 0.08;
      this.queue = [];
      const tick = () => {
        while (this.next < ctx.currentTime + 0.25) {
          const s = getState();
          const beat = 60 / s.bpm;
          const i = this.bar % s.voicings.length;
          scheduleBar(this.bus, s.style, s.voicings[i], s.bass[i], this.next, beat);
          scheduleDrums(this.bus, s.rhythm, this.bar, this.next, beat);
          this.queue.push({ bar: i, time: this.next });
          this.next += beat * 4;
          this.bar += 1;
        }
      };
      tick();
      this.timer = setInterval(tick, 25);
      const frame = () => {
        while (this.queue.length && this.queue[0].time <= ctx.currentTime) {
          onBar(this.queue.shift().bar);
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.bus) closeBus(this.bus);
      this.timer = null;
      this.raf = null;
      this.bus = null;
      this.playing = false;
    },
  };

  let previewBus = null;
  function preview(voicing, bass) {
    ensureContext();
    if (previewBus) closeBus(previewBus);
    previewBus = newBus();
    chordAt(previewBus, voicing, bass, ctx.currentTime + 0.02, 1.6);
  }

  global.ChordAudio = { Player, preview, drumEvents };
})(window);
