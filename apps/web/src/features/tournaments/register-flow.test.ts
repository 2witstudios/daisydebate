import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from './get-tournament';
import {
  defaultRegisterQuery,
  parseRegisterQuery,
  registerFlow,
  registerHref,
  type RegisterQuery,
} from './register-flow';

setupRitewayBun();

const flow = (
  id: string,
  query: Partial<RegisterQuery> = {},
  signedIn = true,
) => {
  const view = getTournament(id, signedIn);
  if (!view) throw new Error(`no sample ${id}`);
  return registerFlow(view, { ...defaultRegisterQuery, ...query });
};

describe('parseRegisterQuery', () => {
  test('defaults, valid steps and ticks, hostile values', () => {
    assert({
      given: 'nothing, a review with both ticks, and junk',
      should: 'default, parse, then default',
      actual: [
        parseRegisterQuery({}),
        parseRegisterQuery({ step: 'review', rules: 'on', agree: 'on' }),
        parseRegisterQuery({ step: 'admin', rules: ['on'], agree: 'yes' }),
      ],
      expected: [
        defaultRegisterQuery,
        { step: 'review', rules: true, agree: true },
        { step: 'eligibility', rules: true, agree: false },
      ],
    });
  });
});

describe('registerHref', () => {
  test('only the step and the two ticks are carried', () => {
    assert({
      given: 'the first step, a step, and done with ticks',
      should: 'build short URLs with no other value',
      actual: [
        registerHref('x', 'eligibility'),
        registerHref('x', 'entry'),
        registerHref('x', 'done', { rules: true, agree: true }),
      ],
      expected: [
        '/tournaments/enter/x',
        '/tournaments/enter/x?step=entry',
        '/tournaments/enter/x?step=done&rules=on&agree=on',
      ],
    });
  });
});

describe('registerFlow', () => {
  test('an open tournament walks eligibility, entry, review, done', () => {
    const steps = (['eligibility', 'entry', 'review'] as const).map((step) => {
      const screen = flow('weeknight-sprint', { step });
      return screen.kind === 'flow'
        ? [screen.step, screen.steps.map((s) => s.state)]
        : screen.kind;
    });
    assert({
      given: 'each step of an open tournament',
      should: 'mark earlier steps done and later ones todo',
      actual: steps,
      expected: [
        ['eligibility', ['current', 'todo', 'todo', 'todo']],
        ['entry', ['done', 'current', 'todo', 'todo']],
        ['review', ['done', 'done', 'current', 'todo']],
      ],
    });
  });

  test('done needs both ticks, else it returns to review', () => {
    const one = flow('weeknight-sprint', { step: 'done', rules: true });
    const both = flow('weeknight-sprint', {
      step: 'done',
      rules: true,
      agree: true,
    });
    assert({
      given: 'done with one tick, then with both',
      should: 'return to review flagged missing, then finish as registered',
      actual: [
        one.kind === 'flow' && [one.step, one.missing],
        both.kind === 'flow' && [both.step, both.missing, both.waitlist],
      ],
      expected: [
        ['review', true],
        ['done', false, false],
      ],
    });
  });

  test('a full tournament enters the waitlist at the next position', () => {
    const screen = flow('night-owl-open', {
      step: 'done',
      rules: true,
      agree: true,
    });
    assert({
      given: 'a full tournament with two waiting',
      should: 'finish on the waitlist at position 3',
      actual: screen.kind === 'flow' && [screen.waitlist, screen.position],
      expected: [true, 3],
    });
  });

  test('refusals: band, closed, and a viewer with no profile', () => {
    const reason = (screen: ReturnType<typeof flow>) =>
      screen.kind === 'refused' ? screen.reason : screen.kind;
    assert({
      given: 'a band excluding the viewer, a closed tournament, and signed out',
      should: 'refuse with the matching reason',
      actual: [
        reason(flow('bronze-cup')),
        reason(flow('frost-cup')),
        reason(flow('autumn-open', {}, false)),
      ],
      expected: ['outside-band', 'closed', 'no-profile'],
    });
  });

  test('an entered viewer lands on done whatever the URL says', () => {
    const screen = flow('autumn-open', { step: 'entry' });
    const waitlisted = flow('novice-cup');
    assert({
      given: 'the viewer already registered, and already waitlisted at 2',
      should: 'show done, and keep the waitlist position',
      actual: [
        screen.kind === 'flow' && [screen.step, screen.waitlist],
        waitlisted.kind === 'flow' && [
          waitlisted.step,
          waitlisted.waitlist,
          waitlisted.position,
        ],
      ],
      expected: [
        ['done', false],
        ['done', true, 2],
      ],
    });
  });

  test('the summary names the start, places, viewer and rating effect', () => {
    const screen = flow('night-owl-open');
    assert({
      given: 'a full tournament',
      should: 'list four facts including the waiting count',
      actual:
        screen.kind === 'flow' &&
        screen.summary.map(([label, value]) => `${label}: ${value}`),
      expected: [
        'Starts: Wed 21 Oct, 20:00 UTC',
        'Places: 8 of 8 places taken, 2 waiting',
        'Entering as: @debater-a, established',
        'Rating effect: None',
      ],
    });
  });
});
