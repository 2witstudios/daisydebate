import type { MinorReleaseRead } from '@daisy/db';
import { maskEmail } from '@daisy/protocol/media-release';
import {
  guardianRelationWords,
  releaseDate,
  releaseDay,
} from './release-words';

/**
 * The minor's Settings section (board "Settings media release"), one state
 * at a time: what to show, from what was read. Pure.
 */
export type MediaReleaseSettingsView =
  | {
      readonly kind: 'none';
      readonly privateRounds: string;
      /** A parent withdrew the last release: asking again is still theirs. */
      readonly withdrawnNote: string | null;
      readonly clubs: readonly {
        readonly id: string;
        readonly name: string;
        readonly asked: boolean;
      }[];
    }
  | {
      readonly kind: 'waiting';
      readonly line: string;
      readonly recipient: string;
    }
  | {
      readonly kind: 'parent';
      readonly line: string;
      readonly paidAds: boolean;
      readonly wordingVersion: string;
    }
  | {
      readonly kind: 'club';
      readonly line: string;
      readonly paidAds: boolean;
    };

const rounds = (count: number) =>
  count === 0
    ? 'Your Youth Rounds will be private.'
    : `Your ${count} Youth ${count === 1 ? 'Round is' : 'Rounds are'} private.`;

export const mediaReleaseSettingsView = (
  read: MinorReleaseRead,
): MediaReleaseSettingsView => {
  const { standing } = read;
  switch (standing.kind) {
    case 'none':
    case 'withdrawn':
      return {
        kind: 'none',
        privateRounds: rounds(read.privateYouthRounds),
        withdrawnNote:
          standing.kind === 'withdrawn'
            ? `Your parent withdrew your release on ${releaseDate(standing.release.withdrawnAt ?? standing.release.signedAt)}. Only they can sign again.`
            : null,
        clubs: read.clubs.map((club) => ({
          id: club.id,
          name: club.name,
          asked: club.askedAt !== null,
        })),
      };
    case 'waiting':
      return {
        kind: 'waiting',
        line: `Asked ${releaseDay(standing.request.requestedAt)} · link works until ${releaseDay(standing.request.expiresAt)}`,
        recipient: maskEmail(standing.request.recipientEmail),
      };
    case 'on_file': {
      const { attestation, signedAt, wordingVersion } = standing.publish;
      return attestation.kind === 'parent'
        ? {
            kind: 'parent',
            line: `Signed by ${attestation.name}, ${guardianRelationWords[attestation.relation]} · ${releaseDate(signedAt)}`,
            paidAds: standing.paidAds,
            wordingVersion,
          }
        : {
            kind: 'club',
            line: `${attestation.organizationName} · confirmed by ${attestation.name}, ${attestation.role} · ${releaseDate(signedAt)}`,
            paidAds: standing.paidAds,
          };
    }
  }
};
