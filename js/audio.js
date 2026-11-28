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

  // ふわっと立ち上がって伸びる音（少しずらした2つの波を重ねる）
  function padNote(bus, midi, t, dur, vel) {
    const f = mtof(midi);
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();
    filt.type = 'lowpass';
    filt.frequency.value = 1600;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + Math.min(0.35, dur * 0.4));
    env.gain.setTargetAtTime(0, t + dur, 0.25);
    filt.connect(env).connect(bus);
    [-6, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(filt);
      o.start(t);
      o.stop(t + dur + 1.2);
    });
  }

  // 歌メロディ用の音（丸い音色に、伸ばした音だけ少しビブラートをかける）
  function leadNote(bus, midi, t, dur, vel) {
    const f = mtof(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.value = f;
    o2.type = 'triangle';
    o2.frequency.value = f;
    g2.gain.value = 0.5;
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.5));
    depth.gain.linearRampToValueAtTime(f * 0.004, t + Math.max(0.26, dur));
    lfo.connect(depth);
    depth.connect(o1.frequency);
    depth.connect(o2.frequency);
    filt.type = 'lowpass';
    filt.frequency.value = 3200;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.02);
    env.gain.setTargetAtTime(vel * 0.75, t + 0.03, 0.4);
    env.gain.setTargetAtTime(0, t + dur, 0.05);
    o1.connect(filt);
    o2.connect(g2).connect(filt);
    filt.connect(env).connect(bus);
    [o1, o2, lfo].forEach((o) => {
      o.start(t);
      o.stop(t + dur + 0.4);
    });
  }

  // 1小節を8分音符8つに分けた位置（s）を拍に直す。スウィングするドラムでは裏拍を3連の位置にずらす
  const SWING = ['shuffle', 'triplet', 'jazz'];
  function slotBeat(s, swing) {
    return Math.floor(s / 2) + (s % 2 ? (swing ? 2 / 3 : 0.5) : 0);
  }

  function scheduleMelody(bus, notes, t, beat, rhythm) {
    const swing = SWING.includes(rhythm);
    (notes || []).forEach((n) => {
      const start = slotBeat(n.s, swing);
      const dur = (slotBeat(n.s + n.l, swing) - start) * beat * 0.92;
      leadNote(bus, n.p, t + start * beat, dur, 0.26);
    });
  }

  function chordAt(bus, voicing, bass, t, dur) {
    const vel = 0.5 / Math.max(3, voicing.length);
    voicing.forEach((n) => keyNote(bus, n, t, dur, vel));
    if (bass != null) bassNote(bus, bass, t, dur, 0.32);
  }

  function arpSequence(voicing, length) {
    const up = voicing.concat([voicing[0] + 12]);
    const seq = up.concat(up.slice(1, -1).reverse());
    return Array.from({ length }, (_, i) => seq[i % seq.length]);
  }

  // 弾き方ごとに、1小節ぶんの音を {inst, note, beat, dur, vel} で返す（beat と dur は拍単位）
  function styleEvents(style, voicing, bass) {
    const events = [];
    const vel = 0.5 / Math.max(3, voicing.length);
    const key = (note, beat, dur, v) => events.push({ inst: 'key', note, beat, dur, vel: v });
    const chord = (beat, dur, scale) => voicing.forEach((n) => key(n, beat, dur, vel * (scale || 1)));
    const low = (beat, dur, v) => {
      if (bass != null) events.push({ inst: 'bass', note: bass, beat, dur, vel: v });
    };
    const arp = (count, dur, v) => {
      arpSequence(voicing, count).forEach((n, i) => key(n, (i * 4) / count, dur, v));
      low(0, 3.88, 0.32);
    };

    if (style === 'quarter') {
      [0, 1, 2, 3].forEach((b) => chord(b, 0.85));
      low(0, 1.9, 0.32);
      low(2, 1.9, 0.3);
    } else if (style === 'eighth') {
      for (let i = 0; i < 8; i++) chord(i / 2, 0.42, i % 2 ? 0.6 : 1);
      low(0, 1.9, 0.32);
      low(2, 1.9, 0.3);
    } else if (style === 'sync') {
      [[0, 1.4], [1.5, 1.4], [3, 0.9]].forEach(([b, d]) => {
        chord(b, d);
        low(b, d, 0.3);
      });
    } else if (style === 'offbeat') {
      [0, 1, 2, 3].forEach((b) => {
        low(b, 0.45, 0.34);
        chord(b + 0.5, 0.3, 1.3);
      });
    } else if (style === 'strum') {
      // ダウンは低い弦から、アップは高い弦から少しずつずらして鳴らす（D・DU・UDU）
      [[0, 0.95, 1], [1, 0.45, 1], [1.5, 0.9, 0.7], [2.5, 0.45, 0.7], [3, 0.45, 1], [3.5, 0.45, 0.7]]
        .forEach(([b, d, v], k) => {
          const notes = [0, 1, 4].includes(k) ? voicing : voicing.slice().reverse();
          notes.forEach((n, j) => key(n, b + j * 0.02, d, vel * v));
        });
      low(0, 1.9, 0.32);
      low(2, 1.9, 0.3);
    } else if (style === 'pad') {
      voicing.forEach((n) => events.push({ inst: 'pad', note: n, beat: 0, dur: 3.9, vel: vel * 0.9 }));
      low(0, 3.88, 0.26);
    } else if (style === 'arp') {
      arp(8, 0.9, 0.16);
    } else if (style === 'arp16') {
      arp(16, 0.45, 0.13);
    } else if (style === 'arp3') {
      arp(12, 0.6, 0.15);
    } else if (style === 'alberti') {
      const top = voicing[voicing.length - 1];
      const mid = voicing[Math.floor(voicing.length / 2)];
      [voicing[0], top, mid, top, voicing[0], top, mid, top].forEach((n, i) => key(n, i / 2, 0.9, 0.16));
      low(0, 3.88, 0.32);
    } else {
      chord(0, 3.88);
      low(0, 3.88, 0.32);
    }
    return events;
  }

  function scheduleBar(bus, style, voicing, bass, t, beat) {
    styleEvents(style, voicing, bass).forEach((e) => {
      const play = e.inst === 'bass' ? bassNote : e.inst === 'pad' ? padNote : keyNote;
      play(bus, e.note, t + e.beat * beat, e.dur * beat, e.vel);
    });
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
          if (s.melody && s.melody[i]) scheduleMelody(this.bus, s.melody[i], this.next, beat, s.rhythm);
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

  // 1小節ぶんのメロディを、そのコードの白玉と一緒に鳴らす
  function previewBar(voicing, bass, notes, bpm) {
    ensureContext();
    if (previewBus) closeBus(previewBus);
    previewBus = newBus();
    const beat = 60 / (bpm || 90);
    const t = ctx.currentTime + 0.02;
    chordAt(previewBus, voicing, bass, t, beat * 4);
    scheduleMelody(previewBus, notes, t, beat);
  }

  global.ChordAudio = { Player, preview, previewBar, drumEvents, styleEvents, slotBeat };
})(window);
