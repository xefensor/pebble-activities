'use strict';

var wire=require('./wire');
var MUSIC='builtin:music';
function key(value){return value===MUSIC||wire.uuid(value)?value:null;}
function list(value){return (Array.isArray(value)?value:[]).map(key).filter(function(v,i,a){return v&&a.indexOf(v)===i;}).slice(0,64);}
function normalizePreferences(value){value=value&&typeof value==='object'?value:{};return {order:list(value.order),hidden:list(value.hidden)};}
function providerKey(card){return card&&card.selectionKey===MUSIC?MUSIC:card&&key(card.provider);}
function terminal(card){return card.state==='completed'||card.state==='cancelled';}
function countdown(card){var d=card.main;return d&&d.type==='clock'&&d.mode==='deadline'?d:null;}
/** Pure host policy. Persist provider keys only; cards and run IDs stay transient. */
function select(cards,options){
  options=options||{};var prefs=normalizePreferences(options),limit=wire.integer(options.limit,0,2)?options.limit:2;
  var entries=(Array.isArray(cards)?cards:[]).map(function(card,index){return {card:card,index:index,key:providerKey(card)};})
    .filter(function(entry){return entry.key&&prefs.hidden.indexOf(entry.key)<0;}),positions=Object.create(null);
  entries.forEach(function(entry,index){if(countdown(entry.card)&&!terminal(entry.card)){(positions[entry.key]||(positions[entry.key]=[])).push(index);}});
  Object.keys(positions).forEach(function(provider){
    var slots=positions[provider],runs=slots.map(function(index){return {card:entries[index].card,index:index};}).sort(function(a,b){
      var ac=countdown(a.card),bc=countdown(b.card);if(ac.running!==bc.running){return ac.running?-1:1;}
      return ac.baseSeconds+(ac.running?ac.anchorAt:0)-bc.baseSeconds-(bc.running?bc.anchorAt:0)||a.index-b.index;
    });
    slots.forEach(function(index,run){entries[index].card=runs[run].card;});
  });
  return entries
    .sort(function(a,b){
      var at=terminal(a.card),bt=terminal(b.card);if(at!==bt){return at?1:-1;}
      var ar=prefs.order.indexOf(a.key),br=prefs.order.indexOf(b.key);ar=ar<0?prefs.order.length:ar;br=br<0?prefs.order.length:br;
      if(ar!==br){return ar-br;}
      return a.index-b.index;
    }).slice(0,limit).map(function(entry){return entry.card;});
}
module.exports={select:select,normalizePreferences:normalizePreferences,providerKey:providerKey,MUSIC_KEY:MUSIC};
