import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOASTS, TOAST_GROUPS, MAX_NAME, titleCase, defaultName, toastName, renamedToasts, toastList } from './toast-names.js';

const GROUP_KEYS = TOAST_GROUPS.map((g) => g.key);
const words = (s) => s.split(' ').length;

test('every toast has a group, names for each design, an emoji, where it shows and an example (D384, D386)', () => {
  for (const [key, d] of Object.entries(TOASTS)) {
    assert.ok(GROUP_KEYS.includes(d.group), `${key}: group ${d.group}`);
    assert.ok(d.name && d.friendly && d.emoji && d.where && d.example, `${key}: a field is missing`);
    assert.ok(['success', 'error', 'info'].includes(d.type), `${key}: type`);
    assert.equal(d.group === 'problems', d.type === 'error', `${key}: errors and only errors are in "Couldn't do it"`);
  }
});

test('a name is the thing and what happened, a few words, with no figure or file in it', () => {
  for (const [key, { name, friendly }] of Object.entries(TOASTS)) {
    assert.ok(words(name) <= 4, `${key}: "${name}" is more than four words`);
    assert.ok(words(friendly) <= 5, `${key}: "${friendly}" is more than five words`);
    for (const n of [name, friendly]) {
      assert.ok(n.length <= MAX_NAME, `${key}: "${n}" is longer than ${MAX_NAME}`);
      assert.doesNotMatch(n, /[$\d]|\.pdf|\.csv|···/, `${key}: "${n}" holds a figure or a file`);
    }
    assert.match(name, /^[A-Z]/, `${key}: "${name}" starts with a capital`);
    if (words(name) === 1) assert.equal(name, 'Undone', `${key}: "${name}" names no thing`);
  }
  // No two toasts share a plain name: each says what it is about.
  const names = Object.values(TOASTS).map((d) => d.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test("Glass says it in Apple's Title Case; Vivid in its friendly line", () => {
  assert.equal(titleCase('Statement already on file'), 'Statement Already on File');
  assert.equal(titleCase("Couldn't read statement"), "Couldn't Read Statement");
  assert.equal(titleCase('Also found in statement'), 'Also Found in Statement');
  assert.equal(defaultName('account.closed', 'classic'), 'Account closed');
  assert.equal(defaultName('account.closed', 'glass'), 'Account Closed');
  assert.equal(defaultName('account.closed', 'vivid'), 'Card tucked away');
  assert.equal(defaultName('no.such.toast'), null);
});

test('renames are kept per design', () => {
  const saved = renamedToasts(null, 'account.closed', 'Card put away', 'vivid');
  assert.equal(toastName('account.closed', saved, 'vivid'), 'Card put away');
  assert.equal(toastName('account.closed', saved, 'glass'), 'Account Closed');
  assert.equal(toastName('account.closed', saved, 'classic'), 'Account closed');
  // Renaming back to the design's own name, or to blank, drops it.
  assert.deepEqual(renamedToasts(saved, 'account.closed', 'Card tucked away', 'vivid').vivid, {});
  assert.deepEqual(renamedToasts(saved, 'account.closed', '  ', 'vivid').vivid, {});
  assert.equal(renamedToasts({}, 'error.save', 'x'.repeat(60), 'classic').classic['error.save'].length, MAX_NAME);
});

test('a flat save from before D386 reads as Classic’s, and moves into the per-design shape on the next rename', () => {
  const old = { 'error.save': 'Not saved' };
  assert.equal(toastName('error.save', old, 'classic'), 'Not saved');
  assert.equal(toastName('error.save', old, 'glass'), "Couldn't Save");
  const next = renamedToasts(old, 'account.closed', 'Card shut', 'glass');
  assert.deepEqual(next, { classic: { 'error.save': 'Not saved' }, glass: { 'account.closed': 'Card shut' }, vivid: {} });
});

test('the list follows the groups in the design’s words, marks renames and searches', () => {
  const saved = renamedToasts(null, 'error.save', 'Not saved', 'glass');
  const all = toastList(saved, '', 'glass');
  assert.deepEqual(all.map((g) => g.key), GROUP_KEYS);
  const save = all.find((g) => g.key === 'problems').items.find((i) => i.key === 'error.save');
  assert.equal(save.current, 'Not saved');
  assert.equal(save.own, "Couldn't Save");
  assert.equal(save.renamed, true);
  assert.deepEqual(toastList({}, 'logo').flatMap((g) => g.items.map((i) => i.key)), ['merchant.logo']);
  assert.deepEqual(toastList({}, 'tucked away', 'vivid').flatMap((g) => g.items.map((i) => i.key)), ['account.closed']);
});
