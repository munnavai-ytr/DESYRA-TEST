/**
 * DESYRA Design System - Modular Scales, Shadows, Radii & Motion
 */

import type { DesignRadius, DesignDensity, DesignMotion } from './types';

export interface RadiusScale {
  sm: string;
  md: string;
  lg: string;
  full: string;
}

export interface ShadowScale {
  sm: string;
  md: string;
  lg: string;
}

export interface DensityScale {
  section: string;
  card: string;
  button: string;
}

export interface MotionScale {
  fast: string;
  base: string;
  slow: string;
  ease: string;
}

/**
 * Returns border radius token values based on DesignRadius keyword.
 */
export function getRadiusScale(radius: DesignRadius): RadiusScale {
  switch (radius) {
    case 'sharp':
      return { sm: '2px', md: '4px', lg: '6px', full: '9999px' };
    case 'round':
      return { sm: '8px', md: '16px', lg: '24px', full: '9999px' };
    case 'soft':
    default:
      return { sm: '6px', md: '10px', lg: '16px', full: '9999px' };
  }
}

/**
 * Returns shadow token values based on shadow style and mode.
 */
export function getShadowScale(
  style: 'none' | 'subtle' | 'layered',
  mode: 'dark' | 'light'
): ShadowScale {
  if (style === 'none') {
    return { sm: 'none', md: 'none', lg: 'none' };
  }

  if (mode === 'dark') {
    if (style === 'layered') {
      return {
        sm: '0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3)',
        md: '0 4px 12px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.4)',
        lg: '0 12px 32px rgba(0, 0, 0, 0.65), 0 4px 12px rgba(0, 0, 0, 0.5)',
      };
    }
    // Subtle dark shadows
    return {
      sm: '0 1px 2px rgba(0, 0, 0, 0.35)',
      md: '0 4px 8px rgba(0, 0, 0, 0.4)',
      lg: '0 8px 20px rgba(0, 0, 0, 0.5)',
    };
  } else {
    if (style === 'layered') {
      return {
        sm: '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
        md: '0 4px 16px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.04)',
        lg: '0 16px 40px rgba(0, 0, 0, 0.12), 0 6px 12px rgba(0, 0, 0, 0.06)',
      };
    }
    // Subtle light shadows
    return {
      sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      md: '0 4px 10px rgba(0, 0, 0, 0.07)',
      lg: '0 10px 25px rgba(0, 0, 0, 0.09)',
    };
  }
}

/**
 * Returns density padding scale based on DesignDensity keyword.
 */
export function getDensityScale(density: DesignDensity): DensityScale {
  switch (density) {
    case 'compact':
      return {
        section: '2.5rem 1rem',
        card: '0.875rem 1rem',
        button: '0.4rem 0.85rem',
      };
    case 'spacious':
      return {
        section: '5rem 2rem',
        card: '2rem 2.25rem',
        button: '0.75rem 1.75rem',
      };
    case 'comfortable':
    default:
      return {
        section: '3.5rem 1.5rem',
        card: '1.25rem 1.5rem',
        button: '0.55rem 1.25rem',
      };
  }
}

/**
 * Returns motion durations and easings based on DesignMotion keyword.
 */
export function getMotionScale(motion: DesignMotion): MotionScale {
  switch (motion) {
    case 'none':
      return {
        fast: '0ms',
        base: '0ms',
        slow: '0ms',
        ease: 'linear',
      };
    case 'rich':
      return {
        fast: '150ms',
        base: '300ms',
        slow: '500ms',
        ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
      };
    case 'subtle':
    default:
      return {
        fast: '100ms',
        base: '200ms',
        slow: '350ms',
        ease: 'cubic-bezier(0.2, 0, 0, 1)',
      };
  }
}

/**
 * Responsive Breakpoints
 */
export const BREAKPOINTS = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
};
