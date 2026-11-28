/* コードルーレット: 画面の動き */
(function () {
  'use strict';

  const T = window.ChordTheory;
  const A = window.ChordAudio;
  // 古いページ（melody.js を読み込まない HTML）でも動くよう、メロディはあるときだけ使う
  const M = window.ChordMelody || null;
  const BAR_COUNTS = [2, 4, 8];
  const MELODY_STYLES = ['off', 'calm', 'lively'];
  const STORE_SETTINGS = 'chord-roulette:settings';
  const STORE_HISTORY = 'chord-roulette:history';
  const HISTORY_MAX = 40;
  const UNDO_MAX = 20;

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
    feel: 'balanced',
    melody: 'calm',
    startTonic: false,
    randomKey: true,
    settingsVersion: 2,
    minorRef: 'tonic',
    historyFilter: 'all',
  };

  const storedSettings = loadJson(STORE_SETTINGS, {});
  const state = Object.assign({}, defaults, storedSettings);
  if ((storedSettings.settingsVersion || 1) < 2) state.randomKey = true;
  if (!Object.hasOwn(T.FEELS, state.feel)) state.feel = defaults.feel;
  if (!MELODY_STYLES.includes(state.melody)) state.melody = defaults.melody;
  state.chords = [];
  state.tune = [];
  let tuneStyle = null;
  state.bars = BAR_COUNTS.includes(Number(state.bars)) ? Number(state.bars) : 4;
  state.locks = Array.from({ length: state.bars }, () => false);
  let undo = [];
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
      feel: state.feel,
      startTonic: state.startTonic,
      bars: state.bars,
    }, extra);
  }

  // ---- メロディ ----
  const melodyOn = () => !!M && state.melody !== 'off';
  const melodyStyle = () => (state.melody === 'lively' ? 'lively' : 'calm');
  const barCode = (notes) => (notes || []).map((n) => `${n.s}.${n.l}.${n.p}`).join(',');
  const tuneCode = (tune) => (M ? M.encode(tune) : '');

  // keep[i] の小節はそのまま、rhythms[i] があればそのリズムで作り直す
  function newTune(keep, rhythms) {
    if (!M) return state.chords.map(() => []);
    tuneStyle = melodyStyle();
    return M.generate({
      keyPc: state.keyPc,
      mode: state.mode,
      chords: state.chords,
      style: tuneStyle,
      current: state.tune,
      keep: keep || [],
      rhythms: rhythms || [],
    });
  }

  function savedTune(code) {
    const tune = M && code ? M.decode(code, state.chords.length) : null;
    if (!tune) return newTune([]);
    tuneStyle = melodyStyle();
    return tune;
  }

  // 小節ごとに、変わる前のコードとメロディを積んでおく（このページを開いている間だけ）
  function resetUndo() {
    undo = state.chords.map(() => []);
  }

  function snapshot() {
    return { keyPc: state.keyPc, chords: state.chords, tune: state.tune };
  }

  function pushUndo(before) {
    state.chords.forEach((c, i) => {
      const chord = before.chords[i];
      if (!chord) return;
      const tune = before.tune[i] || [];
      const sameChord = T.chordName(state.keyPc, state.mode, c) === T.chordName(before.keyPc, state.mode, chord);
      // メロディを隠しているときは、見えないメロディだけの変化を戻す対象にしない
      if (sameChord && (!melodyOn() || barCode(state.tune[i]) === barCode(tune))) return;
      undo[i] = (undo[i] || []).concat([{ keyPc: before.keyPc, chord, tune }]).slice(-UNDO_MAX);
    });
  }

  function undoOne(i) {
    if (!undo[i] || !undo[i].length) return;
    const previous = undo[i].pop();
    state.chords = state.chords.slice();
    state.chords[i] = T.rebaseChord(previous.chord, previous.keyPc, state.keyPc, state.mode);
    state.tune = state.tune.slice();
    state.tune[i] = previous.tune;
    render(false, i);
  }

  function roll() {
    const before = snapshot();
    randomizeKey();
    state.chords = T.generate(options(), state.chords, state.locks);
    state.tune = newTune(state.locks);
    pushUndo(before);
    render(true);
  }

  function newProgression() {
    state.locks = Array.from({ length: state.bars }, () => false);
    randomizeKey();
    state.chords = T.generate(options(), [], []);
    state.tune = newTune([]);
    resetUndo();
    render(true);
  }

  // 固定していない小節のメロディだけを作り直す（コードはそのまま）
  function newMelody() {
    if (!melodyOn()) return;
    const before = snapshot();
    state.tune = newTune(state.locks);
    pushUndo(before);
    render(false, 'tune');
  }

  function randomizeKey() {
    if (state.randomKey) setKey(Math.floor(Math.random() * 12));
  }

  function setKey(keyPc) {
    state.chords = state.chords.map((chord, i) => state.locks[i]
      ? T.rebaseChord(chord, state.keyPc, keyPc, state.mode)
      : chord);
    if (M) state.tune = M.transpose(state.tune, keyPc - state.keyPc, state.locks);
    state.keyPc = keyPc;
  }

  function rerollOne(i) {
    const locks = state.locks.map((_, j) => j !== i);
    const before = snapshot();
    state.chords = T.generate(options({ startTonic: false, avoid: { [i]: state.chords[i] } }), state.chords, locks);
    state.tune = newTune(locks, { [i]: M && M.rhythmOf(state.tune[i]) });
    pushUndo(before);
    render(false, i);
  }

  // ---- 履歴 ----
  function currentEntry() {
    const entry = { keyPc: state.keyPc, mode: state.mode, bars: state.bars, code: T.encodeChords(state.chords) };
    if (M) entry.mel = tuneCode(state.tune);
    return entry;
  }

  function sameEntry(a, b) {
    return a.keyPc === b.keyPc && a.mode === b.mode && (a.bars || 4) === (b.bars || 4) && a.code === b.code;
  }

  // 同じコードの履歴は、メロディも同じものを優先する。★を付けていない履歴は今のメロディに置き換え、
  // ★付きでメロディが違うときは別の履歴として残す
  function rememberCurrent() {
    const cur = currentEntry();
    const same = (h) => sameEntry(h, cur);
    const found = saved.find((h) => same(h) && (!h.mel || h.mel === cur.mel))
      || saved.find((h) => same(h) && !h.fav);
    if (found && found === saved[0] && (!cur.mel || found.mel === cur.mel)) return;
    if (found) {
      if (cur.mel) found.mel = cur.mel;
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
    state.tune = savedTune(h.mel);
    resetUndo();
    render(true);
  }

  // ---- 描画 ----
  function renderSeg(id, value) {
    $(id).querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    });
  }

  function renderKeySelect() {
    // 選択中の欄を乱さないよう、選択肢は作り直さず表記だけ更新する
    const sel = $('key');
    for (let pc = 0; pc < 12; pc++) {
      let o = sel.children[pc];
      if (!o) {
        o = document.createElement('option');
        o.value = String(pc);
        sel.appendChild(o);
      }
      const label = T.tonicName(pc, state.mode);
      if (o.textContent !== label) o.textContent = label;
    }
    sel.value = String(state.keyPc);
  }

  function renderTouchPicker(id) {
    const select = $(id);
    const picker = $(`${id}Picker`);
    if (!picker) return; // A cached page from before the touch controls still uses the native select.
    const choices = picker.querySelector('.choices');
    const current = picker.querySelector('strong');
    Array.from(select.options).forEach((option, i) => {
      let button = choices.children[i];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.v = option.value;
        choices.appendChild(button);
      }
      const selected = option.value === select.value;
      button.textContent = option.textContent;
      button.setAttribute('aria-pressed', String(selected));
      if (selected) current.textContent = option.textContent;
    });
    picker.hidden = false;
  }

  function renderControls() {
    renderKeySelect();
    renderSeg('mode', state.mode);
    $('style').value = state.style;
    if ($('style').value !== state.style) {
      state.style = 'whole';
      $('style').value = 'whole';
    }
    renderSeg('barCount', String(state.bars));
    $('rhythm').value = state.rhythm;
    if ($('rhythm').value !== state.rhythm) {
      state.rhythm = 'none';
      $('rhythm').value = 'none';
    }
    renderSeg('color', state.color);
    renderSeg('outside', state.outside);
    renderSeg('feel', state.feel);
    if ($('melody')) renderSeg('melody', state.melody);
    if ($('newMelody')) $('newMelody').hidden = !melodyOn();
    renderSeg('minorRef', state.minorRef);
    renderSeg('historyFilter', state.historyFilter);
    $('bpm').value = state.bpm;
    $('bpmOut').textContent = state.bpm;
    $('startTonic').checked = state.startTonic;
    $('randomKey').checked = state.randomKey;
    $('minorRef').closest('.field').hidden = state.mode !== 'minor';
    ['key', 'style', 'rhythm'].forEach(renderTouchPicker);
  }

  // 1小節のメロディを、8分音符の目盛りに音の高さと音名を並べた小さな譜面にする
  function tuneSvg(notes, labels, lo, hi) {
    const slot = 20;
    const top = 16;
    const bottom = 60;
    const y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
    const lines = [2, 4, 6].map((s) => `<line x1="${s * slot}" y1="2" x2="${s * slot}" y2="62"/>`).join('');
    const marks = notes.map((n, k) => {
      const x = n.s * slot;
      const ny = y(n.p);
      return `<rect x="${x + 1}" y="${ny.toFixed(1)}" width="${n.l * slot - 2}" height="4" rx="2"/>`
        + `<text x="${x + 2}" y="${(ny - 3).toFixed(1)}">${labels[k]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 160 64" aria-hidden="true" focusable="false">${lines}${marks}</svg>`;
  }

  function tuneRange() {
    const ps = [].concat(...state.tune).map((n) => n.p);
    let lo = ps.length ? Math.min(...ps) - 1 : 60;
    let hi = ps.length ? Math.max(...ps) + 1 : 72;
    const extra = 14 - (hi - lo);
    if (extra > 0) {
      lo -= Math.floor(extra / 2);
      hi += Math.ceil(extra / 2);
    }
    return [lo, hi];
  }

  function renderBars(changedIndex) {
    const box = $('bars');
    box.dataset.count = String(state.chords.length);
    const ns = names(state.chords);
    const rs = romans(state.chords);
    const showTune = melodyOn();
    const [lo, hi] = showTune ? tuneRange() : [0, 1];
    box.innerHTML = '';
    state.chords.forEach((c, i) => {
      const card = document.createElement('article');
      card.className = 'bar';
      if (state.locks[i]) card.classList.add('locked');
      if (changedIndex === 'all' || changedIndex === i) card.classList.add('fresh');
      if (changedIndex === 'tune' && !state.locks[i]) card.classList.add('fresh-tune');
      card.dataset.i = i;
      const n = i + 1;
      const canUndo = !!(undo[i] && undo[i].length);
      const notes = state.tune[i] || [];
      const labels = showTune ? M.noteNames(state.keyPc, state.mode, c, notes) : [];
      const tune = showTune
        ? `<button type="button" class="tune" title="Play melody" aria-label="Play melody, bar ${n}: ${labels.join(' ') || 'rest'}">${tuneSvg(notes, labels, lo, hi)}</button>`
        : '';
      card.innerHTML = `
        <div class="bar-head">
          <span class="bar-no">${n}</span>
          <span class="tools">
            <button type="button" class="icon undo" title="Undo bar ${n}" aria-label="Undo bar ${n}"${canUndo ? '' : ' disabled'}>↶</button>
            <button type="button" class="icon reroll" title="Reroll bar ${n}" aria-label="Reroll bar ${n}">🎲</button>
            <button type="button" class="icon lock" aria-pressed="${state.locks[i]}" title="${state.locks[i] ? 'Unlock' : 'Lock'} bar (${n})" aria-label="Lock bar ${n}">${state.locks[i] ? '🔒' : '🔓'}</button>
          </span>
        </div>
        <button type="button" class="chord" title="Preview chord">
          <span class="name">${ns[i]}</span>
          <span class="roman">${rs[i]}</span>
        </button>
        <div class="tag tag-${c.tag}">${T.tagLabel(c, state.mode, state.minorRef)}</div>${tune}`;
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
        <button type="button" class="star" aria-pressed="${!!h.fav}" aria-label="Favorite: ${nm}" title="${h.fav ? 'Remove from favorites' : 'Add to favorites'}">${h.fav ? '★' : '☆'}</button>
        <button type="button" class="load" title="Load progression">
          <span class="h-key">${h === current ? 'Now · ' : ''}${T.keyLabel(h.keyPc, h.mode)}</span>
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
    if (M) p.set('mel', tuneCode(state.tune));
    window.history.replaceState(null, '', `#${p.toString()}`);
  }

  function render(all, changedIndex) {
    rememberCurrent();
    renderControls();
    renderBars(all ? 'all' : changedIndex);
    renderDiatonic();
    renderHistory();
    updateHash();
    saveSettings();
  }

  // ---- 再生 ----
  function playState() {
    return {
      bpm: state.bpm, style: state.style, rhythm: state.rhythm, voicings: voicings(), bass: basses(),
      melody: melodyOn() ? state.tune : null,
    };
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
    const play = $('play');
    const action = A.Player.playing ? 'Stop' : 'Play';
    play.textContent = A.Player.playing ? '■' : '▶';
    play.setAttribute('aria-label', action);
    play.title = `${action} (Space)`;
    play.classList.toggle('playing', A.Player.playing);
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

  function bindPicker(id, onChange) {
    const select = $(id);
    const picker = $(`${id}Picker`);
    select.addEventListener('change', (e) => onChange(e.target.value));
    if (!picker) return;
    bindSeg(picker.id, (value) => {
      if (value !== select.value) {
        select.value = value;
        onChange(value);
      }
      picker.open = false;
      picker.querySelector('summary').focus();
    });
  }

  function toggleLock(i) {
    state.locks[i] = !state.locks[i];
    renderBars(null);
  }

  function bind() {
    $('roll').addEventListener('click', roll);
    $('play').addEventListener('click', togglePlay);
    if ($('newMelody')) $('newMelody').addEventListener('click', newMelody);

    bindPicker('key', (value) => {
      const before = snapshot();
      setKey(Number(value));
      pushUndo(before);
      render(false, null);
    });
    bindSeg('mode', (v) => {
      if (v === state.mode) return;
      state.mode = v;
      newProgression();
      toast(`New loop: ${T.keyLabel(state.keyPc, state.mode)}`);
    });
    bindSeg('barCount', (v) => {
      const bars = Number(v);
      if (!BAR_COUNTS.includes(bars) || bars === state.bars) return;
      state.bars = bars;
      newProgression();
    });
    $('bpm').addEventListener('input', (e) => {
      state.bpm = Number(e.target.value);
      $('bpmOut').textContent = state.bpm;
    });
    $('bpm').addEventListener('change', () => {
      updateHash();
      saveSettings();
    });
    for (const id of ['style', 'rhythm']) {
      bindPicker(id, (value) => {
        state[id] = value;
        renderTouchPicker(id);
        saveSettings();
      });
    }
    bindSeg('color', (v) => { state.color = v; renderSeg('color', v); renderDiatonic(); saveSettings(); });
    bindSeg('outside', (v) => { state.outside = v; renderSeg('outside', v); saveSettings(); });
    bindSeg('feel', (v) => { state.feel = v; renderSeg('feel', v); saveSettings(); });
    // Off にしてもメロディは残し、表示と再生だけ止める。Calm / Lively を切り替えたときは作り直す
    if ($('melody')) {
      bindSeg('melody', (v) => {
        if (!MELODY_STYLES.includes(v) || v === state.melody) return;
        state.melody = v;
        if (v !== 'off' && M && tuneStyle !== v) {
          const before = snapshot();
          state.tune = newTune(state.locks);
          pushUndo(before);
        }
        render(false, v === 'off' ? null : 'tune');
      });
    }
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
      else if (e.target.closest('.undo')) undoOne(i);
      else if (e.target.closest('.reroll')) rerollOne(i);
      else if (e.target.closest('.tune')) { if (A.previewBar) A.previewBar(voicings()[i], basses()[i], state.tune[i], state.bpm); }
      else if (e.target.closest('.chord')) A.preview(voicings()[i], basses()[i]);
    });

    $('clearHistory').addEventListener('click', () => {
      saved = saved.filter((h, i) => i === 0 || h.fav);
      saveJson(STORE_HISTORY, saved);
      renderHistory();
    });

    // マウス・タッチで押したボタンからフォーカスを外し、ショートカットが効くようにする。
    // 選択欄は click で外すと開いたばかりのピッカーが閉じるため、マウスで選び終えた change のときだけ外す。
    let pointer = '';
    document.addEventListener('pointerdown', (e) => { pointer = e.pointerType || ''; }, true);
    document.addEventListener('keydown', () => { pointer = ''; }, true);
    document.addEventListener('click', (e) => {
      const el = pointer && e.target.closest && e.target.closest('button, input[type=checkbox]');
      if (el) el.blur();
    });
    document.addEventListener('change', (e) => {
      const el = pointer === 'mouse' && e.target.closest && e.target.closest('select');
      if (el) el.blur();
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, select, textarea, button, summary, a, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        roll();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        newMelody();
      } else if (/^[1-8]$/.test(e.key) && Number(e.key) <= state.bars) {
        toggleLock(Number(e.key) - 1);
      }
    });

    window.addEventListener('hashchange', () => {
      if (readHash()) {
        resetUndo();
        render(true);
      }
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
    const tune = M && p.get('mel') ? M.decode(p.get('mel'), bars) : null;
    if (T.encodeChords(chords) === T.encodeChords(state.chords)
      && mode === state.mode && k === state.keyPc && bars === state.bars
      && (!tune || tuneCode(tune) === tuneCode(state.tune))) return false;
    state.mode = mode;
    state.keyPc = Number.isInteger(k) ? T.mod(k, 12) : state.keyPc;
    state.bars = bars;
    if (t >= 50 && t <= 180) state.bpm = Math.round(t);
    state.chords = chords;
    state.locks = Array.from({ length: state.bars }, () => false);
    state.tune = savedTune(tune && p.get('mel'));
    return true;
  }

  function init() {
    if (!['major', 'minor'].includes(state.mode)) state.mode = 'major';
    state.keyPc = T.mod(Number(state.keyPc) || 0, 12);
    if (!readHash()) {
      randomizeKey();
      state.chords = T.generate(options(), [], []);
      state.tune = newTune([]);
    }
    resetUndo();
    bind();
    render(true);
  }

  init();
})();
