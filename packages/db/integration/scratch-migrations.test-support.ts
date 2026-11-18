export { scratchDatabase } from '../src/testing-scratch';

/** CREATE DATABASE copies files; a loaded machine can exceed bun's 5 s default. */
export const ddlTimeoutMs = 60_000;
