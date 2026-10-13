import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePrivacy } from '../../use-privacy';
import { useDesign } from '../../use-design';
import { APPEARANCES, DESIGNS } from '../../designs';
import { OVERVIEW_CARDS } from '../../overview-cards';
import { useOverviewCards } from '../../use-overview-cards';
import { GroupSection, Group, Row, Switch } from './glass-ui';
import { useWide, halves } from '../../use-wide';

/**
 * Glass Settings' smaller panes (D244): Overview cards, Design and Privacy,
 * as grouped lists. Same data and hooks as the Classic panes in Settings.jsx;
 * only the presentation is Apple's.
 */

export function GlassOverviewCards() {
  const { visible, toggle } = useOverviewCards();
  const wide = useWide();
  if (!visible) return <p className="px-4 text-[13px] text-muted">Loading…</p>;
  const onCount = OVERVIEW_CARDS.filter(({ key }) => visible.includes(key)).length;

  return (
    <GroupSection
      label={`${onCount} of ${OVERVIEW_CARDS.length} showing`}
      footnote="A card added to Overview later shows up here already on."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        {(wide ? halves(OVERVIEW_CARDS) : [OVERVIEW_CARDS]).map((cards, i) => (
          <Group key={i}>
            {cards.map(({ key, label }) => (
              <Row
                key={key}
                title={label}
                trailing={<Switch on={visible.includes(key)} onToggle={() => toggle(key)} label={label} />}
              />
            ))}
          </Group>
        ))}
      </div>
    </GroupSection>
  );
}

/** A tiny window in each appearance, the way macOS draws Light, Dark and Auto. */
function AppearanceThumb({ value }) {
  const light = { bg: '#F2F2F7', side: '#E5E5EA', card: '#FFFFFF', line: '#D1D1D6' };
  const dark = { bg: '#1C1C1E', side: '#2C2C2E', card: '#3A3A3C', line: '#48484A' };
  const pane = (c, clip) => (
    <g clipPath={clip}>
      <rect width="112" height="72" fill={c.bg} />
      <rect width="30" height="72" fill={c.side} />
      <rect x="38" y="10" width="64" height="22" rx="4" fill={c.card} />
      <rect x="38" y="38" width="44" height="5" rx="2.5" fill={c.line} />
      <rect x="38" y="48" width="56" height="5" rx="2.5" fill={c.line} />
      <rect x="6" y="10" width="18" height="4" rx="2" fill={c.line} />
      <rect x="6" y="18" width="14" height="4" rx="2" fill={c.line} />
    </g>
  );
  return (
    <svg width="112" height="72" viewBox="0 0 112 72" className="block" aria-hidden="true">
      <defs>
        <clipPath id="gs-thumb-round"><rect width="112" height="72" rx="8" /></clipPath>
        <clipPath id="gs-thumb-left"><polygon points="0,0 112,0 0,72" /></clipPath>
        <clipPath id="gs-thumb-right"><polygon points="112,0 112,72 0,72" /></clipPath>
      </defs>
      <g clipPath="url(#gs-thumb-round)">
        {value === 'light' && pane(light)}
        {value === 'dark' && pane(dark)}
        {value === 'system' && <>{pane(light, 'url(#gs-thumb-left)')}{pane(dark, 'url(#gs-thumb-right)')}</>}
      </g>
    </svg>
  );
}

function Checkmark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className="text-info">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlassDesignPicker() {
  const { design, setDesign, appearance, setAppearance } = useDesign();

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
      <GroupSection label="Appearance" footnote="Auto follows this computer's light or dark setting.">
        <Group as="div" className="px-4 py-4">
          <div role="radiogroup" aria-label="Appearance" className="flex flex-wrap justify-around gap-4">
            {APPEARANCES.map(({ value, label }) => {
              const selected = appearance === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAppearance(value)}
                  className="flex flex-col items-center gap-2"
                >
                  <span
                    className={`block rounded-[11px] p-[3px] transition-shadow ${
                      selected ? 'shadow-[0_0_0_3px_var(--color-info)]' : 'shadow-[0_0_0_1px_var(--color-rule)]'
                    }`}
                  >
                    <AppearanceThumb value={value} />
                  </span>
                  <span className={`text-[13px] ${selected ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</span>
                </button>
              );
            })}
          </div>
        </Group>
      </GroupSection>

      <GroupSection label="Design" footnote="Remembered on this browser only, so each person can pick their own.">
        <Group inset={76} as="div" role="radiogroup" aria-label="Design">
            {DESIGNS.map((d) => {
              const selected = design === d.value;
              return (
                <Row
                  key={d.value}
                  as="div"
                  wrap
                  onClick={() => setDesign(d.value)}
                  actionProps={{ role: 'radio', 'aria-checked': selected }}
                  leading={
                    // The design's own colours, overlapped like a fan of chips.
                    <span className="flex w-12 items-center" aria-hidden="true">
                      {d.swatches.map((c, i) => (
                        <span
                          key={c}
                          className="size-5 rounded-full shadow-[0_0_0_1.5px_var(--g-solid),0_0_0_2px_var(--g-hairline)]"
                          style={{ backgroundColor: c, marginLeft: i ? -8 : 0 }}
                        />
                      ))}
                    </span>
                  }
                  title={<span className={selected ? 'font-semibold' : ''}>{d.label}</span>}
                  subtitle={d.description}
                  trailing={selected ? <Checkmark /> : <span className="w-[15px]" />}
                />
              );
            })}
        </Group>
      </GroupSection>
    </div>
  );
}

export function GlassPrivacy() {
  const { privacyMode, setPrivacyMode } = usePrivacy();
  const reduceMotion = useReducedMotion();
  const sample = privacyMode
    ? { name: 'Jane Doe', date: '*** **', amount: '−$***.**' }
    : { name: 'Your name', date: 'Sep 20', amount: '−$42.00' };

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
      <GroupSection label="Screenshot mode" footnote="Replaces real names with Jane/John Doe and dollar amounts with $***.** across the app, and masks transaction dates. Only the screen changes; nothing in the database does.">
        <Group>
          <Row
            title="Hide names and amounts"
            trailing={<Switch on={privacyMode} onToggle={() => setPrivacyMode(!privacyMode)} label="Hide names and amounts" />}
          />
        </Group>
      </GroupSection>

      <GroupSection label="Preview">
        <Group>
          <li className="relative h-[60px] overflow-hidden">
            <AnimatePresence initial={false}>
              <motion.div
                key={privacyMode ? 'hidden' : 'shown'}
                initial={{ opacity: 0, filter: reduceMotion ? 'none' : 'blur(4px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, filter: reduceMotion ? 'none' : 'blur(4px)' }}
                transition={{ duration: reduceMotion ? 0.12 : 0.25 }}
                className="absolute inset-0 flex items-center gap-3 px-4"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-band text-[15px] font-semibold text-muted" aria-hidden="true">
                  {sample.name[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-ink">{sample.name}</span>
                  <span className="block text-[13px] text-muted tnum">{sample.date}</span>
                </span>
                {/* Money out in plain ink, as Glass sets every amount (D251). */}
                <span className="text-[15px] text-ink tnum">{sample.amount}</span>
              </motion.div>
            </AnimatePresence>
          </li>
        </Group>
      </GroupSection>
    </div>
  );
}
