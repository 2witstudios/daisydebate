import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import { z } from 'zod';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/rate-limit';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
import { eventStream } from './event-stream';
import type { AiDebateOperations } from './operations';

type Dependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => AuthRateLimiter;
  readonly getActorByUserId: (
    userId: string,
  ) => Promise<{ readonly id: string } | null>;
  readonly operations: () => AiDebateOperations;
};

const id = z.string().min(1).max(64);
const segmentIndex = z.number().int().min(0).max(6);
const format = z.enum(['webm', 'ogg', 'mp4', 'wav']);
/** About a minute of compressed speech, base64-encoded. */
const audio = z.string().min(4).max(4_000_000);

/**
 * The request contracts, exported so the browser client can be checked against
 * the real schemas rather than a hand-written copy of them.
 *
 * That check is not ceremony. The cutover renamed `turnIndex` to
 * `segmentIndex` and `expectedSequence` to `expectedVersion` on this side
 * while the browser kept posting the old names; nothing failed until a member
 * pressed a button, because the browser and the handler were each tested
 * against their own idea of the contract. Parsing what the client actually
 * sends through these schemas closes that gap — see `api.test.ts`.
 */
export const schemas = {
  start: z.object({
    resolution: z.string().min(3).max(200),
    personSide: z.enum(['affirmative', 'negative']),
    opponent: z.string().min(1).max(40),
  }),
  command: z.object({
    id,
    expectedVersion: z.number().int().min(1).max(1_000_000),
    command: z.discriminatedUnion('type', [
      z.object({ type: z.literal('start') }),
      z.object({ type: z.literal('startPrep') }),
      z.object({ type: z.literal('startSpeech') }),
      z.object({ type: z.literal('yield') }),
      z.object({ type: z.literal('abort') }),
    ]),
  }),
  transcribe: z.object({ id, segmentIndex, audio, format }),
  speech: z.object({ id, segmentIndex }),
  speak: z.object({
    id,
    utteranceId: id,
    phraseIndex: z.number().int().min(0).max(400),
  }),
  crossExamine: z.object({
    id,
    segmentIndex,
    audio: z.object({ base64: audio, format }).optional(),
  }),
  heard: z.object({
    id,
    utteranceId: id,
    phraseIndex: z.number().int().min(0).max(400),
    playedMs: z.number().min(0).max(600_000),
    totalMs: z.number().min(0).max(600_000),
  }),
  ballot: z.object({ id }),
};

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw createAppError('VALIDATION', undefined, result.error);
  return result.data;
};

/** Per-person request rates; generous for a live debate, tight for abuse. */
const rules = {
  start: { windowSeconds: 3600, max: 12 },
  view: { windowSeconds: 60, max: 240 },
  command: { windowSeconds: 60, max: 60 },
  transcribe: { windowSeconds: 60, max: 90 },
  speech: { windowSeconds: 60, max: 20 },
  // Phrases, not sentences: a speech is a few dozen requests in all.
  speak: { windowSeconds: 60, max: 40 },
  crossExamine: { windowSeconds: 60, max: 60 },
  heard: { windowSeconds: 60, max: 60 },
  ballot: { windowSeconds: 60, max: 10 },
} as const;

/**
 * The `/api/ai-debate/*` routes. Gate order is ADR 0020's: same origin,
 * principal (session cookie), authorization (an onboarded member with an
 * actor), rate limit, then the operation, which also checks the AI debate
 * is the caller's own.
 */
export function createAiDebateHandlers(dependencies: Dependencies) {
  const actorOf = async (request: Request, rule: keyof typeof rules) => {
    const identity = requireSignedIn(await dependencies.identify(request));
    if (identity.state === 'provisional') throw createAppError('AUTHORIZATION');
    const { userId } = identity.principal;
    await consumeOrThrow(
      dependencies.limiter(),
      `ai-debate:${rule}:${userId}`,
      rules[rule],
    );
    const actor = await dependencies.getActorByUserId(userId);
    if (!actor) throw createAppError('INFRASTRUCTURE');
    return actor.id;
  };
  const post =
    <T>(
      name: keyof typeof rules,
      schema: z.ZodType<T>,
      maxBytes: number,
      run: (actorId: string, body: T) => Promise<Response>,
    ) =>
    (request: Request) =>
      handleOperation(
        dependencies.logger,
        request,
        `ai_debate.${name}`,
        async () => {
          requireSameOrigin(request, dependencies.origin());
          const actorId = await actorOf(request, name);
          return run(actorId, parse(schema, await readJson(request, maxBytes)));
        },
      );
  const ops = () => dependencies.operations();
  return {
    start: {
      POST: post('start', schemas.start, 2_048, async (actorId, body) =>
        Response.json(await ops().start({ actorId, ...body }), { status: 201 }),
      ),
    },
    view: {
      GET: (request: Request) =>
        handleOperation(
          dependencies.logger,
          request,
          'ai_debate.view',
          async () => {
            requireSameOriginRead(request, dependencies.origin());
            const actorId = await actorOf(request, 'view');
            const debateId = parse(
              id,
              new URL(request.url).searchParams.get('id'),
            );
            return Response.json(await ops().view({ actorId, id: debateId }));
          },
        ),
    },
    command: {
      POST: post('command', schemas.command, 1_024, async (actorId, body) => {
        await ops().command({ actorId, ...body });
        return new Response(null, { status: 204 });
      }),
    },
    transcribe: {
      POST: post(
        'transcribe',
        schemas.transcribe,
        4_100_000,
        async (actorId, body) =>
          Response.json(
            await ops().transcribe({
              actorId,
              id: body.id,
              segmentIndex: body.segmentIndex,
              audioBase64: body.audio,
              format: body.format,
            }),
          ),
      ),
    },
    speech: {
      POST: post('speech', schemas.speech, 512, async (actorId, body) => {
        const leaving = new AbortController();
        const events = ops().speech({
          actorId,
          ...body,
          signal: leaving.signal,
        });
        // Read the first event before answering, so a refusal (not the AI's
        // turn) maps to its status; later failures end the stream with an
        // error line the browser handles. A listener who leaves stops the
        // model.
        const first = await events.next();
        const stream = eventStream({
          first,
          events,
          abort: () => leaving.abort(),
          onFailure: (error) =>
            dependencies.logger.log(
              'ai_debate.speech.failed',
              { errorCode: (error as { code?: string }).code ?? 'INTERNAL' },
              'AI speech stream failed',
            ),
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }),
    },
    speak: {
      POST: post(
        'speak',
        schemas.speak,
        512,
        async (actorId, body) =>
          new Response(await ops().speak({ actorId, ...body }), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
      ),
    },
    crossExamine: {
      POST: post(
        'crossExamine',
        schemas.crossExamine,
        4_100_000,
        async (actorId, body) =>
          Response.json(
            await ops().crossExamine({
              actorId,
              id: body.id,
              segmentIndex: body.segmentIndex,
              ...(body.audio ? { audio: body.audio } : {}),
            }),
          ),
      ),
    },
    heard: {
      POST: post('heard', schemas.heard, 512, async (actorId, body) => {
        await ops().heard({ actorId, ...body });
        return new Response(null, { status: 204 });
      }),
    },
    ballot: {
      POST: post('ballot', schemas.ballot, 256, async (actorId, body) =>
        Response.json(await ops().ballot({ actorId, ...body })),
      ),
    },
  };
}
