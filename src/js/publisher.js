'use strict';

var wire=require('./wire');
var DEFAULT_KEY='pebble.activities.publisher.v1';
function storageOf(options) {
  var storage=options.storage;
  if(!storage || typeof storage.getItem!=='function' || typeof storage.setItem!=='function') {throw new Error('STORAGE_UNAVAILABLE');}
  if(!wire.uuid(options.pluginUuid)) {throw new Error('INVALID_PROVIDER');}
  return storage;
}
function loadState(storage,key,provider) {
  try {
    var value=JSON.parse(storage.getItem(key));
    if(!value || value.schemaVersion!==1) {return {revision:0,card:null};}
    var card=wire.normalize(value.card,provider);
    var revision=wire.integer(value.revision,1,wire.MAX_EPOCH)?value.revision:card?card.revision:0;
    return {revision:revision,card:card};
  } catch(ignored) {return {revision:0,card:null};}
}
function load(storage,key,provider) {return loadState(storage,key,provider).card;}
function createPublisher(options) {
  options=options||{};
  var storage=storageOf(options), key=options.key||DEFAULT_KEY;
  function accept(snapshot) {
    if(!snapshot || snapshot.schemaVersion!==1) {return {ACTIVITY_ERROR:'INVALID_SNAPSHOT'};}
    var card=wire.normalize(snapshot,options.pluginUuid);
    if(!card) {return {ACTIVITY_ERROR:'INVALID_SNAPSHOT'};}
    var saved=loadState(storage,key,options.pluginUuid),previous=saved.card;
    if(card.revision<saved.revision) {return {ACTIVITY_ERROR:'STALE_REVISION'};}
    // A privacy retraction removes earlier public text too. Retain only its
    // numeric revision floor, never private identity or body, to block replay.
    if(card.private) {
      try {storage.setItem(key,JSON.stringify({schemaVersion:1,revision:card.revision,card:null}));
        var redacted=loadState(storage,key,options.pluginUuid);
        if(redacted.card || redacted.revision!==card.revision){return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
      } catch(ignored) {return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
      return {ACTIVITY_ERROR:'PRIVATE_PERSISTENCE_DISABLED'};
    }
    if(!previous && card.revision===saved.revision){return {ACTIVITY_ERROR:'REVISION_CONFLICT'};}
    if(previous && previous.id===card.id && (previous.state==='completed'||previous.state==='cancelled') && card.state!=='completed' && card.state!=='cancelled'){return {ACTIVITY_ERROR:'TERMINAL_RUN'};}
    var serialized=JSON.stringify(card);
    if(previous && card.revision===previous.revision && JSON.stringify(previous)!==serialized) {return {ACTIVITY_ERROR:'REVISION_CONFLICT'};}
    try {
      storage.setItem(key,JSON.stringify({schemaVersion:1,revision:card.revision,card:card}));
      var read=load(storage,key,options.pluginUuid);
      if(!read || JSON.stringify(read)!==serialized) {return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
    } catch(ignored) {return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
    return {ACTIVITY_ACCEPTED_RUN:card.id,ACTIVITY_ACCEPTED_REVISION:card.revision};
  }
  function handleMessage(payload) {
    payload=payload && payload.payload ? payload.payload : payload;
    if(!payload || typeof payload!=='object' || payload.ACTIVITY_SCHEMA_VERSION===undefined) {return null;}
    var state=payload.ACTIVITY_STATE;
    if(state==='running') {state='active';}
    if(state==='finished') {state='completed';}
    var privacy=payload.ACTIVITY_PRIVATE;
    var validPrivacy=privacy===undefined || privacy===true || privacy===false || privacy===1 || privacy===0;
    var receipt=validPrivacy?accept({schemaVersion:payload.ACTIVITY_SCHEMA_VERSION,id:payload.ACTIVITY_RUN,revision:payload.ACTIVITY_REVISION,
      state:state,kind:payload.ACTIVITY_KIND,clock:payload.ACTIVITY_CLOCK,name:payload.ACTIVITY_NAME,
      main:payload.ACTIVITY_MAIN,footer:payload.ACTIVITY_FOOTER,observedAt:payload.ACTIVITY_OBSERVED_AT,
      validUntil:payload.ACTIVITY_VALID_UNTIL,deadline:payload.ACTIVITY_DEADLINE,duration:payload.ACTIVITY_DURATION,
      clockAt:payload.ACTIVITY_CLOCK_AT,private:privacy===undefined ? options.private!==false : privacy===true || privacy===1}):{ACTIVITY_ERROR:'INVALID_SNAPSHOT'};
    if(wire.integer(payload.ACTIVITY_PUBLISH_SESSION,1,wire.MAX_EPOCH)){receipt.ACTIVITY_PUBLISH_SESSION=payload.ACTIVITY_PUBLISH_SESSION;}
    return receipt;
  }
  return {accept:accept,handleMessage:handleMessage,onMessage:handleMessage,lastRevision:function(){return loadState(storage,key,options.pluginUuid).revision;}};
}
function base64(bytes) {
  var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out='';
  for(var i=0;i<bytes.length;i+=3){var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;out+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|(c>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');}
  return out;
}
function properties(card,request) {
  var p={schema_version:{numericValue:{value:1}},revision:{numericValue:{value:card.revision}},
    kind:{shortText:{text:card.kind}},state:{shortText:{text:card.state}},clock:{shortText:{text:card.clock}},
    name:{longText:{text:card.footer}},main:{longText:{text:card.main}},footer:{longText:{text:card.footer}},
    observed_at:{timestamp:{value:card.observedAt}},valid_until:{timestamp:{value:card.validUntil}},
    deadline:{timestamp:{value:card.deadline}},duration:{numericValue:{value:card.duration,unit:'s'}},
    clock_at:{timestamp:{value:card.clockAt}},private:{boolean:{value:card.private}},unconfirmed:{boolean:{value:true}}};
  if(card.value!==undefined) {p.value={numericValue:{value:card.value,unit:card.unit}};}
  if(card.image && request && request.iconPixelSize) {p.artwork={image:{width:card.image.width,height:card.image.height,palette:base64(card.image.palette),pixels:base64(card.image.pixels)}};}
  return p;
}
function createProvider(options) {
  options=options||{};
  var storage=storageOf(options),key=options.key||DEFAULT_KEY,now=options.now||Date.now;
  function source(request) {
    var nowMs=now(),card=load(storage,key,options.pluginUuid),instances=[];
    if(card && card.validUntil*1000>nowMs) {instances.push({instanceId:card.id,properties:properties(card,request)});}
    return {validUntilMs:Math.floor(nowMs+30000),instances:instances};
  }
  function handleSource(request,respond) {
    if(!request || request.category!==wire.CATEGORY || request.item!==wire.ITEM) {
      if(respond && typeof respond.error==='function') {respond.error('INVALID_REQUEST','Unsupported source');}
      return;
    }
    respond.data(source(request));
  }
  return {source:source,handleSource:handleSource};
}
module.exports={DEFAULT_KEY:DEFAULT_KEY,createPublisher:createPublisher,createProvider:createProvider};
