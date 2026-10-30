import { formatMoney } from '../../../api';
import { Swatch } from './WherePanel';

/** The original bars (D373 keeps them as a design choice), now clickable and in each category's colour. */
export function WhereBars({ items, picked, hover, onPick, onHover }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-3">
      {items.map((i) => (
        <button key={i.key} type="button" onClick={() => onPick(i.key)} onPointerEnter={() => onHover(i.key, null)} onPointerLeave={() => onHover(null)}
          className={`flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left hover:bg-band ${picked === i.key ? 'bg-band' : ''}`}
          style={{ opacity: hover && hover !== i.key ? 0.6 : 1 }}>
          <Swatch item={i} size="size-6" />
          <span className="w-44 shrink-0 whitespace-nowrap text-sm text-ink">{i.name}</span>
          <span className="flex-1"><span className="block h-2.5 rounded-r" style={{ width: `${Math.max((i.value / max) * 100, 1)}%`, backgroundColor: i.color.css }} /></span>
          <span className="w-24 text-right font-mono text-sm tnum text-ink">{formatMoney(i.value)}</span>
        </button>
      ))}
    </div>
  );
}
