(function () {
  'use strict';

  var fixtureData = window.ActivityStudyFixtures;
  var model = window.ActivityStudy;
  var statusNode = document.getElementById('study-status');
  var reportNode = document.getElementById('study-report');
  if (!fixtureData || !model) {
    statusNode.textContent = 'Study data or model is unavailable. Keep all files in the same folder.';
    statusNode.dataset.check = 'failed';
    return;
  }

  var surfaces = ['primary', 'secondary', 'row', 'detail'];
  var fixtureSelect = document.getElementById('fixture');
  var headlineSelect = document.getElementById('headline');
  var themeSelect = document.getElementById('theme');
  var timeInput = document.getElementById('time');
  var connectedInput = document.getElementById('connected');
  var confirmedInput = document.getElementById('confirmed');
  var allowedInput = document.getElementById('allowed');
  var withdrawnInput = document.getElementById('withdrawn');
  var terminalInput = document.getElementById('terminal');
  var lastProjections = [];
  var sweepRunning = false;

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function option(value, text) {
    var el = node('option', '', text);
    el.value = value;
    return el;
  }

  fixtureData.fixtures.forEach(function (fixture, index) {
    fixtureSelect.appendChild(option(String(index), fixture.name));
  });

  function currentFixture() {
    return fixtureData.fixtures[Number(fixtureSelect.value) || 0];
  }

  function refreshChoices() {
    var record = currentFixture().record;
    headlineSelect.replaceChildren(option('', "Provider's choice"));
    record.facts.forEach(function (fact) {
      headlineSelect.appendChild(option(fact.id, fact.label));
    });
    confirmedInput.checked = !record.unconfirmed;
    connectedInput.checked = true;
    allowedInput.checked = true;
    withdrawnInput.checked = false;
    terminalInput.checked = false;
    timeInput.value = '0';
  }

  function state() {
    var record = JSON.parse(JSON.stringify(currentFixture().record));
    record.unconfirmed = !confirmedInput.checked;
    if (terminalInput.checked) record.state = 'completed';
    return {
      record: record,
      options: {
        now: fixtureData.BASE_NOW + Number(timeInput.value),
        connected: true,
        sourceAvailable: connectedInput.checked,
        allowed: allowedInput.checked,
        withdrawn: withdrawnInput.checked,
        headlineId: headlineSelect.value || undefined
      }
    };
  }

  function faceTop(now, secondary) {
    var top = node('div', 'face-top' + (secondary ? ' secondary-top' : ''));
    var date = new Date(now * 1000);
    top.appendChild(node('div', 'face-clock', String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0')));
    top.appendChild(node('div', 'face-date', date.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'})));
    var readings = node('div', 'readings');
    readings.append(node('span', '', '18°'), node('span', '', '4,250'));
    top.appendChild(readings);
    return top;
  }

  function markActivity(el, projection) {
    el.dataset.identity = projection.identity || '';
    el.dataset.headline = projection.headline.id;
    el.classList.add('surface-activity');
    return el;
  }

  function fit(el, essential, max, min) {
    el.dataset.fit = essential ? 'essential' : 'elidable';
    if (max) el.dataset.maxFont = String(max);
    if (min) el.dataset.minFont = String(min);
    return el;
  }

  function title(projection) {
    return fit(node('div', 'activity-title', projection.title), false);
  }

  function badge(projection, className) {
    return fit(node('div', className || 'badge', projection.badge || projection.status || ''), !!projection.badge, 10, 9);
  }

  function mainContent(projection) {
    var fact = projection.headline;
    var label = fit(node('div', 'main-label', fact.label), true, 12, 10);
    var content = fit(node('div', 'main-value' + (fact.type === 'text' ? ' text' : ''), fact.text), true, 43, 20);
    return [label, content];
  }

  function factLabel(fact) {
    return fact.label + (fact.paused ? ' · Paused' : fact.due ? ' · Due' : '');
  }

  function progress(projection) {
    if (!projection.progress) return null;
    var bar = node('div', 'progress');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', projection.progress.label + ': ' + Math.round(projection.progress.fraction * 100) + '%');
    var fill = node('div', 'progress-fill');
    fill.style.width = Math.max(0, Math.min(1, projection.progress.fraction)) * 100 + '%';
    bar.appendChild(fill);
    return bar;
  }

  function humanReason(reason) {
    var names = {
      private: 'Private content is unavailable.',
      unavailable: 'The source is unavailable.',
      unconfirmed: 'The source has not confirmed this information.',
      expired: 'The original observation has expired.',
      denied: 'Permission was withdrawn.',
      permission: 'Permission was withdrawn.',
      'permission-denied': 'Permission was withdrawn.',
      withdrawn: 'The source withdrew this activity.',
      terminal: 'The source ended this activity.',
      completed: 'The source ended this activity.',
      cancelled: 'The source cancelled this activity.',
      invalid: 'This record cannot provide a valid summary.'
    };
    return names[reason] || 'No valid activity is available.';
  }

  function empty(projection, className) {
    var el = node('div', className + ' empty');
    el.append(node('strong', '', 'No activity'), node('span', '', humanReason(projection.reason)));
    return el;
  }

  function renderPrimary(screen, projection, now) {
    screen.appendChild(faceTop(now, false));
    if (!projection.visible) {
      screen.appendChild(empty(projection, 'primary-activity'));
      return;
    }
    var body = markActivity(node('div', 'primary-activity'), projection);
    body.appendChild(title(projection));
    mainContent(projection).forEach(function (el) { body.appendChild(el); });
    body.appendChild(badge(projection));
    var bar = progress(projection);
    if (bar) body.appendChild(bar);
    if (projection.details.length) {
      var detail = projection.details[0];
      body.appendChild(fit(node('div', 'support', factLabel(detail) + ' · ' + detail.text), false));
    }
    screen.appendChild(body);
  }

  function compact(projection, className) {
    var body = markActivity(node('div', className), projection);
    var textMain = projection.headline.type === 'text';
    if (textMain) {
      body.classList.add('text-summary');
      var heading = node('div', 'compact-text-heading');
      heading.appendChild(fit(node('div', 'compact-label', projection.headline.label), true, 11, 9));
      heading.appendChild(fit(node('div', 'compact-title', projection.shortTitle || projection.title), false));
      body.appendChild(heading);
    } else {
      body.appendChild(fit(node('div', 'compact-title', projection.shortTitle || projection.title), false));
    }
    var line = node('div', 'compact-line');
    if (!textMain) line.appendChild(fit(node('div', 'compact-label', projection.headline.label), true, className === 'list-row' ? 12 : 11, 9));
    var maxFont = textMain ? (className === 'list-row' ? 14 : 12) : (className === 'list-row' ? 20 : 17);
    line.appendChild(fit(node('div', 'compact-value' + (textMain ? ' text' : ''), projection.headline.text), true, maxFont, 11));
    body.appendChild(line);
    body.appendChild(badge(projection, 'compact-badge'));
    return body;
  }

  function renderSecondary(screen, projection, now) {
    screen.appendChild(faceTop(now, true));
    screen.appendChild(projection.visible ? compact(projection, 'secondary-activity') : empty(projection, 'secondary-activity'));
    var other = node('div', 'other-activity');
    other.append(node('p', '', 'Another activity'), node('span', '', 'Independent primary position'));
    screen.appendChild(other);
  }

  function renderRow(screen, projection) {
    screen.appendChild(node('div', 'app-header', 'Dashboard · Activities'));
    screen.appendChild(projection.visible ? compact(projection, 'list-row') : empty(projection, 'list-row'));
    var first = node('div', 'neutral-row');
    first.append(node('strong', '', 'Other information'), node('span', '', 'Independent source'));
    var second = node('div', 'neutral-row');
    second.append(node('strong', '', 'Another activity'), node('span', '', 'Separate identity and lifecycle'));
    screen.append(first, second);
  }

  function renderDetail(screen, projection) {
    screen.appendChild(node('div', 'app-header', 'Dashboard · Activity detail'));
    if (!projection.visible) {
      var blank = empty(projection, 'detail-scroll');
      screen.appendChild(blank);
      return;
    }
    var body = markActivity(node('div', 'detail-scroll'), projection);
    body.appendChild(title(projection));
    mainContent(projection).forEach(function (el) { body.appendChild(el); });
    body.appendChild(badge(projection));
    var bar = progress(projection);
    if (bar) body.appendChild(bar);
    projection.details.forEach(function (fact) {
      var row = node('div', 'detail-fact');
      row.appendChild(fit(node('div', 'detail-fact-label', factLabel(fact)), true, 11, 9));
      row.appendChild(fit(node('div', 'detail-fact-value', fact.text), true, 17, 11));
      body.appendChild(row);
    });
    screen.appendChild(body);
  }

  function fitContent() {
    document.querySelectorAll('[data-max-font]').forEach(function (el) {
      var font = Number(el.dataset.maxFont);
      var min = Number(el.dataset.minFont);
      if (el.classList.contains('text')) font = Math.min(font, 23);
      el.style.fontSize = font + 'px';
      while (font > min && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        font--;
        el.style.fontSize = font + 'px';
      }
    });
  }

  function render() {
    var selected = state();
    var fixture = currentFixture();
    document.getElementById('case-description').textContent = fixture.description;
    document.getElementById('time-output').textContent = timeInput.value + ' seconds';
    document.getElementById('selection-note').textContent = headlineSelect.value ? 'Consumer override: ' + headlineSelect.selectedOptions[0].textContent + '. The provider record is unchanged.' : "All views use the provider's selected main fact.";
    lastProjections = surfaces.map(function (surface) {
      var opts = Object.assign({}, selected.options, {surface: surface});
      var projection = model.project(selected.record, opts);
      var screen = document.getElementById(surface + '-screen');
      screen.replaceChildren();
      screen.classList.toggle('dark', themeSelect.value === 'dark');
      if (surface === 'primary') renderPrimary(screen, projection, selected.options.now);
      if (surface === 'secondary') renderSecondary(screen, projection, selected.options.now);
      if (surface === 'row') renderRow(screen, projection);
      if (surface === 'detail') renderDetail(screen, projection);
      return projection;
    });
    fitContent();
    if (!sweepRunning) {
      var result = studyCheck();
      statusNode.dataset.check = result.errors.length ? 'failed' : 'passed';
      statusNode.textContent = result.errors.length ? result.errors.length + ' layout issue(s) detected.' : 'Four projections agree. Essential text fits; ' + result.elisions.length + ' optional text item(s) may be shortened.';
      reportNode.textContent = JSON.stringify(result);
    }
  }

  function studyCheck() {
    var errors = [];
    var elisions = [];
    var visible = lastProjections.filter(function (p) { return p.visible; });
    if (visible.length !== 0 && visible.length !== surfaces.length) errors.push('Visibility differs by surface.');
    if (visible.length) {
      var expected = visible[0].headline.id;
      visible.forEach(function (p) {
        if (p.headline.id !== expected || p.headline.text !== visible[0].headline.text) errors.push('Selected headline differs by surface.');
      });
    }
    document.querySelectorAll('[data-fit]').forEach(function (el) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        var surface = el.closest('.screen').dataset.surface;
        var message = surface + ': ' + el.className + ' (' + el.textContent.slice(0, 60) + ')';
        if (el.dataset.fit === 'essential') errors.push(message);
        else elisions.push(message);
      }
    });
    document.querySelectorAll('.screen').forEach(function (screen) {
      if (screen.scrollWidth > screen.clientWidth + 1 || screen.scrollHeight > screen.clientHeight + 1) errors.push(screen.dataset.surface + ': screen contents exceed viewport.');
    });
    return {errors: errors, elisions: elisions, visible: visible.length, fixture: currentFixture().id, theme: themeSelect.value};
  }

  function sweep() {
    sweepRunning = true;
    var original = fixtureSelect.value;
    var report = {cases: 0, errors: [], elisions: 0, fixtures: fixtureData.fixtures.length, themes: 2};
    var scenarios = [
      {name: 'fresh'},
      {name: 'advanced', offset: 600},
      {name: 'unavailable', connected: false},
      {name: 'last-reported', confirmed: false},
      {name: 'private-unavailable', connected: false, private: true},
      {name: 'expired', expired: true},
      {name: 'denied', allowed: false},
      {name: 'withdrawn', withdrawn: true},
      {name: 'terminal', terminal: true}
    ];
    fixtureData.fixtures.forEach(function (fixture, index) {
      ['light', 'dark'].forEach(function (theme) {
        scenarios.forEach(function (scenario) {
          fixtureSelect.value = String(index);
          refreshChoices();
          themeSelect.value = theme;
          timeInput.value = String(scenario.offset || 0);
          connectedInput.checked = scenario.connected !== false;
          confirmedInput.checked = scenario.confirmed !== false;
          allowedInput.checked = scenario.allowed !== false;
          withdrawnInput.checked = scenario.withdrawn === true;
          terminalInput.checked = scenario.terminal === true;
          var originalPrivate = fixture.record.private;
          var originalValidity = fixture.record.validUntil;
          if (scenario.private) fixture.record.private = true;
          if (scenario.expired) fixture.record.validUntil = fixtureData.BASE_NOW;
          render();
          var result = studyCheck();
          if (scenario.private) fixture.record.private = originalPrivate;
          if (scenario.expired) fixture.record.validUntil = originalValidity;
          report.cases++;
          report.elisions += result.elisions.length;
          result.errors.forEach(function (error) { report.errors.push(fixture.id + ' / ' + theme + ' / ' + scenario.name + ': ' + error); });
        });
        fixture.record.facts.forEach(function (fact) {
          fixtureSelect.value = String(index);
          refreshChoices();
          themeSelect.value = theme;
          headlineSelect.value = fact.id;
          render();
          var result = studyCheck();
          report.cases++;
          report.elisions += result.elisions.length;
          result.errors.forEach(function (error) { report.errors.push(fixture.id + ' / ' + theme + ' / override ' + fact.id + ': ' + error); });
        });
      });
    });
    fixtureSelect.value = original;
    refreshChoices();
    themeSelect.value = 'light';
    render();
    sweepRunning = false;
    statusNode.dataset.check = report.errors.length ? 'failed' : 'passed';
    statusNode.textContent = report.errors.length ? report.errors.length + ' issue(s) across ' + report.cases + ' browser scenarios.' : 'Passed ' + report.cases + ' browser scenarios across ' + report.fixtures + ' examples and two themes. Native rendering remains unverified.';
    reportNode.textContent = JSON.stringify(report);
    window.studyReport = report;
    return report;
  }

  fixtureSelect.addEventListener('change', function () { refreshChoices(); render(); });
  [headlineSelect, themeSelect, timeInput, connectedInput, confirmedInput, allowedInput, withdrawnInput, terminalInput].forEach(function (el) { el.addEventListener('input', render); });
  window.studyCheck = studyCheck;
  window.studySweep = sweep;
  var query = new URLSearchParams(window.location.search);
  var requestedFixture = fixtureData.fixtures.findIndex(function (fixture) { return fixture.id === query.get('case'); });
  if (requestedFixture >= 0) fixtureSelect.value = String(requestedFixture);
  refreshChoices();
  if (query.get('theme') === 'dark') themeSelect.value = 'dark';
  if (query.has('headline')) headlineSelect.value = query.get('headline');
  if (query.has('seconds')) timeInput.value = query.get('seconds');
  if (query.get('available') === '0') connectedInput.checked = false;
  if (query.get('confirmed') === '0') confirmedInput.checked = false;
  render();
  if (query.has('sweep')) sweep();
}());
