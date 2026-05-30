import { Composition } from 'remotion';
import { WebsiteProductVideo } from './website-product-video';

export const VIDEO_FPS = 30;
export const VIDEO_DURATION_IN_FRAMES = 1800;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

export function RemotionRoot() {
  return (
    <Composition
      id="VaultmarkProductVideo"
      component={WebsiteProductVideo}
      durationInFrames={VIDEO_DURATION_IN_FRAMES}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={{
        product: 'Vaultmark',
        tagline: 'Markdown in S3. Searchable, cited, and ready for AI-assisted knowledge work.',
      }}
    />
  );
}
