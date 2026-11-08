import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblyCast } from './assembly-cast';

import { seatIntents } from './seat-intents.test-support';

setupRitewayBun();

const nativeIntents = seatIntents;

test('host cast controls carry actual bot actors and asymmetric declared seats', () => {
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={assemblySnapshot}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId: 't'.repeat(24),
          kind: 'bot',
          label: 'Stored judge bot',
          seatRole: 'judge',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a host, an actual stored eligible bot and two aff/three neg seats',
    should:
      'offer native assignment for every seat with version fences and actual targets rather than fake bot identities',
    actual: [
      html.includes('Affirmative 2'),
      html.includes('Negative 3'),
      html.includes('Stored judge bot'),
      html.includes('t'.repeat(24)),
      (html.match(/value="assign-seat"/g) ?? []).length,
      html.includes('value="claim-seat"'),
      html.includes('name="expectedVersion" value="3"'),
    ],
    expected: [true, true, true, true, 6, false, true],
  });
});

test('non-host cast exposes no assignment authority', () => {
  const view = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, host: false },
  };
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={view}
      viewer={{ actorId: 'u'.repeat(24), label: 'Second member' }}
      bots={[]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a permitted member who is not the host',
    should: 'expose neither assignment nor removal',
    actual: [
      html.includes('value="assign-seat"'),
      html.includes('value="remove-seat"'),
    ],
    expected: [false, false],
  });
});

test('Manage seats shows the AI judge as premium and unselectable for a host without it (WATCH-16)', () => {
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={{ ...assemblySnapshot, aiJudgeSeating: 'premium' }}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId: 'j'.repeat(24),
          kind: 'bot',
          label: 'AI judge',
          seatRole: 'judge',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a casual host without the entitlement',
    should: 'disable the AI judge option and name why',
    actual: html.includes(
      `<option value="${'j'.repeat(24)}" disabled="">AI judge · AI · premium</option>`,
    ),
    expected: true,
  });
});

test('each seat offers only the AI actors that may hold it', () => {
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={{ ...assemblySnapshot, aiJudgeSeating: 'included' }}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId: 'd'.repeat(24),
          kind: 'bot',
          label: 'Debater bot',
          seatRole: 'debater',
          eligible: true,
        },
        {
          actorId: 'j'.repeat(24),
          kind: 'bot',
          label: 'AI judge',
          seatRole: 'judge',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  const seatsOffering = (label: string) =>
    (html.match(new RegExp(`>${label} · AI<`, 'g')) ?? []).length;
  const judgeSeats = assemblySnapshot.rules.seats.judge;
  const sideSeats =
    assemblySnapshot.rules.seats.affirmative +
    assemblySnapshot.rules.seats.negative;
  assert({
    given: 'a bot debater and the AI judge in the cast choices (ISSUE-750)',
    should:
      'offer the bot debater only for side seats and the AI judge only for judge seats',
    actual: [seatsOffering('Debater bot'), seatsOffering('AI judge')],
    expected: [sideSeats, judgeSeats],
  });
});

test('seat pickers show the saved occupant and leave empty seats unselected', () => {
  const actorId = 'd'.repeat(24);
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={{
        ...assemblySnapshot,
        participants: [
          {
            id: 'p'.repeat(24),
            actorId,
            label: 'Saved bot',
            kind: 'bot',
            role: 'negative',
            slot: 0,
            eligible: true,
            needsReady: false,
            ready: 'ready',
            consentVersion: 0,
          },
        ],
      }}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId,
          label: 'Saved bot',
          kind: 'bot',
          seatRole: 'debater',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  const picker = (id: string) =>
    html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>(.*?)</select>`))?.[1] ??
    '';
  assert({
    given: 'a saved bot in Negative 1 and an empty Affirmative 1',
    should:
      'select the saved bot only in its seat and require an explicit choice for the empty seat',
    actual: [
      picker('assign-negative-0').includes(`value="${actorId}" selected=""`),
      /<option[^>]*value=""[^>]*selected=""/.test(
        picker('assign-affirmative-0'),
      ),
      picker('assign-affirmative-0').includes('Choose participant'),
      html.includes('required=""'),
    ],
    expected: [true, true, true, true],
  });
});

test('ranked rooms show their debater bots but mark them unseatable', () => {
  const html = renderToStaticMarkup(
    <AssemblyCast
      view={{ ...assemblySnapshot, competitionType: 'ranked' }}
      viewer={{
        actorId: assemblySnapshot.hostActorId,
        label: assemblySnapshot.hostLabel,
      }}
      bots={[
        {
          actorId: 'w'.repeat(24),
          kind: 'bot',
          label: 'Ranked bot',
          seatRole: 'debater',
          eligible: true,
        },
      ]}
      {...nativeIntents}
    />,
  );
  assert({
    given: 'a ranked room with an eligible debater bot',
    should:
      'list the bot with its ranked reason and disable it instead of refusing the post',
    actual: [
      html.includes('Ranked bot · AI · ranked rooms seat people'),
      /<option[^>]*value="w{24}"[^>]*disabled=""/.test(html),
    ],
    expected: [true, true],
  });
});
