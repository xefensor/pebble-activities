'use strict';

var wire=require('./wire');
var view=require('./view');
var activity=require('./activity');
var summary=require('./summary'),summaryView=require('./summary-view');
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
function sourceItem(plugin,format) {
  if(!plugin||!wire.uuid(plugin.uuid)||!Array.isArray(plugin.sources)){return null;}
  var items=[];
  plugin.sources.forEach(function(source){if(source.category===wire.CATEGORY&&Array.isArray(source.items)&&source.properties&&
    Array.isArray(source.properties.schema_version)&&source.properties.schema_version.indexOf('numericValue')>=0){items=items.concat(source.items);}});
  return format>=3&&items.indexOf(summary.ITEM)>=0?summary.ITEM:
    format>=2&&items.indexOf(activity.ITEM)>=0?activity.ITEM:
    format>=2&&items.indexOf(view.ITEM)>=0?view.ITEM:items.indexOf(wire.ITEM)>=0?wire.ITEM:null;
}
function compatible(plugin,format) {
  return !!sourceItem(plugin,format);
}
function errorCode(error) {return error && typeof error.code==='string' && /^[A-Z0-9_]{1,48}$/.test(error.code)?error.code:'UNKNOWN';}
function clone(value) {return JSON.parse(JSON.stringify(value));}
function sourceFingerprint(source) {
  // Omit mutable capabilities without first copying the complete bitmap and
  // parsing it back. The source has already passed its format's validation.
  var copy={};
  Object.keys(source).forEach(function(name){if(name!=='unconfirmed'&&name!=='displayName'){copy[name]=source[name];}});
  if(source.record){
    copy.record={};Object.keys(source.record).forEach(function(name){
      if(name!=='actions'&&name!=='entityRef'&&name!=='openApp'){copy.record[name]=source.record[name];}
    });
  }
  return JSON.stringify(copy);
}
module.exports=function createActivities(options) {
  options=options||{};
  var nativeFormat=options.nativeFormat===3?3:options.nativeFormat===2?2:1,codec=nativeFormat===3?summaryView:nativeFormat===2?view:wire;
  var pebble=options.pebble||{}, now=options.now||Date.now, later=options.later||setTimeout, cancel=options.cancelLater||clearTimeout;
  var keys=options.keys||{}, send=options.send, groups=Object.create(null), session=0, sequence=0, generation=0;
  var stopped=false,connected=true,enabled=true,available=typeof pebble.enumeratePlugins==='function' && typeof pebble.subscribeToSource==='function';
  var expiryTimer=null,expiryAt=Infinity,discoveryTimer=null,retryTimer=null,bootTimer=null,deliveryEpoch=0,lastError='',bootRequested=false,bootAttempts=0,failureCount=0,seenOrder=0,enumerated=false;
  var revisions=Object.create(null), orders=Object.create(null), lastSignature='',currentSettings={},installed=[],providerMetadata=Object.create(null),lastView=null;
  function seconds(){return Math.max(1,Math.floor(now()/1000));}
  function key(name){return keys[name]===undefined?name:keys[name];}
  function readSettings(){var s=typeof options.getSettings==='function'?options.getSettings():{};return s&&typeof s==='object'?s:{};}
  function isEnabled(s){return s.enabled!==false && s.showActivities!==false;}
  function allowed(provider){return (!Array.isArray(currentSettings.providers)||currentSettings.providers.indexOf(provider)>=0) &&
    (!Array.isArray(currentSettings.disabledProviders)||currentSettings.disabledProviders.indexOf(provider)<0);}
  function stopGroup(group){if(group.handle && typeof group.handle.unsubscribe==='function'){try{group.handle.unsubscribe();}catch(ignored){}}group.handle=null;group.generation++;}
  function accepted(card){try{return typeof options.acceptActivity!=='function'||options.acceptActivity(clone(card))!==false;}catch(ignored){return false;}}
  function visible(card,t){return card.validUntil>t&&
    (nativeFormat<2||card.main.validUntil>t&&(!card.unconfirmed||!card.private&&card.main.retain))&&
    ((card.state!=='completed'&&card.state!=='cancelled')||nativeFormat>=2&&card.showTerminal);}
  function cleanGroup(provider){var group=groups[provider];if(!group){return;}stopGroup(group);group.cards=[];delete groups[provider];}
  function catalogue(defensive){
    var t=seconds(), result=[];
    Object.keys(groups).forEach(function(provider){
      var metadata=providerMetadata[provider];
      groups[provider].cards.forEach(function(card){if(visible(card,t)&&accepted(card)){
        // Internal default selection can borrow immutable cards: normalize()
        // below owns the resulting copy. User callbacks/public reads get deep
        // copies, including nested artwork and capabilities.
        var copy=defensive?clone(card):card;
        if(metadata&&metadata.name){
          if(!defensive){copy={};Object.keys(card).forEach(function(k){copy[k]=card[k];});}
          copy.providerName=metadata.name;
        }
        result.push(copy);
      }});
    });
    result.sort(function(a,b){return orders[a.provider+'|'+a.id]-orders[b.provider+'|'+b.id];});
    return result;
  }
  function catalogueCount(){
    var t=seconds(),count=0;
    Object.keys(groups).forEach(function(provider){groups[provider].cards.forEach(function(card){if(visible(card,t)&&accepted(card)){count++;}});});
    return count;
  }
  function projection(){
    var custom=typeof options.select==='function',all=catalogue(custom),result=custom?options.select(all):all.slice(0,2);
    if(!Array.isArray(result)){result=[];}
    return result.slice(0,2).map(function(card){return codec.normalize(card);}).filter(Boolean);
  }
  function notify(){if(typeof options.onChanged==='function'){options.onChanged();}}
  function deliveryCurrent(epoch,token){return epoch===deliveryEpoch&&token===session&&!stopped&&connected&&enabled;}
  function invalidateDelivery(){
    deliveryEpoch++;lastView=null;bootRequested=false;bootAttempts=0;
    [retryTimer,bootTimer].forEach(function(timer){if(timer!==null){cancel(timer);}});retryTimer=bootTimer=null;
  }
  function requestBootstrap(){
    if(bootRequested || typeof send!=='function' || !connected || !enabled || stopped){return;}
    if(bootAttempts>=3){return;}bootRequested=true;bootAttempts++;var attempt=bootAttempts,epoch=deliveryEpoch,payload={};payload[key('REQUEST_ACTIVITIES')]=1;
    function live(){return deliveryCurrent(epoch,0)&&attempt===bootAttempts;}
    function retry(){if(!live()){return;}if(bootTimer!==null){cancel(bootTimer);}bootTimer=later(function(){bootTimer=null;if(live()){bootRequested=false;requestBootstrap();}},2000);}
    function failed(){if(!live()){return;}bootRequested=false;retry();}
    try{send(payload,retry,failed);}catch(ignored){failed();}
  }
  function publish(force,afterAccepted){
    if(stopped || !connected || !enabled){return;}
    scheduleExpiry();notify();
    if(!session){requestBootstrap();return;}
    var cards=projection(),signature=JSON.stringify(cards);
    if(!force && signature===lastSignature){return;}
    if(signature!==lastSignature){failureCount=0;}lastSignature=signature;
    sequence=sequence===wire.MAX_EPOCH?1:sequence+1;
    if(typeof send!=='function'){return;}
    var revision=sequence,epoch=deliveryEpoch,token=session,payload={},barriers=[];
    Object.keys(groups).forEach(function(provider){var group=groups[provider];
      if(group.rebinding&&!cards.some(function(card){return card.provider===provider;})){barriers.push({group:group,generation:group.generation});}
    });
    var sentAt=seconds();payload[key('ACTIVITY_DATA')]=codec.encode(cards,{session:session,revision:revision,sentAt:sentAt});
    // projection() owns these normalized records. Only copied snapshots leave
    // the consumer, so retaining them needs no second JSON round trip.
    lastView={session:session,viewSequence:revision,sequence:revision,sentAt:sentAt,cards:cards};
    if(typeof options.onView==='function'){options.onView(clone(lastView));}
    if(!deliveryCurrent(epoch,token)){return;}
    if(retryTimer!==null){cancel(retryTimer);retryTimer=null;}
    try{send(payload,function(){
      if(!deliveryCurrent(epoch,token)){return;}
      if(revision===sequence){failureCount=0;}
      // Any acknowledged view excluding a resetting provider is a valid clear
      // barrier, including one that superseded the original queued clear.
      barriers.forEach(function(barrier){
        var group=barrier.group,provider=group.provider;
        if(groups[provider]!==group||group.generation!==barrier.generation||!group.rebinding){return;}
        var pending=group.pendingReset;group.pendingReset=null;group.rebinding=false;
        var needsRebind=group.pendingRebind;group.pendingRebind=false;
        if(group.pendingMode!=='snapshot'){Object.keys(revisions).forEach(function(id){if(id.indexOf(provider+'|')===0){delete revisions[id];}});}
        if(needsRebind){bind(provider,group.item);}
        else if(pending){receive(group,pending,true);}
      });
      if(typeof afterAccepted==='function'){afterAccepted();}
    },function(error){
      if(!deliveryCurrent(epoch,token)||revision!==sequence||error && error.code==='SUPERSEDED'){return;}
      if(++failureCount<3){retryTimer=later(function(){retryTimer=null;publish(true);},2000);}
    });}catch(ignored){if(deliveryCurrent(epoch,token)&&++failureCount<3){retryTimer=later(function(){retryTimer=null;publish(true);},2000);}}
  }
  function uncertain(group){
    var before=group.cards.length,changed=false,t=seconds();
    group.cards=group.cards.filter(function(card){return !card.private&&card.validUntil>t&&
      (nativeFormat>=2?card.main.retain&&card.main.validUntil>t:card.clock!=='none');}).map(function(card){
        if(card.unconfirmed){return card;}
        changed=true;var copy={};Object.keys(card).forEach(function(k){copy[k]=card[k];});copy.unconfirmed=true;return copy;
      });
    return changed||before!==group.cards.length;
  }
  function expire(){
    var t=seconds(), changed=false;
    Object.keys(groups).forEach(function(provider){
      var group=groups[provider],before=group.cards.length;
      group.cards=group.cards.filter(function(card){return card.validUntil>t&&(nativeFormat<2||card.main.validUntil>t);});
      if(group.expiresAt!==null && group.expiresAt<=t){group.expiresAt=null;group.error='SOURCE_EXPIRED';if(uncertain(group)){changed=true;}}
      if(before!==group.cards.length){changed=true;}
    });
    if(changed){publish();}else{scheduleExpiry();}
  }
  function scheduleExpiry(){
    if(stopped||!connected||!enabled){if(expiryTimer!==null){cancel(expiryTimer);}expiryTimer=null;expiryAt=Infinity;return;}
    var t=seconds(),end=Infinity;
    Object.keys(groups).forEach(function(provider){var group=groups[provider];if(group.expiresAt!==null && group.expiresAt>t){end=Math.min(end,group.expiresAt);}group.cards.forEach(function(card){if(card.validUntil>t){end=Math.min(end,card.validUntil);}if(nativeFormat>=2){[card.main,card.support].forEach(function(d){if(d&&d.validUntil>t){end=Math.min(end,d.validUntil);}});}});});
    if(expiryTimer!==null&&expiryAt===end){return;}
    if(expiryTimer!==null){cancel(expiryTimer);expiryTimer=null;}
    expiryAt=end;
    if(end!==Infinity){expiryTimer=later(function(){expiryTimer=null;expiryAt=Infinity;expire();},Math.max(1,end*1000-now()));}
  }
  function receive(group,envelope,rebound){
    if(!envelope || envelope.pluginUuid!==group.provider || !Array.isArray(envelope.instances) || envelope.instances.length>(group.item===summary.ITEM?17:wire.LIMITS.instances)){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
    var t=seconds(),expiry=envelope.validUntilMs===undefined?null:Math.floor(envelope.validUntilMs/1000);
    if(expiry!==null && !wire.integer(expiry,1,wire.MAX_EPOCH)){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
    var snapshotHeader=null;
    if(group.item===summary.ITEM){
      snapshotHeader=summary.header(envelope);
      if(!snapshotHeader){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
      if(!rebound&&group.incarnation&&group.incarnation!==snapshotHeader.incarnation){
        group.cards=[];group.incarnation=null;group.snapshotSequence=0;
        // The source-floor clear must reach native before a reset managed
        // revision. Queue only this cleared view until the send completes.
        group.rebinding=true;group.pendingReset=null;group.pendingMode=snapshotHeader.mode;group.pendingRebind=true;
        stopGroup(group);
        publish(true);return;
      }
      if(group.rebinding&&!rebound){
        var pendingHeader=summary.header(group.pendingReset);
        if(!pendingHeader||pendingHeader.incarnation!==snapshotHeader.incarnation||snapshotHeader.sequence>pendingHeader.sequence){group.pendingReset=envelope;group.pendingMode=snapshotHeader.mode;}
        return;
      }
      if(group.incarnation===snapshotHeader.incarnation&&group.publisherMode!==snapshotHeader.mode){group.cards=[];group.error='INVALID_SOURCE';publish();return;}
      if(group.incarnation===snapshotHeader.incarnation&&snapshotHeader.sequence<group.snapshotSequence){return;}
      var responseSignature=JSON.stringify(envelope.instances);
      if(group.incarnation===snapshotHeader.incarnation&&snapshotHeader.sequence===group.snapshotSequence){
        if(group.responseSignature!==responseSignature){group.cards=[];group.error='INVALID_SOURCE';publish();}return;
      }
      group.incarnation=snapshotHeader.incarnation;group.publisherMode=snapshotHeader.mode;group.snapshotSequence=snapshotHeader.sequence;group.responseSignature=responseSignature;
    }
    var next=[],seen=Object.create(null),malformed=false;
    envelope.instances.forEach(function(instance){
      if(group.item===summary.ITEM&&instance&&instance.instanceId==='@snapshot'){return;}

      var source=group.item===summary.ITEM?summary.sourceCard(instance,group.provider):group.item===activity.ITEM?activity.sourceCard(instance,group.provider):
        group.item===view.ITEM?view.sourceCard(instance,group.provider):sourceCard(instance,group.provider);
      if(!source){malformed=true;return;}
      if(group.item===summary.ITEM&&!source.displayName){
        var metadataEntry=providerMetadata[group.provider];
        if(metadataEntry&&metadataEntry.name){source.displayName=metadataEntry.name;}
      }
      var card=group.item===summary.ITEM?summary.toView(source):group.item===activity.ITEM?activity.toView(source):nativeFormat>=2&&group.item!==view.ITEM?view.fromLegacy(source):source;
      if(nativeFormat===3&&group.item!==summary.ITEM&&card){card=summaryView.fromLegacy(card);}
      if(!card&&group.item!==summary.ITEM){malformed=true;return;}
      if(card&&!accepted(card)){return;}
      var fingerprint=sourceFingerprint(source),identity=source.provider+'|'+source.id;
      var state=source.record?(source.record.state||'active'):source.state;
      var metadata=JSON.stringify([source.kind||source.type,state,source.observedAt,source.validUntil,source.private]);

      if(seen[identity]){malformed=true;return;}seen[identity]=true;
      var previous=revisions[identity];
      if(previous && source.revision<previous.revision){
        var retained=group.cards.filter(function(old){return old.id===source.id && old.revision===previous.revision;})[0];
        if(retained && retained.validUntil>t){next.push(retained);}return;
      }
      if(previous && (source.revision===previous.revision && (metadata!==previous.metadata || group.item===previous.item&&fingerprint!==previous.fingerprint) || previous.terminal && state!=='completed' && state!=='cancelled')){malformed=true;return;}
      revisions[identity]={revision:source.revision,fingerprint:fingerprint,metadata:metadata,item:group.item,terminal:state==='completed'||state==='cancelled'};
      if(!card){return;}
      card.sourceFormat=group.item===summary.ITEM?4:group.item===activity.ITEM?3:group.item===view.ITEM?2:1;
      if(card.kind==='music'){
        card.validUntil=Math.min(card.validUntil,card.observedAt+120);
        if(nativeFormat>=2){card.main.validUntil=Math.min(card.main.validUntil,card.validUntil);if(card.support){card.support.validUntil=Math.min(card.support.validUntil,card.validUntil);}}
      }
      if(!Object.prototype.hasOwnProperty.call(orders,identity)){orders[identity]=++seenOrder;}
      if(card.validUntil>t&&((card.state!=='completed'&&card.state!=='cancelled')||nativeFormat>=2&&card.showTerminal)){next.push(card);}
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
  function bind(provider,item){
    var group=groups[provider]||{provider:provider,generation:0,handle:null,cards:[],error:'',receivedAt:null,expiresAt:null,ready:false};
    groups[provider]=group;stopGroup(group);group.item=item;group.ready=false;group.settled=false;group.error='';var run=group.generation;
    function live(){return !stopped && connected && enabled && groups[provider]===group && run===group.generation;}
    try{
      var handle=pebble.subscribeToSource({plugin:provider,category:wire.CATEGORY,item:item,properties:(item===summary.ITEM?summary.PROPERTIES:item===activity.ITEM?activity.PROPERTIES:item===view.ITEM?view.PROPERTIES:PROPERTIES).slice(),iconPixelSize:{w:40,h:40},
        onData:function(envelope){if(live()){group.settled=true;receive(group,envelope);}},
        onError:function(error){if(!live()){return;}group.settled=true;group.error=errorCode(error);if(group.error==='TIMEOUT'||group.error==='PLUGIN_UNAVAILABLE'||group.error==='RATE_LIMITED'){uncertain(group);}else{group.cards=[];}publish();}});
      if(live()){group.handle=handle;}else if(handle && typeof handle.unsubscribe==='function'){handle.unsubscribe();}
    }catch(error){group.settled=true;group.error=errorCode(error);group.cards=[];publish();}
  }
  function discover(rebind){
    if(stopped||!connected||!enabled){return;}
    available=typeof pebble.enumeratePlugins==='function' && typeof pebble.subscribeToSource==='function';
    if(!available){Object.keys(groups).forEach(cleanGroup);lastError='API_UNAVAILABLE';publish();return;}
    var run=++generation;enumerated=false;
    function apply(plugins){
      if(run!==generation||stopped||!connected||!enabled){return;}
      if(!Array.isArray(plugins)){lastError='INVALID_CATALOGUE';Object.keys(groups).forEach(cleanGroup);publish();return;}
      var items=Object.create(null),metadata=Object.create(null);
      plugins.filter(function(p){return compatible(p,nativeFormat);}).forEach(function(p){
        // The official plugin-test app reads enumeratePlugins().name. Treat it
        // as untrusted display metadata, never as source/revision identity.
        if(!metadata[p.uuid]){metadata[p.uuid]={uuid:p.uuid,name:wire.text(p.name,64),item:sourceItem(p,nativeFormat),available:true};}
      });
      installed=Object.keys(metadata).sort().slice(0,wire.LIMITS.providers).map(function(uuid){return metadata[uuid];});
      providerMetadata=Object.create(null);installed.forEach(function(p){providerMetadata[p.uuid]=p;});
      var providers=installed.filter(function(p){return allowed(p.uuid);}).map(function(p){items[p.uuid]=p.item;return p.uuid;});
      enumerated=true;
      Object.keys(groups).forEach(function(provider){if(providers.indexOf(provider)<0){cleanGroup(provider);}});
      providers.forEach(function(provider){if(rebind||!groups[provider]||groups[provider].item!==items[provider]){bind(provider,items[provider]);}});
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
    if(!enabled){invalidateDelivery();Object.keys(groups).forEach(cleanGroup);lastSignature='';if(expiryTimer!==null){cancel(expiryTimer);expiryTimer=null;}if(discoveryTimer!==null){cancel(discoveryTimer);discoveryTimer=null;}
      if(previous && connected && session && typeof send==='function'){sequence=sequence===wire.MAX_EPOCH?1:sequence+1;var payload={};payload[key('ACTIVITY_DATA')]=codec.encode([],{session:session,revision:sequence,sentAt:seconds()});try{send(payload,function(){},function(){});}catch(ignored){}}
      notify();return;
    }
    // Apply known policy immediately: asynchronous discovery may be slow or
    // never settle, and cannot be the boundary for withdrawing private data.
    var removed=false;
    Object.keys(groups).forEach(function(provider){if(!allowed(provider)){cleanGroup(provider);removed=true;}});
    if(removed){publish();}
    discover(false);
  }
  function refresh(rebaseline,token){
    if(stopped){return;}
    if(typeof rebaseline==='number'){token=rebaseline;rebaseline=true;}
    if(wire.integer(token,2,wire.MAX_EPOCH) && token!==session){invalidateDelivery();session=token;sequence=0;lastSignature='';failureCount=0;}
    else if(rebaseline && !token){bootRequested=false;bootAttempts=0;}failureCount=0;
    currentSettings=readSettings();enabled=isEnabled(currentSettings);
    if(!enabled){configure();return;}
    discover(true);publish(true);
  }
  function connectionChanged(value,token){
    if(stopped || typeof value!=='boolean'){return;}
    connected=value;generation++;
    if(!connected){invalidateDelivery();Object.keys(groups).forEach(cleanGroup);session=0;sequence=0;lastSignature='';
      [expiryTimer,discoveryTimer,retryTimer,bootTimer].forEach(function(timer){if(timer!==null){cancel(timer);}});expiryTimer=discoveryTimer=retryTimer=bootTimer=null;notify();}
    else{refresh(true,token);}
  }
  return {refresh:refresh,configure:configure,connectionChanged:connectionChanged,reproject:function(){publish(true);},
    providers:function(){return clone(installed);},
    catalogue:function(){return catalogue(true);},
    view:function(){return lastView?clone(lastView):null;},
    status:function(){var providers=Object.keys(groups).map(function(provider){var group=groups[provider];return {pluginUuid:provider,state:group.error?'unavailable':group.ready?'ready':'waiting',error:group.error,receivedAt:group.receivedAt};});var count=catalogueCount(),complete=enumerated&&Object.keys(groups).every(function(provider){return groups[provider].settled;});var ready=enabled&&available&&connected&&enumerated&&providers.every(function(p){return p.state==='ready';});return {available:available,connected:connected,enabled:enabled,ready:ready,complete:complete,phase:ready?'ready':count?'partial':complete||lastError||!connected||!available?'unavailable':'loading',error:lastError||providers.map(function(p){return p.error;}).filter(Boolean)[0]||'',providers:providers,count:count};},
    stop:function(){stopped=true;generation++;invalidateDelivery();Object.keys(groups).forEach(cleanGroup);[expiryTimer,discoveryTimer,retryTimer,bootTimer].forEach(function(timer){if(timer!==null){cancel(timer);}});expiryTimer=discoveryTimer=retryTimer=bootTimer=null;revisions=Object.create(null);orders=Object.create(null);}}
};
module.exports.sourceCard=sourceCard;
module.exports.compatible=compatible;
module.exports.PROPERTIES=PROPERTIES;
