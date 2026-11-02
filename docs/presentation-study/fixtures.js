/* Synthetic design fixtures; these are not live integrations or wire records. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityStudyFixtures = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BASE_NOW = Math.floor(Date.UTC(2026, 10, 2, 12, 34, 0) / 1000);
  var PROVIDER = '00112233-4455-6677-8899-aabbccddeeff';

  function record(id, title, headline, facts, extra) {
    return Object.assign({
      id: id,
      provider: PROVIDER,
      revision: 1,
      kind: id,
      title: title,
      state: 'active',
      observedAt: BASE_NOW,
      validUntil: BASE_NOW + 7200,
      private: false,
      headline: headline,
      facts: facts
    }, extra || {});
  }

  function countdown(id, label, seconds, extra) {
    return Object.assign({id: id, label: label, type: 'clock', mode: 'deadline',
      state: 'active', deadline: BASE_NOW + seconds}, extra || {});
  }

  function elapsed(id, label, seconds, extra) {
    return Object.assign({id: id, label: label, type: 'clock', mode: 'elapsed',
      state: 'active', duration: seconds, clockAt: BASE_NOW}, extra || {});
  }

  var fixtures = [
    {id: 'timer', name: 'Cooking timer',
      description: 'A countdown is the chosen main content, in either Dynamic position.',
      record: record('timer', 'Pasta', 'remaining', [
        countdown('remaining', 'Remaining', 380, {shortLabel: 'Left'})
      ], {status: 'Cooking'})},
    {id: 'music', name: 'Music',
      description: 'Private text stays readable in every view and clears when unavailable.',
      record: record('music', 'Now playing', 'track', [
        {id: 'track', label: 'Track', type: 'text', text: 'Everything in Its Right Place'},
        {id: 'artist', label: 'Artist', type: 'text', text: 'Radiohead'},
        elapsed('position', 'Position', 102)
      ], {private: true, status: 'Playing'})},
    {id: 'workout', name: 'Workout with two clocks',
      description: 'Elapsed time and interval countdown have distinct labels and can be explicitly selected.',
      record: record('workout', 'Interval run', 'elapsed', [
        elapsed('elapsed', 'Elapsed', 1458),
        countdown('rest', 'Rest interval', 80, {shortLabel: 'Rest'}),
        {id: 'pace', label: 'Pace', type: 'value', display: '5:12', unit: '/km'},
        {id: 'distance', label: 'Distance', type: 'value', value: 4.67, unit: 'km'},
        {id: 'heart', label: 'Heart rate', shortLabel: 'Pulse', type: 'value', value: 142, unit: 'bpm'}
      ], {shortTitle: 'Run', status: 'Round 3 · Rest'})},
    {id: 'printer', name: '3D printer',
      description: 'One numeric observation drives the percentage and progress bar; ETA is separate.',
      record: record('printer', 'Boat print', 'complete', [
        {id: 'complete', label: 'Complete', type: 'value', value: 72, unit: '%'},
        countdown('finish', 'Estimated remaining', 2220, {shortLabel: 'ETA'}),
        {id: 'layer', label: 'Layer', type: 'value', display: '138 / 190'},
        {id: 'temperature', label: 'Nozzle', type: 'value', value: 205, unit: '°C'}
      ], {status: 'Printing', progress: {fact: 'complete', min: 0, max: 100}})},
    {id: 'train', name: 'Train departure',
      description: 'A structured departure clock updates locally; platform and delay remain observations.',
      record: record('train', 'Train to Prague', 'departure', [
        countdown('departure', 'Departure', 360, {shortLabel: 'Departs'}),
        {id: 'platform', label: 'Platform', type: 'value', display: '4B'},
        {id: 'service', label: 'Service', type: 'text', text: 'R 881'}
      ], {shortTitle: 'Prague', status: 'Delayed 4 min'})},
    {id: 'chess', name: 'Chess with independent clocks',
      description: 'The active match has one ticking player clock and one independently paused clock.',
      record: record('chess', 'Chess match', 'white', [
        countdown('white', 'White', 83),
        {id: 'black', label: 'Black', type: 'clock', mode: 'deadline', state: 'paused', duration: 252},
        {id: 'turn', label: 'Turn', type: 'text', text: 'White to move'}
      ], {shortTitle: 'Chess', status: 'White to move'})},
    {id: 'build', name: 'Job with unknown progress',
      description: 'A useful status requires neither an invented percentage nor a finish estimate.',
      record: record('build', 'Firmware build', 'stage', [
        {id: 'stage', label: 'Stage', type: 'text', text: 'Verifying'},
        {id: 'task', label: 'Task', type: 'text', text: 'Check packaged resources'}
      ], {shortTitle: 'Build'})},
    {id: 'oven', name: 'Oven with current and target values',
      description: 'The chosen current temperature keeps its label and unit; target and timer are distinct facts.',
      record: record('oven', 'Bread oven', 'current', [
        {id: 'current', label: 'Current', type: 'value', value: 180, unit: '°C'},
        {id: 'target', label: 'Target', type: 'value', value: 200, unit: '°C'},
        countdown('bake', 'Bake remaining', 1180, {shortLabel: 'Bake'})
      ], {status: 'Heating'})},
    {id: 'score', name: 'Formatted score',
      description: 'A compound score is readable display content, not a scalar percentage.',
      record: record('score', 'Sparta vs Slavia', 'score', [
        {id: 'score', label: 'Score', type: 'value', display: '2–1'},
        {id: 'period', label: 'Period', type: 'text', text: 'Second half'}
      ], {shortTitle: 'SPA–SLA', status: '68th minute'})},
    {id: 'navigation', name: 'Navigation without artwork',
      description: 'The text preserves the turn instruction even when no arrow or map can be displayed.',
      record: record('navigation', 'Walk to station', 'turn', [
        {id: 'turn', label: 'Next turn', shortLabel: 'Turn', type: 'text', text: 'Left in 200 m'},
        {id: 'street', label: 'Street', type: 'text', text: 'Nádražní'}
      ], {shortTitle: 'Station'})},
    {id: 'long', name: 'Long labels and 24-hour clock',
      description: 'Multibyte text and a 24-hour countdown test space without changing the selected information.',
      record: record('long', 'Příprava čaje před výletem do Špindlerova Mlýna', 'remaining', [
        countdown('remaining', 'Remaining preparation time', 86400, {shortLabel: 'Left'}),
        {id: 'detail', label: 'Destination', type: 'text', text: 'Špindlerův Mlýn · Svatý Petr'}
      ], {shortTitle: 'Čaj · Špindl', status: 'Příprava na zítřejší výlet', validUntil: BASE_NOW + 172800})}
  ];

  return {BASE_NOW: BASE_NOW, fixtures: fixtures};
}));
