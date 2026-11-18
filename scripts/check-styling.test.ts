import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { popoverIssues, stylingIssues } from './check-styling';

setupRitewayBun();

describe('styling gate', () => {
  test('rejects a CSS Module anywhere', () => {
    assert({
      given: 'a component stylesheet named like a CSS Module',
      should: 'report it',
      actual: stylingIssues(['apps/web/src/ui/panel/panel.module.css']).length,
      expected: 1,
    });
  });

  test('rejects a Tailwind config file in every flavor', () => {
    assert({
      given: 'js, mjs, cjs, ts and nested Tailwind config files',
      should: 'report each',
      actual: stylingIssues([
        'tailwind.config.js',
        'tailwind.config.mjs',
        'tailwind.config.cjs',
        'apps/web/tailwind.config.ts',
      ]).length,
      expected: 4,
    });
  });

  test('accepts the CSS-only setup', () => {
    assert({
      given: 'the global stylesheet, theme partials and postcss config',
      should: 'report nothing',
      actual: stylingIssues([
        'apps/web/src/app/globals.css',
        'apps/web/src/app/theme/reset.css',
        'apps/web/postcss.config.mjs',
        'docs/tailwind.config.md',
      ]),
      expected: [],
    });
  });
});

describe('popover gate', () => {
  test('rejects a raw popover attribute outside the primitives', () => {
    assert({
      given: 'a hand-rolled popover and a primitive’s own source',
      should: 'report only the hand-rolled one, with its line',
      actual: [
        popoverIssues(
          'apps/web/src/ui/documents/file-menu.tsx',
          '<button popoverTarget="m" />\n<div id="m" popover="auto" />',
        ),
        popoverIssues(
          'apps/web/src/ui/components/popover/popover-menu.tsx',
          '<div popover="auto" />',
        ),
      ].map((issues) => issues.map((issue) => issue.split(': ')[0])),
      expected: [['apps/web/src/ui/documents/file-menu.tsx:2'], []],
    });
  });

  test('rejects display or direction passed to a primitive', () => {
    assert({
      given: 'the Room seat menu’s old classes (SEAT-14a)',
      should: 'name the owned utilities',
      actual: popoverIssues(
        'apps/web/src/ui/rooms/room-page/room-roster.tsx',
        '<PopoverDialog\n  id={id}\n  className="m-auto flex w-room-dialog flex-col gap-2"\n>',
      ),
      expected: [
        'apps/web/src/ui/rooms/room-page/room-roster.tsx:1: flex flex-col on a popover primitive; it owns display and direction, pass layout (ADR 0153)',
      ],
    });
  });

  test('accepts surface classes and layout', () => {
    assert({
      given: 'a primitive with surface classes and a sibling flex element',
      should: 'report nothing',
      actual: popoverIssues(
        'apps/web/src/ui/rooms/room-page/room-roster.tsx',
        '<PopoverDialog layout="row" className="m-auto gap-2 flex-wrap">\n  <div className="flex flex-col" />\n</PopoverDialog>',
      ),
      expected: [],
    });
  });
});
