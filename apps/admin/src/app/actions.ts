'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { beginEnrollment, finishEnrollment } from '../auth/enrollment';
import { SESSION_ABSOLUTE_MS } from '../auth/lifetimes';
import { parseAuthentication, parseRegistration } from '../auth/responses';
import { SESSION_COOKIE, signOut } from '../auth/session';
import { beginSignIn, finishSignIn } from '../auth/sign-in';
import { requestPeer, requireSameOrigin } from '../server/operator-gate';
import { adminRuntime } from '../server/runtime';

/**
 * The ceremony's server half. Each action checks same-origin first and
 * returns only `ok` and, while a ceremony runs, its options: a refusal
 * never says which check failed.
 */
const refused = { ok: false } as const;

export async function startEnrollment(token: unknown) {
  await requireSameOrigin();
  const result = await beginEnrollment(adminRuntime().auth, {
    token,
    address: await requestPeer(),
  });
  return result.ok ? { ok: true as const, options: result.options } : refused;
}

export async function completeEnrollment(token: unknown, credential: unknown) {
  await requireSameOrigin();
  const response = parseRegistration(credential);
  if (!response) return refused;
  const result = await finishEnrollment(adminRuntime().auth, {
    token,
    address: await requestPeer(),
    response,
  });
  return { ok: result.ok };
}

export async function startSignIn() {
  await requireSameOrigin();
  const result = await beginSignIn(adminRuntime().auth, {
    address: await requestPeer(),
  });
  return result.ok ? { ok: true as const, options: result.options } : refused;
}

export async function completeSignIn(credential: unknown) {
  await requireSameOrigin();
  const response = parseAuthentication(credential);
  if (!response) return refused;
  const jar = await cookies();
  const result = await finishSignIn(adminRuntime().auth, {
    address: await requestPeer(),
    response,
    presented: jar.get(SESSION_COOKIE)?.value ?? null,
  });
  if (!result.ok) return refused;
  // No Secure or __Host- prefix: the canonical origin is http on localhost.
  jar.set(SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
  return { ok: true as const };
}

/** A plain form action: sign-out works without JavaScript. */
export async function signOutAction(): Promise<never> {
  await requireSameOrigin();
  const jar = await cookies();
  await signOut(adminRuntime().auth, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect('/sign-in');
}
