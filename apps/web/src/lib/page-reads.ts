import { deadlineSignal } from '@daisy/clock';
import { cache } from 'react';
import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import type { App } from '../server/app';
import { processApp } from '../server/process-app';
import { resolveSession } from './identity';

/**
 * The one request scope page reads are built on: this process's app, this
 * request's identity (resolved once per render through React's cache) and
 * the bound on a render read. Only page-read modules (a feature's
 * `page-reads.ts`, or a file under its `page-reads/` folder) import it, and it is the only page-side
 * module that reaches the process app (eslint.config.mjs, ISSUE-7 block);
 * every read lives beside its feature.
 */

/** This process's app, for a page read. */
export const requestApp = (): App => processApp();

/**
 * A bound on one server-render read, on this process's injected time
 * (R4.7). The caller clears it once the read settles.
 */
export const renderReadDeadline = (ms: number) =>
  deadlineSignal(processApp().waits, ms);

/**
 * This request's session, resolved once: the layouts and the page they
 * wrap render in the same request, and React's per-request cache makes
 * them share one durable session read.
 */
export const requestSession = cache(async () =>
  resolveSession(processApp().auth(), await headers()),
);

/** This process clock's instant, for a render that words time. */
export const requestNow = (): string => processApp().clock.now();

/** Who is asking in this server-component render. */
export const requestIdentity = async (): Promise<Identity> =>
  (await requestSession()).identity;
