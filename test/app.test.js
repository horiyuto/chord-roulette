'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('../js/theory.js');

function element() {
  const selectors = new Map();
  return {
    children: [], dataset: {}, classList: { add() {} },
    set innerHTML(html) { this.html = html; this.children = []; selectors.clear(); },
    appendChild(child) { this.children.push(child); },
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, element());
      return selectors.get(selector);
    },
    closest(selector) { return this.querySelector(selector); },
    addEventListener(type, handler) { this[type] = handler; },
  };
}

function openApp(hash, entries, { random = Math.random } = {}) {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const nodes = new Map(Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => [m[1], element()]));
  const historyKey = 'chord-roulette:history';
  const storage = new Map([[historyKey, JSON.stringify(entries)]]);
  const location = { hash };
  const previews = [];
  const window = Object.assign(element(), {
    ChordTheory: T,
    ChordAudio: { preview: (notes, bass) => previews.push({ notes, bass }) },
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
    node: (id) => nodes.get(id), entries: () => JSON.parse(storage.get(historyKey)), window, location, previews,
    names: () => nodes.get('bars').children.map((card) => card.html.match(/<span class="name">([^<]+)</)[1]),
    clickBar(i, button) {
      const bars = nodes.get('bars');
      const card = bars.children[i];
      bars.click({ target: { closest: (s) => (s === '.bar' ? card : s === button) } });
    },
  };
}

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
  assert.deepEqual(current(), legacy);
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
  assert.deepEqual(app.entries(), [displayed, legacy, sharedFavorite]);
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
  let name = latest[0];
  for (const previous of versions.reverse()) {
    if (previous[0] === name) continue;
    app.clickBar(0, '.undo');
    assert.deepEqual(app.names(), [previous[0], ...latest.slice(1)]);
    assert.equal(app.entries()[0].keyPc, 2);
    name = previous[0];
  }
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
