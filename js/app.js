/* コードルーレット: 画面の動き */
(function () {
  'use strict';

  const T = window.ChordTheory;
  const A = window.ChordAudio;
  const BAR_COUNTS = [2, 4, 8];
  const STORE_SETTINGS = 'chord-roulette:settings';
  const STORE_HISTORY = 'chord-roulette:history';
  const HISTORY_MAX = 40;

  const $ = (id) => document.getElementById(id);

  const defaults = {
    keyPc: 0,
    mode: 'major',
    bpm: 90,
    style: 'whole',
    bars: 4,
    rhythm: 'none',
    color: 'mix',
    outside: '0.2',
    startTonic: false,
    randomKey: true,
    settingsVersion: 2,
    minorRef: 'tonic',
    historyFilter: 'all',
  };

  const storedSettings = loadJson(STORE_SETTINGS, {});
  const state = Object.assign({}, defaults, storedSettings);
  if ((storedSettings.settingsVersion || 1) < 2) state.randomKey = true;
  state.chords = [];
  state.bars = BAR_COUNTS.includes(Number(state.bars)) ? Number(state.bars) : 4;
  state.locks = Array.from({ length: state.bars }, () => false);
  let saved = loadJson(STORE_HISTORY, []);
  if (!Array.isArray(saved)) saved = [];

  function loadJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* プライベートモードなどでは保存しない */
    }
  }

  function saveSettings() {
    const s = {};
    Object.keys(defaults).forEach((k) => { s[k] = state[k]; });
    saveJson(STORE_SETTINGS, s);
  }

  // ---- 表示用の値 ----
  function names(chords) {
    return chords.map((c) => T.chordName(state.keyPc, state.mode, c));
  }

  function romans(chords) {
    return chords.map((c) => T.romanName(c, state.mode, state.minorRef));
  }

  function voicings() {
    return T.voiceProgression(state.keyPc, state.chords, true);
  }

  function basses() {
    return state.chords.map((c) => T.bassNote(state.keyPc, c));
  }

  // ---- 生成 ----
  function options(extra) {
    return Object.assign({
      mode: state.mode,
      color: state.color,
      outside: Number(state.outside),
      startTonic: state.startTonic,
      bars: state.bars,
    }, extra);
  }

  function roll() {
    randomizeKey();
    state.chords = T.generate(options(), state.chords, state.locks);
    render(true);
  }

  function randomizeKey() {
    if (state.randomKey) state.keyPc = Math.floor(Math.random() * 12);
  }

  function rerollOne(i) {
    const locks = state.locks.map((_, j) => j !== i);
    state.chords = T.generate(options({ startTonic: false, avoid: { [i]: state.chords[i] } }), state.chords, locks);
    render(false, i);
  }

  // ---- 履歴 ----
  function currentEntry() {
    return { keyPc: state.keyPc, mode: state.mode, bars: state.bars, code: T.encodeChords(state.chords) };
  }

  function sameEntry(a, b) {
    return a.keyPc === b.keyPc && a.mode === b.mode && (a.bars || 4) === (b.bars || 4) && a.code === b.code;
  }

  function rememberCurrent() {
    const cur = currentEntry();
    if (saved.length && sameEntry(saved[0], cur)) return;
    const found = saved.find((h) => sameEntry(h, cur));
    if (found) {
      saved = [found].concat(saved.filter((h) => h !== found));
    } else {
      saved.unshift(Object.assign(cur, { fav: false, at: Date.now() }));
    }
    let plain = 0;
    saved = saved.filter((h) => h.fav || ++plain <= HISTORY_MAX);
    saveJson(STORE_HISTORY, saved);
  }

  function loadEntry(h) {
    const chords = T.decodeChords(h.mode, h.code);
    if (!chords || !BAR_COUNTS.includes(chords.length)) return;
    state.mode = h.mode;
    state.keyPc = h.keyPc;
    state.bars = chords.length;
    state.chords = chords;
    state.locks = Array.from({ length: state.bars }, () => false);
    render(true);
  }

  // ---- 描画 ----
  function renderSeg(id, value) {
    $(id).querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    });
  }

  function renderKeySelect() {
    const sel = $('key');
    sel.innerHTML = '';
    for (let pc = 0; pc < 12; pc++) {
      const o = document.createElement('option');
      o.value = String(pc);
      o.textContent = T.tonicName(pc, state.mode);
      sel.appendChild(o);
    }
    sel.value = String(state.keyPc);
  }

  function renderControls() {
    renderKeySelect();
    renderSeg('mode', state.mode);
    renderSeg('style', state.style);
    renderSeg('barCount', String(state.bars));
    renderSeg('rhythm', state.rhythm);
    renderSeg('color', state.color);
    renderSeg('outside', state.outside);
    renderSeg('minorRef', state.minorRef);
    renderSeg('historyFilter', state.historyFilter);
    $('bpm').value = state.bpm;
    $('bpmOut').textContent = state.bpm;
    $('startTonic').checked = state.startTonic;
    $('randomKey').checked = state.randomKey;
    $('minorRef').closest('.field').hidden = state.mode !== 'minor';
  }

  function renderBars(changedIndex) {
    const box = $('bars');
    box.dataset.count = String(state.chords.length);
    const ns = names(state.chords);
    const rs = romans(state.chords);
    box.innerHTML = '';
    state.chords.forEach((c, i) => {
      const card = document.createElement('article');
      card.className = 'bar';
      if (state.locks[i]) card.classList.add('locked');
      if (changedIndex === 'all' || changedIndex === i) card.classList.add('fresh');
      card.dataset.i = i;
      const tones = T.chordToneNames(state.keyPc, state.mode, c).join(' ');
      const bassName = T.chordToneNames(state.keyPc, state.mode, c)[0];
      card.innerHTML = `
        <div class="bar-head">
          <span class="bar-no">${i + 1}小節目</span>
          <button type="button" class="lock" aria-pressed="${state.locks[i]}" title="固定すると、ランダムに提案しても変わりません（キー ${i + 1}）">${state.locks[i] ? '固定中' : '固定'}</button>
        </div>
        <button type="button" class="chord" title="クリックで試聴">
          <span class="name">${ns[i]}</span>
          <span class="roman">${rs[i]}</span>
        </button>
        <div class="tag tag-${c.tag}">${T.tagLabel(c, state.mode, state.minorRef)}</div>
        <div class="tones">構成音 ${tones}<br>ベース ${bassName}</div>
        <button type="button" class="btn ghost small reroll">このコードだけ変える</button>`;
      box.appendChild(card);
    });
  }

  function renderDiatonic() {
    const box = $('diatonic');
    box.innerHTML = '';
    T.diatonicChords(state.mode, state.color === 'triad' ? 'triad' : 'seventh').forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.innerHTML = `<span class="name">${T.chordName(state.keyPc, state.mode, c)}</span><span class="roman">${T.romanName(c, state.mode, state.minorRef)}</span>`;
      b.addEventListener('click', () => {
        const v = T.voiceChord(T.rootPc(state.keyPc, c), T.QUALITIES[c.q].iv, null, true);
        A.preview(v, T.bassNote(state.keyPc, c));
      });
      box.appendChild(b);
    });
  }

  function formatDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderHistory() {
    const box = $('history');
    box.innerHTML = '';
    const current = saved[0];
    const list = saved.filter((h) => state.historyFilter === 'all' || h.fav || h === current);
    list.forEach((h) => {
      const chords = T.decodeChords(h.mode, h.code);
      if (!chords) return;
      const li = document.createElement('li');
      const nm = chords.map((c) => T.chordName(h.keyPc, h.mode, c)).join(' → ');
      const rm = chords.map((c) => T.romanName(c, h.mode, state.minorRef)).join(' → ');
      li.innerHTML = `
        <button type="button" class="star" aria-pressed="${!!h.fav}" title="お気に入り">${h.fav ? '★' : '☆'}</button>
        <button type="button" class="load" title="この進行を呼び出す">
          <span class="h-key">${h === current ? '表示中 · ' : ''}${T.keyLabel(h.keyPc, h.mode)}</span>
          <span class="h-names">${nm}</span>
          <span class="h-romans">${rm}</span>
        </button>
        <span class="h-date">${h.at ? formatDate(h.at) : ''}</span>`;
      li.querySelector('.star').addEventListener('click', () => {
        h.fav = !h.fav;
        saveJson(STORE_HISTORY, saved);
        renderHistory();
      });
      li.querySelector('.load').addEventListener('click', () => loadEntry(h));
      box.appendChild(li);
    });
  }

  function updateHash() {
    const p = new URLSearchParams({
      m: state.mode,
      k: String(state.keyPc),
      c: T.encodeChords(state.chords),
      t: String(state.bpm),
      b: String(state.bars),
    });
    window.history.replaceState(null, '', `#${p.toString()}`);
  }

  function render(all, changedIndex) {
    rememberCurrent();
    renderControls();
    $('keyLabel').textContent = `キー: ${T.keyLabel(state.keyPc, state.mode)}`;
    $('tempoLabel').textContent = `${state.bpm} BPM`;
    renderBars(all ? 'all' : changedIndex);
    renderDiatonic();
    renderHistory();
    updateHash();
    saveSettings();
  }

  // ---- 再生 ----
  function playState() {
    return { bpm: state.bpm, style: state.style, rhythm: state.rhythm, voicings: voicings(), bass: basses() };
  }

  function highlight(i) {
    document.querySelectorAll('.bar').forEach((el) => {
      el.classList.toggle('now', Number(el.dataset.i) === i);
    });
  }

  function togglePlay() {
    if (A.Player.playing) {
      A.Player.stop();
      highlight(-1);
    } else {
      A.Player.start(playState, highlight);
    }
    const playing = A.Player.playing;
    $('play').textContent = playing ? '■ 停止' : '▶ 再生';
    $('play').setAttribute('aria-pressed', String(playing));
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---- 操作 ----
  function bindSeg(id, onChange) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) onChange(b.dataset.v);
    });
  }

  function toggleLock(i) {
    state.locks[i] = !state.locks[i];
    renderBars(null);
  }

  function bind() {
    $('roll').addEventListener('click', roll);
    $('play').addEventListener('click', togglePlay);

    $('key').addEventListener('change', (e) => {
      state.keyPc = Number(e.target.value);
      render(false, null);
    });
    bindSeg('mode', (v) => {
      if (v === state.mode) return;
      state.mode = v;
      state.locks = Array.from({ length: state.bars }, () => false);
      randomizeKey();
      state.chords = T.generate(options(), [], []);
      render(true);
      toast(`${T.keyLabel(state.keyPc, state.mode)} で新しく提案しました`);
    });
    bindSeg('barCount', (v) => {
      const bars = Number(v);
      if (!BAR_COUNTS.includes(bars) || bars === state.bars) return;
      state.bars = bars;
      state.locks = Array.from({ length: bars }, () => false);
      randomizeKey();
      state.chords = T.generate(options(), [], []);
      render(true);
    });
    $('bpm').addEventListener('input', (e) => {
      state.bpm = Number(e.target.value);
      $('bpmOut').textContent = state.bpm;
      $('tempoLabel').textContent = `${state.bpm} BPM`;
    });
    $('bpm').addEventListener('change', () => {
      updateHash();
      saveSettings();
    });
    bindSeg('style', (v) => { state.style = v; renderSeg('style', v); saveSettings(); });
    bindSeg('rhythm', (v) => { state.rhythm = v; renderSeg('rhythm', v); saveSettings(); });
    bindSeg('color', (v) => { state.color = v; renderSeg('color', v); renderDiatonic(); saveSettings(); });
    bindSeg('outside', (v) => { state.outside = v; renderSeg('outside', v); saveSettings(); });
    bindSeg('minorRef', (v) => { state.minorRef = v; render(false, null); });
    bindSeg('historyFilter', (v) => { state.historyFilter = v; renderSeg('historyFilter', v); renderHistory(); saveSettings(); });

    ['startTonic', 'randomKey'].forEach((id) => {
      $(id).addEventListener('change', (e) => { state[id] = e.target.checked; saveSettings(); });
    });

    $('bars').addEventListener('click', (e) => {
      const card = e.target.closest('.bar');
      if (!card) return;
      const i = Number(card.dataset.i);
      if (e.target.closest('.lock')) toggleLock(i);
      else if (e.target.closest('.reroll')) rerollOne(i);
      else if (e.target.closest('.chord')) A.preview(voicings()[i], basses()[i]);
    });

    $('clearHistory').addEventListener('click', () => {
      saved = saved.filter((h, i) => i === 0 || h.fav);
      saveJson(STORE_HISTORY, saved);
      renderHistory();
    });

    // マウスで押したボタンからフォーカスを外し、ショートカットが効くようにする
    let pointer = false;
    document.addEventListener('pointerdown', () => { pointer = true; }, true);
    document.addEventListener('keydown', () => { pointer = false; }, true);
    const release = (e) => {
      const el = e.target.closest && e.target.closest('button, input[type=checkbox], select');
      if (pointer && el) el.blur();
    };
    document.addEventListener('click', release);
    document.addEventListener('change', release);

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, select, textarea, button, summary, a, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        roll();
      } else if (/^[1-8]$/.test(e.key) && Number(e.key) <= state.bars) {
        toggleLock(Number(e.key) - 1);
      }
    });

    window.addEventListener('hashchange', () => {
      if (readHash()) render(true);
    });
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const mode = p.get('m');
    if (mode !== 'major' && mode !== 'minor') return false;
    const chords = T.decodeChords(mode, p.get('c'));
    const bars = p.has('b') ? Number(p.get('b')) : 4;
    if (!chords || !BAR_COUNTS.includes(bars) || chords.length !== bars) return false;
    const k = Number(p.get('k'));
    const t = Number(p.get('t'));
    if (T.encodeChords(chords) === T.encodeChords(state.chords)
      && mode === state.mode && k === state.keyPc && bars === state.bars) return false;
    state.mode = mode;
    state.keyPc = Number.isInteger(k) ? T.mod(k, 12) : state.keyPc;
    state.bars = bars;
    if (t >= 50 && t <= 180) state.bpm = Math.round(t);
    state.chords = chords;
    state.locks = Array.from({ length: state.bars }, () => false);
    return true;
  }

  function init() {
    if (!['major', 'minor'].includes(state.mode)) state.mode = 'major';
    state.keyPc = T.mod(Number(state.keyPc) || 0, 12);
    if (!readHash()) {
      randomizeKey();
      state.chords = T.generate(options(), [], []);
    }
    bind();
    render(true);
  }

  init();
})();
