import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BuildPorts } from './build-recording';
import { encodedMsOf } from './media-commands';

/** The real local machine: files on disk and child processes that can be cancelled. */
export const localFiles: BuildPorts['files'] = {
  makeDir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  write: async (path, text) => {
    await Bun.write(path, text);
  },
  read: (path) => Bun.file(path).text(),
  list: async (dir) => {
    const found = new Map<string, number>();
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries)
      if (entry.isFile()) {
        const path = join(entry.parentPath, entry.name);
        found.set(relative(dir, path), (await stat(path)).size);
      }
    return found;
  },
};

export const removeWorkDir = (path: string) =>
  rm(path, { recursive: true, force: true });

/** Only the exit code is kept: ffmpeg's stderr can name the files it read. */
export const runCommand =
  (signal: AbortSignal) =>
  async (
    command: readonly string[],
    onEncodedMs?: (encodedMs: number) => void,
  ): Promise<string> => {
    const child = Bun.spawn([...command], {
      stdout: 'pipe',
      stderr: 'ignore',
      signal,
    });
    const read = async () => {
      let output = '';
      let readThrough = 0;
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        output += decoder.decode(chunk, { stream: true });
        // Whole lines only: half a number split across chunks would read as less.
        const lineEnd = output.lastIndexOf('\n') + 1;
        const encodedMs = encodedMsOf(output.slice(readThrough, lineEnd));
        readThrough = lineEnd;
        if (encodedMs !== null) onEncodedMs?.(encodedMs);
      }
      return output;
    };
    const [output, code] = await Promise.all([read(), child.exited]);
    if (code !== 0) throw new Error(`${command[0]} exited ${code}`);
    return output;
  };
