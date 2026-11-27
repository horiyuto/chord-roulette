/* コードルーレット: 音楽理論まわり（ブラウザ / Node 共通） */
(function (global) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const ACC = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };

  const mod = (n, m) => ((n % m) + m) % m;

  const QUALITIES = {
    maj: { suffix: '', iv: [0, 4, 7] },
    m: { suffix: 'm', iv: [0, 3, 7] },
    dim: { suffix: 'dim', iv: [0, 3, 6] },
    sus4: { suffix: 'sus4', iv: [0, 5, 7] },
    six: { suffix: '6', iv: [0, 4, 7, 9] },
    m6: { suffix: 'm6', iv: [0, 3, 7, 9] },
    M7: { suffix: 'M7', iv: [0, 4, 7, 11] },
    dom7: { suffix: '7', iv: [0, 4, 7, 10] },
    m7: { suffix: 'm7', iv: [0, 3, 7, 10] },
    m7b5: { suffix: 'm7(♭5)', iv: [0, 3, 6, 10] },
    dim7: { suffix: 'dim7', iv: [0, 3, 6, 9] },
    sus47: { suffix: '7sus4', iv: [0, 5, 7, 10] },
    add9: { suffix: 'add9', iv: [0, 4, 7, 14] },
    madd9: { suffix: 'm(add9)', iv: [0, 3, 7, 14] },
    M9: { suffix: 'M9', iv: [0, 4, 7, 11, 14] },
    dom9: { suffix: '9', iv: [0, 4, 7, 10, 14] },
    m9: { suffix: 'm9', iv: [0, 3, 7, 10, 14] },
    dom7b9: { suffix: '7(♭9)', iv: [0, 4, 7, 10, 13] },
  };

  const TAGS = {
    diatonic: 'ダイアトニック',
    harmonic: 'ハーモニックマイナー',
    secdom: 'セカンダリードミナント',
    borrowed: '同主調から借用',
    dorian: 'ドリアン由来',
    neapolitan: 'ナポリの和音',
    passing: '経過和音',
    restored: '保持したコード',
  };

  // deg: 主音から数えた音名の位置（0〜6）、semi: 主音からの半音数
  // tri / sev / ext: 3和音・4和音・テンション系の候補、w: 出やすさ
  const e = (id, deg, semi, tri, sev, ext, w, tag, target) =>
    ({ id, deg, semi, tri, sev, ext, w, tag, target: target || null, diatonic: tag === 'diatonic' || tag === 'harmonic' });

  const POOLS = {
    major: [
      e('I', 0, 0, ['maj'], ['M7'], ['add9', 'six', 'M9'], 10, 'diatonic'),
      e('IIm', 1, 2, ['m'], ['m7'], ['m9'], 8, 'diatonic'),
      e('IIIm', 2, 4, ['m'], ['m7'], ['m7'], 6, 'diatonic'),
      e('IV', 3, 5, ['maj'], ['M7'], ['add9', 'M9', 'six'], 10, 'diatonic'),
      e('V', 4, 7, ['maj', 'sus4'], ['dom7', 'sus47'], ['dom9', 'sus47'], 9, 'diatonic'),
      e('VIm', 5, 9, ['m'], ['m7'], ['m9'], 9, 'diatonic'),
      e('VIIm7b5', 6, 11, ['dim'], ['m7b5'], ['m7b5'], 2, 'diatonic'),
      e('I7', 0, 0, ['dom7'], ['dom7'], ['dom9'], 2, 'secdom', 'IV'),
      e('II7', 1, 2, ['maj'], ['dom7'], ['dom9'], 3, 'secdom', 'V'),
      e('III7', 2, 4, ['maj'], ['dom7'], ['dom7b9'], 4, 'secdom', 'VIm'),
      e('VI7', 5, 9, ['maj'], ['dom7'], ['dom7b9'], 3, 'secdom', 'IIm'),
      e('VII7', 6, 11, ['maj'], ['dom7'], ['dom7b9'], 1, 'secdom', 'IIIm'),
      e('IVm', 3, 5, ['m'], ['m7'], ['m6'], 4, 'borrowed'),
      e('bVI', 5, 8, ['maj'], ['M7'], ['add9'], 3, 'borrowed'),
      e('bVII', 6, 10, ['maj'], ['dom7'], ['dom9'], 3, 'borrowed'),
      e('bIII', 2, 3, ['maj'], ['M7'], ['M7'], 2, 'borrowed'),
      e('Vm', 4, 7, ['m'], ['m7'], ['m7'], 1, 'borrowed'),
      e('IIm7b5', 1, 2, ['dim'], ['m7b5'], ['m7b5'], 1, 'borrowed'),
      e('bII', 1, 1, ['maj'], ['M7'], ['M7'], 1, 'neapolitan'),
      e('sIVm7b5', 3, 6, ['dim'], ['m7b5'], ['m7b5'], 1, 'passing'),
      e('sIdim7', 0, 1, ['dim7'], ['dim7'], ['dim7'], 1, 'passing', 'IIm'),
    ],
    minor: [
      e('Im', 0, 0, ['m'], ['m7'], ['m9', 'madd9'], 10, 'diatonic'),
      e('IIm7b5', 1, 2, ['dim'], ['m7b5'], ['m7b5'], 3, 'diatonic'),
      e('bIII', 2, 3, ['maj'], ['M7'], ['add9', 'M9'], 7, 'diatonic'),
      e('IVm', 3, 5, ['m'], ['m7'], ['m9'], 8, 'diatonic'),
      e('Vm', 4, 7, ['m'], ['m7'], ['m7'], 5, 'diatonic'),
      e('bVI', 5, 8, ['maj'], ['M7'], ['add9', 'M9'], 9, 'diatonic'),
      e('bVII', 6, 10, ['maj', 'sus4'], ['dom7'], ['dom9'], 8, 'diatonic'),
      e('V', 4, 7, ['maj'], ['dom7'], ['dom7b9'], 6, 'harmonic'),
      e('IV', 3, 5, ['maj'], ['dom7'], ['dom9'], 3, 'dorian'),
      e('IIm', 1, 2, ['m'], ['m7'], ['m9'], 2, 'dorian'),
      e('bII', 1, 1, ['maj'], ['M7'], ['M7'], 1, 'neapolitan'),
      e('VIIdim7', 6, 11, ['dim'], ['dim7'], ['dim7'], 2, 'harmonic', 'Im'),
      e('I', 0, 0, ['maj'], ['M7'], ['M7'], 1, 'borrowed'),
      e('I7', 0, 0, ['dom7'], ['dom7'], ['dom9'], 2, 'secdom', 'IVm'),
      e('II7', 1, 2, ['maj'], ['dom7'], ['dom9'], 1, 'secdom', 'V'),
    ],
  };

  // 調号に合わせた主音の書き方 [音名の位置, 変化記号]
  const TONIC_SPELL = {
    major: [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]],
    minor: [[0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [6, -1], [6, 0]],
  };

  const MODE_LABEL = { major: 'メジャー', minor: 'マイナー' };

  function noteName(letter, acc) {
    return LETTERS[letter] + (ACC[acc] || '');
  }

  function tonicName(pc, mode) {
    const [letter, acc] = TONIC_SPELL[mode][mod(pc, 12)];
    return noteName(letter, acc);
  }

  function keyLabel(pc, mode) {
    return `${tonicName(pc, mode)} ${MODE_LABEL[mode]}`;
  }

  function simplify(letter, acc, strict) {
    const pc = mod(LETTER_PC[letter] + acc, 12);
    const awkward = Math.abs(acc) >= 2 ||
      (strict && ((acc === 1 && (letter === 2 || letter === 6)) || (acc === -1 && (letter === 3 || letter === 0))));
    if (!awkward) return { letter, acc };
    const natural = LETTER_PC.indexOf(pc);
    if (natural >= 0) return { letter: natural, acc: 0 };
    return acc > 0
      ? { letter: LETTER_PC.indexOf(mod(pc - 1, 12)), acc: 1 }
      : { letter: LETTER_PC.indexOf(mod(pc + 1, 12)), acc: -1 };
  }

  function spellRoot(keyPc, mode, chord) {
    const [tLetter] = TONIC_SPELL[mode][mod(keyPc, 12)];
    const letter = (tLetter + chord.deg) % 7;
    const pc = mod(keyPc + chord.semi, 12);
    let acc = mod(pc - LETTER_PC[letter], 12);
    if (acc > 6) acc -= 12;
    return simplify(letter, acc, true);
  }

  function rootPc(keyPc, chord) {
    return mod(keyPc + chord.semi, 12);
  }

  function chordName(keyPc, mode, chord) {
    const r = spellRoot(keyPc, mode, chord);
    return noteName(r.letter, r.acc) + QUALITIES[chord.q].suffix;
  }

  // 度数表記。minorRef = 'relative' のときはマイナーキーを平行調メジャー基準で表す
  function romanStem(deg, semi, mode, minorRef) {
    if (mode === 'minor' && minorRef === 'relative') {
      deg = mod(deg - 2, 7);
      semi = mod(semi - 3, 12);
    }
    let diff = semi - MAJOR_STEPS[deg];
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    return (ACC[diff] || '') + ROMAN[deg];
  }

  function romanName(chord, mode, minorRef) {
    return romanStem(chord.deg, chord.semi, mode, minorRef) + QUALITIES[chord.q].suffix;
  }

  const LETTER_STEP = { 0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6, 13: 1, 14: 1 };

  function chordToneNames(keyPc, mode, chord) {
    const r = spellRoot(keyPc, mode, chord);
    const rpc = mod(LETTER_PC[r.letter] + r.acc, 12);
    return QUALITIES[chord.q].iv.map((iv) => {
      const step = chord.q === 'dim7' && iv === 9 ? 6 : LETTER_STEP[iv];
      const letter = (r.letter + step) % 7;
      let acc = mod(rpc + iv - LETTER_PC[letter], 12);
      if (acc > 6) acc -= 12;
      const s = simplify(letter, acc, false);
      return noteName(s.letter, s.acc);
    });
  }

  function findEntry(mode, id) {
    return POOLS[mode].find((x) => x.id === id) || null;
  }

  function tagLabel(chord, mode, minorRef) {
    const base = TAGS[chord.tag] || '';
    if (!chord.target) return base;
    const t = findEntry(mode, chord.target);
    if (!t) return base;
    return `${base}（→ ${romanStem(t.deg, t.semi, mode, minorRef)}${QUALITIES[t.tri[0]].suffix}）`;
  }

  function weightedPick(list, rng) {
    const total = list.reduce((s, x) => s + x.w, 0);
    let r = rng() * total;
    for (const x of list) {
      r -= x.w;
      if (r < 0) return x;
    }
    return list[list.length - 1];
  }

  function pickQuality(entry, color, rng) {
    let tier;
    if (color === 'triad') tier = 'tri';
    else if (color === 'seventh') tier = 'sev';
    else if (color === 'rich') tier = rng() < 0.5 ? 'sev' : 'ext';
    else {
      const r = rng();
      tier = r < 0.4 ? 'tri' : r < 0.85 ? 'sev' : 'ext';
    }
    const list = entry[tier] && entry[tier].length ? entry[tier] : entry.tri;
    return list[Math.floor(rng() * list.length)];
  }

  function makeChord(entry, q) {
    return { id: entry.id, deg: entry.deg, semi: entry.semi, q, tag: entry.tag, target: entry.target };
  }

  function chordFromId(mode, id, q) {
    if (!Object.hasOwn(QUALITIES, q)) return null;
    // 固定・復元したコードは、生成候補にない度数・響きの組み合わせも保存する。
    const restored = /^r([0-6])-(1[01]|[0-9])$/.exec(id);
    if (restored) {
      return makeChord({ id, deg: Number(restored[1]), semi: Number(restored[2]), tag: 'restored', target: null }, q);
    }
    const entry = findEntry(mode, id);
    if (!entry) return null;
    return makeChord(entry, q);
  }

  // 実際のコード名と音は変えず、今のキーからの度数へ置き直す。
  function rebaseChord(chord, fromKey, toKey, mode) {
    if (mod(fromKey - toKey, 12) === 0) return chord;
    const root = spellRoot(fromKey, mode, chord);
    const deg = mod(root.letter - TONIC_SPELL[mode][mod(toKey, 12)][0], 7);
    const semi = mod(rootPc(fromKey, chord) - toKey, 12);
    const entry = POOLS[mode].find((candidate) => candidate.deg === deg && candidate.semi === semi
      && [...candidate.tri, ...candidate.sev, ...candidate.ext].includes(chord.q));
    return entry ? makeChord(entry, chord.q) : chordFromId(mode, `r${deg}-${semi}`, chord.q);
  }

  /**
   * options.bars 小節ぶんのコードをランダムに選ぶ。
   * locks[i] が true の小節は current[i] をそのまま残す。
   * options.avoid: 小節番号 -> 避けたいコード（同じコードの再提案を防ぐ）
   */
  function generate(options, current, locks, rng) {
    const { mode, color = 'mix', outside = 0.2, startTonic = false, bars = 4, avoid = {} } = options;
    current = current || [];
    locks = locks || [];
    rng = rng || Math.random;
    const pool = POOLS[mode];
    const diatonic = pool.filter((x) => x.diatonic);
    const others = pool.filter((x) => !x.diatonic);
    const tonic = findEntry(mode, mode === 'major' ? 'I' : 'Im');
    const out = [];
    const fixed = (i) => (locks[i] && current[i] ? current[i] : null);

    const clashes = (chord, i) => {
      const prev = i > 0 ? out[i - 1] : fixed(bars - 1);
      const next = i < bars - 1 ? fixed(i + 1) : out[0] || fixed(0);
      if (prev && prev.semi === chord.semi) return true;
      if (next && next.semi === chord.semi) return true;
      const a = avoid[i];
      return !!(a && a.id === chord.id && a.q === chord.q);
    };

    for (let i = 0; i < bars; i++) {
      if (fixed(i)) {
        out[i] = fixed(i);
        continue;
      }
      let chord = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const prev = out[i - 1];
        let entry;
        if (prev && prev.target && attempt < 4 && rng() < 0.75) {
          entry = findEntry(mode, prev.target);
        } else if (i === 0 && startTonic && attempt < 4) {
          entry = tonic;
        } else if (i === bars - 1 && out[0] && outside > 0 && attempt < 4 && rng() < outside * 0.6) {
          const leading = others.filter((x) => x.target && findEntry(mode, x.target).semi === out[0].semi);
          entry = leading.length ? weightedPick(leading, rng) : weightedPick(diatonic, rng);
        } else {
          const src = others.length && rng() < outside ? others : diatonic;
          entry = weightedPick(src, rng);
        }
        chord = makeChord(entry, pickQuality(entry, color, rng));
        if (!clashes(chord, i)) break;
      }
      out[i] = chord;
    }
    return out;
  }

  function diatonicChords(mode, color) {
    const ids = mode === 'major'
      ? ['I', 'IIm', 'IIIm', 'IV', 'V', 'VIm', 'VIIm7b5']
      : ['Im', 'IIm7b5', 'bIII', 'IVm', 'Vm', 'bVI', 'bVII'];
    return ids.map((id) => {
      const entry = findEntry(mode, id);
      const q = color === 'triad' ? entry.tri[0] : entry.sev[0];
      return makeChord(entry, q);
    });
  }

  // ---- ボイシング（前のコードから近い転回形を選ぶ） ----
  function movement(a, b) {
    let s = 0;
    for (const n of b) s += Math.min(...a.map((p) => Math.abs(p - n)));
    for (const p of a) s += Math.min(...b.map((n) => Math.abs(p - n)));
    return s;
  }

  // 5音のコードは、ベースが根音を弾くときは根音を、そうでなければ5度を省く
  function voiceChord(root, intervals, prev, withBass) {
    let ivs = intervals.slice();
    if (ivs.length >= 5) ivs = ivs.filter((x) => x !== (withBass === false ? 7 : 0));
    ivs.sort((a, b) => mod(a, 12) - mod(b, 12));
    const pcs = ivs.map((x) => mod(root + x, 12));
    let best = null;
    let bestScore = Infinity;
    for (let k = 0; k < pcs.length; k++) {
      const order = pcs.slice(k).concat(pcs.slice(0, k));
      for (let start = 52; start <= 64; start++) {
        if (mod(start, 12) !== order[0]) continue;
        const notes = [start];
        for (let j = 1; j < order.length; j++) {
          let n = notes[j - 1] + 1;
          while (mod(n, 12) !== order[j]) n++;
          notes.push(n);
        }
        const avg = notes.reduce((s, n) => s + n, 0) / notes.length;
        let score = prev
          ? movement(prev, notes) + Math.abs(avg - 63) * 0.3
          : (k === 0 ? 0 : 6) + Math.abs(avg - 62) * 0.5;
        if (notes[notes.length - 1] > 79) score += 12;
        if (score < bestScore) {
          bestScore = score;
          best = notes;
        }
      }
    }
    return best;
  }

  function voiceProgression(keyPc, chords, withBass) {
    let prev = null;
    return chords.map((c) => {
      const notes = voiceChord(rootPc(keyPc, c), QUALITIES[c.q].iv, prev, withBass);
      prev = notes;
      return notes;
    });
  }

  function bassNote(keyPc, chord) {
    return 40 + mod(rootPc(keyPc, chord) - 4, 12);
  }

  // ---- URL 共有用 ----
  function encodeChords(chords) {
    return chords.map((c) => `${c.id}.${c.q}`).join('_');
  }

  function decodeChords(mode, text) {
    if (!text) return null;
    const chords = text.split('_').map((part) => {
      const [id, q] = part.split('.');
      return chordFromId(mode, id, q);
    });
    return chords.length && chords.every(Boolean) ? chords : null;
  }

  const api = {
    QUALITIES, POOLS, TAGS, MODE_LABEL, mod,
    tonicName, keyLabel, spellRoot, rootPc, chordName, romanName, romanStem, chordToneNames,
    tagLabel, findEntry, chordFromId, rebaseChord, generate, diatonicChords,
    voiceChord, voiceProgression, bassNote, encodeChords, decodeChords,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChordTheory = api;
})(typeof window !== 'undefined' ? window : globalThis);
