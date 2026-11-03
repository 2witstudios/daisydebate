import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PresenceDot } from './presence-dot';
import { memberStatuses as statuses } from '@daisy/protocol';
import { statusLabels } from './status-labels';
import { presenceDotClass } from './presence-dot-class';

setupRitewayBun();

const base =
  'inline-block size-presence-dot rounded-round border-2 border-surface';

describe('PresenceDot', () => {
  test('names each presence without claiming to be a live region', () => {
    assert({
      given: 'each Social presence (S8)',
      should: 'render an img role labelled with that presence, not status',
      actual: statuses.map((presence) => {
        const html = renderToString(h(PresenceDot, { presence }));
        return (
          html.includes('role="img"') &&
          !html.includes('role="status"') &&
          html.includes(`aria-label="${statusLabels[presence]}"`)
        );
      }),
      expected: statuses.map(() => true),
    });
  });

  test('gives every presence its own fill', () => {
    assert({
      given: 'each Social presence (S8)',
      should: 'add a distinct fill token to the shared dot classes',
      actual: statuses.map((presence) => presenceDotClass(presence)),
      expected: [
        `${base} bg-online`,
        `${base} bg-gold`,
        `${base} bg-hue-clay`,
        `${base} bg-hue-teal`,
        `${base} bg-live`,
        'inline-block size-presence-dot rounded-round border-2 border-ink-faint bg-surface',
      ],
    });
  });
});
