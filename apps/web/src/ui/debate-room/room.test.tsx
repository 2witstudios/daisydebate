import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
import { sampleRound } from '../mock/debate-room.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { DebateRoom } from './room';
import type { RoundSnapshot } from './round';

setupRitewayBun();

const render = (...args: Parameters<typeof sampleRound>) =>
  renderAccessible(h(DebateRoom, { round: sampleRound(...args) }));

const renderRound = (round: RoundSnapshot) =>
  renderAccessible(h(DebateRoom, { round }));

/** Whether the first element comes before the second in the document. */
const before = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & 4) !== 0;

describe('DebateRoom', () => {
  test('the frame before any script runs', () => {
    const view = render('opponent-speaking', 'casual');
    const round = view.get('region', 'Round');
    const files = view.get('complementary', 'Your files');
    const document = view.get('region', 'Document');
    const sidebar = view.get('complementary', 'Round sidebar');
    assert({
      given: 'a casual round while the opponent speaks',
      should:
        'draw the round section, the clock, then Files, the document and a sidebar with three tabs',
      actual: [
        view.has('region', 'Round'),
        view.within('region', 'Round').has('timer', '1AR 2:46'),
        before(round, files),
        before(files, document),
        before(document, sidebar),
        view.count('tab'),
        view.count('separator'),
      ],
      expected: [true, true, true, true, true, 3, 0],
    });
  });

  test('the same help in every Round', () => {
    const ranked = render('prep', 'ranked');
    const rankedTabs = ranked.names('tab');
    const rankedFacts = [
      ranked.has('textbox', 'Ask Assistant'),
      ranked.within('banner').textContent().startsWith('Ranked'),
    ];
    const casualTabs = render('prep', 'casual').names('tab');
    assert({
      given: 'a ranked Round and a casual one',
      should:
        'offer both the same tabs and the AI panel, and mark only the rank',
      actual: [
        rankedTabs,
        rankedTabs.join() === casualTabs.join(),
        ...rankedFacts,
      ],
      expected: [
        ['Transcript', 'Channels, 7 unread', 'AI chat'],
        true,
        true,
        true,
      ],
    });
  });

  test('the round bar', () => {
    const view = render('opponent-speaking', 'casual');
    const bar = view.within('banner');
    assert({
      given: 'a casual round with a human judge',
      should:
        'show the kind, the live speech as the current step, the anonymous judge and Leave round, and claim no recording',
      actual: [
        bar.textContent().startsWith('Casual'),
        bar
          .within('list', 'Speeches')
          .has('listitem', undefined, { current: 'step' }),
        bar.textContent().includes('Judge present'),
        bar.has('link', 'Leave round'),
        view.textContent().includes('Recording'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('no Mute anywhere', () => {
    const view = render('own-speech', 'casual');
    const text = view.textContent();
    assert({
      given: 'the debater’s own speech',
      should:
        'state microphone permission without claiming capture and offer no mute control',
      actual: [
        text.includes('Mic permitted'),
        text.includes('Mic live'),
        /\bMute\b/.test(text) ||
          view.names('button').some((name) => /\bMute\b/.test(name)),
      ],
      expected: [true, false, false],
    });
  });

  test('no layout controls', () => {
    const view = render('cross-ex', 'casual');
    const text = view.textContent();
    assert({
      given: 'any phase',
      should: 'offer no layout menu and no video divider',
      actual: [
        text.includes('Layout:') || view.has('button', /^Layout:/),
        text.includes('Resize video') || view.has('separator', 'Resize video'),
      ],
      expected: [false, false],
    });
  });

  test('the transcript slot', () => {
    const round = sampleRound('opponent-speaking', 'casual');
    const panel = renderAccessible(
      h(DebateRoom, { round, transcript: h('p', null, 'the line') }),
    )
      .within('tabpanel', 'Transcript')
      .textContent();
    const none = renderRound(round)
      .within('tabpanel', 'Transcript')
      .textContent();
    assert({
      given: 'a viewer with a transcript, then one without',
      should:
        'show it in the sidebar’s open panel, else say there is none and keep the panel',
      actual: [
        panel.includes('the line'),
        panel.includes('No transcript.'),
        none.includes('No transcript.'),
      ],
      expected: [true, false, true],
    });
  });

  test('page notices stay inside the frame', () => {
    const view = renderAccessible(
      h(DebateRoom, {
        round: sampleRound('prep', 'casual'),
        notices: h('p', { role: 'note' }, 'the notice'),
      }),
    );
    // That the frame holding it is the viewport-height `room-frame` is a
    // markup contract: markup-contracts/debate-room.
    assert({
      given: 'a page-level notice',
      should: 'render it inside the viewport-height frame',
      actual: [
        view.text('note'),
        before(view.get('note'), view.get('region', 'Round')),
      ],
      expected: ['the notice', true],
    });
  });

  test('the judging window', () => {
    const view = render('judging', 'ranked');
    const ballots = view.within('region', 'Ballots').textContent();
    // The phone's action row repeats the controls; the Round section's are read.
    const controls = view.within('region', 'Round');
    assert({
      given: 'a ranked round after the last speech, a human judge writing',
      should:
        'count down the judging window, list each ballot with its status, keep the judge anonymous and offer Report a problem',
      actual: [
        controls.has('timer', 'Judging window 24:10'),
        view.has('region', 'Ballots'),
        ballots.includes('Judge’s ballot'),
        ballots.includes('Writing · decides the rating'),
        ballots.includes('AI ballot'),
        ballots.includes('Ready · opens with the judge’s'),
        view.within('banner').textContent().includes('Judge present'),
        controls.has('button', 'Report a problem'),
        view.has('button', 'Tech issue'),
        view.has('button', 'End speech'),
        view.textContent().includes('Your prep'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
      ],
    });
  });

  test('no ballots outside judging', () => {
    assert({
      given: 'the opponent speaking',
      should: 'show no ballot section',
      actual: render('opponent-speaking', 'ranked').has('region', 'Ballots'),
      expected: false,
    });
  });

  test('the AI judges', () => {
    const round = sampleRound('judging', 'casual');
    const ballots = renderRound({
      ...round,
      judge: 'ai',
      ballots: { judge: 'ai', ai: null },
    })
      .within('region', 'Ballots')
      .textContent();
    assert({
      given: 'a casual round the AI judges, after the last speech',
      should: 'show the AI judge’s ballot alone, deciding the result',
      actual: [
        ballots.includes('AI judge’s ballot'),
        ballots.includes('Writing · decides the result'),
        ballots.includes('AI ballot'),
      ],
      expected: [true, true, false],
    });
  });
});

test('an opening Round binds its durable floor beside the opening controls', () => {
  const action = async () => contextChatIdle('r'.repeat(24));
  const view = renderAccessible(
    h(DebateRoom, {
      round: { ...sampleRound('prep', 'casual'), phase: 'waiting' },
      notices: h(
        'section',
        { 'aria-label': 'Topic strikes' },
        'Choose a topic',
      ),
      floor: {
        roundId: 'd'.repeat(24),
        actorId: 'a'.repeat(24),
        requestId: 'r'.repeat(24),
        socketUrl: null,
        readOnlyHint: false,
        sendAction: action,
        mutateAction: action,
        reportAction: action,
      },
    }),
  );
  assert({
    given:
      'an opening Round with topic controls and the protected floor binding',
    should:
      'render both the opening controls and one actual floor thread without a seeded channel composer',
    actual: [
      view.has('region', 'Topic strikes'),
      view.count('region', 'Round floor chat'),
      view
        .within('region', 'Round floor chat')
        .textContent()
        .includes('The host can read this chat.'),
      view.textContent().includes('Message #round') ||
        view.has('textbox', 'Message #round'),
    ],
    expected: [true, 1, true, false],
  });
});
