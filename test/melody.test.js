'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/theory.js');
const M = require('../js/melody.js');

const mod = (n, m) => ((n % m) + m) % m;
const J = JSON.stringify;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function samples(count, rng) {
  const out = [];
  for (let n = 0; n < count; n++) {
    const mode = n % 2 ? 'major' : 'minor';
    const bars = [2, 4, 8][n % 3];
    const keyPc = n % 12;
    const style = n % 4 < 2 ? 'calm' : 'lively';
    const chords = T.generate({ mode, bars, color: 'mix', outside: 0.2, feel: ['smooth', 'balanced', 'random'][n % 3] }, [], []);
    out.push({ mode, keyPc, style, chords, tune: M.generate({ keyPc, mode, chords, style, rng }) });
  }
  return out;
}

test('メロディは歌える音域・小節の中に収まり、強拍はコードの音、ほかもキーかコードの音', () => {
  for (const { mode, keyPc, chords, tune } of samples(600, seeded(1))) {
    assert.equal(tune.length, chords.length);
    tune.forEach((notes, i) => {
      const info = M.chordInfo(keyPc, mode, chords[i]);
      let end = 0;
      notes.forEach((n) => {
        assert.ok(n.p >= M.LOW && n.p <= M.HIGH, `range ${n.p}`);
        assert.ok(n.s >= end && n.l >= 1 && n.s + n.l <= M.SLOTS, `bar ${J(notes)}`);
        end = n.s + n.l;
        const pc = mod(n.p, 12);
        if (n.s === 0 || n.s === 4 || n.l >= 3) assert.ok(info.tones.includes(pc), `strong ${J(n)}`);
        assert.ok(info.scale.includes(pc) || info.tones.includes(pc), `scale ${J(n)}`);
      });
    });
  }
});

test('順次進行が中心で、コード外の音は隣の音へ解決し、リズムのくり返し（モチーフ）がある', () => {
  let steps = 0;
  let intervals = 0;
  let big = 0;
  let passing = 0;
  let resolved = 0;
  let repeated = 0;
  let phrases = 0;
  const list = samples(600, seeded(2));
  for (const { mode, keyPc, chords, tune } of list) {
    const flat = [];
    tune.forEach((notes, i) => {
      const tones = M.chordInfo(keyPc, mode, chords[i]).tones;
      notes.forEach((n) => flat.push({ p: n.p, tones }));
    });
    flat.forEach((n, k) => {
      const next = flat[(k + 1) % flat.length];
      const d = Math.abs(next.p - n.p);
      if (k + 1 < flat.length) {
        intervals += 1;
        if (d >= 1 && d <= 2) steps += 1;
        if (d > 7) big += 1;
      }
      if (!n.tones.includes(mod(n.p, 12))) {
        passing += 1;
        if (d >= 1 && d <= 2) resolved += 1;
      }
    });
    const rhythms = tune.map((notes) => J(M.rhythmOf(notes)));
    if (tune.length >= 4) {
      phrases += 1;
      if (new Set(rhythms).size < rhythms.length) repeated += 1;
    }
  }
  assert.ok(steps / intervals > 0.5, `steps ${steps / intervals}`);
  assert.ok(big / intervals < 0.02, `big leaps ${big / intervals}`);
  assert.ok(resolved / passing > 0.9, `resolved ${resolved / passing}`);
  assert.ok(repeated / phrases > 0.8, `motifs ${repeated / phrases}`);
});

test('Lively は Calm より音が多い', () => {
  const count = (style) => {
    const rng = seeded(3);
    let notes = 0;
    for (let n = 0; n < 200; n++) {
      const chords = T.generate({ mode: 'major', bars: 4 }, [], []);
      notes += [].concat(...M.generate({ keyPc: 0, mode: 'major', chords, style, rng })).length;
    }
    return notes;
  };
  assert.ok(count('lively') > count('calm') * 1.3);
});

test('固定した小節はそのまま、指定したリズムで作り直せ、同じ乱数なら同じメロディ', () => {
  const chords = T.decodeChords('major', 'I.maj_VIm.m_IV.maj_V.dom7');
  const current = M.generate({ keyPc: 0, mode: 'major', chords, rng: seeded(4) });
  const rng = seeded(5);
  for (let n = 0; n < 100; n++) {
    const out = M.generate({
      keyPc: 0, mode: 'major', chords, current, rng,
      keep: [true, false, true, true], rhythms: { 1: M.rhythmOf(current[1]) },
    });
    assert.deepEqual([out[0], out[2], out[3]], [current[0], current[2], current[3]]);
    assert.deepEqual(M.rhythmOf(out[1]), M.rhythmOf(current[1]));
  }
  const again = M.generate({ keyPc: 0, mode: 'major', chords, rng: seeded(4) });
  assert.deepEqual(again, current);
});

test('URL用の文字列に書き出して元に戻せ、壊れた文字列は受け付けない', () => {
  for (const { tune } of samples(60, seeded(6))) {
    assert.deepEqual(M.decode(M.encode(tune), tune.length), tune);
  }
  assert.deepEqual(M.decode('04o44q_-', 2), [[{ s: 0, l: 4, p: 60 }, { s: 4, l: 4, p: 62 }], []]);
  for (const bad of ['', '_-', '04o', '04o_-_-', '04o3_-', '05o44q_-', '09o_-', '00o_-', '04!_-', '4ao_-']) {
    assert.equal(M.decode(bad, 2), null, bad);
  }
});

test('移調は固定した小節を動かさず、ほかを同じ幅で音域に近いオクターブへ動かす', () => {
  const tune = [[{ s: 0, l: 8, p: 60 }], [{ s: 0, l: 4, p: 76 }, { s: 4, l: 4, p: 74 }]];
  assert.deepEqual(M.transpose(tune, 2, [true]), [tune[0], [{ s: 0, l: 4, p: 78 - 12 }, { s: 4, l: 4, p: 76 - 12 }]]);
  assert.deepEqual(M.transpose(tune, -1), [[{ s: 0, l: 8, p: 59 }], [{ s: 0, l: 4, p: 75 }, { s: 4, l: 4, p: 73 }]]);
  assert.deepEqual(M.transpose(tune, 12), tune);
});

test('音名はキーとコードに合わせて ♯/♭ を書き分ける', () => {
  const E7 = { deg: 2, semi: 4, q: 'dom7', tag: 'secdom' };
  const F = { deg: 0, semi: 0, q: 'maj', tag: 'diatonic' };
  assert.equal(M.noteName(0, 'major', E7, 68), 'G♯');
  assert.equal(M.noteName(5, 'major', F, 70), 'B♭');
  assert.equal(M.noteName(0, 'major', { deg: 0, semi: 0, q: 'maj', tag: 'diatonic' }, 62), 'D');
  assert.deepEqual(M.noteNames(9, 'minor', { deg: 0, semi: 0, q: 'm', tag: 'diatonic' }, [{ s: 0, l: 2, p: 69 }, { s: 2, l: 2, p: 71 }]), ['A', 'B']);
  const bIII = { deg: 2, semi: 3, q: 'maj', tag: 'borrowed' };
  assert.equal(M.noteNames(1, 'major', bIII, [64, 66, 68, 69].map((p) => ({ p }))).join(' '), 'E F♯ G♯ A');
});
