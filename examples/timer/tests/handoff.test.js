'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helpers = require('../../../src/js/publisher');
const uuid = '50e9ef12-a5ab-4369-a3b5-3447bfba5151';
const now = 1800000000;

function storage(failing) {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failing) throw new Error('test storage failure');
      values.set(key, String(value));
    }
  };
}

function runtime(file, shared) {
  const events = {}, sent = [];
  let source;
  const pebble = {
    addEventListener(name, fn) { events[name] = fn; },
    sendAppMessage(message, success) {
      sent.push(JSON.parse(JSON.stringify(message)));
      success();
    },
    registerSourceHandler(fn) { source = fn; }
  };
  const api = {
    createPublisher(options) { return helpers.createPublisher(options); },
    createProvider(options) { return helpers.createProvider({...options, now: () => now * 1000}); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    Pebble: pebble, localStorage: shared,
    require(name) {
      assert.equal(name, 'pebble-activities/publisher');
      return api;
    }
  }, {filename: file});
  return {events, sent, source};
}

function snapshot(changes) {
  return {
    ACTIVITY_SCHEMA_VERSION: 1,
    ACTIVITY_RUN: '6b49d200:00000001',
    ACTIVITY_REVISION: 4,
    ACTIVITY_STATE: 'active',
    ACTIVITY_KIND: 'timer',
    ACTIVITY_CLOCK: 'deadline',
    ACTIVITY_NAME: 'Timer',
    ACTIVITY_MAIN: '',
    ACTIVITY_FOOTER: 'Timer',
    ACTIVITY_OBSERVED_AT: now,
    ACTIVITY_VALID_UNTIL: now + 660,
    ACTIVITY_DEADLINE: now + 600,
    ACTIVITY_DURATION: 0,
    ACTIVITY_CLOCK_AT: 0,
    ACTIVITY_PRIVATE: 0,
    ACTIVITY_PUBLISH_SESSION: 7,
    ...changes
  };
}

test('native payload is saved by PKJS and read by a separate cold plugin runtime', () => {
  const shared = storage();
  const pkjs = runtime('src/pkjs/index.js', shared);
  pkjs.events.ready();
  assert.deepEqual(pkjs.sent.shift(), {ACTIVITY_REQUEST: 1, ACTIVITY_LAST_REVISION: 0});
  pkjs.events.appmessage({payload: snapshot()});
  assert.equal(pkjs.sent[0].ACTIVITY_ACCEPTED_RUN, '6b49d200:00000001');
  assert.equal(pkjs.sent[0].ACTIVITY_ACCEPTED_REVISION, 4);
  assert.equal(pkjs.sent[0].ACTIVITY_PUBLISH_SESSION, 7);

  // This is a new plugin context after the timer's PKJS context has gone away.
  const plugin = runtime('src/plugin/index.js', shared);
  let answer;
  plugin.source({category: 'activity', item: 'session'}, {data(value) { answer = value; }});
  assert.equal(answer.instances.length, 1);
  const p = answer.instances[0].properties;
  assert.equal(p.deadline.timestamp.value, now + 600);
  assert.equal(p.observed_at.timestamp.value, now);
  assert.equal(p.valid_until.timestamp.value, now + 660);
  assert.equal(p.unconfirmed.boolean.value, true);

  const restart = runtime('src/pkjs/index.js', shared);
  restart.events.ready();
  assert.equal(restart.sent[0].ACTIVITY_LAST_REVISION, 4);
});

test('pause and cancel update the saved run without deriving completion on the phone', () => {
  const shared = storage();
  const pkjs = runtime('src/pkjs/index.js', shared);
  pkjs.events.appmessage({payload: snapshot()});
  pkjs.events.appmessage({payload: snapshot({ACTIVITY_REVISION: 5, ACTIVITY_STATE: 'paused',
    ACTIVITY_DEADLINE: 0, ACTIVITY_DURATION: 480})});
  let source = helpers.createProvider({storage: shared, pluginUuid: uuid, now: () => (now + 120) * 1000}).source({});
  assert.equal(source.instances[0].properties.duration.numericValue.value, 480);
  assert.equal(source.instances[0].properties.state.shortText.text, 'paused');
  pkjs.events.appmessage({payload: snapshot({ACTIVITY_REVISION: 6, ACTIVITY_STATE: 'cancelled',
    ACTIVITY_CLOCK: 'none', ACTIVITY_DEADLINE: 0})});
  source = helpers.createProvider({storage: shared, pluginUuid: uuid, now: () => (now + 120) * 1000}).source({});
  assert.equal(source.instances[0].properties.state.shortText.text, 'cancelled');
  // An older queued running snapshot must not overwrite that cancellation.
  pkjs.events.appmessage({payload: snapshot()});
  assert.equal(pkjs.sent.at(-1).ACTIVITY_ERROR, 'STALE_REVISION');
  assert.equal(pkjs.sent.at(-1).ACTIVITY_RUN, '6b49d200:00000001');
  assert.equal(pkjs.sent.at(-1).ACTIVITY_REVISION, 4);
});

test('storage failure never emits a successful application receipt', () => {
  const pkjs = runtime('src/pkjs/index.js', storage(true));
  pkjs.events.appmessage({payload: snapshot()});
  assert.equal(pkjs.sent.length, 1);
  assert.equal(pkjs.sent[0].ACTIVITY_ERROR, 'STORAGE_FAILED');
  assert.equal(pkjs.sent[0].ACTIVITY_ACCEPTED_REVISION, undefined);
});

test('polling does not renew the original native lease', () => {
  const shared = storage();
  const pkjs = runtime('src/pkjs/index.js', shared);
  pkjs.events.appmessage({payload: snapshot()});
  const provider = helpers.createProvider({storage: shared, pluginUuid: uuid, now: () => (now + 661) * 1000});
  assert.deepEqual(provider.source({}).instances, []);
});
