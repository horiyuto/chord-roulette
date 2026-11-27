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

function openApp(hash, entries) {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const nodes = new Map(Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => [m[1], element()]));
  const historyKey = 'chord-roulette:history';
  const storage = new Map([[historyKey, JSON.stringify(entries)]]);
  const location = { hash };
  const window = Object.assign(element(), {
    ChordTheory: T,
    history: { replaceState(_state, _title, url) { location.hash = url; } },
  });
  const document = Object.assign(element(), {
    getElementById: (id) => nodes.get(id), createElement: element,
  });
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/app.js'), 'utf8'), {
    document, window, location, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  });
  return { node: (id) => nodes.get(id), entries: () => JSON.parse(storage.get(historyKey)), window, location };
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
