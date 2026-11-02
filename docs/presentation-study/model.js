/* Experimental presentation study. Not the version 1 provider or ACT1 API. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ActivityStudy = api;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Study budgets, not proposed wire limits.
  var LIMITS = { facts: 6, title: 128, shortTitle: 48, text: 192, label: 64,
    shortLabel: 32, status: 96, unit: 16, factId: 32, runId: 64 };
  var DETAIL_COUNTS = { primary: 1, secondary: 0, row: 0, detail: 5 };
  var MAX_UINT = 4294967295;

  function uint(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_UINT;
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function text(value, limit, required) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string') return null;
    var clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if ((required && !clean) || new TextEncoder().encode(clean).length > limit) return null;
    return clean;
  }

  function absentOrZero(value) {
    return value === undefined || value === 0;
  }

  function validClock(fact, record) {
    if (fact.state !== 'active' && fact.state !== 'paused') return false;
    if (record.state === 'paused' && fact.state !== 'paused') return false;
    if (fact.mode === 'deadline') {
      if (!absentOrZero(fact.clockAt)) return false;
      return fact.state === 'active'
        ? uint(fact.deadline) && fact.deadline > 0 && absentOrZero(fact.duration)
        : absentOrZero(fact.deadline) && uint(fact.duration);
    }
    if (fact.mode === 'elapsed') {
      if (!absentOrZero(fact.deadline) || !uint(fact.duration)) return false;
      return fact.state === 'active'
        ? uint(fact.clockAt) && fact.clockAt > 0 && fact.clockAt <= record.observedAt
        : absentOrZero(fact.clockAt);
    }
    return false;
  }

  function validFact(fact, record) {
    if (!fact || typeof fact !== 'object' ||
        !text(fact.id, LIMITS.factId, true) || !text(fact.label, LIMITS.label, true) ||
        text(fact.shortLabel, LIMITS.shortLabel, false) === null) return false;
    if (fact.type === 'text') return !!text(fact.text, LIMITS.text, true);
    if (fact.type === 'value') {
      // A derived bar and displayed scalar must never carry conflicting copies.
      if (fact.value !== undefined && fact.display !== undefined) return false;
      return (fact.value === undefined || finite(fact.value)) &&
        text(fact.unit, LIMITS.unit, false) !== null &&
        text(fact.display, LIMITS.text, false) !== null &&
        (finite(fact.value) || !!text(fact.display, LIMITS.text, true));
    }
    return fact.type === 'clock' && validClock(fact, record);
  }

  function validRecord(record) {
    if (!record || typeof record !== 'object' ||
        typeof record.provider !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.provider) ||
        !text(record.id, LIMITS.runId, true) || !text(record.kind, 24, true) ||
        !uint(record.revision) || record.revision === 0 ||
        !text(record.title, LIMITS.title, true) ||
        text(record.shortTitle, LIMITS.shortTitle, false) === null ||
        text(record.status, LIMITS.status, false) === null ||
        !uint(record.observedAt) || record.observedAt === 0 ||
        !uint(record.validUntil) || record.validUntil < record.observedAt ||
        !['active', 'paused', 'completed', 'cancelled'].includes(record.state) ||
        (record.private !== undefined && typeof record.private !== 'boolean') ||
        (record.unconfirmed !== undefined && typeof record.unconfirmed !== 'boolean') ||
        !Array.isArray(record.facts) || record.facts.length < 1 || record.facts.length > LIMITS.facts) return false;
    var ids = new Set();
    for (var fact of record.facts) {
      if (!validFact(fact, record) || ids.has(fact.id)) return false;
      ids.add(fact.id);
    }
    return ids.has(record.headline);
  }

  function clockSeconds(fact, observedAt, now) {
    if (fact.state === 'paused') return fact.duration;
    if (fact.mode === 'deadline') return Math.max(0, fact.deadline - Math.max(now, observedAt));
    return Math.min(MAX_UINT, fact.duration + Math.max(0, now - fact.clockAt));
  }

  function formatClock(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds / 60) % 60;
    var rest = String(seconds % 60).padStart(2, '0');
    return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + rest
      : Math.floor(seconds / 60) + ':' + rest;
  }

  function factView(fact, record, now, compact) {
    var result = { id: fact.id, type: fact.type,
      label: text(compact && fact.shortLabel ? fact.shortLabel : fact.label, LIMITS.label, true) };
    if (fact.type === 'text') result.text = text(fact.text, LIMITS.text, true);
    if (fact.type === 'value') {
      result.text = (fact.display || String(fact.value)) + (fact.unit ? ' ' + fact.unit : '');
      result.text = text(result.text, LIMITS.text + LIMITS.unit + 1, true);
    }
    if (fact.type === 'clock') {
      result.seconds = clockSeconds(fact, record.observedAt, now);
      result.text = formatClock(result.seconds);
      result.due = fact.mode === 'deadline' && fact.state === 'active' && result.seconds === 0;
      result.paused = fact.state === 'paused';
    }
    return result;
  }

  function progressView(record) {
    var spec = record.progress;
    if (!spec || !finite(spec.min) || !finite(spec.max) || spec.max <= spec.min) return null;
    var source = record.facts.find(function (fact) { return fact.id === spec.fact; });
    if (!source || source.type !== 'value' || !finite(source.value) ||
        source.value < spec.min || source.value > spec.max) return null;
    return { factId: source.id, value: source.value, min: spec.min, max: spec.max,
      label: text(source.label, LIMITS.label, true),
      fraction: (source.value - spec.min) / (spec.max - spec.min) };
  }

  function hidden(reason) { return { visible: false, reason: reason }; }

  function project(record, options) {
    options = options || {};
    var now = options.now === undefined ? Math.floor(Date.now() / 1000) : options.now;
    var surface = options.surface || 'primary';
    if (!uint(now) || !Object.prototype.hasOwnProperty.call(DETAIL_COUNTS, surface)) return hidden('invalid-context');
    if (options.allowed === false) return hidden('permission-denied');
    if (options.withdrawn === true) return hidden('withdrawn');
    if (!validRecord(record)) return hidden('invalid-record');
    if (record.state === 'completed' || record.state === 'cancelled') return hidden('terminal');
    if (record.validUntil <= now) return hidden('expired');

    var selected = options.headlineId === undefined ? record.headline : options.headlineId;
    var main = record.facts.find(function (fact) { return fact.id === selected; });
    if (!main) return hidden('invalid-headline');
    var cached = options.connected === false || options.sourceAvailable === false ||
      record.unconfirmed === true;
    var privateContent = record.private !== false ||
      ['music', 'notification', 'notifications'].includes(record.kind.toLowerCase());
    if (cached && (privateContent || main.type !== 'clock')) return hidden('unavailable');

    var compact = surface === 'secondary' || surface === 'row';
    var headline = factView(main, record, now, compact);
    var badges = [];
    if (cached) badges.push('Last reported');
    if (headline.due) badges.push('Due · unconfirmed');
    if (record.state === 'paused' || headline.paused) badges.push('Paused');
    return {
      visible: true,
      identity: record.provider + '/' + record.id,
      state: record.state,
      title: text(record.title, LIMITS.title, true),
      shortTitle: text(record.shortTitle || record.title, LIMITS.title, true),
      status: cached ? '' : text(record.status, LIMITS.status, false),
      badge: badges.join(' · '),
      headline: headline,
      details: cached ? [] : record.facts.filter(function (fact) { return fact.id !== selected; })
        .slice(0, DETAIL_COUNTS[surface]).map(function (fact) { return factView(fact, record, now, false); }),
      progress: cached || compact ? null : progressView(record),
      observedAt: record.observedAt,
      unconfirmed: cached || !!headline.due
    };
  }

  return { project: project, formatClock: formatClock, LIMITS: LIMITS };
}));
