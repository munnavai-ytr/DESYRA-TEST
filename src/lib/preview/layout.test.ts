import { describe, it, expect } from 'vitest';
import { computeFrameLayout } from './layout';

describe('computeFrameLayout', () => {
  it('computes 360x600 for Phone, Tablet, and Desktop', () => {
    // 1. Phone (virtual width 390)
    const phone = computeFrameLayout({
      deviceMode: 'mobile',
      stageWidth: 360,
      stageHeight: 600,
    });
    expect(phone.scale).toBeCloseTo(360 / 390, 4);
    expect(phone.outerWidth).toBeLessThanOrEqual(360);
    expect(phone.outerHeight).toBeLessThanOrEqual(600);
    expect(phone.innerHeight * phone.scale).toBeCloseTo(600, 0);
    expect(phone.offsetX).toBeGreaterThanOrEqual(0);

    // 2. Tablet (virtual width 768)
    const tablet = computeFrameLayout({
      deviceMode: 'tablet',
      stageWidth: 360,
      stageHeight: 600,
    });
    expect(tablet.scale).toBeCloseTo(360 / 768, 4);
    expect(tablet.outerWidth).toBeLessThanOrEqual(360);
    expect(tablet.outerHeight).toBeLessThanOrEqual(600);
    expect(tablet.innerHeight * tablet.scale).toBeCloseTo(600, 0);

    // 3. Desktop (virtual width 1280)
    const desktop = computeFrameLayout({
      deviceMode: 'desktop',
      stageWidth: 360,
      stageHeight: 600,
    });
    expect(desktop.scale).toBeCloseTo(360 / 1280, 4);
    expect(desktop.outerWidth).toBeLessThanOrEqual(360);
    expect(desktop.outerHeight).toBeLessThanOrEqual(600);
    expect(desktop.innerHeight * desktop.scale).toBeCloseTo(600, 0);
  });

  it('handles 768x1024 correctly', () => {
    // Tablet at exact virtual width (768)
    const tablet = computeFrameLayout({
      deviceMode: 'tablet',
      stageWidth: 768,
      stageHeight: 1024,
    });
    expect(tablet.scale).toBe(1);
    expect(tablet.innerWidth).toBe(768);
    expect(tablet.innerHeight).toBe(1024);
    expect(tablet.outerWidth).toBe(768);
    expect(tablet.outerHeight).toBe(1024);
    expect(tablet.offsetX).toBe(0);

    // Mobile on 768 width (centered, scale 1)
    const mobile = computeFrameLayout({
      deviceMode: 'mobile',
      stageWidth: 768,
      stageHeight: 1024,
    });
    expect(mobile.scale).toBe(1);
    expect(mobile.innerWidth).toBe(390);
    expect(mobile.outerWidth).toBe(390);
    expect(mobile.offsetX).toBe(Math.floor((768 - 390) / 2));
  });

  it('handles 1440x900 correctly', () => {
    // Desktop: larger than 1280 -> uses full stage width
    const desktop = computeFrameLayout({
      deviceMode: 'desktop',
      stageWidth: 1440,
      stageHeight: 900,
    });
    expect(desktop.scale).toBe(1);
    expect(desktop.innerWidth).toBe(1440);
    expect(desktop.outerWidth).toBe(1440);
    expect(desktop.outerHeight).toBe(900);
    expect(desktop.offsetX).toBe(0);

    // Mobile: centered at 390px
    const mobile = computeFrameLayout({
      deviceMode: 'mobile',
      stageWidth: 1440,
      stageHeight: 900,
    });
    expect(mobile.scale).toBe(1);
    expect(mobile.outerWidth).toBe(390);
    expect(mobile.offsetX).toBe(Math.floor((1440 - 390) / 2));
  });

  it('handles 1280x700 correctly', () => {
    const desktop = computeFrameLayout({
      deviceMode: 'desktop',
      stageWidth: 1280,
      stageHeight: 700,
    });
    expect(desktop.scale).toBe(1);
    expect(desktop.outerWidth).toBe(1280);
    expect(desktop.outerHeight).toBe(700);
    expect(desktop.offsetX).toBe(0);
  });

  it('handles tiny stages gracefully without exceeding stage or producing negative/NaN values', () => {
    const tinySizes = [
      { stageWidth: 100, stageHeight: 100 },
      { stageWidth: 200, stageHeight: 300 },
      { stageWidth: 50, stageHeight: 80 },
      { stageWidth: 0, stageHeight: 0 },
    ];

    const modes = ['mobile', 'tablet', 'desktop'] as const;

    for (const size of tinySizes) {
      for (const mode of modes) {
        const result = computeFrameLayout({
          deviceMode: mode,
          stageWidth: size.stageWidth,
          stageHeight: size.stageHeight,
        });

        expect(result.outerWidth).toBeLessThanOrEqual(size.stageWidth);
        expect(result.outerHeight).toBeLessThanOrEqual(size.stageHeight);
        expect(result.outerWidth).toBeGreaterThanOrEqual(0);
        expect(result.outerHeight).toBeGreaterThanOrEqual(0);
        expect(result.scale).toBeGreaterThanOrEqual(0.25);
        expect(result.offsetX).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(result.scale)).toBe(false);
        expect(Number.isNaN(result.innerWidth)).toBe(false);
        expect(Number.isNaN(result.innerHeight)).toBe(false);
        expect(Number.isNaN(result.outerWidth)).toBe(false);
        expect(Number.isNaN(result.outerHeight)).toBe(false);
        expect(Number.isNaN(result.offsetX)).toBe(false);

        if (size.stageHeight > 0) {
          expect(result.innerHeight * result.scale).toBeCloseTo(size.stageHeight, 0);
        }
      }
    }
  });
});
