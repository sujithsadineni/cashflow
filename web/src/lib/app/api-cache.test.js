import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiCache } from './api-cache.js';

// A clock and a task boundary the test moves by hand.
function setup(options = {}) {
  let time = 1000;
  let tasks = [];
  const cache = createApiCache({ now: () => time, nextTask: (fn) => tasks.push(fn), ...options });
  return {
    cache,
    advance: (ms) => { time += ms; },
    endTask: () => { const run = tasks; tasks = []; run.forEach((fn) => fn()); },
  };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('views asking for a key at once share one request, and keep its answer', async () => {
  const { cache } = setup();
  let calls = 0;
  const fetcher = async () => { calls += 1; return ['a']; };
  await Promise.all([cache.load('k', fetcher), cache.load('k', fetcher)]);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get('k').data, ['a']);
});

test('a key answered moments ago is not asked again, one answered earlier is', async () => {
  const { cache, advance, endTask } = setup();
  let calls = 0;
  const fetcher = async () => { calls += 1; return calls; };
  await cache.load('k', fetcher);
  endTask();
  advance(500);
  await cache.load('k', fetcher);
  assert.equal(calls, 1, 'still fresh');
  advance(2000);
  await cache.load('k', fetcher);
  assert.equal(calls, 2, 'asked again in the background');
  assert.equal(cache.get('k').data, 2);
});

test('a forced request is made even when fresh', async () => {
  const { cache, endTask } = setup();
  let calls = 0;
  const fetcher = async () => { calls += 1; return calls; };
  await cache.load('k', fetcher);
  endTask();
  await cache.load('k', fetcher, [], true);
  assert.equal(calls, 2);
});

test('a forced request after a save never shares one started before it, and the older reply is dropped', async () => {
  const { cache, endTask } = setup();
  const before = deferred();
  const after = deferred();
  const first = cache.load('k', () => before.promise);
  endTask(); // the save happens in a later task
  const second = cache.load('k', () => after.promise, [], true);
  assert.notEqual(first, second, 'a request of its own');
  after.resolve('after the save');
  await second;
  before.resolve('before the save');
  await first;
  assert.equal(cache.get('k').data, 'after the save', 'the late, older reply does not overwrite it');
});

test('a forced request in the same task shares the one just started (a badge and its page)', async () => {
  const { cache } = setup();
  let calls = 0;
  const fetcher = async () => { calls += 1; return 'x'; };
  await Promise.all([cache.load('k', fetcher), cache.load('k', fetcher, [], true)]);
  assert.equal(calls, 1);
});

test('forgetting a tag drops only the answers kept with it, from any view', async () => {
  const { cache } = setup();
  await cache.load('rows', async () => 1, ['transactions']);
  await cache.load('rows', async () => 1, ['loans'], true);
  await cache.load('people', async () => 2, ['reference']);
  cache.forget(['loans']);
  assert.equal(cache.get('rows'), undefined, 'tags from every view asking are kept together');
  assert.equal(cache.get('people').data, 2);
});

test('a failed request keeps nothing and lets the next one through', async () => {
  const { cache } = setup();
  await assert.rejects(cache.load('k', async () => { throw new Error('down'); }), /down/);
  assert.equal(cache.get('k'), undefined);
  await cache.load('k', async () => 'up');
  assert.equal(cache.get('k').data, 'up');
});

test('at most max answers are kept, the least recently kept go first', async () => {
  const { cache } = setup({ max: 2 });
  cache.keep('a', 1);
  cache.keep('b', 2);
  cache.keep('a', 3);
  cache.keep('c', 4);
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual([cache.get('a').data, cache.get('c').data], [3, 4]);
});

test('a change tells subscribers', () => {
  const { cache } = setup();
  let told = 0;
  const stop = cache.subscribe(() => { told += 1; });
  cache.keep('a', 1);
  cache.forget(['nothing']);
  stop();
  cache.keep('a', 2);
  assert.equal(told, 1, 'once for the keep; forgetting nothing and after unsubscribing say nothing');
});
