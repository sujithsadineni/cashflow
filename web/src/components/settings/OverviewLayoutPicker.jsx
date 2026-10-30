import { OVERVIEW_LAYOUTS } from '../../lib/app/overview-cards';
import { useOverviewLayout } from '../../hooks/use-overview-layout';

// A few category colours for the card's tiles in the thumbnails.
const TILE = ['#3d7be0', '#f7820f', '#b58ad6', '#d8b72a'];

/** "Where it's going" in miniature: one big tile and three smaller ones. */
function Tiles({ x, y, w, h }) {
  const p = 2, iw = w - 2 * p, ih = h - 2 * p, big = iw * 0.55, g = 1.5, rw = iw - big - g, th = (ih - g) / 2;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="3" fill="var(--color-raised)" stroke="var(--color-rule)" />
      <rect x={x + p} y={y + p} width={big} height={ih} rx="2" fill={TILE[0]} />
      <rect x={x + p + big + g} y={y + p} width={rw} height={th} rx="2" fill={TILE[1]} />
      <rect x={x + p + big + g} y={y + p + th + g} width={(rw - g) * 0.6} height={th} rx="2" fill={TILE[2]} />
      <rect x={x + p + big + g + (rw - g) * 0.6 + g} y={y + p + th + g} width={(rw - g) * 0.4} height={th} rx="2" fill={TILE[3]} />
    </>
  );
}

const Card = ({ x, y, w, h }) => <rect x={x} y={y} width={w} height={h} rx="2" fill="var(--color-raised)" stroke="var(--color-rule)" />;

/** n cards across (or down) a span, `g` apart. */
const spread = (n, start, span, g) => Array.from({ length: n }, (_, i) => ({ at: start + i * ((span - (n - 1) * g) / n + g), size: (span - (n - 1) * g) / n }));

const LAYOUT_SHAPES = {
  slim: () => (
    <>
      {spread(4, 6, 100, 3).map(({ at, size }) => <Card key={at} x={at} y={6} w={size} h={10} />)}
      {spread(6, 6, 100, 2).map(({ at, size }) => <Card key={at} x={at} y={19} w={size} h={6} />)}
      <Tiles x={6} y={28} w={100} h={38} />
    </>
  ),
  rail: () => (
    <>
      {spread(4, 6, 36, 2).map(({ at, size }) => <Card key={at} x={6} y={at} w={26} h={size} />)}
      {spread(4, 44, 22, 2).map(({ at, size }) => <Card key={at} x={6} y={at} w={26} h={size} />)}
      <Tiles x={36} y={6} w={70} h={60} />
    </>
  ),
  bento: () => (
    <>
      {spread(4, 6, 100, 3).map(({ at, size }) => <Card key={at} x={at} y={6} w={size} h={10} />)}
      <Tiles x={6} y={19} w={73} h={47} />
      {spread(6, 19, 47, 2).map(({ at, size }) => <Card key={at} x={82} y={at} w={24} h={size} />)}
    </>
  ),
};

function LayoutThumb({ layout }) {
  return (
    <svg width="112" height="72" viewBox="0 0 112 72" className="block" aria-hidden="true">
      <rect width="112" height="72" rx="8" fill="var(--color-band)" />
      {LAYOUT_SHAPES[layout]()}
    </svg>
  );
}

/**
 * Overview's layout (D378): Slim rows, Stats rail or Bento, each drawn as a
 * small picture of the page. Classic and Glass Settings both use it; `glass`
 * swaps the selection ring and type for Apple's.
 */
export function OverviewLayoutPicker({ glass = false }) {
  const { layout, setLayout } = useOverviewLayout();
  if (!layout) return null;

  return (
    <div role="radiogroup" aria-label="Overview layout" className={`apple-pane flex flex-wrap gap-4 ${glass ? 'justify-around' : ''}`}>
      {OVERVIEW_LAYOUTS.map(({ key, label, description }) => {
        const selected = layout === key;
        return (
          <button key={key} type="button" role="radio" aria-checked={selected} title={description}
            onClick={() => setLayout(key)} className="flex flex-col items-center gap-2">
            <span className={`block rounded-[11px] p-[3px] transition-shadow ${
              selected ? 'shadow-[0_0_0_3px_var(--color-info)]' : 'shadow-[0_0_0_1px_var(--color-rule)]'
            }`}>
              <LayoutThumb layout={key} />
            </span>
            <span className={`${glass ? 'text-[13px]' : 'text-sm'} ${selected ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
