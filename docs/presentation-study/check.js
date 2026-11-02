/* Contract experiment checks. Run: node docs/presentation-study/check.js */
'use strict';

var assert = require('node:assert/strict');
var study = require('./model.js');
var data = require('./fixtures.js');
var BASE = data.BASE_NOW;
var surfaces = ['primary', 'secondary', 'row', 'detail'];
var passed = 0;
var failed = 0;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fixture(id) { return clone(data.fixtures.find(function (f) { return f.id === id; }).record); }
function view(record, extra) {
  return study.project(record, Object.assign({now: BASE, surface: 'detail', connected: true,
    allowed: true, withdrawn: false}, extra || {}));
}
function check(name, fn) {
  try { fn(); passed++; }
  catch (error) { failed++; process.stderr.write('FAIL: ' + name + '\n' + error.stack + '\n'); }
}

data.fixtures.forEach(function (f) {
  check(f.id + ': same selected information in every host size', function () {
    var source = clone(f.record);
    var before = clone(source);
    var outputs = surfaces.map(function (surface) { return view(source, {surface: surface}); });
    outputs.forEach(function (output) {
      assert.equal(output.visible, true);
      assert.equal(output.identity, source.provider + '/' + source.id);
      assert.equal(output.headline.id, source.headline);
      assert.ok(output.headline.label);
      assert.ok(output.headline.text);
      assert.equal(output.observedAt, source.observedAt);
    });
    assert.deepEqual(outputs.map(function (output) { return output.headline.text; }),
      outputs.map(function () { return outputs[0].headline.text; }));
    assert.deepEqual(source, before, 'projection must not mutate source snapshots');
  });
});

check('explicit metric selection applies consistently across hosts', function () {
  var source = fixture('workout');
  surfaces.forEach(function (surface) {
    var output = view(source, {surface: surface, headlineId: 'rest'});
    assert.equal(output.visible, true);
    assert.equal(output.headline.id, 'rest');
    assert.match(output.headline.label, /Rest/);
    assert.equal(output.headline.seconds, 80);
  });
  assert.equal(view(source, {headlineId: 'missing'}).visible, false);
  source.headline = 'missing';
  assert.equal(view(source).visible, false, 'an invalid provider headline must not pick an unrelated fact');
});

check('independent player clocks respect each clock state', function () {
  var source = fixture('chess');
  var white = view(source, {now: BASE + 10});
  var black = view(source, {now: BASE + 10, headlineId: 'black'});
  assert.equal(white.headline.seconds, 73);
  assert.equal(black.headline.seconds, 252);
  assert.equal(source.state, 'active');
});

check('paused record cannot contain an active clock', function () {
  var source = fixture('timer');
  source.state = 'paused';
  assert.equal(view(source).visible, false);
  source.facts[0] = {id: 'remaining', label: 'Left', type: 'clock', mode: 'deadline',
    state: 'paused', duration: 380};
  assert.equal(view(source, {now: BASE + 45}).headline.seconds, 380);
});

check('time anchors update elapsed clocks without refreshing observations', function () {
  var source = fixture('workout');
  var output = view(source, {now: BASE + 20});
  assert.equal(output.headline.seconds, 1478);
  assert.equal(output.observedAt, BASE);
  assert.equal(source.revision, 1);
});

check('backward wall-clock change preserves the observed clock base', function () {
  var source = fixture('workout');
  var output = view(source, {now: BASE - 30});
  assert.equal(output.visible, true);
  assert.equal(output.headline.seconds, 1458);
  assert.equal(view(fixture('timer'), {now: BASE - 30}).headline.seconds, 380);
});

check('elapsed anchor later than source observation is incoherent', function () {
  var source = fixture('workout');
  source.facts[0].clockAt = BASE + 1;
  assert.equal(view(source).visible, false);
});

check('clock due is an unconfirmed estimate, never a terminal source update', function () {
  var source = fixture('timer');
  var output = view(source, {now: BASE + 380});
  assert.equal(output.visible, true);
  assert.equal(output.headline.seconds, 0);
  assert.equal(output.headline.due, true);
  assert.match(output.badge, /Due/);
  assert.equal(output.state, 'active');
  assert.equal(source.state, 'active');
  assert.equal(source.revision, 1);
});

check('clock formatting covers hours and multi-day countdowns', function () {
  assert.equal(view(fixture('long')).headline.text, '24:00:00');
  var source = fixture('long');
  source.facts[0].deadline = BASE + 90061;
  assert.equal(view(source).headline.text, '25:01:01');
});

check('progress bar and headline derive from the same numeric fact', function () {
  var source = fixture('printer');
  var output = view(source);
  assert.equal(output.progress.factId, 'complete');
  assert.equal(output.progress.value, 72);
  assert.equal(output.progress.fraction, 0.72);
  assert.match(output.headline.text, /72/);
  source.facts[0].value = 81;
  source.revision++;
  output = view(source);
  assert.equal(output.progress.fraction, 0.81);
  assert.match(output.headline.text, /81/);
});

check('invalid progress data cannot invent a plausible bar', function () {
  var source = fixture('printer');
  source.progress.max = source.progress.min;
  var output = view(source);
  assert.ok(!output.visible || output.progress === null);
  source = fixture('score');
  source.progress = {fact: 'score', min: 0, max: 100};
  output = view(source);
  assert.ok(!output.visible || output.progress === null);
  [-1, 101].forEach(function (value) {
    var outside = fixture('printer');
    outside.facts[0].value = value;
    var outsideOutput = view(outside);
    assert.ok(!outsideOutput.visible || outsideOutput.progress === null,
      'an out-of-range observation must not be clamped into a valid-looking bar');
  });
});

check('a scalar and an independent formatted copy cannot contradict progress', function () {
  var source = fixture('printer');
  source.facts[0].display = '99';
  assert.equal(view(source).visible, false);
});

check('reserved private kinds remain private regardless of letter case', function () {
  ['Music', 'NOTIFICATION', 'Notifications'].forEach(function (kind) {
    var source = fixture('timer');
    source.kind = kind;
    source.private = false;
    assert.equal(view(source, {connected: false}).visible, false);
  });
});

check('unknown work remains useful without invented progress or ETA', function () {
  var output = view(fixture('build'));
  assert.equal(output.headline.text, 'Verifying');
  assert.equal(output.progress, null);
  assert.ok(output.details.every(function (fact) { return fact.type !== 'clock'; }));
});

check('value labels, units, compound displays and navigation meaning survive compact projection', function () {
  var oven = view(fixture('oven'), {surface: 'secondary'});
  assert.match(oven.headline.label, /Current/);
  assert.match(oven.headline.text, /180/);
  assert.match(oven.headline.text, /°C/);
  var pace = view(fixture('workout'), {surface: 'secondary', headlineId: 'pace'});
  assert.match(pace.headline.text, /5:12/);
  assert.match(pace.headline.text, /\/km/);
  assert.equal(view(fixture('score'), {surface: 'row'}).headline.text, '2–1');
  assert.equal(view(fixture('navigation'), {surface: 'secondary'}).headline.text, 'Left in 200 m');
});

check('public cached clock keeps only estimated time and necessary identity', function () {
  var source = fixture('train');
  var output = view(source, {connected: false, now: BASE + 20});
  assert.equal(output.visible, true);
  assert.equal(output.headline.seconds, 340);
  assert.equal(output.unconfirmed, true);
  assert.match(output.badge, /Last reported/);
  assert.equal(output.details.length, 0);
  assert.ok(!output.status);
  assert.equal(output.progress, null);
  assert.equal(output.observedAt, BASE);
});

check('fresh connection does not confirm a last-reported snapshot', function () {
  var source = fixture('train');
  source.unconfirmed = true;
  var output = view(source, {connected: true});
  assert.equal(output.visible, true);
  assert.equal(output.unconfirmed, true);
  assert.match(output.badge, /Last reported/);
  assert.equal(output.details.length, 0);
  assert.ok(!output.status);
});

check('a connected phone does not make a failed provider available', function () {
  var source = fixture('train');
  var output = view(source, {connected: true, sourceAvailable: false});
  assert.equal(output.visible, true);
  assert.match(output.badge, /Last reported/);
  assert.equal(output.details.length, 0);
  assert.equal(output.progress, null);
  assert.equal(view(fixture('printer'), {connected: true, sourceAvailable: false}).visible, false);
});

check('local completion uncertainty does not make a private live source unavailable', function () {
  var source = fixture('timer');
  source.private = true;
  var output = view(source, {now: BASE + 380});
  assert.equal(output.visible, true);
  assert.equal(output.headline.due, true);
  assert.equal(source.unconfirmed, undefined);
  source.unconfirmed = true;
  assert.equal(view(source, {now: BASE + 380}).visible, false);
});

check('public value headline does not silently switch to a cached clock', function () {
  var source = fixture('printer');
  assert.equal(view(source, {connected: false}).visible, false);
  var selectedClock = view(source, {connected: false, headlineId: 'finish'});
  assert.equal(selectedClock.visible, true);
  assert.equal(selectedClock.headline.id, 'finish');
  assert.equal(selectedClock.details.length, 0);
  assert.equal(selectedClock.progress, null);
});

check('private data clears on unavailability or uncertainty', function () {
  var source = fixture('music');
  assert.equal(view(source, {connected: false}).visible, false);
  source.unconfirmed = true;
  assert.equal(view(source).visible, false);
  source = fixture('timer');
  delete source.private;
  assert.equal(view(source, {connected: false}).visible, false, 'privacy defaults to private');
});

check('expiry, denial and withdrawal override public-clock retention', function () {
  var source = fixture('train');
  assert.equal(view(source, {connected: false, now: source.validUntil}).visible, false);
  assert.equal(view(source, {connected: false, allowed: false}).visible, false);
  assert.equal(view(source, {connected: false, withdrawn: true}).visible, false);
});

check('terminal results retract rather than become implicit Dashboard history', function () {
  ['completed', 'cancelled'].forEach(function (state) {
    var source = fixture('timer');
    source.state = state;
    surfaces.forEach(function (surface) { assert.equal(view(source, {surface: surface}).visible, false); });
  });
});

check('kind is semantic metadata, not a domain-specific layout selector', function () {
  var original = fixture('oven');
  var other = clone(original);
  other.kind = 'a-new-provider-domain';
  surfaces.forEach(function (surface) {
    assert.deepEqual(view(original, {surface: surface}), view(other, {surface: surface}));
  });
  var music = fixture('timer');
  music.kind = 'music';
  music.private = false;
  assert.equal(view(music, {connected: false}).visible, false, 'music always remains private');
});

check('duplicate facts, missing identity and oversize fact collections fail closed', function () {
  var source = fixture('timer');
  source.facts.push(clone(source.facts[0]));
  assert.equal(view(source).visible, false);
  source = fixture('timer');
  source.provider = '';
  assert.equal(view(source).visible, false);
  source = fixture('timer');
  for (var i = 0; i < 6; i++) source.facts.push({id: 'extra-' + i, label: 'Extra', type: 'text', text: 'Extra'});
  assert.equal(view(source).visible, false);
});

check('unsupported required content cannot silently select a different fact', function () {
  var source = fixture('printer');
  source.facts[0].type = 'unsupported-graphic';
  assert.equal(view(source).visible, false);
});

check('identity and observation metadata must be coherent', function () {
  ['00112233445566778899aabbccddeeff', '00112233-4455-6677-8899-AABBCCDDEEFF',
    'not-a-provider'].forEach(function (provider) {
    var source = fixture('timer');
    source.provider = provider;
    assert.equal(view(source).visible, false);
  });
  var source = fixture('timer');
  source.observedAt = 0;
  assert.equal(view(source).visible, false);
  source = fixture('timer');
  source.validUntil = source.observedAt - 1;
  assert.equal(view(source).visible, false);
});

process.stdout.write(JSON.stringify({fixtures: data.fixtures.length, surfaces: surfaces.length,
  passed: passed, failed: failed}) + '\n');
if (failed) process.exitCode = 1;
