import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageBoxes, fileSize } from './reading-stages.js';

const today = '2026-10-19';
const states = ({ boxes }) => boxes.map((b) => b.state);
const notes = ({ boxes }) => boxes.map((b) => b.note);

test('file sizes read as KB or MB', () => {
  assert.equal(fileSize(840_000), '820 KB');
  assert.equal(fileSize(2_200_000), '2.1 MB');
  assert.equal(fileSize(0), null);
});

test('while it uploads, then while it reads', () => {
  assert.deepEqual(states(stageBoxes({ fileType: 'PDF', size: 2_200_000, uploaded: false }, { today })),
    ['active', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
  assert.deepEqual(states(stageBoxes({ fileType: 'PDF', size: 2_200_000, uploaded: true }, { today })),
    ['done', 'active', 'waiting', 'waiting', 'waiting', 'waiting']);
  assert.deepEqual(states(stageBoxes({ fileType: 'CSV', uploaded: true }, { today })),
    ['done', 'skip', 'active', 'waiting', 'waiting', 'waiting'], 'a CSV skips Open');
});

const facts = {
  pages: 6, card: { issuer: 'Barclays', name: 'Test Card', mask: '1111' }, card_known: 'suggested', account_id: 7,
  period: { start: '2026-09-12', end: '2026-10-11' }, rows: 48, sorted: 41, low_confidence: 0, duplicates: 0, same_statement: null,
};

test('a clean read: every box says what it found', () => {
  const r = stageBoxes({ fileName: 'eStmt.pdf', fileType: 'PDF', size: 2_200_000, uploaded: true, facts, report: { reconciliation: { closing: true } } }, { today });
  assert.equal(r.boxes[0].title, 'eStmt.pdf · 2.1 MB PDF', 'the size is on hover');
  assert.equal(stageBoxes({ fileName: 'eStmt.pdf', fileType: 'PDF', uploaded: true, facts }, { label: 'barclays-1111-2026-10', today }).boxes[0].note, 'barclays-1111-2026-10');
  assert.deepEqual(states(r), ['done', 'done', 'ask', 'done', 'done', 'done'], 'a suggested card waits for the owner');
  assert.deepEqual(notes(r), ['eStmt.pdf', '6 pages', 'Test Card ···1111', '48 rows · Sep 12 – Oct 11', '41 of 48 sorted', 'Totals match']);
});

test('heads-ups: card not known, nothing in it, totals off, already on file', () => {
  const r = stageBoxes({
    fileType: 'PDF', uploaded: true, report: { reconciliation: { closing: false } },
    facts: { ...facts, card_known: 'none', rows: 0, sorted: 0, duplicates: 2, same_statement: { period_end: '2026-10-11' } },
  }, { today });
  assert.deepEqual(states(r), ['done', 'done', 'warn', 'warn', 'skip', 'warn']);
  assert.equal(r.boxes[2].note, 'Pick its card');
  assert.equal(r.boxes[2].title, "Test Card ···1111 isn't one of your cards yet");
  assert.equal(r.boxes[5].note, 'Already on file · 2 maybe duplicates · A total is off');
  assert.match(r.boxes[5].title, /closing Oct 11/);
});

test('a CSV on a named account', () => {
  const r = stageBoxes({ fileName: 'checking.csv', fileType: 'CSV', size: 4000, uploaded: true, facts: { ...facts, pages: null, card: null, card_known: 'confirmed', period: null, rows: 2, sorted: 2 } }, { accountName: 'Checking ···2222', today });
  assert.deepEqual(notes(r), ['checking.csv', 'Not needed', 'Checking ···2222', '2 rows', '2 of 2 sorted', 'No totals to check']);
});

test('a stop: the boxes before are done, the ones after never reached', () => {
  const locked = stageBoxes({ fileType: 'PDF', uploaded: true, error: { message: 'This PDF is password-protected. Enter the password and try again.', stage: 'open' } }, { today });
  assert.deepEqual(states(locked), ['done', 'stop', 'off', 'off', 'off', 'off']);
  assert.equal(locked.boxes[1].note, 'Has a password');
  assert.match(locked.message, /password-protected/);

  const repeat = stageBoxes({ fileType: 'PDF', uploaded: false, error: { message: 'This exact file was already imported', stage: 'upload' } }, { today });
  assert.deepEqual([repeat.boxes[0].state, repeat.boxes[0].note], ['stop', 'Already imported']);
  const known = stageBoxes({ fileType: 'PDF', uploaded: false, error: { message: 'This exact file was already imported', stage: 'upload', existing: { id: 4 } } }, { today });
  assert.equal(known.boxes[0].note, 'Already on file');

  const unknown = stageBoxes({ fileType: 'PDF', uploaded: true, error: { message: "The free reader doesn't know X statements yet.", stage: 'find' } }, { today });
  assert.deepEqual(states(unknown), ['done', 'done', 'stop', 'off', 'off', 'off']);

  const csvStop = stageBoxes({ fileType: 'CSV', uploaded: true, error: { message: 'Could not find a date column in the header row', stage: 'read' } }, { today });
  assert.deepEqual(states(csvStop), ['done', 'skip', 'skip', 'stop', 'off', 'off'], "a CSV's card isn't found before a stop");

  const noStage = stageBoxes({ fileType: 'PDF', uploaded: true, error: { message: 'timeout' } }, { today });
  assert.equal(noStage.boxes[3].state, 'stop', 'an answer with no stage stops while reading');
});
