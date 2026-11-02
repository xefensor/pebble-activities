'use strict';

var wire=require('./wire');
var view=require('./view');
var DEFAULT_KEY='pebble.activities.publisher.v1';
var MAX_RECORDS=8;
function record(snapshot,provider){
  var card=wire.normalize(snapshot,provider);
  if(!card){return null;}
  if(snapshot.totalDuration!==undefined){
    if(!wire.integer(snapshot.totalDuration,0,wire.MAX_EPOCH)){return null;}
    card.totalDuration=snapshot.totalDuration;
  }
  return card;
}
function storageOf(options) {
  var storage=options.storage;
  if(!storage || typeof storage.getItem!=='function' || typeof storage.setItem!=='function') {throw new Error('STORAGE_UNAVAILABLE');}
  if(!wire.uuid(options.pluginUuid)) {throw new Error('INVALID_PROVIDER');}
  return storage;
}
function loadState(storage,key,provider) {
  try {
    var value=JSON.parse(storage.getItem(key));
    if(!value || value.schemaVersion!==1) {return {revision:0,slots:[]};}
    var revision=wire.integer(value.revision,1,wire.MAX_EPOCH)?value.revision:0;
    // Version 0.1.0/0.1.1 stored one card at this same key. Read it as slot 0;
    // opt-in collection writers migrate it on their next accepted snapshot.
    var source=Array.isArray(value.slots)?value.slots:[value.card];
    if(source.length>MAX_RECORDS) {return {revision:revision,slots:[]};}
    var slots=[],identities=Object.create(null);
    for(var i=0;i<source.length;i++) {
      if(source[i]===null || source[i]===undefined) {slots.push(null);continue;}
      var card=record(source[i],provider);
      if(!card || card.private || identities[card.id]) {return {revision:revision,slots:[]};}
      identities[card.id]=true;
      revision=Math.max(revision,card.revision);
      slots.push(card);
    }
    return {revision:revision,slots:slots};
  } catch(ignored) {return {revision:0,slots:[]};}
}
function createPublisher(options) {
  options=options||{};
  var storage=storageOf(options), key=options.key||DEFAULT_KEY;
  var maxRecords=options.maxRecords===undefined?1:options.maxRecords;
  if(!wire.integer(maxRecords,1,MAX_RECORDS)) {throw new Error('INVALID_RECORD_LIMIT');}
  function save(revision,slots) {
    // Keep the original envelope for default single-record publishers.
    var value=maxRecords===1?{schemaVersion:1,revision:revision,card:slots[0]||null}:
      {schemaVersion:1,revision:revision,slots:slots};
    try {
      storage.setItem(key,JSON.stringify(value));
      var read=loadState(storage,key,options.pluginUuid);
      if(read.revision!==revision || JSON.stringify(read.slots)!==JSON.stringify(slots)) {return false;}
      return true;
    } catch(ignored) {return false;}
  }
  function accept(snapshot) {
    if(!snapshot || snapshot.schemaVersion!==1) {return {ACTIVITY_ERROR:'INVALID_SNAPSHOT'};}
    var slot=snapshot.slot===undefined?0:snapshot.slot;
    if(!wire.integer(slot,0,maxRecords-1)) {return {ACTIVITY_ERROR:'INVALID_SLOT'};}
    var card=record(snapshot,options.pluginUuid);
    if(!card) {return {ACTIVITY_ERROR:'INVALID_SNAPSHOT'};}
    var saved=loadState(storage,key,options.pluginUuid),previous=saved.slots[slot];
    if(card.revision<saved.revision) {return {ACTIVITY_ERROR:'STALE_REVISION'};}
    // An accidental/default smaller writer must not silently discard another
    // slot. Reopen with the established limit to update or retract those slots.
    if(saved.slots.slice(maxRecords).some(function(record){return !!record;})) {
      return {ACTIVITY_ERROR:'RECORD_LIMIT_CONFLICT'};
    }
    var slots=saved.slots.slice(0,maxRecords);
    while(slots.length<maxRecords) {slots.push(null);}
    // A stable host-owned slot replaces its prior run atomically. It is not a
    // second public identity: source consumers still see the card's run ID.
    // This prevents an offline restart from leaving the predecessor running.
    for(var at=0;at<slots.length;at++) {
      if(at!==slot && slots[at] && slots[at].id===card.id) {return {ACTIVITY_ERROR:'SLOT_CONFLICT'};}
    }
    // Redact this slot's previous public contents and retain only the global
    // numeric floor. Never persist the private run identity or body. Other
    // public slots are independent and stay available.
    if(card.private) {
      slots[slot]=null;
      if(!save(card.revision,slots)) {return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
      return {ACTIVITY_ERROR:'PRIVATE_PERSISTENCE_DISABLED'};
    }
    if(previous && previous.id===card.id && (previous.state==='completed'||previous.state==='cancelled') && card.state!=='completed' && card.state!=='cancelled'){return {ACTIVITY_ERROR:'TERMINAL_RUN'};}
    var serialized=JSON.stringify(card);
    if(card.revision===saved.revision && (!previous || previous.revision!==card.revision ||
        JSON.stringify(previous)!==serialized)) {return {ACTIVITY_ERROR:'REVISION_CONFLICT'};}
    slots[slot]=card;
    if(!save(card.revision,slots)) {return {ACTIVITY_ERROR:'STORAGE_FAILED'};}
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
      clockAt:payload.ACTIVITY_CLOCK_AT,private:privacy===undefined ? options.private!==false : privacy===true || privacy===1,
      slot:payload.ACTIVITY_SLOT,totalDuration:payload.ACTIVITY_TOTAL_DURATION}):{ACTIVITY_ERROR:'INVALID_SNAPSHOT'};
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
    var nowMs=now(),slots=loadState(storage,key,options.pluginUuid).slots,instances=[];
    slots.forEach(function(card) {
      if(card && card.validUntil*1000>nowMs) {
        if(request&&request.item===view.ITEM){
          var projected=view.fromLegacy(card,{terminalResults:true});
          if(projected){projected.unconfirmed=true;var instance=view.toSourceInstance(projected,request);if(instance){instances.push(instance);}}
        }else{instances.push({instanceId:card.id,properties:properties(card,request)});}
      }
    });
    return {validUntilMs:Math.floor(nowMs+30000),instances:instances};
  }
  function handleSource(request,respond) {
    if(!request || request.category!==wire.CATEGORY || request.item!==wire.ITEM&&request.item!==view.ITEM) {
      if(respond && typeof respond.error==='function') {respond.error('INVALID_REQUEST','Unsupported source');}
      return;
    }
    respond.data(source(request));
  }
  return {source:source,handleSource:handleSource};
}
module.exports={DEFAULT_KEY:DEFAULT_KEY,MAX_RECORDS:MAX_RECORDS,createPublisher:createPublisher,createProvider:createProvider};
