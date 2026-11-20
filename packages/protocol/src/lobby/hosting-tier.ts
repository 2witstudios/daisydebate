/**
 * Host tiers (decision 80, ADR 0149). Anyone can host a tournament free up to
 * 16 entries, without recording, AI judging or broadcast. One payment for
 * that tournament only unlocks those and raises its entry cap: USD 99 up to
 * 64 entries, USD 199 unlimited. Nothing renews.
 */
export const hostingTiers = ['free', 'event_64', 'event_unlimited'] as const;
export type HostingTier = (typeof hostingTiers)[number];
export type PaidHostingTier = Exclude<HostingTier, 'free'>;
export const paidHostingTiers = ['event_64', 'event_unlimited'] as const;

export const isHostingTier = (value: string): value is HostingTier =>
  (hostingTiers as readonly string[]).includes(value);

const rank: Record<HostingTier, number> = {
  free: 0,
  event_64: 1,
  event_unlimited: 2,
};

const entryCaps = {
  free: 16,
  event_64: 64,
  event_unlimited: null,
} as const satisfies Record<HostingTier, number | null>;

/** The accepted entries a tournament may hold on a tier; null has no cap. */
export const hostingEntryCap = <Tier extends HostingTier>(
  tier: Tier,
): (typeof entryCaps)[Tier] => entryCaps[tier];

/** The one-time Stripe offers, found by lookup key and verified by amount (USD cents). */
export const hostingOffers = {
  event_64: { unitAmount: 9900, lookupKey: 'daisy_host_event_usd_99' },
  event_unlimited: {
    unitAmount: 19900,
    lookupKey: 'daisy_host_event_usd_199',
  },
} as const satisfies Record<
  PaidHostingTier,
  { readonly unitAmount: number; readonly lookupKey: string }
>;

/**
 * How many of a paid tournament's event Rounds may record at once: half its
 * entry cap for USD 99 (every pair in one round), and a fleet-bounded 64 for
 * unlimited. A hosting grant carries its own limits instead.
 */
export const hostingCaptureConcurrency = {
  event_64: 32,
  event_unlimited: 64,
} as const satisfies Record<PaidHostingTier, number>;

const tierPrice = (tier: HostingTier): number =>
  tier === 'free' ? 0 : hostingOffers[tier].unitAmount;

/** What a hosted tournament may switch on, or take one more of. */
export type HostedFeature = 'entry' | 'recording' | 'ai_judging' | 'broadcast';
type UpgradeReason = 'entry-limit' | Exclude<HostedFeature, 'entry'>;
export type EventAllowance =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'upgrade_required'; readonly reason: UpgradeReason };

const allowed: EventAllowance = { kind: 'allowed' };

/**
 * Whether a tournament on `tier`, holding `acceptedEntries`, may take one
 * more entry or switch a paid feature on.
 */
export function eventAllowance(
  tier: HostingTier,
  acceptedEntries: number,
  feature: HostedFeature,
): EventAllowance {
  switch (feature) {
    case 'entry': {
      const cap = hostingEntryCap(tier);
      return cap === null || acceptedEntries < cap
        ? allowed
        : { kind: 'upgrade_required', reason: 'entry-limit' };
    }
    case 'recording':
    case 'ai_judging':
    case 'broadcast':
      return tier === 'free'
        ? { kind: 'upgrade_required', reason: feature }
        : allowed;
  }
}

/** What moving a tournament from `current` to `target` still costs (USD cents). */
export type HostingUpgrade =
  | { readonly kind: 'owed'; readonly amount: number }
  | { readonly kind: 'held' };

export function hostingUpgrade(
  current: HostingTier,
  target: PaidHostingTier,
): HostingUpgrade {
  return rank[target] <= rank[current]
    ? { kind: 'held' }
    : { kind: 'owed', amount: tierPrice(target) - tierPrice(current) };
}

/**
 * A tournament's tier is never stored twice: it is the highest tier paid
 * for it, and a current administrative hosting grant covering it counts as
 * unlimited.
 */
export function effectiveHostingTier(input: {
  readonly paidTiers: readonly PaidHostingTier[];
  readonly granted: boolean;
}): HostingTier {
  if (input.granted) return 'event_unlimited';
  return input.paidTiers.reduce<HostingTier>(
    (highest, tier) => (rank[tier] > rank[highest] ? tier : highest),
    'free',
  );
}
