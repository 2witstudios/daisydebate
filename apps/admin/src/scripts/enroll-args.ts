import { parseArgs } from 'node:util';
import type { EnrollmentMode } from '../auth/issue-enrollment';

/** `--name <n> [--replace | --additional]`, validated before any connection. */
export function parseEnrollArgs(
  argv: readonly string[],
):
  | { readonly ok: true; readonly name: string; readonly mode: EnrollmentMode }
  | { readonly ok: false; readonly reason: string } {
  const usage =
    'Usage: bun apps/admin/src/scripts/operator-enroll.ts --name <name> [--replace | --additional]';
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        name: { type: 'string' },
        replace: { type: 'boolean', default: false },
        additional: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    const name = values.name?.trim() ?? '';
    if (
      !/^[\p{L}\p{N} ._-]{1,64}$/u.test(name) ||
      (values.replace && values.additional)
    )
      return { ok: false, reason: usage };
    const mode = values.replace
      ? 'replace'
      : values.additional
        ? 'additional'
        : 'initial';
    return { ok: true, name, mode };
  } catch {
    return { ok: false, reason: usage };
  }
}
