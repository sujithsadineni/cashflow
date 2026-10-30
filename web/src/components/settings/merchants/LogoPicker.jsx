import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { usePlacement, useOutsideClose } from '../../../hooks/use-popover';
import { PopoverPanel } from '../../ui/PopoverPanel';

/**
 * Choosing a merchant's logo (D301), from one picker opened by Choose Logo.
 * Its category's icon already says "no logo", so this is only for real
 * ones:
 *
 *   Search for a Logo  the name (editable) goes to Clearbit's public company
 *                      list on Search, and only then; companies with a site
 *                      and an icon come back as cards. Nothing is applied
 *                      until one is picked, because a local name often
 *                      matches another business somewhere else.
 *   Its website        typed, its logo shows before it's used
 *   Upload Logo        an image file (dropping one on the logo works too)
 *   Built-in Logo      clears what was chosen
 *
 * Each choice applies at once; the pane's toast has Undo. The app's popover
 * (a bottom sheet on a phone), inside the Apple focus scope.
 *
 *   onPick({ domain } | { clear: true } | { photo: File } | { removePhoto: true })
 */

const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
// The API's cleaning (merchant-names.js), for the preview.
const cleanDomain = (v) => {
  const h = v.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return HOST.test(h) ? h : null;
};
const favicon = (domain) => `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

function Heading({ children }) {
  return <h4 className="mb-1.5 px-1 text-[13px] text-muted">{children}</h4>;
}

export function LogoPicker({ merchant, source, hasKnownLogo, onPick, trigger }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(merchant);
  const [found, setFound] = useState({ status: 'idle', results: [] });
  const [site, setSite] = useState('');
  const [place, placePanel] = usePlacement(open, triggerRef, 360);
  const close = useCallback(() => setOpen(false), []);
  const refs = useMemo(() => [triggerRef, panelRef], []);
  useOutsideClose(open, refs, close);

  const typed = cleanDomain(site);
  const choose = (choice) => { setOpen(false); onPick(choice); };
  const show = () => {
    placePanel();
    setQuery(merchant);
    setFound({ status: 'idle', results: [] });
    setSite(source.kind === 'website' ? source.domain : '');
    setOpen(true);
  };
  // Portalled, but React still bubbles a submit to the detail's own form: stop it.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  async function search(e) {
    stop(e);
    const q = query.trim();
    if (!q) return;
    setFound({ status: 'loading', results: [], q });
    try {
      const res = await api.merchants.logoSearch(q);
      setFound({ status: res.unavailable ? 'unavailable' : 'done', results: res.results, q });
    } catch {
      setFound({ status: 'unavailable', results: [], q });
    }
  }

  return (
    <>
      {trigger({ ref: triggerRef, onClick: () => (open ? close() : show()), 'aria-haspopup': 'dialog', 'aria-expanded': open })}
      {open && (
        <PopoverPanel
          place={place}
          panelRef={panelRef}
          role="dialog"
          aria-label="Choose a logo"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); triggerRef.current?.focus(); } }}
          className="apple-pane p-3"
          style={{ width: place?.sheet ? undefined : 360 }}
        >
          <div className="max-h-[65vh] space-y-4 overflow-y-auto overscroll-contain">
            <section>
              <Heading>Search for a Logo</Heading>
              <form onSubmit={search} className="flex items-center gap-2 rounded-lg bg-band px-2 py-1.5 focus-within:ring-2 focus-within:ring-info/40">
                <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" /></svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Company name" autoComplete="off" autoFocus
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
                <button type="submit" disabled={!query.trim() || found.status === 'loading'} className="rounded-full bg-info px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-35">
                  {found.status === 'loading' ? 'Searching…' : 'Search'}
                </button>
              </form>
              {found.status === 'done' && found.results.length > 0 && (
                <ul className="mt-2 grid grid-cols-2 gap-1.5" aria-label="Logos found">
                  {found.results.map((r) => (
                    <li key={r.domain}>
                      <button type="button" onClick={() => choose({ domain: r.domain })} title={`Use ${r.domain}`}
                        className="flex w-full items-center gap-2 rounded-lg border border-rule p-2 text-left transition-colors hover:border-info/50 hover:bg-info/5 active:bg-info/10">
                        <img src={favicon(r.domain)} alt="" className="size-8 shrink-0 rounded-md bg-raised object-cover shadow-[0_0_0_0.5px_rgb(0_0_0/0.1)]" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-ink">{r.name}</span>
                          <span className="block truncate text-[11px] text-faint">{r.domain}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.status === 'done' && found.results.length === 0 && (
                <p className="mt-1.5 px-1 text-[13px] text-muted">No logo found for “{found.q}”. Try a shorter name, or type its website below.</p>
              )}
              {found.status === 'unavailable' && (
                <p className="mt-1.5 px-1 text-[13px] text-muted">Logo search can't be reached right now. Type its website below instead.</p>
              )}
              <p className="mt-1.5 px-1 text-[11px] leading-snug text-faint">Search sends this name to Clearbit's public list of companies. Nothing changes until you pick one.</p>
            </section>

            <section className="border-t border-rule pt-3">
              <Heading>Or Its Website</Heading>
              <form onSubmit={(e) => { stop(e); if (typed) choose({ domain: typed }); }}
                className="flex items-center gap-2 rounded-lg bg-band px-2 py-1.5 focus-within:ring-2 focus-within:ring-info/40">
                <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised" aria-hidden="true">
                  {typed ? <img key={typed} src={favicon(typed)} alt="" className="size-full object-cover" /> : <span className="text-[13px] text-faint">www</span>}
                </span>
                <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="cornerbakery.com" aria-label="Website" inputMode="url" autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
                <button type="submit" disabled={!typed} className="rounded-full bg-info px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-35">Use</button>
              </form>
              {site.trim() && !typed && <p className="mt-1 px-1 text-[13px] text-muted">A website, like cornerbakery.com</p>}
            </section>

            <section className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full bg-info/10 px-3 py-1.5 text-[13px] font-medium text-info hover:bg-info/15">
                {source.kind === 'photo' ? 'Replace Logo' : 'Upload Logo'}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose({ photo: f }); }} />
              {source.kind === 'photo' && (
                <button type="button" onClick={() => choose({ removePhoto: true })} className="rounded-full px-3 py-1.5 text-[13px] text-spend hover:bg-band">Remove Logo</button>
              )}
              {source.kind === 'website' && (
                <button type="button" onClick={() => choose({ clear: true })} className="ml-auto rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-band hover:text-ink">
                  {hasKnownLogo ? 'Use Built-in Logo' : 'Remove Custom Logo'}
                </button>
              )}
              <p className="w-full px-1 text-[11px] text-faint">PNG, JPEG or WebP, up to 5 MB. You can also drop an image on the logo.</p>
            </section>
          </div>
        </PopoverPanel>
      )}
    </>
  );
}
