import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  releaseAudiences,
  releaseThingSchema,
  type ReleaseAudience,
  type ReleaseThing,
} from '@daisy/protocol/release-audience';
import { visibleThing } from './authorization-audience';
import type {
  VideoSubjectsFact,
  ViewerAudience,
  ViewingFact,
} from './authorization-lobby-facts';
import {
  ask,
  eventRoom,
  eventRound,
  fixture,
  hosted,
  lobbyFact,
  lobbyGrant,
  noConflict,
  type Asker,
} from './lobby.test-support';

setupRitewayBun();

const subsets = <Item>(items: readonly Item[]): Item[][] =>
  Array.from({ length: 2 ** items.length }, (_, bits) =>
    items.filter((_item, index) => (bits >> index) & 1),
  );
const things = releaseThingSchema.options;
const viewers = subsets<ViewerAudience>([
  'responsible_adults',
  'competitors',
  'participants',
]);
const openings = subsets(releaseAudiences);
const releasesOf = (
  thing: ReleaseThing,
  audiences: readonly ReleaseAudience[],
) => audiences.map((audience) => ({ thing, audience }));
const official: Asker = {
  grants: [
    lobbyGrant('hosted', ['tournament.ballots.read_unreleased'], {
      grantId: 'official',
    }),
  ],
};
const subjects = (
  over: Partial<VideoSubjectsFact> = {},
): VideoSubjectsFact => ({
  minorSeated: false,
  guardianCap: 'lobby',
  ...over,
});

describe('the audience rule', () => {
  test('shows a viewer exactly what was released to their audiences', () => {
    const cases = viewers.flatMap((audiences) =>
      openings.map((opened) => ({ audiences, opened })),
    );
    assert({
      given: 'every viewer and every set of audiences a thing was released to',
      should:
        'be visible exactly when a release names one of the viewer’s audiences, link and public being anyone’s',
      actual: cases.map(({ audiences, opened }) =>
        visibleThing(
          'decision',
          { audiences, releases: releasesOf('decision', opened) },
          null,
        ),
      ),
      expected: cases.map(({ audiences, opened }) =>
        opened.some(
          (audience) =>
            audience === 'link' ||
            audience === 'public' ||
            (audiences as readonly string[]).includes(audience),
        ),
      ),
    });
    assert({
      given: 'a release of every other thing to everyone',
      should: 'show none of them as this thing',
      actual: things.filter((thing) =>
        visibleThing(
          thing,
          {
            audiences: ['participants'],
            releases: things
              .filter((other) => other !== thing)
              .flatMap((other) => releasesOf(other, releaseAudiences)),
          },
          null,
        ),
      ),
      expected: [],
    });
  });

  test('an added release never removes a visible thing', () => {
    assert({
      given:
        'every viewer, every set of releases, and each release added to it',
      should: 'never hide what was visible',
      actual: viewers.flatMap((audiences) =>
        openings.flatMap((opened) =>
          releaseAudiences.filter(
            (added) =>
              visibleThing(
                'scores',
                { audiences, releases: releasesOf('scores', opened) },
                null,
              ) &&
              !visibleThing(
                'scores',
                {
                  audiences,
                  releases: releasesOf('scores', [...opened, added]),
                },
                null,
              ),
          ),
        ),
      ).length,
      expected: 0,
    });
  });

  test('with no release, only officials see the thing', () => {
    const empty: ViewingFact = {
      audiences: ['responsible_adults', 'competitors', 'participants'],
      releases: [],
    };
    const reads = (asker: Asker) => [
      ask('result.read', fixture(hosted, { viewing: empty }), asker).allow,
      ask(
        'posting.read',
        { kind: 'draw', scope: hosted, viewing: empty },
        asker,
      ).allow,
      ask('standings.read', lobbyFact(hosted, { viewing: empty }), asker).allow,
      ...(['decision', 'scores', 'reason', 'feedback'] as const).map(
        (part) =>
          ask(
            'ballot.read',
            {
              kind: 'ballot',
              scope: hosted,
              conflict: noConflict,
              viewing: empty,
              part,
            },
            asker,
          ).allow,
      ),
      ask('room.read', eventRoom({ viewing: empty }), asker).allow,
      ask('round.read', eventRound({ viewing: empty }), asker).allow,
    ];
    assert({
      given:
        'a viewer in every audience with nothing released, and an official',
      should: 'show the viewer nothing and the official everything',
      actual: [reads({}), reads(official)].map((answers) => [
        ...new Set(answers),
      ]),
      expected: [[false], [true]],
    });
  });

  test('each read opens with its own thing', () => {
    const opened = (thing: ReleaseThing): ViewingFact => ({
      audiences: ['competitors'],
      releases: releasesOf(thing, ['competitors']),
    });
    const ballot = (
      released: ReleaseThing,
      part: 'decision' | 'scores' | 'reason' | 'feedback',
    ) =>
      ask('ballot.read', {
        kind: 'ballot',
        scope: hosted,
        conflict: noConflict,
        viewing: opened(released),
        part,
      }).allow;
    assert({
      given: 'a competitor, with one thing released to competitors at a time',
      should:
        'open the posting, the result and standings, each ballot part, and the Room, each by its own thing',
      actual: things.map((thing) => ({
        thing,
        posting: ask('posting.read', {
          kind: 'draw',
          scope: hosted,
          viewing: opened(thing),
        }).allow,
        result: ask('result.read', fixture(hosted, { viewing: opened(thing) }))
          .allow,
        standings: ask(
          'standings.read',
          lobbyFact(hosted, { viewing: opened(thing) }),
        ).allow,
        parts: (['decision', 'scores', 'reason', 'feedback'] as const).filter(
          (part) => ballot(thing, part),
        ),
        room: ask('room.read', eventRoom({ viewing: opened(thing) })).allow,
      })),
      expected: things.map((thing) => ({
        thing,
        posting: thing === 'posting',
        result: thing === 'decision',
        standings: thing === 'decision',
        parts: ['decision', 'scores', 'reason', 'feedback'].filter(
          (part) => part === thing,
        ),
        room: thing === 'video',
      })),
    });
    assert({
      given: 'a released thing read by a competitor',
      should: 'name the audience relation as the authority',
      actual: ask(
        'result.read',
        fixture(hosted, { viewing: opened('decision') }),
      ),
      expected: {
        allow: true,
        authority: { kind: 'relationship', relation: 'audience' },
        conflict: null,
      },
    });
  });

  test('a conflicted official under denied sees no more than their audiences', () => {
    const conflict = {
      connections: ['ward' as const],
      handling: 'denied' as const,
      waiverId: null,
    };
    const cases = viewers.flatMap((audiences) =>
      openings.map((opened) => ({
        audiences,
        releases: releasesOf('decision', opened),
      })),
    );
    assert({
      given:
        'an official whose child is on the fixture, for every audience and release set',
      should:
        'read the result exactly as a person with those audiences and no grant',
      actual: cases.map(
        (viewing) =>
          ask('result.read', fixture(hosted, { viewing, conflict }), official)
            .allow,
      ),
      expected: cases.map(
        (viewing) => ask('result.read', fixture(hosted, { viewing })).allow,
      ),
    });
    assert({
      given: 'the same official under flagged, and with a confirmed waiver',
      should: 'see everything, with the conflict on the decision',
      actual: [
        ask(
          'result.read',
          fixture(hosted, { conflict: { ...conflict, handling: 'flagged' } }),
          official,
        ),
        ask(
          'result.read',
          fixture(hosted, {
            conflict: {
              ...conflict,
              handling: 'second_confirms',
              waiverId: 'w',
            },
          }),
          official,
        ).allow,
        ask(
          'result.read',
          fixture(hosted, {
            conflict: { ...conflict, handling: 'second_confirms' },
          }),
          official,
        ).allow,
      ],
      expected: [
        {
          allow: true,
          authority: { kind: 'grant', grantId: 'official' },
          conflict: {
            connections: ['ward'],
            handling: 'flagged',
            waiverId: null,
          },
        },
        true,
        false,
      ],
    });
  });
});

describe('the fixed video caps', () => {
  const cases = viewers.flatMap((audiences) =>
    openings.map((opened) => ({ audiences, opened })),
  );
  const watch = (
    audiences: readonly ViewerAudience[],
    opened: readonly ReleaseAudience[],
    video: VideoSubjectsFact,
    asker: Asker = {},
  ) =>
    [
      ask(
        'room.read',
        eventRoom({
          viewing: { audiences, releases: releasesOf('video', opened) },
          video,
        }),
        asker,
      ),
      ask(
        'round.read',
        eventRound({
          viewing: { audiences, releases: releasesOf('video', opened) },
          video,
        }),
        asker,
      ),
    ].map((decision) => decision.allow);
  test('never show video with a minor seated to the public', () => {
    assert({
      given: 'a minor seated, for every viewer and every set of releases',
      should:
        'decide exactly as if nothing had ever been released to the public',
      actual: cases.map(({ audiences, opened }) =>
        watch(audiences, opened, subjects({ minorSeated: true })),
      ),
      expected: cases.map(({ audiences, opened }) =>
        watch(
          audiences,
          opened.filter((audience) => audience !== 'public'),
          subjects(),
        ),
      ),
    });
    assert({
      given:
        'a video released to the public alone, with and without a minor seated',
      should: 'show it only where no minor is seated',
      actual: [subjects({ minorSeated: true }), subjects()].map((video) =>
        watch([], ['public'], video),
      ),
      expected: [
        [false, false],
        [true, true],
      ],
    });
  });
  test('never show video past a guardian’s officials cap', () => {
    assert({
      given:
        'a ward capped at officials, for every viewer and every set of releases',
      should:
        'show it to nobody who is not an official or in a seat, and still to an official',
      actual: [
        cases.filter(({ audiences, opened }) =>
          watch(audiences, opened, subjects({ guardianCap: 'officials' })).some(
            Boolean,
          ),
        ).length,
        watch(
          [],
          [],
          subjects({ guardianCap: 'officials', minorSeated: true }),
          official,
        ),
        watch([], [], subjects({ guardianCap: 'officials' }), {
          actorId: 'seat',
        }),
      ],
      expected: [0, [true, true], [true, true]],
    });
  });
});

describe('reading a lobby', () => {
  test('is for its host readers and the audiences its postings ever open to', () => {
    const read = (
      postingAudiences: readonly ReleaseAudience[],
      audiences: readonly ViewerAudience[],
      asker: Asker = {},
    ) =>
      (['lobby.read', 'room.list'] as const).map(
        (capability) =>
          ask(
            capability,
            lobbyFact(hosted, {
              postingAudiences,
              viewing: { audiences, releases: [] },
            }),
            asker,
          ).allow,
      );
    assert({
      given:
        'a lobby whose postings open to participants, to nobody, and to anyone with the link',
      should:
        'be read by a participant, by its staff whatever the setting, and by anyone holding the id when the link is open',
      actual: [
        read(['participants'], ['participants']),
        read(['participants'], []),
        read([], ['participants']),
        read([], [], { grants: [lobbyGrant('hosted', ['lobby.announce'])] }),
        read([], [], { actorId: 'host' }),
        read(['link'], []),
      ],
      expected: [
        [true, true],
        [false, false],
        [false, false],
        [true, true],
        [true, true],
        [true, true],
      ],
    });
  });
});
