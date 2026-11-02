import type { ChallengeList, PublishedResolution } from '@daisy/protocol';
import type { RoomTemplate } from '../rooms/read-catalog';
import { challengeRefusal, type ChallengeFormState } from './forms';
import { challengeRoomForm, templateFor } from './room';

type Offer = ChallengeList['incoming'][number];

/** The effects of accepting an offer, injected so the sequence stays testable. */
export type AcceptOfferPorts = {
  readonly nextId: () => string;
  readonly readOffers: () => Promise<readonly Offer[] | null>;
  readonly inARoom: () => Promise<boolean>;
  readonly readCatalog: () => Promise<
    | {
        readonly kind: 'found';
        readonly choices: readonly RoomTemplate[];
        readonly resolutions: readonly PublishedResolution[];
      }
    | { readonly kind: 'unavailable' }
  >;
  /** Opens the room, running `beforeMoveOn` with it, then moves on. */
  readonly openRoom: (
    form: FormData,
    beforeMoveOn: (roomId: string) => Promise<string | undefined>,
  ) => Promise<{
    readonly next?: string | undefined;
    readonly error?: string | undefined;
  }>;
  /** Names the room on the challenge, which rings the challenger. */
  readonly nameRoom: (roomId: string) => Promise<{
    readonly ok: boolean;
    readonly status: number;
  }>;
};

/**
 * Accepts an offer (ADR 0098): the acceptor opens the agreed room through the
 * one room-create route, then names it on the challenge, then both go there. A
 * room that opens but cannot be named still holds them.
 */
export async function acceptOffer(
  input: {
    readonly challengeId: string;
    readonly username: string;
    readonly actorId: string;
  },
  ports: AcceptOfferPorts,
): Promise<ChallengeFormState> {
  const offers = await ports.readOffers();
  const offer = offers?.find((row) => row.id === input.challengeId);
  if (!offer) return { notice: challengeRefusal('accept', 404) };
  // A member already in a room finishes there first; nothing else is opened.
  if (await ports.inARoom())
    return { notice: challengeRefusal('accept-placed', 409) };
  const catalog = await ports.readCatalog();
  const template =
    catalog.kind === 'found'
      ? templateFor(catalog.choices, offer.format)
      : undefined;
  if (!template || catalog.kind !== 'found')
    return { notice: challengeRefusal('accept', 500) };
  let notNamed: string | undefined;
  const created = await ports.openRoom(
    challengeRoomForm({
      host: input.username,
      hostActorId: input.actorId,
      opponent: offer.username,
      opponentActorId: offer.actorId,
      mode: offer.mode,
      template,
      commandId: ports.nextId(),
      resolutions: catalog.resolutions,
    }),
    async (roomId) => {
      try {
        const named = await ports.nameRoom(roomId);
        if (named.ok) return undefined;
        notNamed = challengeRefusal(
          named.status === 404 ? 'accept-lost' : 'accept-unnamed',
          named.status,
        );
      } catch {
        notNamed = challengeRefusal('accept-unnamed', 500);
      }
      return notNamed;
    },
  );
  if (created.next !== undefined) return { next: created.next };
  return {
    notice:
      notNamed ??
      (offer.mode === 'ranked'
        ? challengeRefusal('accept-ranked', 500)
        : (created.error ?? challengeRefusal('accept', 500))),
  };
}
