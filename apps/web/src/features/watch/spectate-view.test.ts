import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  debateContext,
  debateSchedule,
  findDebate,
  spectatorSocial,
} from './debate-source';
import { defaultSpectateQuery, type SpectateQuery } from './spectate-query';
import { buildSpectateView } from './spectate-view';

setupRitewayBun();

const viewOf = (
  id: string,
  query: SpectateQuery = defaultSpectateQuery,
  extra: {
    connection?: 'connected' | 'reconnecting';
    reportSent?: boolean;
  } = {},
) => {
  const debate = findDebate(id);
  if (!debate) throw new Error(`no sample ${id}`);
  const { phases, turns } = debateSchedule(debate);
  return buildSpectateView({
    debate,
    query,
    phases,
    turns,
    social: spectatorSocial(debate),
    context: debateContext(debate),
    ...extra,
  });
};

describe('buildSpectateView: a live debate', () => {
  const view = viewOf('top-of-the-ladder');

  test('seats, clock and audience', () => {
    assert({
      given: 'the top-of-the-ladder debate speaking S3',
      should: 'mark the Aff speaker, run the clock and count the audience',
      actual: [
        view.live,
        view.seats.aff.activity,
        view.seats.neg.activity,
        view.clock.kind === 'running' && view.clock.secondsLeft,
        view.clock.kind === 'running' && view.clock.phaseName,
        view.badges.watching,
        view.banner,
        view.social.open,
      ],
      expected: [
        true,
        'Speaking',
        'Listening',
        228,
        'Speech [3]',
        142,
        null,
        true,
      ],
    });
  });

  test('timeline and speeches', () => {
    assert({
      given: 'the turn in progress is the 5th of twelve',
      should:
        'mark two phases done, one current, and cut the live speech short',
      actual: [
        view.timeline.steps.map((step) => step.state).join(' '),
        view.timeline.caption,
        view.speeches.length,
        view.speeches.at(-1)?.speakingNow,
        view.speeches.at(-1)?.text.endsWith('…'),
        view.speeches[0]?.stamp,
      ],
      expected: [
        'done done current upcoming upcoming upcoming',
        'Next: Speech [4], Neg · 5:00',
        5,
        true,
        true,
        '0:00',
      ],
    });
  });

  test('the report dialog subject', () => {
    assert({
      given: 'a report open on the debate and on a chat message',
      should: 'name what is reported',
      actual: [
        viewOf('top-of-the-ladder', {
          pane: 'speeches',
          report: { kind: 'debate' },
        }).reportTarget,
        viewOf('top-of-the-ladder', {
          pane: 'speeches',
          report: { kind: 'message', id: 'c1' },
        }).reportTarget,
        view.reportTarget,
      ],
      expected: ['the debate', 'a message from @spectator-one', null],
    });
  });

  test('a lost connection', () => {
    const lost = viewOf('top-of-the-ladder', defaultSpectateQuery, {
      connection: 'reconnecting',
    });
    assert({
      given: 'the audience connection dropped',
      should: 'say reconnecting and keep the last clock value',
      actual: [
        lost.connection,
        lost.clock.kind === 'running' && lost.clock.secondsLeft,
      ],
      expected: ['reconnecting', 228],
    });
  });
});

describe('buildSpectateView: an ended debate', () => {
  test('ballots still pending', () => {
    const view = viewOf('evening-round');
    assert({
      given: 'an ended debate with 2 of 3 ballots in',
      should: 'show the pending banner, a final clock and closed chat',
      actual: [
        view.live,
        view.banner?.kind,
        view.banner?.kind === 'pending' && view.banner.replayHref,
        view.clock,
        view.timeline.caption,
        view.speeches.length,
        view.social.open,
        view.badges.watching,
        view.seats.aff.activity,
      ],
      expected: [
        false,
        'pending',
        '/recordings/evening-round',
        { kind: 'final', totalLabel: '30:00' },
        'Ballots are being collected',
        12,
        false,
        null,
        null,
      ],
    });
  });

  test('result published', () => {
    const view = viewOf('semifinal-rehearsal');
    assert({
      given: 'a ranked debate Neg won 2 to 1',
      should: 'announce the result with rating changes',
      actual: [
        view.banner?.kind === 'result' && view.banner.headline,
        view.banner?.kind === 'result' && view.banner.detail,
        view.timeline.caption,
      ],
      expected: [
        'Neg wins, 2 to 1',
        '@debater-g 1655 to 1646, @debater-h 1641 to 1650. Judge reasons are in the recording.',
        'Debate complete',
      ],
    });
  });

  test('a casual result carries no rating change', () => {
    const view = viewOf('open-table');
    assert({
      given: 'a casual debate',
      should: 'say casual debates are not rated',
      actual: view.banner?.kind === 'result' && view.banner.detail,
      expected:
        'Casual debates are not rated. Judge reasons are in the recording.',
    });
  });
});
