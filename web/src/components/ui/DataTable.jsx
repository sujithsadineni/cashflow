import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDesign } from '../../use-design';

/**
 * The one table the app's list pages share (D142) — Activity first,
 * the ledger tables after. Pages describe columns; this owns the look
 * (Classic greenbar rows or Vivid's), zebra banding, row hover, and —
 * when `renderDetail` is given — a ＋ button at the start of each row
 * that opens that row's detail panel underneath it.
 *
 *   columns       [{ key, header, render(row), className?, headerClassName?, phone? }]
 *                 phone: false hides that column below `md` (D232): the row keeps
 *                 only what fits a phone, the rest goes in a second line or the ＋ panel
 *   rows          the data
 *   rowKey        row => stable key
 *   renderDetail  row => node | null — null means that row has nothing
 *                 to expand, and it gets no ＋ button
 *   onRowClick    row => void, optional (whole row becomes clickable)
 *   empty         what to show with no rows
 *   groupOf       row => key, optional — rows arrive sorted, so a full-
 *                 width header row goes in wherever the key changes
 *                 (Transactions' "September 2026"); zebra striping runs
 *                 on across groups rather than restarting
 *   groupLabel    key => node for that header (defaults to the key)
 *   fixed         table-layout: fixed, for column widths set in headerClassName
 *   stickyHeader  keep the header row pinned while the page scrolls
 *   roomy         taller rows and wider gaps between columns, for a page that
 *                 has the width to breathe (Transactions, D237)
 *   attention     row => boolean, optional — that row's ＋ pulses: it has
 *                 something to resolve (an unverified card payment, D199)
 */
export function DataTable({
  columns, rows, rowKey, renderDetail, onRowClick, empty = 'Nothing here yet.',
  groupOf, groupLabel = (key) => key, fixed = false, stickyHeader = false, attention, roomy = false,
}) {
  const cellY = roomy ? 'py-3' : 'py-2';
  const gap = roomy ? 'pr-6' : 'pr-4';
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const [open, setOpen] = useState(() => new Set());

  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted">{empty}</p>;

  const expandable = Boolean(renderDetail);
  const colCount = columns.length + (expandable ? 1 : 0);
  // A column hidden on a phone keeps its place at zero width rather than
  // display:none (D232): the month rows span every column, and a removed cell
  // would shift the columns after it into the wrong slots.
  // Its content is removed on a phone (and laid out as if unwrapped from
  // `md` up, so a cell's own truncation still works), so an auto-width table
  // doesn't keep room for it either.
  const onPhone = (c) => (c.phone === false ? 'max-md:w-0 max-md:overflow-hidden max-md:p-0' : '');
  const phoneContent = (c, node) => (c.phone === false ? <div className="max-md:hidden md:contents">{node}</div> : node);
  const phoneColumns = columns.filter((c) => c.phone !== false).length;

  // Phones: ~7rem per column is the least a column can hold without text and
  // logos colliding, so a table too wide for that scrolls sideways inside its own
  // box instead of crushing. Only the columns a phone shows count (D232); from
  // `md` up, no minimum.
  return (
    <div className={`overflow-x-auto border border-rule bg-raised ${vivid ? 'rounded-2xl shadow-sm' : 'rounded-lg'}`}>
      <table
        style={{ '--dt-min': `${phoneColumns * 7}rem` }}
        className={`w-full min-w-[var(--dt-min)] border-collapse text-sm md:min-w-0 ${fixed ? 'table-fixed' : ''}`}
      >
        <thead>
          <tr className={`table-head border-b text-left ${vivid ? 'border-rule bg-band/60 text-ink/70' : 'border-rule-str bg-raised text-muted'}`}>
            {expandable && <th className="w-14 py-2.5 pl-3" aria-label="Details" />}
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={`${roomy ? 'py-3.5' : 'py-2.5'} ${gap} font-normal ${onPhone(c)} ${!expandable && i === 0 ? 'pl-4' : ''} ${
                  stickyHeader ? `sticky top-0 z-[1] ${vivid ? 'bg-band' : 'bg-raised'}` : ''
                } ${c.headerClassName ?? ''}`}
              >
                {phoneContent(c, c.header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row);
            const detail = expandable ? renderDetail(row) : null;
            const isOpen = open.has(key);
            const group = groupOf?.(row);
            const newGroup = groupOf && (i === 0 || groupOf(rows[i - 1]) !== group);
            return (
              <Fragment key={key}>
                {newGroup && (
                  <tr className={`group-row ${vivid ? 'bg-vivid-green/5' : 'bg-band/70'}`}>
                    <td
                      colSpan={colCount}
                      className={`py-1.5 pl-4 text-xs font-medium ${vivid ? 'text-vivid-green' : 'uppercase tracking-wide text-muted'}`}
                    >
                      {groupLabel(group)}
                    </td>
                  </tr>
                )}
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-rule transition-colors ${i % 2 === 1 ? 'bg-band/40' : 'bg-raised'} ${
                    vivid ? 'hover:bg-vivid-green/5' : 'hover:bg-band/70'
                  } ${onRowClick ? 'cursor-pointer' : ''} ${isOpen ? (vivid ? 'bg-vivid-green/5' : 'bg-band/70') : ''}`}
                >
                  {expandable && (
                    <td className={`${cellY} pl-3 pr-3 align-middle`}>
                      {/* The ＋ sits in its own 3.5rem column: room to breathe before the date (D242). */}
                      {detail && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(key);
                          }}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Hide details' : 'Show details'}
                          className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                            vivid
                              ? isOpen
                                ? 'bg-vivid-green text-white'
                                : 'bg-vivid-green/10 text-vivid-green hover:bg-vivid-green/20'
                              : 'border border-rule text-muted hover:text-ink'
                          } ${attention?.(row) && !isOpen ? 'attention-pulse' : ''}`}
                        >
                          {/* Only the glyph turns (+ → ×), not the square around it. A drawn
                              plus, not the "+" character: a text glyph sits on the baseline,
                              a hair low and left of centre (D242). */}
                          <motion.svg
                            viewBox="0 0 12 12"
                            className="size-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            aria-hidden="true"
                            animate={{ rotate: isOpen ? 45 : 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          >
                            <path d="M6 1.5v9M1.5 6h9" />
                          </motion.svg>
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map((c, ci) => (
                    <td key={c.key} className={`${cellY} ${gap} align-middle ${onPhone(c)} ${!expandable && ci === 0 ? 'pl-4' : ''} ${c.className ?? ''}`}>
                      {phoneContent(c, c.render(row))}
                    </td>
                  ))}
                </tr>
                <AnimatePresence initial={false}>
                  {isOpen && detail && (
                    <tr className="border-b border-rule">
                      <td colSpan={colCount} className="p-0">
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className={`px-4 py-3 md:pl-[4.25rem] ${vivid ? 'bg-vivid-green/5' : 'bg-band/50'}`}>{detail}</div>
                        </motion.div>
                      </td>
                    </tr>
                  )}
                </AnimatePresence>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
