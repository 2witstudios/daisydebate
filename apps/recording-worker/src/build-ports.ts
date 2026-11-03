import type { RecordingBuildProgress } from '@daisy/protocol';

export type MediaProbe = {
  readonly durationMs: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
};

/** Everything a build touches, so its order and its failures can be tested. */
export type BuildPorts = {
  readonly hold: {
    readonly readText: (key: string) => Promise<string>;
    readonly listNames: (prefix: string) => Promise<readonly string[]>;
    readonly download: (key: string, path: string) => Promise<void>;
  };
  readonly recordings: {
    readonly upload: (key: string, path: string) => Promise<void>;
    readonly sizes: (prefix: string) => Promise<ReadonlyMap<string, number>>;
  };
  readonly files: {
    readonly makeDir: (path: string) => Promise<void>;
    readonly write: (path: string, text: string) => Promise<void>;
    readonly read: (path: string) => Promise<string>;
    /** Every file under a directory, relative to it, with its size. */
    readonly list: (dir: string) => Promise<ReadonlyMap<string, number>>;
  };
  /**
   * Runs a command; a non-zero exit rejects. `onEncodedMs` hears how much video an
   * ffmpeg asked for `-progress` has written so far.
   */
  readonly run: (
    command: readonly string[],
    onEncodedMs?: (encodedMs: number) => void,
    /** Past this the command is stopped, which rejects like any failure. */
    withinMs?: number,
  ) => Promise<string>;
  /** How far the build really is. Reporting never fails or slows it. */
  readonly progress: (progress: RecordingBuildProgress) => void;
  /** One debater's view could not be built: the Recording goes on without it. */
  readonly povMissing: () => void;
  readonly slatePath: string;
  readonly workDir: string;
  readonly now: () => string;
};
