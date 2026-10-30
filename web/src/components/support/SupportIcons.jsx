/**
 * Line icons for the help button and everything it opens (D334): the
 * menu's three options, the Support panel's tiles and the report form.
 * One stroke weight (1.6 on a 24 grid), currentColor, so they take ink in
 * Classic and white on Vivid's coloured tiles. Each has named parts that
 * index.css moves when its `.support-item` is hovered or focused (the
 * bulb's rays light, the bug's legs wiggle, the heart beats, the star
 * turns, the link's halves meet, the arrow lifts). Off under Reduce Motion.
 */

// `kind` is the icon's own class (what index.css moves); `className` is the caller's.
const Svg = ({ children, size = 20, kind = '', className = '' }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`si ${kind} ${className}`} aria-hidden="true">
    {children}
  </svg>
);

export const BulbIcon = (p) => (
  <Svg {...p} kind="si-bulb">
    <path className="si-glass" d="M9 16.5c0-1.8-3-3.2-3-7a6 6 0 0112 0c0 3.8-3 5.2-3 7z" />
    <path d="M9.5 19h5M10.5 21.5h3" />
    <path className="si-rays" d="M12 .8v1.4M3.2 4.2l1 1M20.8 4.2l-1 1M1 10.5h1.4M21.6 10.5H23" />
  </Svg>
);

export const BugIcon = (p) => (
  <Svg {...p} kind="si-bug">
    <rect x="7.5" y="8" width="9" height="12" rx="4.5" />
    <path d="M9.5 8a2.5 2.5 0 015 0M12 11.5V20" />
    <g className="si-legs-l"><path d="M7.5 11.5H4.5M7.5 15H4M7.5 18l-2.5 2" /></g>
    <g className="si-legs-r"><path d="M16.5 11.5h3M16.5 15H20M16.5 18l2.5 2" /></g>
    <path d="M10 5.5L8.5 3.5M14 5.5l1.5-2" />
  </Svg>
);

export const HeartIcon = (p) => (
  <Svg {...p} kind="si-heartbeat">
    <path className="si-heart" d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.2a4.3 4.3 0 017.5 2.6C19.5 15.4 12 20 12 20z" />
  </Svg>
);

export const LinkedInIcon = (p) => (
  <Svg {...p} kind="si-tilt">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
    <path d="M8 10.5V16.5M11.5 16.5v-6M11.5 13.2c0-1.6 1-2.7 2.4-2.7s2.3 1.1 2.3 2.7v3.3" />
    <circle cx="8" cy="7.6" r=".9" fill="currentColor" stroke="none" />
  </Svg>
);

export const StarIcon = (p) => (
  <Svg {...p} kind="si-starred">
    <path className="si-star" d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
  </Svg>
);

export const ShareIcon = (p) => (
  <Svg {...p} kind="si-share">
    <path d="M8 10.5H6.5A1.5 1.5 0 005 12v7.5A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V12a1.5 1.5 0 00-1.5-1.5H16" />
    <g className="si-arrow"><path d="M12 14.5V3M8.5 6.5L12 3l3.5 3.5" /></g>
  </Svg>
);

export const XIcon = (p) => (
  <Svg {...p} kind="si-tilt">
    <path d="M4.5 4h4l11 16h-4z" />
    <path d="M19.5 4l-6.3 7.2M4.5 20l6.3-7.2" />
  </Svg>
);

export const LinkIcon = (p) => (
  <Svg {...p} kind="si-link">
    <path className="si-link-a" d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
    <path className="si-link-b" d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...p} kind="si-check">
    <path className="si-tick" d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const CheckCircleIcon = (p) => (
  <Svg {...p} kind="si-check">
    <circle className="si-ring" cx="12" cy="12" r="9" />
    <path className="si-tick" d="M7.5 12.5l3 3 6-6.5" />
  </Svg>
);

export const ImageIcon = (p) => (
  <Svg {...p} kind="si-image">
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle className="si-sun" cx="8.5" cy="9.5" r="1.6" />
    <path d="M3.5 17.5l5-5 4 4 3-3 5 5" />
  </Svg>
);

export const EyeOffIcon = (p) => (
  <Svg {...p}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M4 20L20 4" />
  </Svg>
);

/** The "opens in a new tab" arrow, at the end of a link tile and on the GitHub button. */
export const ArrowUpRightIcon = (p) => (
  <Svg size={16} {...p} kind="si-out">
    <path d="M8 16L16 8M9.5 8H16v6.5" />
  </Svg>
);

/** The help button's own icon: a speech bubble whose three dots type. */
export const ChatTypingIcon = (p) => (
  <Svg {...p} kind="si-chat">
    <path className="si-bubble" d="M5 5h14a2 2 0 012 2v8.5a2 2 0 01-2 2h-7.5L7 21v-3.5H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
    <circle className="si-dot si-dot-1" cx="8.5" cy="11.25" r="1.1" fill="currentColor" stroke="none" />
    <circle className="si-dot si-dot-2" cx="12" cy="11.25" r="1.1" fill="currentColor" stroke="none" />
    <circle className="si-dot si-dot-3" cx="15.5" cy="11.25" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);
