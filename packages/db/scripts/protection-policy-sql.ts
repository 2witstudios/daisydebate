import { ageBands, messageRequestSettings } from '@daisy/protocol';
import { dmRequestAction } from '@daisy/protocol/dm-policy';
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
const protectionPolicyRows = (): string =>
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

/** Both minor bands answer identically under the new-request rule. */
export const dmRequestPolicyRows = () =>
  (['13-15', 'adult'] as const)
    .flatMap((initiator) =>
      (['13-15', 'adult'] as const).flatMap((recipient) =>
        [false, true].flatMap((friends) =>
          [false, true].flatMap((linkedStaff) =>
            messageRequestSettings.map((recipientSetting) => {
              const action = dmRequestAction({
                initiator,
                recipient,
                friends,
                linkedStaff,
                recipientSetting,
              });
              return `(${initiator === 'adult'}, ${recipient === 'adult'}, ${friends}, ${linkedStaff}, '${recipientSetting}', '${action}')`;
            }),
          ),
        ),
      ),
    )
    .join(',\n    ');

if (import.meta.main)
  process.stdout.write(
    `${
      process.argv.includes('--dm-requests')
        ? dmRequestPolicyRows()
        : process.argv.includes('--holds')
          ? friendApprovalRows()
          : protectionPolicyRows()
    }\n`,
  );
