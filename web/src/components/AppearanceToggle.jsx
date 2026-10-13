import { useDesign } from '../use-design';
import { APPEARANCES } from '../designs';

/**
 * Light / Dark / Auto, one tap each way (D234). In the sidebar's footer and
 * the phone's top bar; Settings → Design has the same choice spelled out.
 * The icon shows what's chosen: a sun, a moon, or a half-filled circle for
 * Auto (follows the computer). A tap moves to the next one.
 */
const ICON = {
  light: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 9.6A5.8 5.8 0 016.4 2.5a5.8 5.8 0 107.1 7.1z" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export function AppearanceToggle({ withLabel = false, className = '' }) {
  const { appearance, setAppearance, theme } = useDesign();
  const i = APPEARANCES.findIndex((a) => a.value === appearance);
  const current = APPEARANCES[i] ?? APPEARANCES[2];
  const next = APPEARANCES[(i + 1) % APPEARANCES.length];
  const label = current.value === 'system' ? `Auto (${theme})` : current.label;
  return (
    <button
      type="button"
      onClick={() => setAppearance(next.value)}
      aria-label={`Appearance: ${label}. Switch to ${next.label}`}
      title={`Appearance: ${label}. Click for ${next.label}`}
      className={`flex items-center gap-2 rounded-md text-muted transition-colors hover:bg-band hover:text-ink ${withLabel ? 'px-2 py-1.5 text-xs' : 'size-9 justify-center'} ${className}`}
    >
      {ICON[current.value]}
      {withLabel && <span>{label}</span>}
    </button>
  );
}
