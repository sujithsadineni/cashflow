/**
 * Generic person icon.
 *
 * This used to be a per-id male/female pair, keyed on the assumption
 * that the app would only ever have exactly two fixed people. Now
 * that people are created by signup or detected from a statement,
 * there's no gender to key off of -- same 16x16 stroke language as
 * every other icon in the app, but one icon for everyone.
 */

const iconProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const strokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

function GenericPersonIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="5.5" r="2.5" {...strokeProps} />
      <path d="M2.5 13.5c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5" {...strokeProps} />
    </svg>
  );
}

export function personIcon() {
  return <GenericPersonIcon />;
}
