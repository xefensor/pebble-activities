'use strict';

module.exports = {
  wire: require('./wire'),
  view: require('./view'),
  selection: require('./selection'),
  createActivities: require('./consumer'),
  createPublisher: require('./publisher').createPublisher,
  createProvider: require('./publisher').createProvider,
  createContext: require('./adapters/legacy/context')
};
