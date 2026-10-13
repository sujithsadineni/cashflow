import { Fragment, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePrivacy } from '../use-privacy';
import { useDesign } from '../use-design';
import { APPEARANCES, DESIGNS } from '../designs';
import { avatarColorFor } from '../merchant-logos';
import { CategoryGlyph } from '../category-icons';
import { ICON_CATALOG, defaultIconFor } from '../category-icon-keys';
import { OVERVIEW_CARDS } from '../overview-cards';
import { useOverviewCards } from '../use-overview-cards';
import { Accounts } from './Accounts';
import { Loans } from './Loans';
import { MerchantIcons } from './MerchantIcons';
import { People } from './settings/People';
import { Backups } from './settings/Backups';
import { Button, TextInput, Segmented, PageTitle, SectionHeader } from './Form';
import { useNotify } from '../use-notify';
import { GlassSettings } from './settings/GlassSettings';
import { GlassOverviewCards, GlassDesignPicker, GlassPrivacy } from './settings/GlassPanes';
import { GroupSection, Group, Row } from './settings/glass-ui';
import { useWide, halves } from '../use-wide';

/**
 * Turns real names into Jane/John Doe and real dollar figures into
 * $***.** everywhere they're normally shown — for taking a screenshot
 * without posting real household data. A display-layer toggle only:
 * nothing in the database changes, and it's remembered per-browser
 * (localStorage), not as household data, so it's local to this
 * machine rather than something an API call could flip remotely.
 */
/** The on/off switch every toggle in this file shares — first built for Privacy, now Overview cards too. */
function ToggleSwitch({ on, onToggle, label }) {
  const { design } = useDesign();
  const onClass = design === 'vivid' ? 'border-vivid-green bg-vivid-green' : 'border-earn bg-earn';
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        on ? onClass : 'border-rule-str bg-band'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-raised shadow-sm transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** Settings → Design: pick Classic or Vivid. A real radio group, so it's keyboard-reachable like any other choice. */
function DesignPicker() {
  const { design, setDesign, appearance, setAppearance } = useDesign();

  return (
    <section>
      <SectionHeader title="Design" emoji="🎨" tint="bg-vivid-purple/15" />
      <p className="mb-4 max-w-md text-sm text-muted">
        How the app looks on this browser. Your choice is remembered here only, so each person can pick their own.
      </p>
      {/* Light or dark on top of any design (D234); Auto follows the computer. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink">Appearance</span>
        <Segmented value={appearance} onChange={setAppearance} options={APPEARANCES} />
      </div>
      <div role="radiogroup" aria-label="Design" className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {DESIGNS.map((d) => {
          const selected = design === d.value;
          return (
            <button
              key={d.value}
              role="radio"
              aria-checked={selected}
              onClick={() => setDesign(d.value)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selected ? 'border-earn bg-earn/5 ring-1 ring-earn' : 'border-rule hover:border-rule-str hover:bg-band'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{d.label}</span>
                {selected && <span className="text-xs text-earn">In use</span>}
              </div>
              <div className="mt-3 flex gap-1.5">
                {d.swatches.map((c) => (
                  <span key={c} className="size-6 rounded-md border border-rule" style={{ backgroundColor: c }} />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">{d.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PrivacyToggle() {
  const { privacyMode, setPrivacyMode } = usePrivacy();
  const vivid = useDesign().design === 'vivid';

  return (
    <section>
      <SectionHeader title="Privacy" emoji="🔒" tint="bg-vivid-teal/15" />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-ink">Hide names and amounts</div>
          <p className="mt-0.5 max-w-md text-sm text-muted">
            Replaces real names with Jane/John Doe and real dollar amounts with $***.** across
            the app, and masks transaction dates — for taking a screenshot to share.
          </p>
        </div>
        <ToggleSwitch on={privacyMode} onToggle={() => setPrivacyMode(!privacyMode)} label="Hide names and amounts" />
      </div>

      {/* Vivid (D151): what the mask does, before and after, on a sample row. */}
      {vivid && (
        <div className="mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { key: 'shown', emoji: '👀', label: 'Shown', name: 'Your name', amount: '−$42.00', date: 'Sep 20' },
            { key: 'hidden', emoji: '🙈', label: 'Hidden', name: 'Jane Doe', amount: '−$***.**', date: '*** **' },
          ].map((row) => {
            const active = (row.key === 'hidden') === privacyMode;
            return (
              <div
                key={row.key}
                className={`rounded-2xl border p-4 transition-all ${
                  active ? 'border-vivid-teal bg-vivid-teal/5 ring-1 ring-vivid-teal' : 'border-rule opacity-60'
                }`}
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                  <span className="text-lg leading-none" aria-hidden="true">{row.emoji}</span>
                  {row.label}
                  {active && <span className="ml-auto text-xs text-vivid-teal">Now</span>}
                </div>
                <div className="flex items-baseline justify-between gap-3 rounded-lg bg-band/60 px-3 py-2 text-sm">
                  <span className="text-ink">{row.name}</span>
                  <span className="font-mono text-xs text-muted tnum">{row.date}</span>
                  <span className="font-mono text-spend tnum">{row.amount}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Which small secondary cards show on Overview — see
 * web/src/overview-cards.js for the shared registry. Unset (new
 * household, or a brand-new card shipped since the preference was
 * last saved) defaults to every card on, so this is purely opt-out,
 * never a blank slate to configure before Overview looks right.
 */
function OverviewCardsToggle() {
  const vivid = useDesign().design === 'vivid';
  const { visible, toggle } = useOverviewCards();

  return (
    <section>
      <SectionHeader title="Overview cards" emoji="🧩" tint="bg-vivid-green/15" />
      <p className="mb-4 max-w-md text-sm text-muted">
        Choose which small cards show on the Overview page. A new card added later shows up here already on.
      </p>
      {visible && vivid && (
        // A preview of each card as it sits on Overview; switched-off
        // cards fade back rather than vanish, so they're easy to bring back.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {OVERVIEW_CARDS.map(({ key, label, emoji, tint }) => {
            const on = visible.includes(key);
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-2xl p-3.5 transition-opacity ${tint} ${on ? '' : 'opacity-45'}`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-lg leading-none shadow-sm" aria-hidden="true">
                  {emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{label}</div>
                  <div className="text-xs text-muted">{on ? 'Showing on Overview' : 'Hidden'}</div>
                </div>
                <ToggleSwitch on={on} onToggle={() => toggle(key)} label={label} />
              </div>
            );
          })}
        </div>
      )}
      {visible && !vivid && (
        <div className="divide-y divide-rule">
          {OVERVIEW_CARDS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-3">
              <div className="text-sm text-ink">{label}</div>
              <ToggleSwitch on={visible.includes(key)} onToggle={() => toggle(key)} label={label} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A category's icon badge — colored deterministically from its name
 * (the exact same `avatarColorFor` every merchant-initial avatar
 * already uses, so this introduces no new colors, just a new place
 * the existing palette shows up), the glyph either its own saved
 * `icon_key` or a best-effort default from the name. Click opens the
 * picker inline below the row.
 */
function CategoryIconButton({ category, onToggle }) {
  const iconKey = category.icon_key || defaultIconFor(category.name);
  return (
    <button
      onClick={onToggle}
      title="Change icon"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white transition-transform hover:scale-110"
      style={{ backgroundColor: avatarColorFor(category.name) }}
    >
      <CategoryGlyph iconKey={iconKey} size={17} />
    </button>
  );
}

function IconPicker({ category, onPick }) {
  const current = category.icon_key || defaultIconFor(category.name);
  const color = avatarColorFor(category.name);
  return (
    <li className="border-b border-rule bg-band/40 px-1 py-3">
      <div className="flex flex-wrap gap-1.5">
        {ICON_CATALOG.map((key) => (
          <button
            key={key}
            onClick={() => onPick(key)}
            title={key}
            className={`flex size-8 items-center justify-center rounded-lg text-white transition-transform hover:scale-110 ${
              key === current ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''
            }`}
            style={{ backgroundColor: color }}
          >
            <CategoryGlyph iconKey={key} size={17} />
          </button>
        ))}
      </div>
    </li>
  );
}

/**
 * Category manager: add your own (Costco, Refund, …), delete unused
 * ones. A category on real transactions can't be deleted — the API
 * refuses, because deleting it would silently uncategorize history.
 */
function Categories({ categories, onChange }) {
  const notify = useNotify();
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const maxCount = Math.max(1, ...categories.map((c) => Number(c.transaction_count ?? 0)));
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pickerFor, setPickerFor] = useState(null);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.categoryCreate(name);
      notify(`"${name}" added`, { type: 'success' });
      setName('');
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category) => {
    setError(null);
    try {
      await api.categoryDelete(category.id);
      onChange();
      notify(`"${category.name}" deleted`, { type: 'success' });
    } catch (err) {
      setError(err.message);
    }
  };

  const pickIcon = async (category, iconKey) => {
    setPickerFor(null);
    try {
      await api.categoryIcon(category.id, iconKey);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  if (design === 'glass') {
    return (
      <GlassCategories
        categories={categories}
        name={name} setName={setName} add={add} busy={busy} error={error}
        remove={remove} pickIcon={pickIcon} pickerFor={pickerFor} setPickerFor={setPickerFor}
      />
    );
  }

  return (
    <section>
      <SectionHeader title="Categories" emoji="🗂️" tint="bg-vivid-amber/20">
        <span className="text-sm text-faint tnum">{categories.length}</span>
      </SectionHeader>

      <div className="mb-4 flex gap-2">
        <div className="w-64">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Costco, Refund, …"
          />
        </div>
        <Button onClick={add} disabled={busy || !name.trim()}>Add</Button>
      </div>

      {error && <p className="mb-3 text-sm text-spend">{error}</p>}

      <ul className="divide-y divide-rule">
        {categories.map((category) => {
          const count = Number(category.transaction_count ?? 0);
          const isOpen = pickerFor === category.id;
          return (
            <Fragment key={category.id}>
              <li className="group flex items-center justify-between gap-4 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <CategoryIconButton
                    category={category}
                    open={isOpen}
                    onToggle={() => setPickerFor(isOpen ? null : category.id)}
                  />
                  <span className="min-w-0">
                    <span className="text-ink">{category.name}</span>
                    {/* Vivid (D147): how much each category is actually used, at a glance. */}
                    {vivid && count > 0 && (
                      <span className="mt-1 block h-1 w-40 rounded-full bg-band">
                        <span
                          className="animate-bar-grow block h-1 rounded-full"
                          style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: avatarColorFor(category.name) }}
                        />
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex items-baseline gap-4">
                  <span className={`text-sm tnum ${vivid && count === 0 ? 'rounded-full bg-vivid-amber/15 px-2 py-0.5 text-xs text-ink' : 'text-faint'}`}>
                    {count === 0 ? 'unused' : `${count} transaction${count === 1 ? '' : 's'}`}
                  </span>
                  {count === 0 && (
                    <button
                      onClick={() => remove(category)}
                      className="text-sm text-faint underline-offset-4 opacity-0 transition-opacity
                                 group-hover:opacity-100 hover:text-spend hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </span>
              </li>
              {isOpen && <IconPicker category={category} onPick={(key) => pickIcon(category, key)} />}
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Glass (D244): one grouped list. Adding is the list's first row, the way
 * Reminders adds a list; each icon tile opens its picker right under the row,
 * growing open on a no-bounce spring. An unused category shows "Delete"
 * outright: an action that only appears on hover can't be found by touch or
 * by anyone who doesn't already know it's there.
 */
function GlassCategories({ categories, name, setName, add, busy, error, remove, pickIcon, pickerFor, setPickerFor }) {
  const reduceMotion = useReducedMotion();
  // Wide screens: two lists side by side, the add row heading the first (D245).
  const columns = useWide() ? halves(categories) : [categories];
  return (
    <GroupSection
      label={`${categories.length} categories`}
      footnote="Tap an icon to change it. A category in use can't be deleted, because that would quietly uncategorise its history."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
      {columns.map((column, col) => (
      <Group key={col} inset={58}>
        {col === 0 && <li className="gs-row flex min-h-11 items-center gap-3 px-4 py-2">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-info text-white" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="New category"
            aria-label="New category name"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          {name.trim() && (
            <button type="button" onClick={add} disabled={busy} className="text-[15px] font-semibold text-info disabled:opacity-40">
              Add
            </button>
          )}
        </li>}
        {column.map((category) => {
          const count = Number(category.transaction_count ?? 0);
          const isOpen = pickerFor === category.id;
          const current = category.icon_key || defaultIconFor(category.name);
          const color = avatarColorFor(category.name);
          return (
            <Row
              key={category.id}
              leading={
                <button
                  type="button"
                  onClick={() => setPickerFor(isOpen ? null : category.id)}
                  aria-expanded={isOpen}
                  aria-label={`Change ${category.name}'s icon`}
                  className="flex size-[30px] items-center justify-center rounded-[8px] text-white"
                  style={{ backgroundColor: color }}
                >
                  <CategoryGlyph iconKey={current} size={16} />
                </button>
              }
              title={category.name}
              trailing={count === 0 ? (
                <>
                  <span className="text-[15px] text-faint">Unused</span>
                  <button type="button" onClick={() => remove(category)} className="text-[15px] text-spend">Delete</button>
                </>
              ) : (
                <span className="text-[15px] text-muted tnum">{count}</span>
              )}
            >
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.35 }}
                    className="overflow-hidden"
                  >
                    <div role="radiogroup" aria-label={`${category.name} icon`} className="flex flex-wrap gap-1.5 px-4 pt-1 pb-3 pl-[58px]">
                      {ICON_CATALOG.map((key) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={key === current}
                          title={key}
                          onClick={() => pickIcon(category, key)}
                          className={`flex size-8 items-center justify-center rounded-[8px] text-white ${
                            key === current ? 'shadow-[0_0_0_2px_var(--g-solid),0_0_0_4px_var(--color-info)]' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        >
                          <CategoryGlyph iconKey={key} size={16} />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Row>
          );
        })}
      </Group>
      ))}
      </div>
      {error && <p className="mt-1.5 px-4 text-[13px] text-spend">{error}</p>}
    </GroupSection>
  );
}

/**
 * One person's button in the centered row below — a colored initial
 * (the same `avatarColorFor`/`initialsFor` every merchant avatar
 * already uses) plus their name and account count. Click opens the
 * full PersonCard: everything here is just enough to recognize who's
 * who and invite a click, not a place to read details.
 */
const TABS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'loans', label: 'Loans' },
  { value: 'people', label: 'People' },
  { value: 'categories', label: 'Categories' },
  { value: 'icons', label: 'Merchants' },
  { value: 'overview', label: 'Overview cards' },
  { value: 'design', label: 'Design' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'backups', label: 'Backups' },
];

/**
 * One section at a time behind a tab switcher, not six stacked
 * sections in one long scroll — Accounts, Loans, People, Categories,
 * and Merchant icons (236 rows on its own) used to all render at
 * once, so getting to any one of them meant scrolling past all the
 * others first. Each section component is unchanged; only how many
 * of them are on screen together changed.
 */
export function Settings({ accounts, people, categories, onChange }) {
  // The tab lives in the URL (?tab=loans), so a toast's "Open Loans" can land on it (D201).
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'accounts';
  const setTab = (value) => setParams({ tab: value }, { replace: true });
  const glass = useDesign().design === 'glass';

  if (glass) {
    // People's pane line is the household itself, as Glass People had it (D243).
    const description = tab === 'people'
      ? `Your household · ${people.length} ${people.length === 1 ? 'person' : 'people'} · ${accounts.length} accounts, one shared ledger`
      : undefined;
    return (
      <GlassSettings tabs={TABS} tab={tab} setTab={setTab} description={description}>
        {tab === 'accounts' && <Accounts accounts={accounts} people={people} onChange={onChange} />}
        {tab === 'loans' && <Loans accounts={accounts} onChange={onChange} />}
        {tab === 'people' && <People people={people} accounts={accounts} onChange={onChange} />}
        {tab === 'categories' && <Categories categories={categories} onChange={onChange} />}
        {tab === 'icons' && <MerchantIcons />}
        {tab === 'overview' && <GlassOverviewCards />}
        {tab === 'design' && <GlassDesignPicker />}
        {tab === 'privacy' && <GlassPrivacy />}
        {tab === 'backups' && <Backups />}
      </GlassSettings>
    );
  }

  return (
    <div>
      <header className="mb-6">
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="⚙️" tint="bg-rule/60">Settings</PageTitle>
        <p className="mt-1 text-sm text-muted">Accounts, people, categories, and merchant icons.</p>
      </header>

      <div className="mb-8">
        <Segmented value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === 'accounts' && <Accounts accounts={accounts} people={people} onChange={onChange} />}
      {tab === 'loans' && <Loans accounts={accounts} onChange={onChange} />}
      {tab === 'people' && <People people={people} accounts={accounts} onChange={onChange} />}
      {tab === 'categories' && <Categories categories={categories} onChange={onChange} />}
      {tab === 'icons' && <MerchantIcons />}
      {tab === 'overview' && <OverviewCardsToggle />}
      {tab === 'design' && <DesignPicker />}
      {tab === 'privacy' && <PrivacyToggle />}
      {tab === 'backups' && <Backups />}
    </div>
  );
}
