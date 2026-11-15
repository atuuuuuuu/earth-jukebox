// Offline rendering: play part of a track into a buffer faster than real time.
// Used for automated sound checks, and the basis for an "export audio" fallback deliverable.

import { AudioEngine } from './audio.js';
import { Player } from './player.js';

const T = window.EJ.Tone;

export async function renderBuffer({ track, mapping, settings, from = 0, seconds = 20, sampleRate = 44100, mute = [] }) {
  const tail = 4;
  let audio;
  const buffer = await T.Offline(async () => {
    audio = new AudioEngine({ offline: true, humNotes: mapping.HUM_NOTES, settings });
    await audio.init();
    // solo/mute for analysis: 'notes' | 'cello' | 'hum'
    if (mute.includes('hum')) audio.humBus.level.disconnect();
    if (mute.includes('beat')) audio.beatGain.disconnect();
    for (const v of ['notes', 'cello']) if (mute.includes(v)) audio[v].level.disconnect();
    const player = new Player({ track, mapping, audio, settings });
    player.scheduleAll(from, from + seconds, 0.05);
  }, seconds + tail, 2, sampleRate);
  audio.dispose();          // its samples and reverb would otherwise stay in memory after every saved file
  return buffer.get(); // AudioBuffer
}

/** 16-bit PCM WAV bytes from an AudioBuffer. */
export function encodeWav(ab) {
  const ch = ab.numberOfChannels, n = ab.length, sr = ab.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => ab.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(data.buffer);
}

export async function renderWavBase64(opts) {
  const bytes = encodeWav(await renderBuffer(opts));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
