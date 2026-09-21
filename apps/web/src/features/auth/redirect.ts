const ORIGIN = 'http://local.invalid';

const hasControlOrBackslash = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f || character === '\\';
  });

/** Percent-decodes up to three layers so double-encoded bypasses surface. */
function decodeLayers(value: string): string[] | null {
  const layers = [value];
  for (let index = 0; index < 3; index += 1) {
    const last = layers[layers.length - 1] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(last);
    } catch {
      return null;
    }
    if (decoded === last) break;
    layers.push(decoded);
  }
  return layers;
}

const isLocalPath = (layer: string) =>
  layer.startsWith('/') &&
  !layer.startsWith('//') &&
  !hasControlOrBackslash(layer);

/**
 * Once dot segments are resolved every decoding layer must still be a
 * same-origin path, so `/..%2F..%2F//host` cannot become protocol-relative,
 * and no layer may carry a credential in its query.
 */
function staysLocal(layer: string): boolean {
  try {
    const url = new URL(layer, ORIGIN);
    return (
      url.origin === ORIGIN &&
      !url.pathname.startsWith('//') &&
      !url.searchParams.has('token')
    );
  } catch {
    return false;
  }
}

/**
 * Return destinations are local paths only. External URLs, protocol-relative
 * and backslash forms, encoded variants and token-bearing queries all fall
 * back, so a confirmation redirect can never leak or forward a credential.
 */
export function safeLocalDestination(
  value: string | null | undefined,
  fallback = '/lobby',
): string {
  if (!value) return fallback;
  const layers = decodeLayers(value);
  return layers && layers.every(isLocalPath) && layers.every(staysLocal)
    ? value
    : fallback;
}
