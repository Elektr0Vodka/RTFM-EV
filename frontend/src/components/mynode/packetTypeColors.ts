// Packet type colours, shared by the My Node charts and the live signal card.
// Hardcoded HSL values (~28° steps around the hue wheel) so colours are vivid
// and distinct regardless of which theme is active.

const NAMED_TYPE_COLORS: Record<string, string> = {
  // All PayloadType enum values by exact name
  REQUEST: 'hsl(4,   70%, 54%)', // red
  RESPONSE: 'hsl(28,  82%, 54%)', // orange
  TEXT_MESSAGE: 'hsl(48,  85%, 46%)', // amber
  ACK: 'hsl(135, 60%, 44%)', // green
  ADVERT: 'hsl(192, 78%, 46%)', // cyan
  GROUP_TEXT: 'hsl(255, 65%, 60%)', // violet
  GROUP_DATA: 'hsl(310, 62%, 56%)', // magenta
  ANON_REQUEST: 'hsl(336, 70%, 56%)', // rose
  PATH: 'hsl(158, 62%, 42%)', // teal-green
  TRACE: 'hsl(22,  80%, 52%)', // burnt orange
  MULTIPART: 'hsl(222, 68%, 58%)', // indigo-blue
  CONTROL: 'hsl(282, 58%, 54%)', // purple
  RAW_CUSTOM: 'hsl(82,  58%, 44%)', // lime
  FUOTA: 'hsl(100, 55%, 40%)', // green (meshcore_fuota firmware updates, payload type 0x0E)
  // Legacy / alternate spellings that may appear in older data
  GROUPTEXT: 'hsl(255, 65%, 60%)',
  TEXTMESSAGE: 'hsl(48,  85%, 46%)',
};

// Fallback palette for any unknown future types - 8 evenly-spaced hues
const FALLBACK_COLORS = [
  'hsl(0,   65%, 52%)',
  'hsl(45,  78%, 48%)',
  'hsl(90,  55%, 44%)',
  'hsl(135, 58%, 44%)',
  'hsl(180, 68%, 42%)',
  'hsl(225, 65%, 56%)',
  'hsl(270, 60%, 56%)',
  'hsl(315, 62%, 54%)',
];

export function typeColor(t: string): string {
  const upper = t.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (upper in NAMED_TYPE_COLORS) return NAMED_TYPE_COLORS[upper];
  // Partial-match fallback for any prefixed/suffixed variants
  for (const [k, v] of Object.entries(NAMED_TYPE_COLORS)) {
    if (upper.includes(k) || k.includes(upper)) return v;
  }
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
