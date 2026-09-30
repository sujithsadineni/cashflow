import { CardFace } from './CardCarousel';

// How much of each card the next one covers, and the card's own
// rendered height (h-56 = 224px on CardFace) — the only two numbers
// that control the look, since normal document flow (later siblings
// paint over earlier ones) does the rest. Same ~62% overlap ratio as
// before. Both live here as inline-style values, not Tailwind
// classes, so a card leaving the visible filter can transition them
// to 0 instead of jumping straight there — see `visibleIds` below.
const OVERLAP_PX = 140;
const CARD_HEIGHT_PX = 224;

/**
 * A simple overlapping deck of real cards — pick one to see its
 * statement grid on the right. Every card stays the same size all the
 * time; nothing expands or collapses on selection.
 *
 * Nothing selected by default, and every card shown at full strength
 * in that state — the deck reads as "here's your wallet," not as an
 * incomplete choice waiting to be made. Only once a card is actually
 * clicked do the others recede (blur + dim); clicking the same card
 * again deselects back to that neutral all-visible state. The grid
 * this sits next to grays itself out for exactly the same "nothing
 * picked yet" state (see `MonthStatusGrid`'s `disabled` prop) — the
 * two together read as one page waiting for one decision.
 *
 * Focus, not a frame: once something's selected, the OTHER cards blur
 * and dim instead of drawing a ring around the selected one. A ring
 * needs its own box to line up against the card's actual rendered
 * edges, and it didn't — the button wrapping each card is wider than
 * CardFace's own `max-w` cap, so the ring outlined empty space past
 * the card's right edge. Blur has no such box to get wrong: it's
 * applied straight to the card that needs to recede, clipped to
 * whatever it actually is.
 *
 * `visibleIds`, when given, filters the deck down to a subset — but
 * every account still mounts (same DOM node, same React key) whether
 * shown or not. A card leaving the filter collapses its own height
 * and overlap margin to 0 instead of unmounting, so the cards below
 * it slide up smoothly under `transition-all` rather than jumping
 * the instant the filter changes. Omit it to show the whole deck, as
 * every caller but the Statements page's filter row does.
 */
export function AccountFilter({ accounts, visibleIds, selectedId, onSelect }) {
  if (accounts.length === 0) return null;
  const hasSelection = selectedId !== null;

  let visibleIndex = -1;

  return (
    <div className="w-96 shrink-0">
      {accounts.map((account) => {
        const visible = !visibleIds || visibleIds.has(account.id);
        if (visible) visibleIndex += 1;
        const selected = account.id === selectedId;

        return (
          <button
            key={account.id}
            onClick={() => { if (visible) onSelect(selected ? null : account.id); }}
            aria-hidden={!visible}
            tabIndex={visible ? 0 : -1}
            style={{
              marginTop: !visible || visibleIndex === 0 ? 0 : -OVERLAP_PX,
              maxHeight: visible ? CARD_HEIGHT_PX : 0,
              opacity: !visible ? 0 : selected ? 1 : hasSelection ? 0.5 : 1,
            }}
            className={`block w-full overflow-hidden text-left transition-all duration-300 ease-out ${
              !visible
                ? 'pointer-events-none'
                : selected
                  ? 'relative z-10 -translate-y-1 scale-[1.03]'
                  : hasSelection
                    ? 'blur-[2px] hover:opacity-80 hover:blur-none'
                    : 'hover:-translate-y-0.5'
            }`}
          >
            <CardFace account={account} />
          </button>
        );
      })}
    </div>
  );
}
