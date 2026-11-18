import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ownedUtilitiesIn,
  popoverClasses,
  type PopoverClassName,
} from './popover-classes';

setupRitewayBun();

const thrown = (run: () => unknown): string => {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('popoverClasses', () => {
  test('a closed popover is hidden', () => {
    assert({
      given: 'any popover',
      should: 'hide it whenever it is not open',
      actual: popoverClasses({}).split(' ').includes('not-open:hidden'),
      expected: true,
    });
  });

  test('an open popover lays out as asked', () => {
    assert({
      given: 'the stack and row layouts',
      should: 'apply flex and its direction only under the open state',
      actual: [popoverClasses({}), popoverClasses({ layout: 'row' })],
      expected: [
        'not-open:hidden open:flex open:flex-col',
        'not-open:hidden open:flex open:flex-row',
      ],
    });
  });

  test('surface classes follow the layout', () => {
    assert({
      given: 'surface classes from the caller',
      should: 'keep them after the primitive’s own',
      actual: popoverClasses({ className: ' m-auto gap-2 rounded-lg ' }),
      expected:
        'not-open:hidden open:flex open:flex-col m-auto gap-2 rounded-lg',
    });
  });

  test('a caller may not set display', () => {
    assert({
      given: 'the Room seat menu’s old classes, with a bare flex (SEAT-14a)',
      should: 'refuse them and name the owned utilities',
      actual: thrown(() =>
        popoverClasses({
          className: 'm-auto flex w-room-dialog flex-col',
          strict: true,
        }),
      ),
      expected:
        'A popover owns its display and direction; pass layout instead of: flex flex-col',
    });
  });

  test('variants and important marks do not hide a display utility', () => {
    assert({
      given: 'display set under variants or as important',
      should: 'find each one',
      actual: ownedUtilitiesIn(
        'open:flex md:grid !block hidden! sm:open:inline-flex gap-2 flex-1 flex-wrap',
      ),
      expected: [
        'open:flex',
        'md:grid',
        '!block',
        'hidden!',
        'sm:open:inline-flex',
      ],
    });
  });

  test('a variant that styles children is the caller’s', () => {
    assert({
      given: 'display set on children with *:, **: and combinator variants',
      should: 'leave them to the caller, while a self variant is still owned',
      actual: ownedUtilitiesIn(
        '*:flex **:block [&>li]:block [&_p]:grid [&:hover]:flex',
      ),
      expected: ['[&:hover]:flex'],
    });
  });

  test('an arbitrary display property is owned too', () => {
    assert({
      given: 'display and flex-direction written as arbitrary properties',
      should: 'find each one, under variants as well',
      actual: ownedUtilitiesIn(
        '[display:flex] md:[flex-direction:column] [color:red]',
      ),
      expected: ['[display:flex]', 'md:[flex-direction:column]'],
    });
  });

  test('a render drops an owned class rather than failing the route', () => {
    assert({
      given: 'an owned class without strict',
      should: 'drop it and keep the surface classes',
      actual: popoverClasses({
        className: 'm-auto flex gap-2 [display:grid]',
        strict: false,
      }),
      expected: 'not-open:hidden open:flex open:flex-col m-auto gap-2',
    });
  });
});

// Compile-time: a literal className that sets display does not type-check.
const accepted: PopoverClassName<'m-auto gap-2'> = 'm-auto gap-2';
const refused: [PopoverClassName<'m-auto flex gap-2'>] extends [never]
  ? true
  : false = true;
const refusedUnderVariant: [PopoverClassName<'gap-2 open:!grid'>] extends [
  never,
]
  ? true
  : false = true;
const refusedAfterNewline: [PopoverClassName<'m-auto\nflex'>] extends [never]
  ? true
  : false = true;
const refusedProperty: [PopoverClassName<'gap-2 [display:flex]'>] extends [
  never,
]
  ? true
  : false = true;
const childVariants: PopoverClassName<'*:flex [&>li]:block gap-2'> =
  '*:flex [&>li]:block gap-2';
void [
  accepted,
  refused,
  refusedUnderVariant,
  refusedAfterNewline,
  refusedProperty,
  childVariants,
];
