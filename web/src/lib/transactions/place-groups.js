/**
 * The Where filter's places by state (D369, D370): the states where the
 * household buys most first, each with its cities most-used first, Online on
 * its own. The picker shows the states first and a state's cities on a tap;
 * a whole state is one choice, "state:TX". Pure; tested in place-groups.test.js.
 */

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'Washington, DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

/**
 * A place key ("Lakeview|TX", "online") → its city and the state it's grouped under. A city a
 * line printed without its state joins the state of the same city printed with one, if any.
 */
function splitter(places) {
  const stateOf = new Map();
  for (const p of places) {
    const [city, code] = p.key.split('|');
    if (code && STATES[code] && !stateOf.has(city.toLowerCase())) stateOf.set(city.toLowerCase(), { name: STATES[code], code });
  }
  return (p) => {
    const [city, code] = p.key.split('|');
    if (code) return STATES[code] ? { city, state: STATES[code], code } : { city, state: 'Elsewhere', code: null };
    const joined = stateOf.get(city.toLowerCase());
    // Beside its namesake, it says why it's a second entry.
    return joined ? { city: `${city} (state not printed)`, state: joined.name, code: joined.code } : { city, state: 'Elsewhere', code: null };
  };
}

/**
 * @param places [{ key, label, count }] from /transactions/places
 * @returns { online: place | null, states: [{ code, name, key: "state:TX", count, cities: [{ key, city, count }] }] }
 */
export function placeTree(places) {
  const split = splitter(places);
  const byState = new Map();
  let online = null;
  for (const p of places) {
    if (p.key === 'online') { online = p; continue; }
    const { city, state, code } = split(p);
    if (!byState.has(state)) byState.set(state, { code, name: state, key: code ? `state:${code}` : null, count: 0, cities: [] });
    const s = byState.get(state);
    s.count += p.count;
    s.cities.push({ key: p.key, city, count: p.count });
  }
  const states = [...byState.values()]
    .map((s) => ({ ...s, cities: s.cities.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)) }))
    .sort((a, b) => (a.name === 'Elsewhere') - (b.name === 'Elsewhere') || b.count - a.count || a.name.localeCompare(b.name));
  return { online, states };
}

/** A picked place as its chip says it: "Lakeview, TX", or a whole state, "All of Texas". */
export function placeLabel(places, key) {
  if (key?.startsWith('state:')) return `All of ${STATES[key.slice(6)] ?? key.slice(6)}`;
  return places.find((p) => p.key === key)?.label ?? key;
}
