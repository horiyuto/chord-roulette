'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/theory.js');
const M = require('../js/midi.js');
const fs = require('node:fs');
const vm = require('node:vm');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chord = (mode, id, q) => T.chordFromId(mode, id, q);

test('キーに合わせてコード名を書く', () => {
  const am = ['Im', 'bVI', 'bIII', 'bVII', 'V'].map((id, i) => chord('minor', id, ['m', 'maj', 'maj', 'maj', 'dom7'][i]));
  assert.deepEqual(am.map((c) => T.chordName(9, 'minor', c)), ['Am', 'F', 'C', 'G', 'E7']);

  assert.equal(T.chordName(1, 'major', chord('major', 'bVI', 'maj')), 'A');
  assert.equal(T.chordName(6, 'major', chord('major', 'VIIm7b5', 'm7b5')), 'Fm7(♭5)');
  assert.equal(T.chordName(3, 'minor', chord('minor', 'V', 'dom7')), 'B♭7');
  assert.equal(T.keyLabel(1, 'major'), 'D♭ メジャー');
  assert.equal(T.keyLabel(1, 'minor'), 'C♯ マイナー');
});

test('構成音を音名で返す', () => {
  assert.deepEqual(T.chordToneNames(0, 'major', chord('major', 'IIm', 'm7')), ['D', 'F', 'A', 'C']);
  assert.deepEqual(T.chordToneNames(0, 'major', chord('major', 'sIdim7', 'dim7')), ['C♯', 'E', 'G', 'B♭']);
  assert.deepEqual(T.chordToneNames(1, 'minor', chord('minor', 'V', 'dom7')), ['G♯', 'B♯', 'D♯', 'F♯']);
});

test('度数表記（マイナーは主音基準と平行調基準）', () => {
  assert.equal(T.romanName(chord('major', 'IIm', 'm7'), 'major'), 'IIm7');
  assert.equal(T.romanName(chord('major', 'bVII', 'maj'), 'major'), '♭VII');
  assert.equal(T.romanName(chord('major', 'sIVm7b5', 'm7b5'), 'major'), '♯IVm7(♭5)');

  const prog = [['Im', 'm'], ['bVI', 'maj'], ['bIII', 'maj'], ['bVII', 'maj']].map(([id, q]) => chord('minor', id, q));
  assert.deepEqual(prog.map((c) => T.romanName(c, 'minor', 'tonic')), ['Im', '♭VI', '♭III', '♭VII']);
  assert.deepEqual(prog.map((c) => T.romanName(c, 'minor', 'relative')), ['VIm', 'IV', 'I', 'V']);
  assert.equal(T.romanName(chord('minor', 'V', 'dom7'), 'minor', 'relative'), 'III7');
});

test('セカンダリードミナントには解決先を添える', () => {
  assert.equal(T.tagLabel(chord('major', 'III7', 'dom7'), 'major'), 'セカンダリードミナント（→ VIm）');
});

test('ランダム提案: 4小節・固定は維持・隣り合う小節で同じルートが続かない', () => {
  for (const mode of ['major', 'minor']) {
    for (const color of ['triad', 'seventh', 'mix', 'rich']) {
      for (let seed = 1; seed <= 150; seed++) {
        const rng = seeded(seed * 31 + color.length);
        const first = T.generate({ mode, color, outside: 0.45 }, null, null, rng);
        assert.equal(first.length, 4);
        first.forEach((c) => assert.ok(T.QUALITIES[c.q], `${c.id}.${c.q}`));
        for (let i = 0; i < 4; i++) {
          assert.notEqual(first[i].semi, first[(i + 1) % 4].semi, `${mode} ${T.encodeChords(first)}`);
        }
        const locks = [true, false, true, false];
        const next = T.generate({ mode, color, outside: 0.45 }, first, locks, rng);
        assert.equal(next[0], first[0]);
        assert.equal(next[2], first[2]);
      }
    }
  }
});

test('ノンダイアトニック「なし」ならダイアトニックだけ', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const p = T.generate({ mode: seed % 2 ? 'major' : 'minor', outside: 0 }, null, null, seeded(seed));
    p.forEach((c) => assert.ok(['diatonic', 'harmonic'].includes(c.tag), c.id));
  }
});

test('1小節目をトニックから始められる', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const p = T.generate({ mode: 'major', startTonic: true, outside: 0.2 }, null, null, seeded(seed));
    assert.equal(p[0].id, 'I');
  }
});

test('2・4・8小節の進行を生成し、ループ境界でも同じルートを避ける', () => {
  for (const bars of [2, 4, 8]) {
    const progression = T.generate({ mode: 'major', bars, outside: 0.2 }, null, null, seeded(bars));
    assert.equal(progression.length, bars);
    progression.forEach((c, i) => assert.notEqual(c.semi, progression[(i + 1) % bars].semi));
  }
});

test('1小節だけ変えると、そのコードは別のものになる', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    const p = T.generate({ mode: 'major', color: 'triad', outside: 0 }, null, null, rng);
    const q = T.generate({ mode: 'major', color: 'triad', outside: 0, avoid: { 1: p[1] } }, p, [true, false, true, true], rng);
    assert.ok(q[1].id !== p[1].id || q[1].q !== p[1].q);
    assert.equal(q[0], p[0]);
  }
});

test('ボイシングは決めた音域に収まる', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const keyPc = seed % 12;
    const p = T.generate({ mode: 'major', color: 'rich', outside: 0.45 }, null, null, seeded(seed));
    for (const withBass of [true, false]) {
      T.voiceProgression(keyPc, p, withBass).forEach((notes, i) => {
        assert.ok(notes[0] >= 52 && notes[0] <= 64, `low ${notes}`);
        assert.ok(notes[notes.length - 1] <= 83, `high ${notes}`);
        assert.ok(notes.length >= 3 && notes.length <= 4);
        for (let j = 1; j < notes.length; j++) assert.ok(notes[j] > notes[j - 1]);
        const pcs = new Set(T.QUALITIES[p[i].q].iv.map((x) => T.mod(T.rootPc(keyPc, p[i]) + x, 12)));
        notes.forEach((n) => assert.ok(pcs.has(T.mod(n, 12))));
      });
    }
    p.forEach((c) => {
      const b = T.bassNote(keyPc, c);
      assert.ok(b >= 40 && b <= 51);
      assert.equal(T.mod(b, 12), T.rootPc(keyPc, c));
    });
  }
});

test('URL用の文字列から元に戻せる', () => {
  const p = T.generate({ mode: 'minor', color: 'mix', outside: 0.45 }, null, null, seeded(7));
  assert.deepEqual(T.decodeChords('minor', T.encodeChords(p)), p);
  assert.equal(T.decodeChords('minor', 'Im.m_nope.m'), null);
  assert.equal(T.decodeChords('major', ''), null);
});

test('MIDIファイルの形式', () => {
  const data = M.buildMidi({ bars: [{ notes: [45, 57, 60, 64] }, { notes: [41, 57, 60, 65] }], bpm: 90, name: 'test' });
  const ascii = (a, b) => String.fromCharCode(...data.slice(a, b));
  assert.equal(ascii(0, 4), 'MThd');
  assert.deepEqual([...data.slice(8, 14)], [0, 0, 0, 1, 0x01, 0xe0]);
  assert.equal(ascii(14, 18), 'MTrk');
  const len = (data[18] << 24) | (data[19] << 16) | (data[20] << 8) | data[21];
  assert.equal(len, data.length - 22);
  assert.deepEqual([...data.slice(-4)], [0x00, 0xff, 0x2f, 0x00]);
  const usPerQuarter = Math.round(60000000 / 90);
  const tempoAt = data.indexOf(0x51);
  assert.equal((data[tempoAt + 2] << 16) | (data[tempoAt + 3] << 8) | data[tempoAt + 4], usPerQuarter);
  const noteOns = data.filter((b, i) => b === 0x90 && i > 22).length;
  assert.equal(noteOns, 8);
});

test('ドラムのリズムパターンは小節内の指定拍に配置される', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/audio.js'), 'utf8'), { window });
  const events = window.ChordAudio.drumEvents;
  const summarize = (pattern, sound) => Array.from(events(pattern))
    .filter((event) => event.sound === sound)
    .map((event) => event.beat);

  assert.deepEqual(summarize('none', 'kick'), []);
  assert.deepEqual(summarize('eight', 'kick'), [0, 2]);
  assert.deepEqual(summarize('eight', 'snare'), [1, 3]);
  assert.deepEqual(summarize('four', 'kick'), [0, 1, 2, 3]);
  assert.deepEqual(summarize('half', 'kick'), [0]);
  assert.deepEqual(summarize('half', 'snare'), [2]);
  assert.deepEqual(summarize('eight', 'hat'), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
});

test('ファイル名用に記号をASCIIへ置き換える', () => {
  assert.equal(M.asciiName('B♭m7(♭5)'), 'Bbm7b5');
  assert.equal(M.asciiName('F♯ minor'), 'F#-minor');
});
