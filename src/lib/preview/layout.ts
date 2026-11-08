/**
 * DESYRA Preview Frame Layout Engine
 * Pure, deterministic layout and virtual scaling calculator.
 * Fix Push 7A.1: Implements precise scaling, zero-margin outer wrapper,
 * bottom-aligned viewport, and stage isolation.
 */

export type DeviceMode = 'mobile' | 'tablet' | 'desktop';

export interface ComputeFrameLayoutInput {
  deviceMode: DeviceMode;
  stageWidth: number;
  stageHeight: number;
}

export interface FrameLayoutResult {
  scale: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  offsetX: number;
}

export const VIRTUAL_DEVICE_WIDTHS: Record<DeviceMode, number> = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
};

/**
 * Computes frame scaling, inner viewport dimensions, and outer container layout.
 */
export function computeFrameLayout({
  deviceMode,
  stageWidth,
  stageHeight,
}: ComputeFrameLayoutInput): FrameLayoutResult {
  const sWidth = Math.floor(Math.max(0, stageWidth));
  const sHeight = Math.floor(Math.max(0, stageHeight));

  if (sWidth === 0 || sHeight === 0) {
    return {
      scale: 1,
      innerWidth: 0,
      innerHeight: 0,
      outerWidth: 0,
      outerHeight: 0,
      offsetX: 0,
    };
  }

  const virtualWidth = VIRTUAL_DEVICE_WIDTHS[deviceMode] || 1280;

  if (sWidth >= virtualWidth) {
    // Stage is at least as wide as the device virtual width
    // Desktop uses full stageWidth when larger than 1280
    const frameWidth = deviceMode === 'desktop' ? sWidth : virtualWidth;
    const offsetX = Math.floor(Math.max(0, (sWidth - frameWidth) / 2));

    return {
      scale: 1,
      innerWidth: frameWidth,
      innerHeight: sHeight,
      outerWidth: frameWidth,
      outerHeight: sHeight,
      offsetX,
    };
  }

  // Stage is narrower than the target virtual width -> scale down
  // No -16 offset, no hard 0.2 clamp; minimum scale is 0.25
  const rawScale = sWidth / virtualWidth;
  const scale = Math.max(0.25, rawScale);

  const innerWidth = virtualWidth;
  const innerHeight = Math.floor(sHeight / scale);
  const outerWidth = Math.min(sWidth, Math.floor(virtualWidth * scale));
  const outerHeight = sHeight;
  const offsetX = Math.floor(Math.max(0, (sWidth - outerWidth) / 2));

  return {
    scale,
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    offsetX,
  };
}
