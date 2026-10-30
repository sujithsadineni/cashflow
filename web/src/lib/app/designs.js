/**
 * The looks a person can pick in Settings → Design (see
 * design-context.jsx). Classic is the default; `swatches` only draw the
 * little preview chips in the picker.
 */
export const DESIGNS = [
  {
    value: 'classic',
    label: 'Classic',
    description: 'The original greenbar ledger — quiet surfaces, oxblood and pine as the only strong colors.',
    swatches: ['#FBFCFA', '#EDF2EC', '#8C2F1F', '#2F6B4F'],
  },
  {
    value: 'vivid',
    label: 'Vivid',
    description: 'Color tiles on every card, a saved-per-month ledger under Activity, and colored spend-mix bars.',
    swatches: ['#1F8A57', '#E5484D', '#F5A524', '#8E4EC6'],
  },
  {
    value: 'glass',
    label: 'Glass',
    description: 'Translucent sidebar and controls over a soft backdrop, the system font, and Apple-style springs. Content stays solid; only what floats is glass.',
    swatches: ['#F2F2F7', '#FFFFFF', '#0071E3', '#248A3D'],
  },
];

/**
 * Light or dark, on top of whichever design (D234). "Auto" follows the
 * computer's own appearance setting; the default, so nothing changes for
 * anyone until they pick.
 */
export const APPEARANCES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];
export const DEFAULT_APPEARANCE = 'system';

// Vivid became the default in D142 ("I love this Vivid design… make this the
// default"). Anyone who already chose Classic keeps it — only an unset
// preference follows this. The GitHub Pages demo opens in Glass (D257), the
// newest design, so a first visit plays its intro; a saved pick still wins.
export const DEFAULT_DESIGN = import.meta.env.VITE_DEMO === '1' ? 'glass' : 'vivid';

// The Vivid design's category colors, in rank order (biggest spend
// first). Shared by the Spend mix bars and "Where it's going" so the
// same category is the same color in both places on the page.
export const VIVID_MIX_COLORS = ['bg-vivid-red', 'bg-vivid-amber', 'bg-vivid-teal', 'bg-vivid-blue', 'bg-vivid-purple', 'bg-vivid-pink'];
