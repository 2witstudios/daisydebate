import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PresenceDot } from './presence-dot';
import type { Presence } from '../../types/presence/presence';
import { presenceDotClass } from './presence-dot-class';

setupRitewayBun();

const base =
  'inline-block size-presence-dot rounded-round border-2 border-surface';

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

  test('gives every presence its own fill', () => {
    assert({
      given: 'each presence value',
      should: 'add a distinct fill token to the shared dot classes',
      actual: statuses.map((presence) => presenceDotClass(presence)),
      expected: [
        `${base} bg-online`,
        `${base} bg-live`,
        `${base} bg-gold`,
        `${base} bg-ink-faint`,
      ],
    });
  });
});
