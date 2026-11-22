import { createAppError } from '@daisy/errors';
import { subscriptionAccess } from '@daisy/auth/authorization';
import type {
  ClubSeatManagerCommand,
  createClubSeats,
} from '../src/club-seat-commands';
import {
  clubInvitationMailRefusal,
  decideClubSeating,
  type ClubSeatingCommand,
} from '@daisy/protocol/club-seats';
type MemberCaller = { readonly userId: string; readonly actorId: string };

type Store = ReturnType<typeof createClubSeats>;

function toSeatingCommand(
  command: ClubSeatManagerCommand,
  facts: {
    readonly invitationId: string;
    readonly target: { member: boolean; elsewhere: boolean } | null;
  },
): ClubSeatingCommand | null {
  switch (command.kind) {
    case 'invite':
      return {
        kind: 'invite',
        invitationId: facts.invitationId,
        email: command.email,
      };
    case 'assign':
      return {
        kind: 'assign',
        target: {
          kind: 'member',
          userId: command.userId,
          isMember: facts.target?.member ?? false,
          seatedElsewhere: facts.target?.elsewhere ?? false,
        },
      };
    case 'move':
      return {
        kind: 'move',
        fromUserId: command.fromUserId,
        to:
          command.to.kind === 'member'
            ? {
                kind: 'member',
                userId: command.to.userId,
                isMember: facts.target?.member ?? false,
                seatedElsewhere: facts.target?.elsewhere ?? false,
              }
            : {
                kind: 'invite',
                invitationId: facts.invitationId,
                email: command.to.email,
              },
      };
    case 'remove':
      return { kind: 'remove', userId: command.userId };
    case 'cancel':
      return { kind: 'cancel', invitationId: command.invitationId };
    case 'prepare-seat-count':
      return {
        kind: 'change-seat-count',
        seatCount: command.seatCount,
        release: command.release,
      };
  }
}

/** A manager may free capacity without an active plan; giving capacity requires one. */
function executeManagerCommand(
  store: Pick<Store, 'managerCommand'>,
  subject: MemberCaller,
  organizationId: string,
  command: ClubSeatManagerCommand,
) {
  return store.managerCommand(
    subject,
    organizationId,
    command,
    async (session) => {
      const loaded = await session.load();
      const active =
        loaded.evidence !== null &&
        subscriptionAccess(loaded.evidence, loaded.now).kind !== 'none';
      if (
        !active &&
        ['invite', 'assign', 'move', 'prepare-seat-count'].includes(
          command.kind,
        )
      )
        return { kind: 'refused', reason: 'no-active-plan' };
      const { customer, subscription } = loaded;
      if (
        command.kind === 'prepare-seat-count' &&
        (!customer ||
          !subscription ||
          (customer.mode !== 'test' && customer.mode !== 'live'))
      )
        return { kind: 'refused', reason: 'no-active-plan' };
      if (
        command.kind === 'invite' ||
        (command.kind === 'move' && command.to.kind === 'invite')
      ) {
        const reason = clubInvitationMailRefusal(
          await loaded.mail(),
          loaded.before.seatCount,
        );
        if (reason) return { kind: 'refused', reason };
      }
      const seatingCommand = toSeatingCommand(command, loaded);
      if (!seatingCommand) throw createAppError('INVARIANT');
      const decision = decideClubSeating(
        loaded.before,
        seatingCommand,
        loaded.now,
      );
      if (decision.kind === 'refused')
        return { kind: 'refused', reason: decision.reason };
      await loaded.apply(decision.state);
      if (command.kind !== 'prepare-seat-count') return { kind: 'changed' };
      // Readiness was established before any release was applied.
      if (
        !customer ||
        !subscription ||
        (customer.mode !== 'test' && customer.mode !== 'live')
      )
        throw createAppError('INVARIANT');
      return {
        kind: 'seat-count-ready',
        mode: customer.mode,
        vendorCustomerId: customer.vendorCustomerId,
        vendorSubscriptionId: subscription.vendorSubscriptionId,
        currentSeatCount: loaded.before.seatCount,
        seatCount: command.seatCount,
      };
    },
  );
}

/** Test composition only; production route/Billing composition is exercised in web integration. */
export const clubSeatTestCommands = (store: Store) => ({
  ...store,
  answer: (
    subject: MemberCaller,
    organizationId: string,
    invitationId: string,
    answer: 'accept' | 'decline',
  ) =>
    store.answerCommand(
      subject,
      organizationId,
      invitationId,
      answer,
      async (session) => {
        const loaded = await session.load();
        const decision = decideClubSeating(
          loaded.before,
          answer === 'accept'
            ? {
                kind: 'accept',
                invitationId,
                userId: subject.userId,
                seatedElsewhere: loaded.elsewhere,
              }
            : { kind: 'decline', invitationId },
          loaded.now,
        );
        if (decision.kind === 'refused')
          return { kind: 'refused', reason: decision.reason };
        await loaded.apply(decision.state);
        return { kind: 'changed' };
      },
    ),
  command: (
    subject: MemberCaller,
    organizationId: string,
    command: ClubSeatManagerCommand,
  ) => executeManagerCommand(store, subject, organizationId, command),
});
