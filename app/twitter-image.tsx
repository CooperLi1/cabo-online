import { ImageResponse } from 'next/og';
import { SocialPreview } from './social-preview';

export const alt = 'cabo! pastel pixel-art multiplayer card game preview';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <SocialPreview kind="twitter" width={size.width} height={size.height} />,
    size,
  );
}
