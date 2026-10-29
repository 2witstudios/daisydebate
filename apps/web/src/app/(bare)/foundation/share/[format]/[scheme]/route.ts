import { renderShareImage } from '../../../../../../lib/share-image';
import { shareFormats } from '../../../../../../ui/brand/share-canvas';

// The proxy's /foundation gate also protects this screenshot/export route.
export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{ format: string; scheme: string }>;
  },
) {
  const { format, scheme } = await params;
  if (
    !Object.hasOwn(shareFormats, format) ||
    (scheme !== 'light' && scheme !== 'dark')
  )
    return new Response(null, { status: 404 });
  return renderShareImage(format as keyof typeof shareFormats, scheme);
}
