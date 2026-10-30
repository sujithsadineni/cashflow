import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, FAMILIES } from './spend-families.js';
import { categoryPalette, toLab, labToLinear } from './category-palette.js';

test('categories fall into families by name, first rule wins, the rest into Fees & other', () => {
  const fam = (n) => familyOf(n).key;
  assert.equal(fam('Groceries'), 'food');
  assert.equal(fam('Fast Food'), 'food');
  assert.equal(fam('Rent'), 'home');
  assert.equal(fam('Phone'), 'home');
  assert.equal(fam('EV Charging'), 'move');
  assert.equal(fam('Auto Maintenance'), 'move');
  assert.equal(fam('Balance Transfer'), 'sent');
  assert.equal(fam('Clothing'), 'life');
  assert.equal(fam('Bank Fees'), 'other');
  assert.equal(fam('Interest'), 'other');
  assert.equal(fam('Balance Transfer Fee'), 'other', 'a fee is a fee');
  assert.equal(fam('Consulting Fee'), 'sent');
  assert.equal(fam(null), 'other');
});

test('no family hue range touches green, which means money in', () => {
  for (const f of FAMILIES) for (let h = f.hues[0]; h <= f.hues[1]; h++) {
    const hh = h % 360;
    assert.ok(hh < 120 || hh > 165, `${f.name} reaches ${hh}°`);
  }
});

const sample = ['Groceries', 'Dining', 'Fast Food', 'Rent', 'Utilities', 'Phone', 'Insurance', 'Subscriptions', 'Transport', 'Fuel', 'Shopping', 'Clothing',
  'Travel', 'Fitness', 'Zelle', 'Gift Cards', 'Bank Fees', 'Interest', 'Uncategorized'].map((name, i) => ({ id: i + 1, name }));

test('every category gets its own colour, in gamut and inside its family', () => {
  const pal = categoryPalette(sample);
  assert.equal(pal.size, sample.length);
  for (const [name, c] of pal) {
    assert.ok(labToLinear(toLab(c)).every((x) => x >= -0.002 && x <= 1.002), `${name} out of gamut`);
    const [h0, h1] = c.family.hues, h = c.h < h0 ? c.h + 360 : c.h;
    assert.ok(h >= h0 && h <= h1, `${name} hue ${c.h} outside ${c.family.name}`);
  }
  const labs = [...pal.values()].map(toLab);
  let min = 99;
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) min = Math.min(min, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])) * 100);
  assert.ok(min >= 5, `closest pair only ${min.toFixed(1)} apart`);
});

test('a colour belongs to the category: same in any order, and a new category never repaints the rest', () => {
  const a = categoryPalette(sample), b = categoryPalette([...sample].reverse());
  for (const [name, c] of a) assert.equal(b.get(name).css, c.css);
  const more = categoryPalette([...sample, { id: 99, name: 'Parking' }]);
  for (const [name, c] of a) assert.equal(more.get(name).css, c.css, `${name} changed`);
});
