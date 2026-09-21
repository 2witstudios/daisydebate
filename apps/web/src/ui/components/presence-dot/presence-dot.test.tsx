import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PresenceDot } from './presence-dot';
import type { Presence } from '../../types/presence/presence';

setupRitewayBun();

const statuses: readonly Presence[] = [
  'online',
  'in-debate',
  'away',
  'offline',
];

describe('PresenceDot', () => {
  test('announces each presence as a named status', () => {
    assert({
      given: 'each presence value',
      should: 'render a status role labelled with that presence',
      actual: statuses.map((presence) => {
        const html = renderToString(h(PresenceDot, { presence }));
        return (
          html.includes('role="status"') &&
          html.includes(`aria-label="${presence}"`)
        );
      }),
      expected: statuses.map(() => true),
    });
  });

  test('has a stylesheet class for every presence', () => {
    const css = readFileSync(
      join(import.meta.dir, 'presence-dot.module.css'),
      'utf8',
    );
    assert({
      given: 'each presence value used as a CSS module key',
      should: 'be defined in the stylesheet so no dot renders unstyled',
      actual: statuses.filter((presence) => !css.includes(`.${presence} {`)),
      expected: [],
    });
  });
});
