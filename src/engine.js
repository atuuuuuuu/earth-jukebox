// The bundle the page loads as the global EJ (npm run build): Tone.js, and toWav for "Save as audio file".
// The sound engine itself is in public/sweep/.
import * as Tone from "tone";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// Encode an AudioBuffer as 16-bit stereo WAV, for "Save as audio file".
export function toWav(buffer) {
  const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)];
  const out = new DataView(new ArrayBuffer(44 + l.length * 4));
  const text = (at, s) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); out.setUint32(4, 36 + l.length * 4, true); text(8, "WAVEfmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); text(36, "data");
  out.setUint32(40, l.length * 4, true);
  for (let i = 0; i < l.length; i++) {
    out.setInt16(44 + i * 4, clamp(l[i], -1, 1) * 32767, true);
    out.setInt16(46 + i * 4, clamp(r[i], -1, 1) * 32767, true);
  }
  return new Blob([out], { type: "audio/wav" });
}

export { Tone };
