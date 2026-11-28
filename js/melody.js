/* コードルーレット: 歌メロディの提案（ブラウザ / Node 共通） */
(function (global) {
  'use strict';

  const T = typeof module !== 'undefined' && module.exports ? require('./theory.js') : global.ChordTheory;
  const mod = (n, m) => ((n % m) + m) % m;

  // 1小節を8分音符8つに分ける。音は {s: 開始, l: 長さ, p: MIDI番号}
  const SLOTS = 8;
  const LOW = 58; // B♭3
  const HIGH = 77; // F5
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

  const RHYTHMS = {
    calm: {
      body: [
        [[0, 2], [2, 2], [4, 4]],
        [[0, 3], [3, 1], [4, 4]],
        [[0, 2], [2, 2], [4, 2], [6, 2]],
        [[0, 3], [3, 3], [6, 2]],
        [[2, 2], [4, 2], [6, 2]],
        [[0, 4], [4, 2], [6, 2]],
        [[0, 2], [2, 1], [3, 1], [4, 4]],
        [[1, 1], [2, 2], [4, 3]],
      ],
      end: [
        [[0, 2], [2, 6]],
        [[0, 4], [4, 4]],
        [[0, 6]],
        [[0, 2], [2, 2], [4, 4]],
      ],
    },
    lively: {
      body: [
        [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2]],
        [[0, 2], [2, 1], [3, 3], [6, 1], [7, 1]],
        [[0, 1], [1, 2], [3, 1], [4, 2], [6, 2]],
        [[1, 1], [2, 1], [3, 2], [5, 1], [6, 2]],
        [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [6, 2]],
        [[0, 3], [3, 1], [4, 1], [5, 1], [6, 2]],
        [[0, 2], [2, 2], [4, 1], [5, 2], [7, 1]],
        [[0, 1], [1, 1], [2, 1], [3, 3], [6, 2]],
      ],
      end: [
        [[0, 1], [1, 1], [2, 6]],
        [[0, 2], [2, 1], [3, 5]],
        [[0, 1], [1, 1], [2, 1], [3, 1], [4, 4]],
        [[0, 3], [3, 5]],
      ],
    },
  };

  // 同じ文字の小節は同じリズム（とできれば同じ形の旋律）。H は途中の区切り、E は最後
  const PLANS = {
    2: [[['a', 'E'], 1]],
    4: [[['a', 'b', 'a', 'E'], 3], [['a', 'a', 'b', 'E'], 2], [['a', 'b', 'c', 'E'], 1]],
    8: [
      [['a', 'b', 'a', 'H', 'a', 'b', 'a', 'E'], 3],
      [['a', 'b', 'a', 'H', 'a', 'b', 'c', 'E'], 2],
      [['a', 'a', 'b', 'H', 'a', 'a', 'b', 'E'], 1],
    ],
  };

  // 小節ごとの高さの目安（山なりにして、8小節では後半を高くする）
  const SHAPES = { 2: [0, -1], 4: [-1, 1, 3, -1], 8: [-2, 0, 2, -1, 0, 2, 5, -1] };

  // 前の音からの半音数ごとの選びやすさ（同音・2度が多め、跳躍は少なめ）
  const INTERVAL_W = [1, 3, 3, 1.6, 1.6, 0.9, 0.05, 0.5, 0.15, 0.15, 0.03, 0.03, 0.1];
  const intervalWeight = (d) => INTERVAL_W[Math.abs(d)] || 0.01;

  const OFFSET = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6, 13: 1, 14: 1 };

  // コードごとに、使える音（コードトーンと、キーの音階をコードに合わせて変えた音階）をまとめる
  function chordInfo(keyPc, mode, chord) {
    const iv = T.QUALITIES[chord.q].iv;
    const root = T.rootPc(keyPc, chord);
    const at = (x) => mod(root + x, 12);
    const minorBase = mode === 'major' ? ['borrowed', 'neapolitan'].includes(chord.tag) : chord.tag !== 'borrowed';
    const scale = SCALES[minorBase ? 'minor' : 'major'].map((s) => mod(keyPc + s, 12));
    iv.forEach((x) => {
      const offset = chord.q === 'dim7' && x === 9 ? 6 : OFFSET[x];
      scale[(chord.deg + offset) % 7] = at(x);
    });
    const tones = iv.map(at);
    const near = new Set();
    tones.forEach((t) => { near.add(mod(t - 1, 12)); near.add(mod(t + 1, 12)); });
    return {
      root,
      tones,
      scale,
      strong: iv.filter((x) => x !== 13).map(at),
      stable: iv.filter((x) => [0, 3, 4, 5, 7].includes(x)).map(at),
      tension: iv.filter((x) => x >= 9).map(at),
      near: scale.filter((pc) => !tones.includes(pc) && near.has(pc)),
    };
  }

  // 拍の頭（1・3拍目）、長い音、フレーズの最後はコードトーン。それ以外は音階の音で、長い音はコードトーンと半音でぶつからない音
  function allowed(pc, note, info) {
    if (note.final) return info.stable.includes(pc);
    if (note.strong) return info.strong.includes(pc);
    if (!info.scale.includes(pc)) return false;
    return !(note.long && info.near.includes(pc));
  }

  function describe(s, l, final) {
    return { strong: s === 0 || s === 4 || l >= 3 || final, long: l >= 2, final };
  }

  function pickWeighted(items, weightOf, rng) {
    const weights = items.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return items[Math.floor(rng() * items.length)];
    let r = rng() * total;
    for (let k = 0; k < items.length; k++) {
      r -= weights[k];
      if (r < 0) return items[k];
    }
    return items[items.length - 1];
  }

  function newRun() {
    return { prev: null, prevIv: 0, prevNonChord: false, repeats: 0, run: 0, runDir: 0 };
  }

  function advance(run, p, info) {
    if (run.prev != null) {
      const d = p - run.prev;
      run.repeats = d === 0 ? run.repeats + 1 : 0;
      if (d) {
        run.run = Math.sign(d) === run.runDir ? run.run + 1 : 1;
        run.runDir = Math.sign(d);
      }
      run.prevIv = d;
    }
    run.prev = p;
    run.prevNonChord = !info.tones.includes(mod(p, 12));
  }

  // コードトーン以外の音は、次の音へ2度で進めるときだけ使う
  function resolvable(m, tones) {
    return tones.some((t) => {
      for (let p = m - 2; p <= m + 2; p++) if (p !== m && mod(p, 12) === t && p >= LOW && p <= HIGH) return true;
      return false;
    });
  }

  function choosePitch(note, ctx, run) {
    const maxLeap = ctx.style === 'lively' ? 12 : 7;
    const range = [];
    for (let m = LOW; m <= HIGH; m++) if (allowed(mod(m, 12), note, ctx.info)) range.push(m);
    const strict = range.filter((m) => {
      const chordTone = ctx.info.tones.includes(mod(m, 12));
      if (run.prev != null) {
        const d = Math.abs(m - run.prev);
        if (d > maxLeap) return false;
        if (run.prevNonChord && (d === 0 || d > 2)) return false;
        if (d === 0 && run.repeats >= 2) return false;
      }
      if (!chordTone) {
        if (note.next != null) return m !== note.next && Math.abs(m - note.next) <= 2;
        if (!resolvable(m, note.last ? ctx.nextTones : ctx.info.tones)) return false;
      }
      return true;
    });
    const list = strict.length ? strict : range;
    return pickWeighted(list, (m) => weigh(m, note, ctx, run), ctx.rng);
  }

  function weigh(m, note, ctx, run) {
    let w = 1;
    if (run.prev != null) {
      const d = m - run.prev;
      w *= intervalWeight(d);
      if (d === 0 && ctx.style === 'calm') w *= 0.8;
      if (Math.abs(run.prevIv) >= 5 && d !== 0) w *= Math.sign(d) === Math.sign(run.prevIv) ? 0.25 : 2.5;
      if (run.run >= 3 && d !== 0 && Math.sign(d) === run.runDir) w *= 0.5;
      if (note.want != null) w *= d === note.want ? 5 : Math.sign(d) === Math.sign(note.want) ? 1.6 : 0.7;
    }
    const off = m - note.target;
    w *= Math.exp(-(off * off) / 32);
    const pc = mod(m, 12);
    const fromRoot = mod(m - ctx.info.root, 12);
    if (note.final) {
      if (pc === ctx.keyPc) w *= 4;
      else if (fromRoot === 0) w *= 2;
      else if (fromRoot === 3 || fromRoot === 4) w *= 1.5;
    } else if (note.strong && ctx.info.tension.includes(pc)) {
      w *= 0.6;
    }
    if (note.next != null) w *= Math.sqrt(intervalWeight(note.next - m));
    return Math.max(w, 1e-9);
  }

  function freshBar(rhythm, ctx, run0, guide) {
    const run = Object.assign({}, run0);
    return rhythm.map(([s, l], k) => {
      const last = k === rhythm.length - 1;
      const note = Object.assign(describe(s, l, ctx.final && last), {
        last,
        next: last ? ctx.next : null,
        target: ctx.final && last ? ctx.target - 2 : ctx.target,
        want: guide && k > 0 ? guide[k].p - guide[k - 1].p : null,
      });
      const p = choosePitch(note, ctx, run);
      advance(run, p, ctx.info);
      return { s, l, p };
    });
  }

  function fits(ps, rhythm, ctx, run) {
    const last = rhythm.length - 1;
    for (let k = 0; k <= last; k++) {
      const p = ps[k];
      if (p < LOW || p > HIGH) return false;
      if (!allowed(mod(p, 12), describe(rhythm[k][0], rhythm[k][1], ctx.final && k === last), ctx.info)) return false;
      const prev = k ? ps[k - 1] : run.prev;
      const prevNonChord = k ? !ctx.info.tones.includes(mod(prev, 12)) : run.prevNonChord;
      if (prev == null) continue;
      const d = Math.abs(p - prev);
      if (prevNonChord && (d === 0 || d > 2)) return false;
      if (k === 0 && d > (ctx.style === 'lively' ? 12 : 7)) return false;
    }
    const end = ps[last];
    if (ctx.next != null && !ctx.info.tones.includes(mod(end, 12))) {
      const d = Math.abs(ctx.next - end);
      if (d === 0 || d > 2) return false;
    }
    return true;
  }

  // 同じリズムの小節は、旋律の形をそのまま、または音階に沿ってずらして使う（ゼクエンツ）
  function sequence(src, ctx, run) {
    const rhythm = src.map((n) => [n.s, n.l]);
    const ladder = [];
    for (let m = LOW - 12; m <= HIGH + 12; m++) if (ctx.info.scale.includes(mod(m, 12))) ladder.push(m);
    const nearest = (p) => ladder.reduce((best, m, k) => (Math.abs(m - p) < Math.abs(ladder[best] - p) ? k : best), 0);
    const cands = [];
    for (let s = -7; s <= 7; s++) cands.push({ ps: src.map((n) => n.p + s), w: s === 0 ? 3 : 0.5 });
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const ps = src.map((n) => ladder[nearest(n.p) + k]);
      if (ps.every((p) => p != null)) cands.push({ ps, w: 1.5 });
    }
    const seen = new Set();
    const valid = cands.filter((c) => {
      const id = c.ps.join(',');
      if (seen.has(id) || !fits(c.ps, rhythm, ctx, run)) return false;
      seen.add(id);
      return true;
    });
    if (!valid.length) return null;
    const pick = pickWeighted(valid, (c) => {
      const avg = c.ps.reduce((a, b) => a + b, 0) / c.ps.length;
      const off = avg - ctx.target;
      const join = run.prev != null ? intervalWeight(c.ps[0] - run.prev) : 1;
      return c.w * Math.exp(-(off * off) / 50) * join;
    }, ctx.rng);
    return src.map((n, k) => ({ s: n.s, l: n.l, p: pick.ps[k] }));
  }

  const rhythmKey = (notes) => notes.map((n) => (Array.isArray(n) ? n.join('.') : `${n.s}.${n.l}`)).join(',');

  function attempt(o, rng) {
    const { keyPc, mode, chords, style, current, keep, rhythms } = o;
    const bars = chords.length;
    const infos = chords.map((c) => chordInfo(keyPc, mode, c));
    const pool = RHYTHMS[style] || RHYTHMS.calm;
    const planList = PLANS[bars];
    const plan = planList
      ? pickWeighted(planList, (x) => x[1], rng)[0]
      : Array.from({ length: bars }, (_, i) => (i === bars - 1 ? 'E' : i % 2 ? 'b' : 'a'));
    const center = 66 + Math.floor(rng() * 5) - 2;
    const shape = SHAPES[bars] || plan.map((x, i) => (x === 'E' ? -1 : i % 4));
    const kept = (i) => (keep[i] && current[i] ? current[i] : null);

    const byLetter = {};
    const used = [];
    const rhythmFor = (letter) => {
      if (!byLetter[letter]) {
        const list = letter === 'E' || letter === 'H' ? pool.end : pool.body;
        const fresh = list.filter((r) => !used.includes(rhythmKey(r)));
        byLetter[letter] = pickWeighted(fresh.length ? fresh : list, () => 1, rng);
        used.push(rhythmKey(byLetter[letter]));
      }
      return byLetter[letter];
    };

    const out = [];
    const run = newRun();
    let motifs = 0;
    for (let i = 0; i < bars; i++) {
      if (kept(i)) {
        out[i] = kept(i).map((n) => ({ s: n.s, l: n.l, p: n.p }));
        out[i].forEach((n) => advance(run, n.p, infos[i]));
        continue;
      }
      const rhythm = rhythms[i] || rhythmFor(plan[i]);
      const after = i < bars - 1 ? kept(i + 1) : out[0] || kept(0);
      const ctx = {
        info: infos[i],
        nextTones: infos[(i + 1) % bars].tones,
        keyPc,
        style,
        rng,
        final: plan[i] === 'E' || plan[i] === 'H',
        target: center + shape[i],
        next: after && after.length ? after[0].p : null,
      };
      const key = rhythmKey(rhythm);
      let src = null;
      for (let j = i - 1; j >= 0 && !src; j--) if (out[j] && rhythmKey(out[j]) === key) src = out[j];
      for (let j = i + 1; j < bars && !src; j++) if (kept(j) && rhythmKey(kept(j)) === key) src = kept(j);
      let notes = src ? sequence(src, ctx, run) : null;
      if (notes) motifs += 1;
      else notes = freshBar(rhythm, ctx, run, src);
      notes.forEach((n) => advance(run, n.p, infos[i]));
      out[i] = notes;
    }
    return { tune: out, motifs };
  }

  // 歩くような動き（2度）が多く、大きな跳躍が少なく、音域が広すぎないものを選ぶ
  function score(tune, motifs, rng) {
    const ps = [].concat(...tune).map((n) => n.p);
    let steps = 0;
    let leaps = 0;
    let big = 0;
    for (let k = 1; k < ps.length; k++) {
      const d = Math.abs(ps[k] - ps[k - 1]);
      if (d >= 1 && d <= 2) steps += 1;
      if (d >= 5) leaps += 1;
      if (d > 7) big += 1;
    }
    const n = Math.max(1, ps.length - 1);
    const span = ps.length ? Math.max(...ps) - Math.min(...ps) : 0;
    return motifs * 0.6 + (steps / n) * 2 - (leaps / n) * 1.5 - big * 0.8
      - Math.max(0, span - 14) * 0.4 - (span < 5 ? 1 : 0) + rng() * 1.2;
  }

  // keep[i] の小節はそのまま、rhythms[i] があればそのリズムで作り直す
  function generate(options) {
    const o = Object.assign({ style: 'calm', current: [], keep: [], rhythms: [] }, options);
    const rng = o.rng || Math.random;
    let best = null;
    let bestScore = -Infinity;
    for (let n = 0; n < 6; n++) {
      const { tune, motifs } = attempt(o, rng);
      const s = score(tune, motifs, rng);
      if (s > bestScore) {
        best = tune;
        bestScore = s;
      }
    }
    return best;
  }

  function rhythmOf(notes) {
    return notes && notes.length ? notes.map((n) => [n.s, n.l]) : null;
  }

  // 固定していない小節を移調する。1オクターブ上下のうち、音域に収まるほうを選ぶ
  function transpose(tune, semis, locks) {
    const d = mod(semis, 12);
    const free = (i) => !(locks && locks[i]);
    let best = 0;
    let bestOut = Infinity;
    (d ? [d, d - 12] : [0]).forEach((s) => {
      let outside = 0;
      tune.forEach((notes, i) => {
        if (free(i)) notes.forEach((n) => { outside += Math.max(0, LOW - n.p - s, n.p + s - HIGH); });
      });
      if (outside < bestOut) {
        best = s;
        bestOut = outside;
      }
    });
    return tune.map((notes, i) => (free(i) ? notes.map((n) => ({ s: n.s, l: n.l, p: n.p + best })) : notes));
  }

  // ---- URL 共有用: 1音を「開始・長さ・高さ」の3文字で書く ----
  const PITCH_BASE = 36;
  const PITCH_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function encode(tune) {
    return tune.map((notes) => (notes.length
      ? notes.map((n) => `${n.s}${n.l}${PITCH_CHARS[n.p - PITCH_BASE]}`).join('')
      : '-')).join('_');
  }

  function decode(text, bars) {
    if (!text) return null;
    const parts = text.split('_');
    if (bars != null && parts.length !== bars) return null;
    const tune = [];
    for (const part of parts) {
      if (part === '-') {
        tune.push([]);
        continue;
      }
      if (!part || part.length % 3) return null;
      const notes = [];
      let end = 0;
      for (let k = 0; k < part.length; k += 3) {
        const s = Number(part[k]);
        const l = Number(part[k + 1]);
        const idx = PITCH_CHARS.indexOf(part[k + 2]);
        if (!(s >= end && l >= 1 && s + l <= SLOTS && idx >= 0)) return null;
        notes.push({ s, l, p: PITCH_BASE + idx });
        end = s + l;
      }
      tune.push(notes);
    }
    return tune;
  }

  // ---- 表示用の音名 ----
  function scaleName(keyPc, mode, pc) {
    const steps = SCALES[mode];
    const d = steps.findIndex((s) => mod(keyPc + s, 12) === pc);
    return d >= 0 ? T.chordName(keyPc, mode, { deg: d, semi: steps[d], q: 'maj' }) : null;
  }

  // コードの音階の音は、コード名のルートから数えた文字で書く（E のコードなら G♭ ではなく F♯）
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  function chordScaleName(keyPc, mode, chord, pc) {
    const j = chordInfo(keyPc, mode, chord).scale.indexOf(pc);
    if (j < 0) return null;
    const letter = (T.spellRoot(keyPc, mode, chord).letter + mod(j - chord.deg, 7)) % 7;
    let acc = mod(pc - LETTER_PC[letter], 12);
    if (acc > 6) acc -= 12;
    if (Math.abs(acc) > 1) return null;
    return LETTERS[letter] + ['♭', '', '♯'][acc + 1];
  }

  function noteName(keyPc, mode, chord, midi) {
    const pc = mod(midi, 12);
    const k = T.QUALITIES[chord.q].iv.findIndex((x) => mod(T.rootPc(keyPc, chord) + x, 12) === pc);
    if (k >= 0) return T.chordToneNames(keyPc, mode, chord)[k];
    const inChord = chordScaleName(keyPc, mode, chord, pc);
    if (inChord) return inChord;
    const inKey = scaleName(keyPc, mode, pc);
    if (inKey) return inKey;
    const flats = SCALES[mode].some((s) => scaleName(keyPc, mode, mod(keyPc + s, 12)).includes('♭'));
    const steps = SCALES[mode];
    const order = flats ? [1, -1] : [-1, 1];
    for (const dir of order) {
      const d = steps.findIndex((s) => mod(keyPc + s, 12) === mod(pc + dir, 12));
      if (d >= 0) return T.chordName(keyPc, mode, { deg: d, semi: mod(pc - keyPc, 12), q: 'maj' });
    }
    return String(pc);
  }

  function noteNames(keyPc, mode, chord, notes) {
    return notes.map((n) => noteName(keyPc, mode, chord, n.p));
  }

  const api = {
    SLOTS, LOW, HIGH, RHYTHMS, PLANS,
    chordInfo, generate, rhythmOf, transpose, encode, decode, noteName, noteNames,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChordMelody = api;
})(typeof window !== 'undefined' ? window : globalThis);
