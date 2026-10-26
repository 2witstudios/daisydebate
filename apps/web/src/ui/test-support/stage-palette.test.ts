import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { pageColourClasses, stageColourClasses } from './stage-palette';

setupRitewayBun();

describe('pageColourClasses', () => {
  test('finds page colours and leaves stage colours and non-colour classes alone', () => {
    assert({
      given: 'markup mixing page ink, a hover accent, stage ink and layout',
      should: 'report only the page-palette colour classes',
      actual: pageColourClasses(
        '<span class="flex text-ink hover:text-accent border-border-strong"></span>' +
          '<i class="text-stage-ink border-stage-ink-muted text-sm bg-surface-stage"></i>',
      ),
      expected: ['text-ink', 'hover:text-accent', 'border-border-strong'],
    });
  });
});

describe('stageColourClasses', () => {
  test('finds stage colours and leaves page colours and non-colour classes alone', () => {
    assert({
      given:
        'markup mixing stage ink, the stage surface, forest chip ink, page ink and layout',
      should: 'report only the stage colour classes that vanish on cream',
      actual: stageColourClasses(
        '<span class="flex text-ink hover:text-stage-accent text-stage-accent-ink"></span>' +
          '<i class="text-stage-ink-muted text-sm bg-surface-stage bg-surface"></i>',
      ),
      expected: [
        'hover:text-stage-accent',
        'text-stage-ink-muted',
        'bg-surface-stage',
      ],
    });
  });
});
