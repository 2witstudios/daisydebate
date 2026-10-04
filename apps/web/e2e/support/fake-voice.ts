import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A WAV of a voice-like sound for Chromium's fake microphone
 * (`--use-file-for-fake-audio-capture`). The built-in fake device only
 * beeps about once a second, so how much "voice" a recording holds is luck.
 * Written into test-results.
 */
export function fakeVoiceFile(): string {
  const rate = 16_000;
  const seconds = 10;
  const samples = rate * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  // Voice-like: a pitch that wanders between about 120 and 220 Hz with a
  // few harmonics, loud and soft at a syllable rate. A steady tone would be
  // removed by the microphone's noise suppression as background noise.
  let phase = 0;
  for (let index = 0; index < samples; index += 1) {
    const time = index / rate;
    const pitch = 170 + 50 * Math.sin(2 * Math.PI * 0.7 * time);
    phase += (2 * Math.PI * pitch) / rate;
    const voice =
      Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
    const syllables = Math.max(0, Math.sin(2 * Math.PI * 4 * time)) ** 0.5;
    bytes.writeInt16LE(Math.round(voice * syllables * 9_000), 44 + index * 2);
  }
  const directory = join(process.cwd(), 'test-results');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'fake-voice.wav');
  writeFileSync(path, bytes);
  return path;
}
