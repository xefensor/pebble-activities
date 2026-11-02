'use strict';

var activities = require('pebble-activities/publisher');
var publisher = activities.createPublisher({
  storage: localStorage,
  pluginUuid: '50e9ef12-a5ab-4369-a3b5-3447bfba5151',
  private: false
});

// The example owns one transport queue. Saving a snapshot and delivering its
// application receipt are different from Pebble's lower-level transport ACK.
var queue = [];
var busy = false;
function flush() {
  if (busy || !queue.length) return;
  busy = true;
  var message = queue.shift();
  function done() { busy = false; flush(); }
  Pebble.sendAppMessage(message, done, done);
}
function send(message) {
  if (message.ACTIVITY_ACCEPTED_REVISION !== undefined) {
    queue = queue.filter(function (pending) {
      return pending.ACTIVITY_ACCEPTED_REVISION === undefined;
    });
  }
  queue.push(message);
  flush();
}

Pebble.addEventListener('ready', function () {
  send({ ACTIVITY_REQUEST: 1, ACTIVITY_LAST_REVISION: publisher.lastRevision() });
});

Pebble.addEventListener('appmessage', function (event) {
  var payload = event && event.payload;
  if (!payload || payload.ACTIVITY_SCHEMA_VERSION === undefined) return;
  var receipt = publisher.handleMessage(payload);
  if (receipt && receipt.ACTIVITY_ERROR) {
    receipt.ACTIVITY_RUN = payload.ACTIVITY_RUN;
    receipt.ACTIVITY_REVISION = payload.ACTIVITY_REVISION;
  }
  if (receipt) send(receipt);
});
