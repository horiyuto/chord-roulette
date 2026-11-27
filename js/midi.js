/* コードルーレット: Standard MIDI File（Format 0）の書き出し */
(function (global) {
  'use strict';

  const TPQ = 480;
  const BAR = TPQ * 4;

  function vlq(value) {
    const bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return bytes;
  }

  function u32(n) {
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  /**
   * bars: [{ notes: number[] }]（1小節に1コード、全音符）
   */
  function buildMidi({ bars, bpm, name }) {
    const events = [];
    bars.forEach((bar, i) => {
      bar.notes.filter((n) => Number.isInteger(n) && n >= 0 && n <= 127).forEach((n) => {
        events.push({ tick: i * BAR, order: 1, data: [0x90, n, 90] });
        events.push({ tick: (i + 1) * BAR, order: 0, data: [0x80, n, 0] });
      });
    });
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const nameBytes = Array.from(new TextEncoder().encode(name || 'Chord Roulette'));
    const usPerQuarter = Math.round(60000000 / bpm);
    const track = [
      0x00, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes,
      0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
    ];
    let last = 0;
    for (const ev of events) {
      track.push(...vlq(ev.tick - last), ...ev.data);
      last = ev.tick;
    }
    track.push(0x00, 0xff, 0x2f, 0x00);

    const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0x00, 0x00, 0x00, 0x01, (TPQ >> 8) & 0xff, TPQ & 0xff];
    const trackHeader = [0x4d, 0x54, 0x72, 0x6b, ...u32(track.length)];
    return new Uint8Array([...header, ...trackHeader, ...track]);
  }

  function asciiName(text) {
    return text
      .replace(/♯/g, '#')
      .replace(/♭/g, 'b')
      .replace(/[()]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9#_.-]/g, '');
  }

  const api = { buildMidi, asciiName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ChordMidi = api;
})(typeof window !== 'undefined' ? window : globalThis);
