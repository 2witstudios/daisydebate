/** Streamed spans do not pass through beforeSend or beforeSendTransaction (Sentry11). */
export function scrubSpan<
  S extends {
    name: string;
    attributes: Record<string, unknown>;
    links?: readonly { attributes?: Record<string, unknown> }[];
  },
>(span: S): S {
  const scrub = (attributes: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(attributes)
        .filter(
          ([key]) =>
            !/^(?:url\.query|http\.query|db\.statement|db\.query\.(?:text|parameter.*)|http\.request\.(?:body|header.*)|user\.(?:email|name|ip_address))$/.test(
              key,
            ),
        )
        .map(([key, value]) => [
          key,
          /^(?:url(?:\.full|\.path)?|http\.(?:url|target)|sentry\.segment\.name)$/.test(
            key,
          ) && typeof value === 'string'
            ? value.split(/[?#]/)[0]
            : value,
        ]),
    );
  return {
    ...span,
    name:
      span.attributes['db.system'] || span.attributes['db.system.name']
        ? 'db.query'
        : span.name.split(/[?#]/)[0]!,
    attributes: scrub(span.attributes),
    ...(span.links
      ? {
          links: span.links.map((link) => ({
            ...link,
            ...(link.attributes ? { attributes: scrub(link.attributes) } : {}),
          })),
        }
      : {}),
  };
}
