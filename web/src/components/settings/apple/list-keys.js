/**
 * Up and down walk a split view's rows in the order they're shown,
 * selecting as they go, as a macOS list does (D297, D298). Put it on the
 * list's container as onKeyDown; rows are the `button[data-row-id]`s in it.
 */
export function moveSelection(e, onSelect) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = [...e.currentTarget.querySelectorAll('button[data-row-id]')];
  const at = buttons.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
  next.focus();
  onSelect(Number(next.dataset.rowId));
}
