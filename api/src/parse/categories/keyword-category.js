/**
 * A category from plain words in the bank line (D188, D337), for a row nothing
 * else could categorise: no history, no rule, a place never seen. "HABIBI
 * GRILL", "BIRYANI POT", "WOK N ROLL" are restaurants without anyone having
 * to say so. Only ever fills a blank, only for purchases, and only names a
 * category the household actually has. It's a suggestion like any other:
 * the row still goes through Review.
 */

// A line that names what it is (D337). The first five are certain enough that the re-check also
// questions a row filed elsewhere (STRONG): State Farm had been learned as Parking & Tolls from one
// wrong row and copied onto 21. The rest only fill a blank.
export const STRONG = new Set(['Insurance', 'Parking & Tolls', 'Health', 'Gifts & Donations', 'Subscriptions', 'Costco Fuel']);
const RULES = [
  ['Insurance', /\b(insurance|geico|progressive ins|allstate|state farm|lemonade ins)\b/i],
  ['Parking & Tolls', /\b(parking|parkmobile|park mobile|toll ?way|tollway|ntta|e-?zpass|txtag|peach ?pass|sunpass)\b/i],
  ['Health', /\b(pharmacy|cvs\/?pharmacy|walgreens|urgent care|dental|dentist|clinic|hospital|optometr\w*|medical center)\b/i],
  // "Church" only as a place, not an address: Duke Energy bills from S CHURCH ST.
  ['Gifts & Donations', /\b(temple|mosque|gurdwara|mandir|donation|charity)\b|\bchurch\b(?!\s+(st|rd|ave|street|road|dr|ln|blvd|hill)\b)/i],
  ['Subscriptions', /apple\.com\/bill|\b(netflix\.com|spotify|hulu|youtube premium|icloud|chatgpt|openai)\b/i],
  ['Travel', /\b(flixbus|flix|greyhound|amtrak|airlines?|airways|hotel|motel|marriott|hilton|hyatt|airbnb|expedia|inn|suites|la quinta|days inn|booking\.com|six flags)\b/i],
  // D417: generic words and large chains that read the same for any household, ahead of Dining's broad words.
  ['EV Charging', /\b(chargepoint|evgo|electrify america|blink charging|blink|supercharger|ev ?charging|charging station)\b/i],
  ['Education', /\b(university|univ|college|school|tuition|academy|parchment|coursera|udemy)\b/i],
  ['Government', /\b(dmv|ncdmv|txdmv|dps|uscis|usps|passport|county|city of|state of|dept of|department of|court|tax collector|vehicle reg\w*|defensive driving)\b/i],
  ['Personal Care', /\b(salon|nails?|threading|spa|barber\w*|beauty|cosmetics|great clips|sport clips|supercuts|ulta|sephora)\b/i],
  ['Home', /\b(storage|home depot|lowe'?s|ikea|hardware|furniture|bed bath|homegoods|wayfair|serviceworks)\b/i],
  ['Auto Maintenance', /\b(car ?wash|auto parts|autozone|o'?reilly|jiffy lube|valvoline|tires?|mechanic|oil change|auto repair|lkq)\b/i],
  ['Utilities', /\b(energy|electric\w*|power co\w*|water|utilities|comcast|xfinity|spectrum|paymentus|duke)\b/i],
  ['Phone', /\b(wireless|t-?mobile|verizon|at&t|visible|mint mobile|cricket|boost mobile|cell ?phone)\b/i],
  ['Entertainment', /\b(cinema|theatre|theater|movies|amc|regal|bowl\w*|arcade|museum|zoo|aquarium|concert|ticketmaster|eventbrite|topgolf|jet ?ski)\b/i],
  ['Rent', /\b(apartments?|leasing|property management|residential|rent pmts?|rentpay\w*)\b/i],
  // D342: chains, ahead of Dining's words ("chicken", "burgers") so a Chick-fil-A is fast food.
  ['Fast Food', /\b(mcdonald'?s|taco bell|wendy'?s|burger king|chick-fil-a|kfc|popeyes|subway|sonic drive|whataburger|jack in the box|sarku|domino'?s|pizza hut|papa john'?s|little caesars|cook out|waffle house|chipotle|five guys|in-n-out|raising cane'?s|arby'?s|dairy queen|panda express|shake shack|wingstop|jersey mike'?s|jimmy john'?s|qdoba|del taco|carl'?s jr|white castle|zaxby'?s|bojangles|culver'?s|cicis)\b/i],
  ['Clothing', /\b(ross stores|ross dress|tj ?maxx|marshalls|burlington|h&m|zara|old navy|uniqlo|puma|nike|adidas|forever 21|american eagle|guess|gap outlet|banana republic|levi'?s|skims|the north face|kohl'?s|macy'?s|nordstrom|dillard'?s|abercrombie|shoe palace|tx-anf)\b/i],
  ['Dining', /\b(restaur\w*|cafe|grill|kitchen|pizza\w*|tacos?|taqueria|burgers?|biryani|bakery|bagels?|coffee|espresso|tea|boba|sushi|ramen|pho|thai|thali|indian|chinese|mexican|wok|eats|diner|bbq|barbecue|soft serve|ice cream|creamery|gelato|deli|bistro|curry|dosa|wings|chicken|noodles?|dumplings?|donuts?|doughnuts?|cantina|brewing|brewery|steakhouse|smokehouse)\b/i],
  ['Groceries', /\b(grocery|groceries|grocers?|supermarket|market|bazaa?r|fresh meat|halal meat|produce|farmers|foods|kroger|publix|aldi|lidl|safeway|albertsons|food lion|harris teeter|wegmans|sprouts|h-?e-?b|winco|meijer|hy-?vee|patel brothers|apna bazar)\b/i],
  ['Fuel', /\b(fuel|gas station|petro\w*|circle k|costco gas|shell oil|exxon\w*|mobil|chevron|sunoco|valero|marathon|speedway|wawa|sheetz|quik ?trip|racetrac|7-?eleven|casey'?s|murphy ?usa|love'?s travel|pilot|flying j|citgo|phillips 66|conoco|buc-?ee'?s)\b/i],
  ['Transport', /\b(transit|taxi|metrocard|bike share|marta|metro|tvm)\b/i],
];

/**
 * Lines that say what they are for certain (D368): Costco's pumps print COSTCO GAS, and the
 * household keeps that apart from the warehouse. These win over the household's own history on
 * import too (a new station's line would otherwise take the "Costco" every other Costco row has),
 * and the re-check questions such a row filed anywhere else.
 */
const CERTAIN = [['Costco Fuel', /\bcostco\s*(gas|gasoline|fuel)\b/i]];

/** A category a line names for certain, if the household has it, or null. */
export function certainCategory(description, categoryNames = null) {
  for (const [category, re] of CERTAIN) {
    if (re.test(description ?? '') && (!categoryNames || categoryNames.includes(category))) return category;
  }
  return null;
}

/** @returns a category name from `categoryNames`, or null. */
export function keywordCategory(description, categoryNames = null) {
  const certain = certainCategory(description, categoryNames);
  if (certain) return certain;
  for (const [category, re] of RULES) {
    if (re.test(description ?? '') && (!categoryNames || categoryNames.includes(category))) return category;
  }
  return null;
}
