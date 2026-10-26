import type {
  ResolutionCategory,
  ResolutionDrawManifest,
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol';
import {
  acceptedRoomMutation,
  complete,
  type Edges,
} from './room-assembly-facts';
import {
  mayStrike,
  needsStart,
  preRoundBegun,
  preRoundPhase,
} from './pre-round-phase';
import {
  bytesOf,
  canonicalJson,
  digestOf,
  drawCommitment,
  inputCommitment,
} from './draw-random';
import {
  drawResolutions,
  handOffReveal,
  revealed,
  sideControllers,
  standingPositions,
} from './resolution-draw';

const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
  ok: false,
  refusal,
});

const DIFFICULTIES: ['advanced', 'intro', 'standard'] = [
  'advanced',
  'intro',
  'standard',
];

function beginDraw(
  room: RoomAssemblyState,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome {
  const draw = room.executionPlan.resolutionDraw;
  if (!draw.enabled) throw new Error('beginDraw requires an enabled draw');
  if (room.participants.some((p) => !p.eligible))
    return refuse('actor-ineligible');
  if (!consent.available) return refuse('readiness-unavailable');
  if (
    room.participants.some(
      (p) => p.kind === 'human' && !consent.readyActorIds.includes(p.actorId),
    )
  )
    return refuse('not-ready');
  const facts = edges.drawStart;
  const bank = draw.source.kind === 'bank' ? facts?.bank : null;
  if (!facts || (draw.source.kind === 'bank' && !bank))
    return refuse('draw-unavailable');
  const categories = draw.source.kind === 'bank' ? draw.source.categories : [];
  const candidates =
    draw.source.kind === 'bank'
      ? bank!.entries
          .filter((e) => e.locale === 'en' && categories.includes(e.category))
          .map(({ id, text, category }) => ({ id, text, category }))
      : draw.source.resolutions.map((text, i) => ({
          id: `h:${i}`,
          text,
          category: null,
        }));
  const seed = bytesOf(facts.seed);
  const drawn = drawResolutions({
    candidates,
    exclusions: draw.source.kind === 'bank' ? facts.exclusions : [],
    size: draw.drawSize,
    seed,
  });
  if (!drawn.ok) return refuse('draw-unavailable');
  const sortedCategories = [...categories].sort();
  const sourceInput =
    draw.source.kind === 'bank'
      ? {
          kind: 'bank' as const,
          revision: bank!.revision,
          categories: sortedCategories,
          locale: 'en' as const,
          difficulties: DIFFICULTIES,
        }
      : { kind: 'host' as const, resolutions: draw.source.resolutions };
  const inputs = {
    candidateIds: drawn.candidateIds,
    exclusions: drawn.exclusions,
    exclusionsRelaxed: drawn.exclusionsRelaxed,
    sourceInput,
    configInput: draw,
    salt: facts.salt,
  };
  const { salt: _salt, ...committed } = inputs;
  void _salt;
  const manifest: ResolutionDrawManifest = {
    version: 1,
    algorithm: 'daisy-draw-v1',
    roomId: room.id,
    drawId: facts.drawId,
    source:
      sourceInput.kind === 'bank'
        ? sourceInput
        : { kind: 'host', count: sourceInput.resolutions.length },
    drawSize: draw.drawSize,
    firstStriker: draw.firstStriker,
    strikeWindowMs: draw.strikeWindowMs,
    controllers: sideControllers(room.participants),
    inputCommitment: inputCommitment(
      bytesOf(facts.salt),
      canonicalJson(committed),
    ),
  };
  const manifestDigest = digestOf(canonicalJson(manifest));
  return acceptedRoomMutation(
    {
      ...room,
      resolutionDraw: {
        id: facts.drawId,
        manifest,
        manifestDigest,
        commitment: drawCommitment({
          roomId: room.id,
          drawId: facts.drawId,
          manifestDigest,
          seed,
        }),
        items: drawn.items,
        startedAt: edges.now,
        strikes: [],
      },
    },
    { drawSecrets: { seed: facts.seed, inputs } },
  );
}

/** Host-only: begins the pre-round — a draw when the plan has one, else prep. */
export const startPreRound = (
  room: RoomAssemblyState,
  _actorId: string,
  _command: Extract<RoomCommand, { type: 'start-pre-round' }>,
  consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  if (preRoundBegun(room) || !needsStart(room))
    return refuse('prep-unavailable');
  if (!complete(room)) return refuse('incomplete-cast');
  if (room.executionPlan.resolutionDraw.enabled)
    return beginDraw(room, consent, edges);
  return acceptedRoomMutation({ ...room, prepStartedAt: edges.now });
};

/** A debater strikes one standing resolution for their side (settled Room). */
export const strikeResolution = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'strike-resolution' }>,
  _consent: RoomConsent,
  edges: Edges,
): RoomMutationOutcome => {
  if (
    !room.participants.some(
      (p) =>
        p.actorId === actorId &&
        (p.role === 'affirmative' || p.role === 'negative'),
    )
  )
    return refuse('not-seated');
  const draw = room.resolutionDraw;
  if (!draw) return refuse('strike-unavailable');
  if (revealed(draw) || command.ordinal !== draw.strikes.length)
    return refuse('strike-conflict');
  const phase = preRoundPhase(room, edges.now);
  if (!mayStrike(room, actorId, phase) || phase.phase !== 'striking')
    return refuse('not-your-turn');
  if (!standingPositions(draw).includes(command.position))
    return refuse('strike-unavailable');
  return acceptedRoomMutation(
    handOffReveal({
      ...room,
      resolutionDraw: {
        ...draw,
        strikes: [
          ...draw.strikes,
          {
            ordinal: command.ordinal,
            position: command.position,
            side: phase.turn.side,
            kind: 'debater',
            actorId,
            commandId: command.commandId,
            at: edges.now,
          },
        ],
      },
    }),
  );
};
