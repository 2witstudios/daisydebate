import type { Database } from '@daisy/db';
import type { OpenRouter } from '@daisy/ai-voice';
import type {
  NecessaryEvidenceRestore,
  NecessaryEvidenceRestoreReply,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { assembleOriginalAudio } from './audio';
import { canStartTranscription } from './start-window';
type Work = ReturnType<Database['createTranscriptionRecovery']>;
type Claim = Extract<Awaited<ReturnType<Work['claim']>>, { kind: 'claimed' }>;
type Restored = Extract<NecessaryEvidenceRestoreReply, { kind: 'restored' }>;
/** One capacity-reserved attempt. Caller owns renewal/scheduling and any subsequent qualified selection; no implicit provider retries. */
export function createTranscriptionAttempt(input: {
  readonly store: Pick<Work, 'verify' | 'begin' | 'retry' | 'recordCandidate'>;
  readonly restore: NecessaryEvidenceRestore;
  readonly voice: Pick<OpenRouter, 'transcribe'>;
  readonly monotonicNow: () => number;
}) {
  return async (claim: Claim, signal: AbortSignal) => {
    let audio: Uint8Array | undefined;
    let admitted: Awaited<ReturnType<Work['begin']>> | undefined;
    const live = () => {
      if (signal.aborted)
        throw createAppError('CONFLICT', 'Transcription cancelled');
    };
    const verify = async () => {
      live();
      const current = await input.store.verify(claim);
      live();
      if (
        current.model !== claim.model ||
        current.policyDigest !== claim.policyDigest ||
        JSON.stringify(current.evidenceIds) !==
          JSON.stringify(claim.evidenceIds)
      )
        throw createAppError(
          'CONFLICT',
          'Original recognition manifest changed',
        );
    };
    const restore = async () => {
      const originals: Restored[] = [];
      for (const evidenceId of claim.evidenceIds) {
        live();
        const reply = await input.restore({
          roundId: claim.roundId,
          evidenceId,
        });
        live();
        if (reply.kind !== 'restored')
          throw createAppError('CONFLICT', 'Original evidence is unavailable');
        originals.push(reply);
      }
      return originals;
    };
    try {
      await verify();
      const originals = await restore();
      const assembled = assembleOriginalAudio({
        roundId: claim.roundId,
        evidenceIds: claim.evidenceIds,
        bodies: originals.map((original) => original.body),
      });
      if (assembled.kind !== 'assembled')
        throw createAppError('CONFLICT', 'Original audio cannot be assembled');
      audio = assembled.wav;
      // Encoding/preparation precede buying the call. The immutable base64 copy cannot be cryptographically recalled.
      const audioBase64 = Buffer.from(
        audio.buffer,
        audio.byteOffset,
        audio.byteLength,
      ).toString('base64');
      live();
      const beforeAdmissionMs = input.monotonicNow();
      admitted = await input.store.begin(claim);
      if (admitted.kind === 'already-admitted')
        return { kind: 'reconciled' as const, ordinal: admitted.ordinal };
      if (admitted.kind === 'blocked') return admitted;
      const beforeDispatch = await restore();
      if (JSON.stringify(beforeDispatch) !== JSON.stringify(originals))
        throw createAppError(
          'CONFLICT',
          'Original evidence changed before dispatch',
        );
      await verify();
      live();
      if (
        !canStartTranscription({
          beforeAdmissionMs,
          nowMs: input.monotonicNow(),
          grant: admitted,
        })
      )
        throw createAppError(
          'CONFLICT',
          'Transcription start permission expired',
        );
      const response = await input.voice.transcribe({
        model: claim.model,
        audioBase64,
        format: 'wav',
        signal,
      });
      live();
      if (
        typeof response.text !== 'string' ||
        Buffer.byteLength(response.text) > 65536
      )
        throw createAppError(
          'INFRASTRUCTURE',
          'Invalid transcription response',
        );
      const latest = await restore();
      if (JSON.stringify(latest) !== JSON.stringify(originals))
        throw createAppError('CONFLICT', 'Original evidence changed');
      await verify();
      const recorded = await input.store.recordCandidate({
        ...claim,
        text: response.text,
      });
      live();
      return { ...recorded, text: response.text };
    } catch (error) {
      try {
        if (admitted?.kind === 'admitted')
          await input.store.retry({ ...claim, reason: 'uncertain' });
      } catch {
        /* A stale/privacy-denied claim cannot be revived; its durable recovery/retirement owns the remainder. */
      }
      throw error;
    } finally {
      audio?.fill(0);
    }
  };
}
