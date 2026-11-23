import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `text` spoken by espeak-ng as a base64 WAV (16-bit mono), for a seat's
 * microphone to play. The nightly Linux runner installs espeak-ng through
 * `scripts/ci-browsers.sh`; on macOS, `brew install espeak-ng`. The words
 * begin at the file's start, so a drill's onset is the speech's onset.
 */
export async function spokenWav(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-spoken-'));
  try {
    const path = join(dir, 'speech.wav');
    execFileSync('espeak-ng', ['-v', 'en-us', '-s', '165', '-w', path, text]);
    return (await readFile(path)).toString('base64');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
