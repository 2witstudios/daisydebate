import { z } from 'zod';

/** `AUTH_TRUSTED_PROXIES` keyword: trust this machine's default gateway. */
export const TRUSTED_PROXY_GATEWAY = 'gateway';

// IPv6 that embeds IPv4: dotted notation, or the IPv4-mapped block ::ffff:0:0/96
// written in hex (only zero groups, then ffff, then exactly two groups).
const embedsIpv4 = (value: string) =>
  value.includes('.') ||
  /^[0:]*:ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(value.split('/')[0] ?? '');
// The accepted set must stay a subset of what Better Auth acts on: it drops
// an entry it cannot parse with only a warning, quietly untrusting a real
// proxy. It reduces IPv4-mapped IPv6 to four bytes and caps that prefix at
// 32, so mapped ranges are refused outright; operators write the IPv4 form.
// Stricter than Better Auth on purpose (no leading-zero prefixes either).
// The literal keyword instead trusts this machine's single default gateway,
// resolved once at the server edge through @daisy/ingress/trusted-proxies:
// on Fly that is the one address fly-proxy connects from (ISSUE-162).
const proxyAddress = z.union([
  z.ipv4(),
  z.cidrv4(),
  z.union([z.ipv6(), z.cidrv6()]).refine((value) => !embedsIpv4(value)),
  z.literal(TRUSTED_PROXY_GATEWAY),
]);
/** Optional comma-separated list: absent or blank means an empty list. */
const commaList = (entry: z.ZodType<string, string>) =>
  z
    .string()
    .default('')
    .transform((value) =>
      value.trim() === '' ? [] : value.split(',').map((item) => item.trim()),
    )
    .pipe(z.array(entry));

/** The `AUTH_TRUSTED_PROXIES` list: absent or blank is empty. */
export const trustedProxyList = commaList(proxyAddress);

/** Shared ingress configuration, independent of authentication activation. */
export function readTrustedProxyConfig(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const parsed = trustedProxyList.safeParse(env.AUTH_TRUSTED_PROXIES);
  if (!parsed.success)
    throw new Error('Invalid ingress configuration: AUTH_TRUSTED_PROXIES');
  return parsed.data;
}
