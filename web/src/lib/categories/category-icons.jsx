/**
 * A small fixed catalog of category icons — simple single-stroke
 * glyphs, drawn white-on-color the same way CardPaymentIcon and
 * InterestEarnedIcon already are (MerchantAvatar.jsx), so a category
 * badge and a transaction-type badge read as the same design
 * language rather than two icon systems.
 *
 * `iconFor(name)` is a best-effort name match, not a real
 * classifier — new/renamed categories fall back to `dot` rather than
 * guessing wrong. It only ever supplies the DEFAULT: once a category
 * has its own `icon_key` in the database (set via the picker in
 * Settings), that always wins.
 */

import { useDesign } from '../../hooks/use-design';
import { GLASS_GLYPHS } from './glass-category-glyphs';

const s = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };



const PATHS = {
  home: <path d="M2.5 8L8 3l5.5 5M4 6.8V13h8V6.8" {...s} />,
  bolt: <path d="M8.5 2L4 9h3.5L7 14l5-7.5H8.5L9.5 2z" {...s} strokeLinejoin="round" />,
  cart: (
    <>
      <path d="M2 3h1.6L5 10.5h6.5L13 5H4.2" {...s} />
      <circle cx="6" cy="13" r="1" {...s} />
      <circle cx="11" cy="13" r="1" {...s} />
    </>
  ),
  fork: (
    <>
      <path d="M4.5 2v5.5M3 2v3.5a1.5 1.5 0 003 0V2M6 2v3.5a1.5 1.5 0 01-3 0" {...s} />
      <path d="M4.5 7.5V14" {...s} />
      <path d="M11.5 2c-1 0-1.8 1-1.8 3s.8 3 1.8 3v6" {...s} />
    </>
  ),
  car: (
    <>
      <path d="M2.5 10V8.2L3.8 5h8.4l1.3 3.2V10" {...s} />
      <path d="M2.5 10h11v1.5h-11z" {...s} />
      <circle cx="4.8" cy="11.5" r="1.2" {...s} />
      <circle cx="11.2" cy="11.5" r="1.2" {...s} />
    </>
  ),
  fuel: (
    <>
      <path d="M3 14V3.5a1 1 0 011-1h4a1 1 0 011 1V14" {...s} />
      <path d="M3 14h6" {...s} />
      <path d="M3 8h5" {...s} />
      <path d="M9 5.5l2 1.3v4.7a1 1 0 002 0V7.5L11.5 5.5" {...s} />
    </>
  ),
  bag: (
    <>
      <path d="M3.5 5h9l.7 9h-10.4z" {...s} />
      <path d="M5.5 5V4a2.5 2.5 0 015 0v1" {...s} />
    </>
  ),
  heart: <path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 018 4.8a2.7 2.7 0 015.5 1.4c0 3.8-5.5 7.3-5.5 7.3z" {...s} />,
  shield: <path d="M8 2l5 1.8v4.3c0 3.3-2.2 5.4-5 6.2-2.8-.8-5-2.9-5-6.2V3.8z" {...s} strokeLinejoin="round" />,
  refresh: (
    <>
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" {...s} />
      <path d="M11 2.5v2.5h-2.5" {...s} />
      <path d="M5 13.5V11h2.5" {...s} />
    </>
  ),
  star: <path d="M8 2.5l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" {...s} strokeLinejoin="round" />,
  tag: (
    <>
      <path d="M2.5 2.5h5L13.5 8.5l-5.5 5.5L2.5 8V2.5z" {...s} strokeLinejoin="round" />
      <circle cx="5.5" cy="5.5" r="1" {...s} />
    </>
  ),
  swap: <path d="M2.5 5.5h9L9 3M13.5 10.5h-9L7 13" {...s} />,
  card: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" {...s} />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" {...s} />
      <path d="M4.5 10.2l1.3 1.3 2.7-2.7" {...s} />
    </>
  ),
  'tray-down': (
    <>
      <path d="M8 2v7.5M5 7l3 3 3-3" {...s} />
      <path d="M2.5 11v2a1 1 0 001 1h9a1 1 0 001-1v-2" {...s} />
    </>
  ),
  percent: (
    <>
      <circle cx="5" cy="5" r="1.6" {...s} />
      <circle cx="11" cy="11" r="1.6" {...s} />
      <path d="M11.5 4.5l-7 7" {...s} />
    </>
  ),
  bank: (
    <>
      <path d="M2 6l6-3.5L14 6" {...s} strokeLinejoin="round" />
      <path d="M3 6.5V13M6.3 6.5V13M9.7 6.5V13M13 6.5V13" {...s} />
      <path d="M2 13h12" {...s} />
    </>
  ),
  undo: <path d="M4 4.5H9a4 4 0 010 8H5.5M4 4.5l2.3-2.3M4 4.5l2.3 2.3" {...s} />,
  piggy: (
    <>
      <path d="M3 8.5a4.5 4.5 0 014.5-4h2.3L11 3l1.3 1.5H13v3h-1.2" {...s} strokeLinejoin="round" />
      <path d="M3 8.5v2.3c0 .7.5 1.2 1.2 1.2H5v1.5h2v-1.5h2V13.5h2V12h.2a1.6 1.6 0 001.6-1.6V8.7" {...s} strokeLinejoin="round" />
      <circle cx="10.2" cy="6.7" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  plane: <path d="M14 2L2 7.2l4.5 1.3L8 13l1.7-4.3L14 6.5V2zM6.8 8.5L2 7.2" {...s} strokeLinejoin="round" />,
  film: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" {...s} />
      <path d="M5 3v10M11 3v10M2 6.3h3M11 6.3h3M2 9.7h3M11 9.7h3" {...s} />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="5" width="12" height="8" rx="1.2" {...s} />
      <path d="M5.5 5V3.8a1 1 0 011-1h3a1 1 0 011 1V5" {...s} />
      <path d="M2 8.5h12" {...s} />
    </>
  ),
  // D262: the audit's new categories, and Education's own mark.
  school: (
    <>
      <path d="M1.5 6.2L8 3l6.5 3.2L8 9.4z" {...s} strokeLinejoin="round" />
      <path d="M4.2 7.6v3c0 1 1.7 1.9 3.8 1.9s3.8-.9 3.8-1.9v-3" {...s} />
      <path d="M14.5 6.2v3.6" {...s} />
    </>
  ),
  cut: (
    <>
      <circle cx="4.5" cy="11.8" r="1.8" {...s} />
      <circle cx="11.5" cy="11.8" r="1.8" {...s} />
      <path d="M5.7 10.4L12 2.5M10.3 10.4L4 2.5" {...s} />
    </>
  ),
  wrench: <path d="M10.6 2.2a3.2 3.2 0 00-3 4.3l-4.9 4.9a1.4 1.4 0 002 2l4.9-4.9a3.2 3.2 0 004.3-3L12 7.4l-1.6-.3-.3-1.6 1.9-1.9a3.2 3.2 0 00-1.4-1.4z" {...s} strokeLinejoin="round" />,
  ticket: (
    <>
      <path d="M2 5a1 1 0 011-1h10a1 1 0 011 1v1.6a1.4 1.4 0 000 2.8V11a1 1 0 01-1 1H3a1 1 0 01-1-1V9.4a1.4 1.4 0 000-2.8z" {...s} strokeLinejoin="round" />
      <path d="M10 4.5v1.2M10 7.4v1.2M10 10.3v1.2" {...s} />
    </>
  ),
  document: (
    <>
      <path d="M4 2h5l3 3v9H4z" {...s} strokeLinejoin="round" />
      <path d="M9 2v3h3M6 8.5h4M6 11h4" {...s} />
    </>
  ),
  gift: (
    <>
      <rect x="2.5" y="6" width="11" height="2.8" rx=".5" {...s} />
      <path d="M3.5 8.8V14h9V8.8M8 6v8" {...s} />
      <path d="M8 6C7 3.6 4.6 3.4 4.8 4.9 5 6 8 6 8 6zM8 6c1-2.4 3.4-2.6 3.2-1.1C11 6 8 6 8 6z" {...s} strokeLinejoin="round" />
    </>
  ),
  barbell: <path d="M2 8h12M4.5 5v6M11.5 5v6M2 6.5v3M14 6.5v3" {...s} />,
  bed: (
    <>
      <path d="M2 3.5V13M2 9.5h12V13M14 9.5V8a2 2 0 00-2-2H7v3.5" {...s} />
      <circle cx="4.5" cy="7.5" r="1.2" {...s} />
    </>
  ),
  phone: (
    <>
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" {...s} />
      <path d="M7 12.3h2" {...s} />
    </>
  ),
  // D373: Ionicons' outline glyphs (MIT, as Glass's), drawn at 16px with this set's stroke weight.
  'globe': <g transform="scale(0.03125)"><path d="M256 48C141.13 48 48 141.13 48 256s93.13 208 208 208 208-93.13 208-208S370.87 48 256 48z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="44" /><path d="M256 48c-58.07 0-112.67 93.13-112.67 208S197.93 464 256 464s112.67-93.13 112.67-208S314.07 48 256 48z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="44" /><path d="M117.33 117.33c38.24 27.15 86.38 43.34 138.67 43.34s100.43-16.19 138.67-43.34M394.67 394.67c-38.24-27.15-86.38-43.34-138.67-43.34s-100.43 16.19-138.67 43.34" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="44" d="M256 48v416M464 256H48" /></g>,
  'people': <g transform="scale(0.03125)"><path d="M402 168c-2.93 40.67-33.1 72-66 72s-63.12-31.32-66-72c-3-42.31 26.37-72 66-72s69 30.46 66 72z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path d="M336 304c-65.17 0-127.84 32.37-143.54 95.41-2.08 8.34 3.15 16.59 11.72 16.59h263.65c8.57 0 13.77-8.25 11.72-16.59C463.85 335.36 401.18 304 336 304z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="44" /><path d="M200 185.94c-2.34 32.48-26.72 58.06-53 58.06s-50.7-25.57-53-58.06C91.61 152.15 115.34 128 147 128s55.39 24.77 53 57.94z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path d="M206 306c-18.05-8.27-37.93-11.45-59-11.45-52 0-102.1 25.85-114.65 76.2-1.65 6.66 2.53 13.25 9.37 13.25H154" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="44" /></g>,
  'compare': <g transform="scale(0.03125)"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M304 160l-64-64 64-64M207 352l64 64-64 64" /><circle cx="112" cy="96" r="48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><circle cx="400" cy="416" r="48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path d="M256 96h84a60 60 0 0160 60v212M255 416h-84a60 60 0 01-60-60V144" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /></g>,
  'battery': <g transform="scale(0.03125)"><path d="M48 322.3V189.7A29.74 29.74 0 0177.7 160h137.44l24.4-32H77.7A61.77 61.77 0 0016 189.7v132.6A61.77 61.77 0 0077.7 384h96.85a22.57 22.57 0 01.26-7.32l.15-.75.21-.73 6.5-23.2H77.7A29.74 29.74 0 0148 322.3zM386.3 128h-98.64a22.69 22.69 0 01-.27 7.2l-.15.74-.21.73-6.54 23.33H386.3a29.74 29.74 0 0129.7 29.7v132.6a29.74 29.74 0 01-29.7 29.7H247l-24.42 32H386.3a61.77 61.77 0 0061.7-61.7V189.7a61.77 61.77 0 00-61.7-61.7z" /><path d="M162.65 294.16a24.37 24.37 0 01-21.56-13 25 25 0 011.42-25.83l.31-.46.33-.44L197.62 183H89.69a20 20 0 00-20 20v106a20 20 0 0020 20h98.42l9.78-34.86z" /><path d="M276.07 280.89l27.07-35.49a5.2 5.2 0 00.77-1.91 5 5 0 00.08-.66 5 5 0 00-.08-1.29 5.11 5.11 0 00-.68-1.75 4.76 4.76 0 00-.78-.95 3.48 3.48 0 00-.48-.38 4 4 0 00-1.11-.55 4.28 4.28 0 00-1.31-.2h-61.62l12.12-43.21 3.23-11.5 6.21-22.16.51-1.84 7.79-27.76a3.51 3.51 0 00.05-.55v-.16c0-.05 0-.26-.05-.38s0-.09 0-.14a2.2 2.2 0 00-.17-.45 3.77 3.77 0 00-.26-.39l-.09-.1a2.73 2.73 0 00-.25-.23l-.1-.08a3.14 3.14 0 00-.39-.24 2 2 0 00-.41-.14H265.53a2.3 2.3 0 00-.45 0 1.9 1.9 0 00-.42.15l-.13.07-.3.21-.11.1a2.4 2.4 0 00-.36.41l-18 23.63-13.14 17.22-9.85 12.83-63.71 83.55a5.72 5.72 0 00-.44.8 4.78 4.78 0 00-.35 1.09 4.7 4.7 0 00-.08 1.29 4.86 4.86 0 002 3.71 4.74 4.74 0 00.54.31 4.31 4.31 0 001.89.43h61.62L194.42 380.6a3.64 3.64 0 000 .56v.15a2.32 2.32 0 00.06.38.58.58 0 000 .14 2.2 2.2 0 00.17.45 3.62 3.62 0 00.26.38l.09.1.25.24a.39.39 0 01.1.08 2.22 2.22 0 00.39.23 2.83 2.83 0 00.41.14h.13a1.86 1.86 0 00.33 0h.13a2.32 2.32 0 00.45-.06 2.05 2.05 0 00.41-.16l.13-.07.3-.21.11-.09a2.4 2.4 0 00.36-.41L221.82 352l17.53-23z" /><path d="M319.5 256.93l-.46.6L264.51 329h109.8a20 20 0 0020-20V203a20 20 0 00-20-20H274.05l-9.74 34.73h35.24A24.35 24.35 0 01321 230.5a25.21 25.21 0 01-1 25.79zM480 202.67a16 16 0 00-16 16v74.66a16 16 0 0032 0v-74.66a16 16 0 00-16-16z" /></g>,
  'storefront': <g transform="scale(0.03125)"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M448 448V240M64 240v208M382.47 48H129.53c-21.79 0-41.47 12-49.93 30.46L36.3 173c-14.58 31.81 9.63 67.85 47.19 69h2c31.4 0 56.85-25.18 56.85-52.23 0 27 25.46 52.23 56.86 52.23s56.8-23.38 56.8-52.23c0 27 25.45 52.23 56.85 52.23s56.86-23.38 56.86-52.23c0 28.85 25.45 52.23 56.85 52.23h1.95c37.56-1.17 61.77-37.21 47.19-69l-43.3-94.54C423.94 60 404.26 48 382.47 48zM32 464h448M136 288h80a24 24 0 0124 24v88h0-128 0v-88a24 24 0 0124-24zM288 464V312a24 24 0 0124-24h64a24 24 0 0124 24v152" /></g>,
  'fast-food': <g transform="scale(0.03125)"><path d="M322 416c0 35.35-20.65 64-56 64H134c-35.35 0-56-28.65-56-64M336 336c17.67 0 32 17.91 32 40h0c0 22.09-14.33 40-32 40H64c-17.67 0-32-17.91-32-40h0c0-22.09 14.33-40 32-40" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="44" /><path d="M344 336H179.31a8 8 0 00-5.65 2.34l-26.83 26.83a4 4 0 01-5.66 0l-26.83-26.83a8 8 0 00-5.65-2.34H56a24 24 0 01-24-24h0a24 24 0 0124-24h288a24 24 0 0124 24h0a24 24 0 01-24 24zM64 276v-.22c0-55 45-83.78 100-83.78h72c55 0 100 29 100 84v-.22M241 112l7.44 63.97" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="44" /><path d="M256 480h139.31a32 32 0 0031.91-29.61L463 112" fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M368 112l16-64 47-16" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="44" d="M224 112h256" /></g>,
  'shirt': <g transform="scale(0.03125)"><path d="M314.56 48s-22.78 8-58.56 8-58.56-8-58.56-8a31.94 31.94 0 00-10.57 1.8L32 104l16.63 88 48.88 5.52a24 24 0 0121.29 24.58L112 464h288l-6.8-241.9a24 24 0 0121.29-24.58l48.88-5.52L480 104 325.13 49.8a31.94 31.94 0 00-10.57-1.8zM333.31 52.66a80 80 0 01-154.62 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /></g>,
  'check': <g transform="scale(0.03125)"><path d="M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192 192-86 192-192z" fill="none" stroke="currentColor" strokeMiterlimit="10" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M352 176L217.6 336 160 272" /></g>,
  'cash': <g transform="scale(0.03125)"><rect x="32" y="80" width="448" height="256" rx="16" ry="16" transform="rotate(180 256 208)" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M64 384h384M96 432h320" /><circle cx="256" cy="208" r="80" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path d="M480 160a80 80 0 01-80-80M32 160a80 80 0 0080-80M480 256a80 80 0 00-80 80M32 256a80 80 0 0180 80" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /></g>,
  'hourglass': <g transform="scale(0.03125)"><path d="M145.61 464h220.78c19.8 0 35.55-16.29 33.42-35.06C386.06 308 304 310 304 256s83.11-51 95.8-172.94c2-18.78-13.61-35.06-33.41-35.06H145.61c-19.8 0-35.37 16.28-33.41 35.06C124.89 205 208 201 208 256s-82.06 52-95.8 172.94c-2.14 18.77 13.61 35.06 33.41 35.06z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /><path d="M343.3 432H169.13c-15.6 0-20-18-9.06-29.16C186.55 376 240 356.78 240 326V224c0-19.85-38-35-61.51-67.2-3.88-5.31-3.49-12.8 6.37-12.8h142.73c8.41 0 10.23 7.43 6.4 12.75C310.82 189 272 204.05 272 224v102c0 30.53 55.71 47 80.4 76.87 9.95 12.04 6.47 29.13-9.1 29.13z" /></g>,
  'leaf': <g transform="scale(0.03125)"><path d="M321.89 171.42C233 114 141 155.22 56 65.22c-19.8-21-8.3 235.5 98.1 332.7 77.79 71 197.9 63.08 238.4-5.92s18.28-163.17-70.61-220.58zM173 253c86 81 175 129 292 147" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" /></g>,
  'library': <g transform="scale(0.03125)"><rect x="32" y="96" width="64" height="368" rx="16" ry="16" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M112 224h128M112 400h128" /><rect x="112" y="160" width="128" height="304" rx="16" ry="16" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /><rect x="256" y="48" width="96" height="416" rx="16" ry="16" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /><path d="M422.46 96.11l-40.4 4.25c-11.12 1.17-19.18 11.57-17.93 23.1l34.92 321.59c1.26 11.53 11.37 20 22.49 18.84l40.4-4.25c11.12-1.17 19.18-11.57 17.93-23.1L445 115c-1.31-11.58-11.42-20.06-22.54-18.89z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /></g>,
  'receipt': <g transform="scale(0.03125)"><path fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" d="M160 336V48l32 16 32-16 31.94 16 32.37-16L320 64l31.79-16 31.93 16L416 48l32.01 16L480 48v224" /><path d="M480 272v112a80 80 0 01-80 80h0a80 80 0 01-80-80v-48H48a15.86 15.86 0 00-16 16c0 64 6.74 112 80 112h288" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="44" /><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44" d="M224 144h192M288 224h128" /></g>,
  dot: <circle cx="8" cy="8" r="3" {...s} />,
  // An ascending line with an arrowhead — Investment's own mark, kept
  // visually distinct from piggy (Savings), which the old default-icon
  // pattern match (/saving/) would otherwise have handed Investment too.
  // Three ascending bars, not a line-with-arrowhead — Overview.jsx's
  // existing SavingsIcon already owns that exact shape (a real near-
  // collision caught while building this: an early draft of this icon
  // copied it path-for-path, which would have made Investment and
  // Savings read as the same glyph everywhere they sit side by side).
  'trend-up': (
    <>
      <path d="M3 13V9M7.5 13V6M12 13V3" {...s} />
    </>
  ),
};

export function CategoryGlyph({ iconKey, size = 16 }) {
  const key = PATHS[iconKey] ? iconKey : 'dot';
  // Glass (D246): the same key, drawn as Ionicons' filled glyph.
  if (useDesign().design === 'glass') {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
        {GLASS_GLYPHS[key]}
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[key]}
    </svg>
  );
}
