import { ageBands } from '@daisy/protocol';
import {
  friendApprovalLimits,
  friendRequestNeedsGuardian,
  protectionLevels,
  protectionLimits,
  type ProtectionLevel,
} from '@daisy/protocol/protection-level';

export const protectionChoices: readonly ProtectionLevel[] = [
  ...protectionLevels.flatMap((level) =>
    level === 'custom' ? [] : [{ level }],
  ),
  ...friendApprovalLimits.flatMap((friendApproval) =>
    [false, true].flatMap((friendsOnlyMessages) =>
      [false, true].map((rankedAllowed) => ({
        level: 'custom' as const,
        friendApproval,
        friendsOnlyMessages,
        rankedAllowed,
      })),
    ),
  ),
];

/** SQL is a literal lookup of the protocol's finite choice space. */
export const protectionPolicyRows = (): string =>
  protectionChoices
    .map((choice) => {
      const limits = protectionLimits(choice);
      return `('${JSON.stringify(choice)}'::jsonb, '${limits.friendApproval}', ${limits.messageRequests === 'friends'}, ${limits.rankedAllowed})`;
    })
    .join(',\n    ');

const friendApprovalRows = () =>
  friendApprovalLimits
    .flatMap((approval) =>
      (['incoming', 'outgoing'] as const).flatMap((direction) =>
        [...ageBands, null].flatMap((age) =>
          friendRequestNeedsGuardian(approval, direction, age)
            ? [`('${approval}', '${direction}', '${age ?? ''}')`]
            : [],
        ),
      ),
    )
    .join(',\n      ');

if (import.meta.main)
  process.stdout.write(
    `${process.argv.includes('--holds') ? friendApprovalRows() : protectionPolicyRows()}\n`,
  );
