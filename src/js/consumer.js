'use strict';

var wire=require('./wire');
var PROPERTIES=['schema_version','kind','state','clock','revision','name','main','footer','observed_at','valid_until','deadline','duration','clock_at','private','unconfirmed','value','artwork'];
function scalar(p,name,shape,field) {return p && p[name] && p[name][shape] ? p[name][shape][field||'value'] : undefined;}
function string(p,name) {var v=scalar(p,name,'longText','text');return v===undefined?scalar(p,name,'shortText','text'):v;}
function sourceCard(instance,provider) {
  if(!instance || !wire.object(instance.properties)) {return null;}
  var p=instance.properties;
  if(scalar(p,'schema_version','numericValue')!==1) {return null;}
  var number=p.value && p.value.numericValue;
  return wire.normalize({id:instance.instanceId,kind:string(p,'kind'),state:string(p,'state'),clock:string(p,'clock'),
    revision:scalar(p,'revision','numericValue'),observedAt:scalar(p,'observed_at','timestamp'),validUntil:scalar(p,'valid_until','timestamp'),
    deadline:scalar(p,'deadline','timestamp'),duration:scalar(p,'duration','numericValue'),clockAt:scalar(p,'clock_at','timestamp'),
    main:string(p,'main')===undefined?string(p,'value'):string(p,'main'),footer:string(p,'footer')===undefined?string(p,'name'):string(p,'footer'),
    private:scalar(p,'private','boolean')!==false,unconfirmed:scalar(p,'unconfirmed','boolean')===true,value:number && number.value,unit:number && number.unit,
    image:p.artwork && (p.artwork.image || p.artwork.icon)},provider);
}
function compatible(plugin) {
  return plugin && wire.uuid(plugin.uuid) && Array.isArray(plugin.sources) && plugin.sources.some(function(source){
    return source.category===wire.CATEGORY && Array.isArray(source.items) && source.items.indexOf(wire.ITEM)>=0 && source.properties &&
      Array.isArray(source.properties.schema_version) && source.properties.schema_version.indexOf('numericValue')>=0;
  });
}
function errorCode(error) {return error && typeof error.code==='string' && /^[A-Z0-9_]{1,48}$/.test(error.code)?error.code:'UNKNOWN';}
function clone(value) {return JSON.parse(JSON.stringify(value));}
module.exports=function createActivities(options) {
  options=options||{};
  var pebble=options.pebble||{}, now=options.now||Date.now, later=options.later||setTimeout, cancel=options.cancelLater||clearTimeout;
  var keys=options.keys||{}, send=options.send, groups=Object.create(null), session=0, sequence=0, generation=0;
  var stopped=false,connected=true,enabled=true,available=typeof pebble.enumeratePlugins==='function' && typeof pebble.subscribeToSource==='function';
  var expiryTimer=null,discoveryTimer=null,retryTimer=null,bootTimer=null,lastError='',bootRequested=false,bootAttempts=0,failureCount=0,seenOrder=0;
  var revisions=Object.create(null), orders=Object.create(null), lastSignature='',currentSettings={};
  function seconds(){return Math.max(1,Math.floor(now()/1000));}
  function key(name){return keys[name]===undefined?name:keys[name];}
  function readSettings(){var s=typeof options.getSettings==='function'?options.getSettings():{};return s&&typeof s==='object'?s:{};}
  function isEnabled(s){return s.enabled!==false && s.showActivities!==false;}
  function allowed(provider){return (!Array.isArray(currentSettings.providers)||currentSettings.providers.indexOf(provider)>=0) &&
    (!Array.isArray(currentSettings.disabledProviders)||currentSettings.disabledProviders.indexOf(provider)<0);}
  function stopGroup(group){if(group.handle && typeof group.handle.unsubscribe==='function'){try{group.handle.unsubscribe();}catch(ignored){}}group.handle=null;group.generation++;}
  function accepted(card){try{return typeof options.acceptActivity!=='function'||options.acceptActivity(card)!==false;}catch(ignored){return false;}}
  function cleanGroup(provider){var group=groups[provider];if(!group){return;}stopGroup(group);group.cards=[];delete groups[provider];}
  function catalogue(){
    var t=seconds(), result=[];
    Object.keys(groups).forEach(function(provider){groups[provider].cards.forEach(function(card){if(card.validUntil>t && card.state!=='completed' && card.state!=='cancelled' && accepted(card)){result.push(card);}});});
    result.sort(function(a,b){return orders[a.provider+'|'+a.id]-orders[b.provider+'|'+b.id];});
    return result;
  }
  function projection(){
    var all=catalogue(), result=typeof options.select==='function'?options.select(all.slice()):all.slice(0,2);
    if(!Array.isArray(result)){result=[];}
    return result.slice(0,2).map(function(card){return wire.normalize(card);}).filter(Boolean);
  }
  function notify(){if(typeof options.onChanged==='function'){options.onChanged();}}
  function requestBootstrap(){
    if(bootRequested || typeof send!=='function' || !connected || !enabled || stopped){return;}
    if(bootAttempts>=3){return;}bootRequested=true;bootAttempts++;var payload={};payload[key('REQUEST_ACTIVITIES')]=1;
    function retry(){if(bootTimer!==null){cancel(bootTimer);}bootTimer=later(function(){bootTimer=null;if(!session&&!stopped&&connected&&enabled){bootRequested=false;requestBootstrap();}},2000);}
    try{send(payload,retry,function(){bootRequested=false;retry();});}catch(ignored){bootRequested=false;retry();}
  }
  function publish(force){
    if(stopped || !connected || !enabled){return;}
    scheduleExpiry();notify();
    if(!session){requestBootstrap();return;}
    var cards=projection(),signature=JSON.stringify(cards);
    if(!force && signature===lastSignature){return;}
    if(signature!==lastSignature){failureCount=0;}lastSignature=signature;
    sequence=sequence===wire.MAX_EPOCH?1:sequence+1;
    if(typeof send!=='function'){return;}
    var revision=sequence,payload={};
    payload[key('ACTIVITY_DATA')]=wire.encode(cards,{session:session,revision:revision,sentAt:seconds()});
    if(retryTimer!==null){cancel(retryTimer);retryTimer=null;}
    try{send(payload,function(){if(revision===sequence){failureCount=0;}},function(error){
      if(stopped||!connected||!enabled||revision!==sequence||error && error.code==='SUPERSEDED'){return;}
      if(++failureCount<3){retryTimer=later(function(){retryTimer=null;publish(true);},2000);}
    });}catch(ignored){if(++failureCount<3){retryTimer=later(function(){retryTimer=null;publish(true);},2000);}}
  }
  function uncertain(group){
    group.cards=group.cards.filter(function(card){return !card.private && card.clock!=='none' && card.validUntil>seconds();}).map(function(card){var copy=clone(card);copy.unconfirmed=true;return copy;});
  }
  function expire(){
    var t=seconds(), changed=false;
    Object.keys(groups).forEach(function(provider){
      var group=groups[provider],before=JSON.stringify(group.cards);
      group.cards=group.cards.filter(function(card){return card.validUntil>t;});
      if(group.expiresAt!==null && group.expiresAt<=t){group.expiresAt=null;group.error='SOURCE_EXPIRED';uncertain(group);}
      if(before!==JSON.stringify(group.cards)){changed=true;}
    });
    if(changed){publish();}else{scheduleExpiry();}
  }
  function scheduleExpiry(){
    if(expiryTimer!==null){cancel(expiryTimer);expiryTimer=null;}
    if(stopped||!connected||!enabled){return;}
    var t=seconds(),end=Infinity;
    Object.keys(groups).forEach(function(provider){var group=groups[provider];if(group.expiresAt!==null && group.expiresAt>t){end=Math.min(end,group.expiresAt);}group.cards.forEach(function(card){if(card.validUntil>t){end=Math.min(end,card.validUntil);}});});
    if(end!==Infinity){expiryTimer=later(function(){expiryTimer=null;expire();},Math.max(1,end*1000-now()));}
  }
  function receive(group,envelope){
    if(!envelope || envelope.pluginUuid!==group.provider || !Array.isArray(envelope.instances) || envelope.instances.length>wire.LIMITS.instances){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
    var t=seconds(),expiry=envelope.validUntilMs===undefined?null:Math.floor(envelope.validUntilMs/1000);
    if(expiry!==null && !wire.integer(expiry,1,wire.MAX_EPOCH)){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
    var next=[],seen=Object.create(null),malformed=false;
    envelope.instances.forEach(function(instance){
      var card=sourceCard(instance,group.provider);
      if(!card){malformed=true;return;}
      if(!accepted(card)){return;}
      var fingerprintCard=clone(card);delete fingerprintCard.unconfirmed;var fingerprint=JSON.stringify(fingerprintCard);
      var identity=card.provider+'|'+card.id;
      if(seen[identity]){malformed=true;return;}seen[identity]=true;
      var previous=revisions[identity];
      if(previous && card.revision<previous.revision){
        var retained=group.cards.filter(function(old){return old.id===card.id && old.revision===previous.revision;})[0];
        if(retained && retained.validUntil>t){next.push(retained);}return;
      }
      if(previous && (card.revision===previous.revision && fingerprint!==previous.fingerprint || previous.terminal && card.state!=='completed' && card.state!=='cancelled')){malformed=true;return;}
      revisions[identity]={revision:card.revision,fingerprint:fingerprint,terminal:card.state==='completed'||card.state==='cancelled'};
      if(card.kind==='music'){card.validUntil=Math.min(card.validUntil,t+120);}
      if(!Object.prototype.hasOwnProperty.call(orders,identity)){orders[identity]=++seenOrder;}
      if(card.validUntil>t && card.state!=='completed' && card.state!=='cancelled'){next.push(card);}
    });
    // A malformed/redacted entry cannot leave an older private preview alive.
    if(malformed){next=[];}
    group.cards=next;group.receivedAt=t;group.expiresAt=expiry;group.error=malformed?'INVALID_SOURCE':'';group.ready=true;
    if(expiry!==null && expiry<=t){uncertain(group);group.error='SOURCE_EXPIRED';}
    // Bound revision/ordering tombstones independently of untrusted source churn.
    var identities=Object.keys(revisions);
    if(identities.length>1024){var live=Object.create(null);Object.keys(groups).forEach(function(provider){groups[provider].cards.forEach(function(card){live[card.provider+'|'+card.id]=true;});});identities.filter(function(id){return !live[id];}).slice(0,identities.length-1024).forEach(function(id){delete revisions[id];delete orders[id];});}
    publish();
  }
  function bind(provider){
    var group=groups[provider]||{provider:provider,generation:0,handle:null,cards:[],error:'',receivedAt:null,expiresAt:null,ready:false};
    groups[provider]=group;stopGroup(group);var run=group.generation;
    function live(){return !stopped && connected && enabled && groups[provider]===group && run===group.generation;}
    try{
      var handle=pebble.subscribeToSource({plugin:provider,category:wire.CATEGORY,item:wire.ITEM,properties:PROPERTIES.slice(),iconPixelSize:{w:40,h:40},
        onData:function(envelope){if(live()){receive(group,envelope);}},
        onError:function(error){if(!live()){return;}group.error=errorCode(error);if(group.error==='TIMEOUT'||group.error==='PLUGIN_UNAVAILABLE'||group.error==='RATE_LIMITED'){uncertain(group);}else{group.cards=[];}publish();}});
      if(live()){group.handle=handle;}else if(handle && typeof handle.unsubscribe==='function'){handle.unsubscribe();}
    }catch(error){group.error=errorCode(error);group.cards=[];publish();}
  }
  function discover(rebind){
    if(stopped||!connected||!enabled){return;}
    available=typeof pebble.enumeratePlugins==='function' && typeof pebble.subscribeToSource==='function';
    if(!available){Object.keys(groups).forEach(cleanGroup);lastError='API_UNAVAILABLE';publish();return;}
    var run=++generation;
    function apply(plugins){
      if(run!==generation||stopped||!connected||!enabled){return;}
      if(!Array.isArray(plugins)){lastError='INVALID_CATALOGUE';Object.keys(groups).forEach(cleanGroup);publish();return;}
      var providers=plugins.filter(compatible).filter(function(p){return allowed(p.uuid);}).map(function(p){return p.uuid;}).sort().filter(function(v,i,a){return i===0||a[i-1]!==v;}).slice(0,wire.LIMITS.providers);
      Object.keys(groups).forEach(function(provider){if(providers.indexOf(provider)<0){cleanGroup(provider);}});
      providers.forEach(function(provider){if(rebind||!groups[provider]){bind(provider);}});
      lastError='';publish();
    }
    try{var result=pebble.enumeratePlugins();if(result && typeof result.then==='function'){result.then(apply,function(){if(run===generation){lastError='CATALOGUE_UNAVAILABLE';Object.keys(groups).forEach(cleanGroup);publish();}});}else{apply(result);}}
    catch(ignored){lastError='CATALOGUE_UNAVAILABLE';Object.keys(groups).forEach(cleanGroup);publish();}
    if(discoveryTimer!==null){cancel(discoveryTimer);}
    discoveryTimer=later(function(){discoveryTimer=null;discover(false);},60000);
  }
  function configure(){
    if(stopped){return;}
    var next=readSettings(),previous=enabled;currentSettings=next;enabled=isEnabled(next);
    if(!enabled){Object.keys(groups).forEach(cleanGroup);lastSignature='';if(expiryTimer!==null){cancel(expiryTimer);expiryTimer=null;}if(retryTimer!==null){cancel(retryTimer);retryTimer=null;}if(discoveryTimer!==null){cancel(discoveryTimer);discoveryTimer=null;}
      if(previous && connected && session && typeof send==='function'){sequence=sequence===wire.MAX_EPOCH?1:sequence+1;var payload={};payload[key('ACTIVITY_DATA')]=wire.encode([],{session:session,revision:sequence,sentAt:seconds()});try{send(payload,function(){},function(){});}catch(ignored){}}
      notify();return;
    }
    discover(true);
  }
  function refresh(rebaseline,token){
    if(stopped){return;}
    if(typeof rebaseline==='number'){token=rebaseline;rebaseline=true;}
    if(wire.integer(token,2,wire.MAX_EPOCH) && token!==session){session=token;sequence=0;lastSignature='';bootRequested=false;bootAttempts=0;failureCount=0;if(bootTimer!==null){cancel(bootTimer);bootTimer=null;}}
    else if(rebaseline && !token){bootRequested=false;bootAttempts=0;}failureCount=0;
    currentSettings=readSettings();enabled=isEnabled(currentSettings);
    if(!enabled){configure();return;}
    discover(true);publish(true);
  }
  function connectionChanged(value,token){
    if(stopped || typeof value!=='boolean'){return;}
    connected=value;generation++;
    if(!connected){Object.keys(groups).forEach(cleanGroup);session=0;sequence=0;lastSignature='';bootRequested=false;
      [expiryTimer,discoveryTimer,retryTimer,bootTimer].forEach(function(timer){if(timer!==null){cancel(timer);}});expiryTimer=discoveryTimer=retryTimer=bootTimer=null;notify();}
    else{refresh(true,token);}
  }
  return {refresh:refresh,configure:configure,connectionChanged:connectionChanged,
    catalogue:function(){return clone(catalogue());},
    status:function(){var providers=Object.keys(groups).map(function(provider){var group=groups[provider];return {pluginUuid:provider,state:group.error?'unavailable':group.ready?'ready':'waiting',error:group.error,receivedAt:group.receivedAt};});return {available:available,connected:connected,enabled:enabled,ready:enabled&&available&&connected&&providers.every(function(p){return p.state==='ready';}),error:lastError||providers.map(function(p){return p.error;}).filter(Boolean)[0]||'',providers:providers,count:catalogue().length};},
    stop:function(){stopped=true;generation++;Object.keys(groups).forEach(cleanGroup);[expiryTimer,discoveryTimer,retryTimer,bootTimer].forEach(function(timer){if(timer!==null){cancel(timer);}});expiryTimer=discoveryTimer=retryTimer=bootTimer=null;revisions=Object.create(null);orders=Object.create(null);}}
};
module.exports.sourceCard=sourceCard;
module.exports.compatible=compatible;
module.exports.PROPERTIES=PROPERTIES;
