/** The search field at the top of a Settings list (Merchants D300, Notifications D384): iOS's, from tokens. */
export function SearchField({ value, onChange, placeholder = 'Search', label = 'Search' }) {
  return (
    <label className="flex items-center gap-2 rounded-[10px] bg-band px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-info/40">
      <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="flex size-5 items-center justify-center rounded-full bg-faint/60 text-raised">
          <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
        </button>
      )}
    </label>
  );
}
