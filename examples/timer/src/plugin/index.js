'use strict';

var activities = require('pebble-activities/publisher');
var provider = activities.createProvider({
  storage: localStorage,
  pluginUuid: '50e9ef12-a5ab-4369-a3b5-3447bfba5151'
});

Pebble.registerSourceHandler(function (request, respond) {
  provider.handleSource(request, respond);
});
