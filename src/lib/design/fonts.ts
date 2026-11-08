/**
 * DESYRA Design System - Font Pairs & Google Fonts URL Builder
 */

import type { FontPair } from './types';

export const FONT_PAIRS: Record<string, FontPair> = {
  'inter-neutral': {
    id: 'inter-neutral',
    name: 'Inter (Clean Neutral)',
    displayFamily: 'Inter',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['clean', 'neutral', 'modern', 'saas'],
  },
  'space-grotesk-tech': {
    id: 'space-grotesk-tech',
    name: 'Space Grotesk + Inter (Tech & Developer)',
    displayFamily: 'Space Grotesk',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['tech', 'developer', 'cyber', 'modern'],
  },
  'sora-modern': {
    id: 'sora-modern',
    name: 'Sora + Inter (Modern Geometric)',
    displayFamily: 'Sora',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['modern', 'fintech', 'sleek', 'product'],
  },
  'manrope-friendly': {
    id: 'manrope-friendly',
    name: 'Manrope (Friendly Corporate)',
    displayFamily: 'Manrope',
    bodyFamily: 'Manrope',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['friendly', 'corporate', 'clean', 'finance'],
  },
  'plus-jakarta-sans': {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans (SaaS & Startup)',
    displayFamily: 'Plus Jakarta Sans',
    bodyFamily: 'Plus Jakarta Sans',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['saas', 'startup', 'dashboard', 'clean'],
  },
  'outfit-friendly': {
    id: 'outfit-friendly',
    name: 'Outfit + Inter (Warm & Approachable)',
    displayFamily: 'Outfit',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['warm', 'friendly', 'mobile', 'social'],
  },
  'playfair-editorial': {
    id: 'playfair-editorial',
    name: 'Playfair Display + Inter (Classic Editorial)',
    displayFamily: 'Playfair Display',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['editorial', 'classic', 'publishing', 'portfolio'],
  },
  'fraunces-editorial': {
    id: 'fraunces-editorial',
    name: 'Fraunces + Inter (Warm Editorial)',
    displayFamily: 'Fraunces',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['editorial', 'warm', 'cafe', 'food'],
  },
  'dm-serif-luxury': {
    id: 'dm-serif-luxury',
    name: 'DM Serif Display + DM Sans (Luxury & Fashion)',
    displayFamily: 'DM Serif Display',
    bodyFamily: 'DM Sans',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['luxury', 'fashion', 'high-end', 'ecommerce'],
  },
  'bricolage-bold': {
    id: 'bricolage-bold',
    name: 'Bricolage Grotesque + Inter (Bold & Expressive)',
    displayFamily: 'Bricolage Grotesque',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['bold', 'expressive', 'creative', 'marketing'],
  },
  'poppins-playful': {
    id: 'poppins-playful',
    name: 'Poppins (Playful & Vibrant)',
    displayFamily: 'Poppins',
    bodyFamily: 'Poppins',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin'],
    moodTags: ['playful', 'vibrant', 'game', 'education'],
  },

  // Bengali-capable Pairs
  'hind-siliguri-bn': {
    id: 'hind-siliguri-bn',
    name: 'Hind Siliguri (Bengali Clean)',
    displayFamily: 'Hind Siliguri',
    bodyFamily: 'Hind Siliguri',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin', 'bengali'],
    moodTags: ['bengali', 'clean', 'general', 'news'],
  },
  'noto-sans-bengali-bn': {
    id: 'noto-sans-bengali-bn',
    name: 'Noto Sans Bengali (Bengali Modern)',
    displayFamily: 'Noto Sans Bengali',
    bodyFamily: 'Noto Sans Bengali',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin', 'bengali'],
    moodTags: ['bengali', 'modern', 'corporate', 'learning'],
  },
  'anek-bangla-bn': {
    id: 'anek-bangla-bn',
    name: 'Anek Bangla (Bengali Bold)',
    displayFamily: 'Anek Bangla',
    bodyFamily: 'Hind Siliguri',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@500;600;700&family=Hind+Siliguri:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin', 'bengali'],
    moodTags: ['bengali', 'bold', 'marketing', 'magazine'],
  },
  'baloo-da-2-bn': {
    id: 'baloo-da-2-bn',
    name: 'Baloo Da 2 (Bengali Playful)',
    displayFamily: 'Baloo Da 2',
    bodyFamily: 'Hind Siliguri',
    monoFamily: 'JetBrains Mono',
    weights: [400, 500, 600, 700],
    googleFontsHref:
      'https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@600;700&family=Hind+Siliguri:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
    supports: ['latin', 'bengali'],
    moodTags: ['bengali', 'playful', 'food', 'kids'],
  },
};

/**
 * Gets a font pair by ID or returns default fallback.
 */
export function getFontPair(id: string, isBengali = false): FontPair {
  if (FONT_PAIRS[id]) {
    return FONT_PAIRS[id];
  }
  return isBengali ? FONT_PAIRS['hind-siliguri-bn'] : FONT_PAIRS['inter-neutral'];
}
