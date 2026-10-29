import { ImageResponse } from 'next/og';
import { RasterMark } from '../ui/brand/raster-mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<RasterMark size={size.width} tile />, size);
}
