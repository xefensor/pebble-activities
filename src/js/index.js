'use strict';

module.exports = {
  wire: require('./wire'),
  createActivities: require('./consumer'),
  createPublisher: require('./publisher').createPublisher,
  createProvider: require('./publisher').createProvider,
  createContext: require('./adapters/legacy/context')
};
