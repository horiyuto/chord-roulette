'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../js/theory.js');
const M = require('../js/melody.js');
const J = JSON.stringify;

function element() {
  const selectors = new Map();
  return {
    children: [], dataset: {}, classList: { add() {}, toggle() {} },
    setAttribute(name, value) { this[name] = value; },
    set innerHTML(html) { this.html = html; this.children = []; selectors.clear(); },
    appendChild(child) { this.children.push(child); },
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, element());
      return selectors.get(selector);
    },
    closest(selector) { return this.querySelector(selector); },
    focus() { this.focused = true; },
    addEventListener(type, handler) { this[type] = handler; },
  };
}

function openApp(hash, entries, { random = Math.random, theory = T, melody = M, settings } = {}) {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const nodes = new Map(Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => [m[1], Object.assign(element(), { id: m[1] })]));
  for (const [, id, content] of html.matchAll(/<select id="([^"]+)">([\s\S]*?)<\/select>/g)) {
    const select = nodes.get(id);
    select.options = select.children;
    for (const [, value, textContent] of content.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)) {
      select.appendChild({ value, textContent });
    }
  }
  const historyKey = 'chord-roulette:history';
  const storage = new Map([[historyKey, JSON.stringify(entries)]]);
  if (settings) storage.set('chord-roulette:settings', JSON.stringify(settings));
  const location = { hash };
  const previews = [];
  const window = Object.assign(element(), {
    ChordTheory: theory,
    ChordMelody: melody,
    ChordAudio: {
      preview: (notes, bass) => previews.push({ notes, bass }),
      previewBar: (notes, bass, tune, bpm) => previews.push({ notes, bass, tune, bpm }),
      Player: { playing: false, start(getState) { this.playing = true; this.getState = getState; }, stop() { this.playing = false; } },
    },
    history: { replaceState(_state, _title, url) { location.hash = url; } },
  });
  const document = Object.assign(element(), {
    getElementById: (id) => nodes.get(id), createElement: element,
  });
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/app.js'), 'utf8'), {
    document, window, location, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    Math: Object.assign(Object.create(Math), { random }),
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  });
  return {
    node: (id) => nodes.get(id), entries: () => JSON.parse(storage.get(historyKey)), window, document, location, previews,
    settings: () => JSON.parse(storage.get('chord-roulette:settings')),
    names: () => nodes.get('bars').children.map((card) => card.html.match(/<span class="name">([^<]+)</)[1]),
    clickBar(i, button) {
      const bars = nodes.get('bars');
      const card = bars.children[i];
      bars.click({ target: { closest: (s) => (s === '.bar' ? card : s === button) } });
    },
  };
}

test('playback button keeps its symbol, tooltip and accessible action in sync', () => {
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj&t=90&b=2', []);
  const play = app.node('play');
  for (const [symbol, action] of [['■', 'Stop'], ['▶', 'Play']]) {
    play.click();
    assert.equal(play.textContent, symbol);
    assert.equal(play['aria-label'], action);
    assert.equal(play.title, `${action} (Space)`);
  }
});

test('tapping or clicking a select keeps its picker open; only a mouse choice drops focus', () => {
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj&t=90&b=2', []);
  const control = (tag) => {
    const el = { blurred: 0, blur() { this.blurred += 1; } };
    el.closest = (selector) => (selector.split(',').map((s) => s.trim()).includes(tag) ? el : null);
    return el;
  };
  for (const pointerType of ['mouse', 'touch']) {
    const select = control('select');
    app.document.pointerdown({ pointerType });
    app.document.click({ target: select });
    assert.equal(select.blurred, 0, `${pointerType}: opening the picker`);
    app.document.change({ target: select });
    assert.equal(select.blurred, pointerType === 'mouse' ? 1 : 0, `${pointerType}: after choosing`);
    const button = control('button');
    app.document.click({ target: button });
    assert.equal(button.blurred, 1, `${pointerType}: button`);
  }
});

test('key options are updated in place instead of being rebuilt', () => {
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj&t=90&b=2', []);
  const key = app.node('key');
  const options = key.children.slice();
  assert.equal(options.length, 12);
  app.node('mode').click({ target: { closest: () => ({ dataset: { v: 'minor' } }) } });
  key.change({ target: { value: '3' } });
  assert.equal(key.children.length, 12);
  key.children.forEach((o, pc) => {
    assert.equal(o, options[pc]);
    assert.equal(o.textContent, T.tonicName(pc, 'minor'));
  });
  assert.equal(key.value, '3');
});

test('phone choices commit to the loop and keep the labels, settings and live playback in sync', () => {
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj&t=90&b=2', []);
  app.node('play').click();
  for (const [id, label, value] of [['key', 'G', '7'], ['style', 'Arpeggio', 'arp'], ['rhythm', 'Bossa nova', 'bossa']]) {
    const picker = app.node(`${id}Picker`);
    const buttons = picker.querySelector('.choices').children;
    const choice = buttons.find((b) => b.textContent === label);
    assert.ok(choice);
    picker.open = true;
    picker.click({ target: { closest: () => choice } });
    assert.equal(app.node(id).value, value);
    assert.deepEqual(buttons.filter((b) => b['aria-pressed'] === 'true'), [choice]);
    assert.equal(picker.querySelector('strong').textContent, label);
    assert.equal(picker.open, false);
    assert.equal(picker.querySelector('summary').focused, true);
  }
  assert.deepEqual(app.names(), ['G', 'C']);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('k'), '7');
  const playback = app.window.ChordAudio.Player.getState();
  assert.deepEqual([playback.style, playback.rhythm], ['arp', 'bossa']);
  assert.deepEqual([app.settings().style, app.settings().rhythm], ['arp', 'bossa']);

  app.location.hash = '#m=minor&k=1&c=Im.m_IVm.m&t=80&b=2';
  app.window.hashchange();
  assert.equal(app.node('keyPicker').querySelector('strong').textContent, T.tonicName(1, 'minor'));
});

test('Feel は以前の設定がなければ Balanced で、選んだものが提案に使われ保存される', () => {
  const feels = [];
  const theory = Object.assign({}, T, { generate: (opts, ...rest) => { feels.push(opts.feel); return T.generate(opts, ...rest); } });
  const app = openApp('', [], { theory, settings: { outside: '0', settingsVersion: 2 } });
  assert.deepEqual(feels, ['balanced']);

  app.node('feel').click({ target: { closest: () => ({ dataset: { v: 'smooth' } }) } });
  assert.equal(app.settings().feel, 'smooth');
  app.node('roll').click();
  app.clickBar(1, '.reroll');
  assert.deepEqual(feels.slice(1), ['smooth', 'smooth']);

  const reopened = [];
  const spy = Object.assign({}, T, { generate: (opts, ...rest) => { reopened.push(opts.feel); return T.generate(opts, ...rest); } });
  openApp('', [], { theory: spy, settings: app.settings() });
  assert.deepEqual(reopened, ['smooth']);
});

test('共有URL・移調・1小節の再提案を履歴からお気に入りにできる', () => {
  const code = 'I.maj_IV.maj_V.dom7_IIm.m';
  const legacy = { mode: 'major', keyPc: 0, code, fav: true, at: 123 };
  const app = openApp(`#m=major&k=2&c=${code}&t=120`, [legacy]);
  const firstStar = () => app.node('history').children[0].querySelector('.star');
  const current = () => app.entries()[0];

  assert.equal(current().code, code);
  assert.equal(current().keyPc, 2);
  assert.equal(current().bars, 4);
  assert.equal(app.node('bpm').value, 120);
  firstStar().click();
  const sharedFavorite = current();
  assert.equal(sharedFavorite.fav, true);

  app.node('key').change({ target: { value: '0' } });
  const legacyNow = current();
  assert.deepEqual(legacyNow, Object.assign({}, legacy, { mel: legacyNow.mel }));
  assert.ok(M.decode(legacyNow.mel, 4));
  assert.equal(app.entries().length, 2);

  const card = app.node('bars').children[1];
  app.node('bars').click({ target: { closest: (s) => s === '.bar' ? card : s === '.reroll' } });
  assert.notEqual(current().code, code);
  assert.equal(current().keyPc, 0);
  assert.equal(new URLSearchParams(app.location.hash.slice(1)).get('c'), current().code);

  app.location.hash = '#m=major&k=7&c=I.maj_IV.maj&t=80&b=2';
  app.window.hashchange();
  assert.equal(current().keyPc, 7);
  assert.equal(current().bars, 2);
  const displayed = current();
  app.node('historyFilter').click({ target: { closest: () => ({ dataset: { v: 'fav' } }) } });
  assert.equal(app.node('history').children.length, 3);
  app.node('clearHistory').click();
  assert.deepEqual(app.entries(), [displayed, legacyNow, sharedFavorite]);
  firstStar().click();
  assert.equal(current().fav, true);
});

test('小節ごとに前のコードへ戻せて、ほかの小節はそのまま', () => {
  const code = 'I.maj_IV.maj_V.dom7_IIm.m';
  const app = openApp(`#m=major&k=2&c=${code}&t=120`, []);
  const bars = app.node('bars');
  const codes = () => app.entries()[0].code.split('_');
  const click = (i, button) => {
    const card = bars.children[i];
    bars.click({ target: { closest: (s) => (s === '.bar' ? card : s === button) } });
  };
  const undoDisabled = (i) => / disabled>↶/.test(bars.children[i].html);

  const original = codes();
  assert.ok(undoDisabled(1));
  click(1, '.undo');
  assert.deepEqual(codes(), original);

  click(1, '.reroll');
  const once = codes();
  click(1, '.reroll');
  assert.notEqual(codes()[1], once[1]);
  assert.ok(!undoDisabled(1));
  assert.ok(undoDisabled(2));
  click(1, '.undo');
  assert.deepEqual(codes(), once);
  click(1, '.undo');
  assert.deepEqual(codes(), original);
  assert.ok(undoDisabled(1));
  assert.equal(app.entries()[0].keyPc, 2);

  app.node('randomKey').change({ target: { checked: false } });
  click(0, '.lock');
  let before;
  for (let n = 0; n < 20; n++) {
    before = codes();
    app.node('roll').click();
    if (codes().some((c, i) => c !== before[i])) break;
  }
  const rolled = codes();
  assert.equal(rolled[0], before[0]);
  const changed = rolled.findIndex((c, i) => c !== before[i]);
  assert.ok(changed > 0);
  click(changed, '.undo');
  assert.deepEqual(codes(), rolled.map((c, i) => (i === changed ? before[i] : c)));

  app.node('mode').click({ target: { closest: () => ({ dataset: { v: 'minor' } }) } });
  bars.children.forEach((_, i) => assert.ok(undoDisabled(i)));
});

test('ランダムなキー変更だけでも、その小節の元のコードと音へ戻せる', () => {
  const code = 'I.maj_IV.maj_V.dom7_IIm.m';
  const app = openApp(`#m=major&k=0&c=${code}&t=120`, [], { random: () => 0.5 });
  const original = app.names();
  assert.deepEqual(original, ['C', 'F', 'G7', 'Dm']);

  app.node('startTonic').change({ target: { checked: true } });
  app.node('color').click({ target: { closest: () => ({ dataset: { v: 'triad' } }) } });
  app.node('roll').click();
  assert.equal(app.entries()[0].keyPc, 6);
  assert.equal(app.entries()[0].code.split('_')[0], code.split('_')[0]);
  const rolled = app.names();
  assert.equal(rolled[0], 'F♯');
  assert.ok(!/ disabled>↶/.test(app.node('bars').children[0].html));

  app.clickBar(0, '.undo');
  assert.deepEqual(app.names(), ['C', ...rolled.slice(1)]);
  assert.equal(app.entries()[0].keyPc, 6);
  app.clickBar(0, '.chord');
  assert.deepEqual(app.previews[0].notes.map((note) => note % 12).sort((a, b) => a - b), [0, 4, 7]);
  assert.equal(app.previews[0].bass % 12, 0);

  const reopened = openApp(app.location.hash, app.entries());
  assert.deepEqual(reopened.names(), app.names());
  reopened.node('history').children[1].querySelector('.load').click();
  reopened.node('history').children[1].querySelector('.load').click();
  assert.deepEqual(reopened.names(), app.names());
  for (let i = 1; i < original.length; i++) app.clickBar(i, '.undo');
  assert.deepEqual(app.names(), original);
  assert.equal(app.entries()[0].keyPc, 6);
});

test('コードとキーが同時に変わる全体提案を重ねても、選んだ小節だけ順に戻せる', () => {
  const keys = [6, 2];
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj_V.dom7_IIm.m&t=90', [], {
    random: () => keys.shift() / 12,
  });
  const versions = [app.names()];
  app.node('roll').click();
  versions.push(app.names());
  app.node('roll').click();
  const latest = app.names();
  // メロディだけが変わった全体提案も戻す対象になるので、コード名が変わる段だけを順に確かめる
  const expected = versions.reverse().map((v) => v[0]).filter((n, k, a) => n !== (k ? a[k - 1] : latest[0]));
  const seen = [];
  for (let n = 0; n < 10 && !/ disabled>↶/.test(app.node('bars').children[0].html); n++) {
    app.clickBar(0, '.undo');
    assert.deepEqual(app.names().slice(1), latest.slice(1));
    assert.equal(app.entries()[0].keyPc, 2);
    const name = app.names()[0];
    if (name !== (seen.length ? seen[seen.length - 1] : latest[0])) seen.push(name);
  }
  assert.deepEqual(seen, expected);
  assert.equal(app.names()[0], 'C');
  assert.ok(/ disabled>↶/.test(app.node('bars').children[0].html));
});

test('キー変更・1小節の変更を重ねても、小節ごとに表示されていた順に戻せる', () => {
  const app = openApp('#m=minor&k=9&c=Im.m_bVI.maj_bIII.maj_bVII.maj&t=90', []);
  const original = app.names();
  app.node('key').change({ target: { value: '0' } });
  const transposed = app.names();
  app.clickBar(0, '.reroll');
  const rerolled = app.names();
  assert.notEqual(rerolled[0], transposed[0]);
  app.node('key').change({ target: { value: '4' } });
  const latest = app.names();

  for (const name of [rerolled[0], transposed[0], original[0]]) {
    app.clickBar(0, '.undo');
    assert.deepEqual(app.names(), [name, ...latest.slice(1)]);
    assert.equal(app.entries()[0].keyPc, 4);
  }
  assert.ok(/ disabled>↶/.test(app.node('bars').children[0].html));
  app.clickBar(1, '.undo');
  assert.deepEqual(app.names(), [original[0], transposed[1], ...latest.slice(2)]);
  app.clickBar(1, '.undo');
  assert.deepEqual(app.names(), [original[0], original[1], ...latest.slice(2)]);

  app.node('key').change({ target: { value: '4' } });
  assert.ok(/ disabled>↶/.test(app.node('bars').children[0].html));
  app.node('barCount').click({ target: { closest: () => ({ dataset: { v: '2' } }) } });
  app.node('bars').children.forEach((card) => assert.ok(/ disabled>↶/.test(card.html)));
});

test('固定は度数ではなくコードそのものを、ランダム・手動のキー変更後も保つ', () => {
  const keys = [0, 6, 2];
  const app = openApp('#m=major&k=9&c=I.M7_IV.M7_V.sus47_IIm.m7&t=119', [], {
    random: () => keys.shift() / 12,
  });
  const original = app.names();
  assert.equal(original[0], 'AM7');
  app.clickBar(0, '.lock');
  app.clickBar(2, '.lock');

  for (const key of [0, 6]) {
    app.node('roll').click();
    assert.equal(app.entries()[0].keyPc, key);
    assert.equal(app.names()[0], original[0]);
    assert.equal(app.names()[2], original[2]);
    assert.ok(/ disabled>↶/.test(app.node('bars').children[0].html));
    assert.ok(/ disabled>↶/.test(app.node('bars').children[2].html));
  }
  app.clickBar(0, '.chord');
  assert.deepEqual(app.previews[0].notes.map((note) => note % 12).sort((a, b) => a - b), [1, 4, 8, 9]);
  assert.equal(app.previews[0].bass % 12, 9);
  assert.deepEqual(openApp(app.location.hash, []).names(), app.names());

  const before = app.names();
  app.clickBar(1, '.lock');
  app.clickBar(3, '.lock');
  app.node('roll').click();
  assert.equal(app.entries()[0].keyPc, 2);
  assert.deepEqual(app.names(), before);
  app.node('key').change({ target: { value: '4' } });
  assert.equal(app.entries()[0].keyPc, 4);
  assert.deepEqual(app.names(), before);

  app.clickBar(0, '.lock');
  app.node('key').change({ target: { value: '5' } });
  assert.equal(app.names()[0], 'B♭M7');
  assert.deepEqual(app.names().slice(1), before.slice(1));
  app.clickBar(0, '.undo');
  assert.deepEqual(app.names(), before);
  assert.equal(app.entries()[0].keyPc, 5);
});

function seededMelody(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Object.assign({}, M, { generate: (o) => M.generate(Object.assign({ rng }, o)) });
}

const hashParam = (app, name) => new URLSearchParams(app.location.hash.slice(1)).get(name);
const tuneOf = (app) => M.decode(hashParam(app, 'mel'));
const pick = (app, id, v) => app.node(id).click({ target: { closest: () => ({ dataset: { v } }) } });
const pressKey = (app, key) => app.document.keydown({ key, target: { closest: () => null }, preventDefault() {} });
const hasTune = (app) => app.node('bars').children.map((card) => /class="tune"/.test(card.html));

test('メロディは各小節に音名つきで表示・再生され、URLと履歴に残り、そのまま開き直せる', () => {
  const code = 'I.maj_VIm.m_IV.maj_V.dom7';
  const app = openApp(`#m=major&k=0&c=${code}&t=96`, [], { melody: seededMelody(1) });
  const tune = tuneOf(app);
  assert.equal(tune.length, 4);
  assert.ok(tune.every((notes) => notes.length > 0));
  assert.equal(app.entries()[0].mel, hashParam(app, 'mel'));
  const chords = T.decodeChords('major', code);
  app.node('bars').children.forEach((card, i) => {
    const labels = M.noteNames(0, 'major', chords[i], tune[i]);
    assert.ok(card.html.includes(`aria-label="Play melody, bar ${i + 1}: ${labels.join(' ')}"`), card.html);
  });
  assert.equal(app.node('newMelody').hidden, false);

  app.node('play').click();
  assert.deepEqual(app.window.ChordAudio.Player.getState().melody, tune);
  app.clickBar(2, '.tune');
  assert.deepEqual(app.previews.at(-1).tune, tune[2]);
  assert.equal(app.previews.at(-1).bpm, 96);

  const reopened = openApp(app.location.hash, []);
  assert.deepEqual(tuneOf(reopened), tune);
  const legacyUrl = openApp(`#m=major&k=0&c=${code}&t=96`, []);
  assert.equal(tuneOf(legacyUrl).length, 4);
  const broken = openApp(`#m=major&k=0&c=${code}&t=96&mel=zz`, []);
  assert.equal(tuneOf(broken).length, 4);
  assert.deepEqual(broken.names(), app.names());
});

test('🎵 と M キーは固定していない小節のメロディだけ作り直し、コードは変えず、小節ごとに戻せる', () => {
  const app = openApp('#m=major&k=0&c=I.maj_VIm.m_IV.maj_V.dom7&t=90', [], { melody: seededMelody(2) });
  const names = app.names();
  const first = tuneOf(app);
  app.clickBar(1, '.lock');
  app.node('newMelody').click();
  const second = tuneOf(app);
  assert.deepEqual(app.names(), names);
  assert.deepEqual(second[1], first[1]);
  const changed = [0, 2, 3].filter((i) => J(second[i]) !== J(first[i]));
  assert.ok(changed.length > 0);
  assert.ok(/ disabled>↶/.test(app.node('bars').children[1].html));

  pressKey(app, 'm');
  const third = tuneOf(app);
  assert.deepEqual(third[1], first[1]);
  app.clickBar(changed[0], '.undo');
  const undone = tuneOf(app);
  assert.deepEqual(undone[changed[0]], second[changed[0]]);
  assert.deepEqual(undone.filter((_, i) => i !== changed[0]), third.filter((_, i) => i !== changed[0]));
  assert.deepEqual(app.names(), names);
});

test('🎲 でも固定した小節はコードとメロディを保ち、1小節の再提案はその小節のリズムを保つ', () => {
  const keys = [5];
  const app = openApp('#m=major&k=0&c=I.maj_VIm.m_IV.maj_V.dom7&t=90', [], {
    melody: seededMelody(3), random: () => keys.shift() / 12,
  });
  const names = app.names();
  const first = tuneOf(app);
  app.clickBar(0, '.lock');
  app.node('roll').click();
  assert.equal(app.entries()[0].keyPc, 5);
  assert.equal(app.names()[0], names[0]);
  assert.deepEqual(tuneOf(app)[0], first[0]);

  const before = tuneOf(app);
  const beforeNames = app.names();
  app.clickBar(2, '.reroll');
  const after = tuneOf(app);
  assert.notEqual(app.names()[2], beforeNames[2]);
  assert.deepEqual(M.rhythmOf(after[2]), M.rhythmOf(before[2]));
  assert.deepEqual(after.filter((_, i) => i !== 2), before.filter((_, i) => i !== 2));
});

test('キーを変えると固定していない小節のメロディは同じ幅で移調し、固定した小節はそのまま', () => {
  const app = openApp('#m=major&k=0&c=I.maj_VIm.m_IV.maj_V.dom7&t=90', [], { melody: seededMelody(4) });
  const first = tuneOf(app);
  app.clickBar(3, '.lock');
  app.node('key').change({ target: { value: '2' } });
  const moved = tuneOf(app);
  assert.deepEqual(moved[3], first[3]);
  const shift = moved[0][0].p - first[0][0].p;
  assert.ok(shift === 2 || shift === -10, String(shift));
  [0, 1, 2].forEach((i) => assert.deepEqual(moved[i], first[i].map((n) => Object.assign({}, n, { p: n.p + shift }))));
  app.clickBar(0, '.undo');
  assert.deepEqual(tuneOf(app)[0], first[0]);
});

test('Melody を Off にすると表示・再生・🎵を止め、Calm / Lively に戻すと続きから使える', () => {
  const app = openApp('#m=minor&k=9&c=Im.m_bVI.maj_bIII.maj_bVII.maj&t=90', [], { melody: seededMelody(5) });
  const calm = tuneOf(app);
  app.node('play').click();
  pick(app, 'melody', 'off');
  assert.equal(app.settings().melody, 'off');
  assert.deepEqual(hasTune(app), [false, false, false, false]);
  assert.equal(app.node('newMelody').hidden, true);
  assert.equal(app.window.ChordAudio.Player.getState().melody, null);
  pressKey(app, 'M');
  assert.deepEqual(tuneOf(app), calm);
  assert.equal(openApp(app.location.hash, [], { settings: app.settings() }).node('newMelody').hidden, true);

  pick(app, 'melody', 'calm');
  assert.deepEqual(tuneOf(app), calm);
  assert.deepEqual(hasTune(app), [true, true, true, true]);
  assert.deepEqual(app.window.ChordAudio.Player.getState().melody, calm);

  pick(app, 'melody', 'lively');
  const lively = tuneOf(app);
  assert.notDeepEqual(lively, calm);
  assert.ok([].concat(...lively).length > [].concat(...calm).length);
  app.clickBar(0, '.undo');
  assert.deepEqual(tuneOf(app)[0], calm[0]);
});

test('★を付けた履歴はそのときのメロディを保ち、付けていない履歴は今のメロディに置き換わる', () => {
  const app = openApp('#m=major&k=0&c=I.maj_VIm.m_IV.maj_V.dom7&t=90', [], { melody: seededMelody(6) });
  const starred = hashParam(app, 'mel');
  app.node('history').children[0].querySelector('.star').click();
  app.node('newMelody').click();
  assert.equal(app.entries().length, 2);
  assert.equal(app.entries()[1].mel, starred);
  app.node('newMelody').click();
  const latest = hashParam(app, 'mel');
  assert.deepEqual(app.entries().map((h) => h.mel), [latest, starred]);

  app.node('history').children[1].querySelector('.load').click();
  assert.equal(hashParam(app, 'mel'), starred);
  assert.equal(app.entries()[0].mel, starred);
  assert.equal(app.entries().length, 2);
});

test('melody.js を読み込まない古いページでも、メロディなしでこれまでどおり動く', () => {
  const app = openApp('#m=major&k=0&c=I.maj_IV.maj&t=90&b=2', [], { melody: null });
  assert.equal(hashParam(app, 'mel'), null);
  assert.deepEqual(hasTune(app), [false, false]);
  assert.equal(app.node('newMelody').hidden, true);
  app.node('roll').click();
  app.clickBar(0, '.reroll');
  pressKey(app, 'm');
  app.node('play').click();
  assert.equal(app.window.ChordAudio.Player.getState().melody, null);
  assert.ok(app.entries().every((h) => !('mel' in h)));
});
