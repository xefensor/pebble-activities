'use strict';

// Read-only hosts do not need the native-owner publisher/storage bridge.
// Keep the complete historical API in index.js for existing consumers.
module.exports={
  activity:require('./activity'),
  summary:require('./summary'),
  summaryView:require('./summary-view'),
  wire:require('./wire'),
  view:require('./view'),
  selection:require('./selection'),
  createActivities:require('./consumer'),
  createContext:require('./adapters/legacy/context')
};
