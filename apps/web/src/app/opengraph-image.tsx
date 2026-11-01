import { renderShareImage } from '../lib/share-image';

export const alt =
  'Daisy Debate — The arena for competitive debate. Better arguments. A more thoughtful world.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return renderShareImage('og');
}
