'use strict';

// Schema 4 is semantic source content. Layout and source observation are never
// supplied by fresh-read authors; imported owners use the separate snapshot path.
var wire=require('./wire'),MAX=wire.MAX_EPOCH;
var ICONS=['activity','timer','stopwatch','media','message','call','navigation','workout','recording','download','delivery'];
var DIRECTIONS=['turn-left','turn-right','straight','u-turn'];
var STATES=['active','paused','completed','cancelled'];
var PLAYBACK=['playing','paused','buffering','stopped','unknown'];
var META_KEY='pebble.activities.summary.metadata.v1';
var LIMITS={records:16,descriptor:1024,text:192,label:32,name:64,value:64,unit:16,actions:1536,entity:256,openApp:96};
var SOURCE_PROPERTIES={schema_version:['numericValue'],publisher_incarnation:['longText'],publisher_mode:['shortText'],snapshot_sequence:['numericValue'],activity_count:['numericValue'],
  revision:['numericValue'],observed_at:['timestamp'],valid_until:['timestamp'],private:['boolean'],unconfirmed:['boolean'],content:['longText'],
  app_name:['longText'],icon:['image','icon'],artwork:['image','icon'],entity_ref:['longText'],actions:['longText'],open_app:['longText']};
var SHARED=['id','type','name','icon','visibleUntil','entityRef','actions','openApp'];
function own(v,k){return Object.prototype.hasOwnProperty.call(v,k);}
function known(v,keys){return wire.object(v)&&Object.keys(v).every(function(k){return keys.indexOf(k)>=0;});}
function finite(v){return typeof v==='number'&&isFinite(v);}
function text(v,max){
  if(typeof v!=='string'||/[\x00-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(v)){return null;}
  var t=v.trim();
  if(!t||wire.utf8(t).length>max||/[\ud800-\udfff]/.test(t.replace(/[\ud800-\udbff][\udc00-\udfff]/g,''))){return null;}
  return t;
}
function bounded(v,max){try{return wire.utf8(JSON.stringify(v)).length<=max;}catch(ignored){return false;}}
function jsonValue(v,depth){
  if(v===null||typeof v==='string'||typeof v==='boolean'){return true;}
  if(typeof v==='number'){return finite(v);}
  if(depth<0||typeof v!=='object'){return false;}
  if(Array.isArray(v)){return v.every(function(x){return jsonValue(x,depth-1);});}
  if(!wire.object(v)||Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null){return false;}
  return Object.keys(v).every(function(k){return jsonValue(v[k],depth-1);});
}
function extension(input,name){
  if(name==='openApp'){
    return known(input,['watchAppUuid'])&&wire.uuid(input.watchAppUuid)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(input.watchAppUuid)?{watchAppUuid:input.watchAppUuid}:null;
  }
  if(name==='entityRef'){
    if(!known(input,['category','item','instanceId'])){return null;}
    var out={};
    if(!['category','item','instanceId'].every(function(k){out[k]=text(input[k],64);return !!out[k];})){return null;}
    return bounded(out,LIMITS.entity)?out:null;
  }
  if(!Array.isArray(input)||input.length>3){return null;}
  var ids=Object.create(null),result=[];
  for(var i=0;i<input.length;i++){
    var a=input[i];if(!known(a,['id','label','action','args','semantic'])){return null;}
    var action={id:text(a.id,32),label:text(a.label,32),action:text(a.action,64),args:a.args===undefined?{}:a.args};
    if(!action.id||!action.label||!action.action||ids[action.id]||!wire.object(action.args)||!jsonValue(action.args,4)||!bounded(action.args,256)){return null;}
    ids[action.id]=true;
    if(a.semantic!==undefined){if(['play','pause','resume','stop','next','previous','cancel','acknowledge'].indexOf(a.semantic)<0){return null;}action.semantic=a.semantic;}
    result.push(action);
  }
  return bounded(result,LIMITS.actions)?result:null;
}
function datum(input,observedAt){
  if(!wire.object(input)){return null;}
  var d={type:input.type},keys=['type','label'];
  if(input.type==='text'){
    keys.push('text');d.text=text(input.text,LIMITS.text);if(!d.text){return null;}
  }else if(input.type==='value'){
    keys=keys.concat(['value','unit','range','symbol']);
    d.value=finite(input.value)?input.value:text(input.value,LIMITS.value);if(d.value===null){return null;}
    if(input.unit!==undefined){d.unit=text(input.unit,LIMITS.unit);if(!d.unit){return null;}}
    if(input.range!==undefined){
      var r=input.range,min=r&&r.min===undefined?0:r&&r.min;
      if(!known(r,['min','max'])||!finite(d.value)||!finite(min)||!finite(r.max)||r.max<=min||d.value<min||d.value>r.max){return null;}
      d.range={min:min,max:r.max};
    }
    if(input.symbol!==undefined){if(DIRECTIONS.indexOf(input.symbol)<0){return null;}d.symbol=input.symbol;}
  }else if(input.type==='clock'){
    keys=keys.concat(['mode','deadline','since','seconds']);d.mode=input.mode;
    if(d.mode==='countdown'){
      if(input.since!==undefined||own(input,'deadline')===own(input,'seconds')){return null;}
      if(own(input,'deadline')){if(!wire.integer(input.deadline,1,MAX)){return null;}d.deadline=input.deadline;}
      else{if(!wire.integer(input.seconds,0,MAX)){return null;}d.seconds=input.seconds;}
    }else if(d.mode==='elapsed'){
      if(input.deadline!==undefined||input.since===undefined&&input.seconds===undefined){return null;}
      if(input.since!==undefined){if(!wire.integer(input.since,1,observedAt||MAX)){return null;}d.since=input.since;}
      if(input.seconds!==undefined){if(!wire.integer(input.seconds,0,MAX)){return null;}d.seconds=input.seconds;}
    }else{return null;}
  }else{return null;}
  if(!known(input,keys)){return null;}
  if(input.label!==undefined){d.label=text(input.label,LIMITS.label);if(!d.label){return null;}}
  return d;
}
function descriptor(record){
  var out={};Object.keys(record).forEach(function(k){
    if(k==='artwork'||k==='entityRef'||k==='actions'||k==='openApp'||k==='icon'&&typeof record.icon!=='string'){return;}out[k]=record[k];
  });return out;
}
function normalize(input,observedAt){
  var keys=SHARED.concat(input&&input.type==='media'?['title','artist','artwork','itemId','playback']:['headline','detail','summary','state','result']);
  if(!known(input,keys)||!text(input.id,64)||input.id[0]==='@'||input.id!==input.id.trim()){return null;}
  var out={id:input.id,type:input.type};
  if(input.name!==undefined){out.name=text(input.name,LIMITS.name);if(!out.name){return null;}}
  if(input.icon!==undefined){
    out.icon=typeof input.icon==='string'?(ICONS.indexOf(input.icon)>=0?input.icon:null):wire.image(input.icon);if(!out.icon){return null;}
  }
  if(input.visibleUntil!==undefined){if(!wire.integer(input.visibleUntil,1,MAX)){return null;}out.visibleUntil=input.visibleUntil;}
  ['entityRef','actions','openApp'].forEach(function(k){if(input[k]!==undefined){out[k]=extension(input[k],k);}});
  if(['entityRef','actions','openApp'].some(function(k){return own(out,k)&&out[k]===null;})){return null;}
  if(input.type==='standard'){
    out.headline=datum(input.headline,observedAt);if(!out.headline){return null;}
    if(input.detail!==undefined){out.detail=datum(input.detail,observedAt);if(!out.detail){return null;}}
    out.summary=input.summary===undefined?'headline':input.summary;
    out.state=input.state===undefined?'active':input.state;out.result=input.result===undefined?false:input.result;
    if(['headline','detail'].indexOf(out.summary)<0||out.summary==='detail'&&!out.detail||STATES.indexOf(out.state)<0||typeof out.result!=='boolean'||out.result&&out.state!=='completed'&&out.state!=='cancelled'){return null;}
  }else if(input.type==='media'){
    out.title=text(input.title,LIMITS.text);if(!out.title){return null;}
    if(input.artist!==undefined){out.artist=text(input.artist,LIMITS.text);if(!out.artist){return null;}}
    if(input.itemId!==undefined){out.itemId=text(input.itemId,64);if(!out.itemId){return null;}}
    out.playback=input.playback===undefined?'unknown':input.playback;if(PLAYBACK.indexOf(out.playback)<0){return null;}
    if(input.artwork!==undefined){out.artwork=wire.image(input.artwork);if(!out.artwork){return null;}}
  }else{return null;}
  return bounded(descriptor(out),LIMITS.descriptor)?out:null;
}
function sourceRecord(input,provider){
  if(!wire.object(input)||!wire.uuid(provider||input.provider)||!wire.integer(input.revision,1,MAX)||
    !wire.integer(input.observedAt,1,MAX)||!wire.integer(input.validUntil,input.observedAt,MAX)||
    input.private!==undefined&&typeof input.private!=='boolean'||input.unconfirmed!==undefined&&typeof input.unconfirmed!=='boolean'){return null;}
  var record=normalize(input.record,input.observedAt);if(!record){return null;}
  var out={provider:provider||input.provider,record:record,id:record.id,type:record.type,revision:input.revision,observedAt:input.observedAt,
    validUntil:Math.min(input.validUntil,record.visibleUntil===undefined?MAX:record.visibleUntil),private:record.type==='media'||input.private!==false,
    unconfirmed:input.unconfirmed===true,displayName:text(input.displayName,64)||''};
  if(out.validUntil<out.observedAt||out.private&&out.unconfirmed){return null;}
  return out;
}
function scalar(p,k,shape,field){return p&&p[k]&&p[k][shape]?p[k][shape][field||'value']:undefined;}
function parseJson(p,key,limit){var raw=scalar(p,key,'longText','text');if(typeof raw!=='string'||wire.utf8(raw).length>limit){return null;}try{return JSON.parse(raw);}catch(ignored){return null;}}
function sourceCard(instance,provider){
  var p=instance&&instance.properties;if(!wire.object(p)||scalar(p,'schema_version','numericValue')!==4){return null;}
  if(!wire.integer(scalar(p,'revision','numericValue'),1,MAX)||!wire.integer(scalar(p,'observed_at','timestamp'),1,MAX)||
      !wire.integer(scalar(p,'valid_until','timestamp'),1,MAX)||typeof scalar(p,'private','boolean')!=='boolean'||typeof scalar(p,'unconfirmed','boolean')!=='boolean'){return null;}
  if(p.icon!==undefined&&(!wire.object(p.icon)||!p.icon.image&&!p.icon.icon)||p.artwork!==undefined&&(!wire.object(p.artwork)||!p.artwork.image&&!p.artwork.icon)){return null;}
  var record=parseJson(p,'content',LIMITS.descriptor);if(!wire.object(record)||instance.instanceId!==record.id){return null;}
  delete record.entityRef;delete record.actions;delete record.openApp;
  if(p.icon!==undefined){record.icon=p.icon.image||p.icon.icon;}
  if(p.artwork!==undefined){record.artwork=p.artwork.image||p.artwork.icon;}
  // Malformed optional capabilities are discarded independently of content.
  [['entity_ref','entityRef',LIMITS.entity],['actions','actions',LIMITS.actions],['open_app','openApp',LIMITS.openApp]].forEach(function(pair){
    if(p[pair[0]]!==undefined){var value=extension(parseJson(p,pair[0],pair[2]),pair[1]);if(value!==null){record[pair[1]]=value;}}
  });
  return sourceRecord({record:record,revision:scalar(p,'revision','numericValue'),observedAt:scalar(p,'observed_at','timestamp'),
    validUntil:scalar(p,'valid_until','timestamp'),private:scalar(p,'private','boolean'),unconfirmed:scalar(p,'unconfirmed','boolean'),
    displayName:scalar(p,'app_name','longText','text')},provider);
}
function header(envelope){
  if(!envelope||!Array.isArray(envelope.instances)||envelope.instances.length>17){return null;}
  var found=envelope.instances.filter(function(i){return i&&i.instanceId==='@snapshot';});
  if(found.length!==1){return null;}var p=found[0].properties;
  var h={mode:scalar(p,'publisher_mode','shortText','text'),incarnation:scalar(p,'publisher_incarnation','longText','text'),sequence:scalar(p,'snapshot_sequence','numericValue'),count:scalar(p,'activity_count','numericValue')};
  return scalar(p,'schema_version','numericValue')===4&&['fresh','snapshot'].indexOf(h.mode)>=0&&typeof h.incarnation==='string'&&text(h.incarnation,64)===h.incarnation&&wire.integer(h.sequence,1,MAX)&&wire.integer(h.count,0,16)&&h.count===envelope.instances.length-1?h:null;
}
function base64(bytes){var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out='';for(var i=0;i<bytes.length;i+=3){var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;out+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|(c>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');}return out;}
function imageProperty(image){return {image:{width:image.width,height:image.height,palette:base64(image.palette),pixels:base64(image.pixels)}};}
function toSourceInstance(input,request){
  var value=sourceRecord(input);if(!value){return null;}var r=value.record;
  var p={schema_version:{numericValue:{value:4}},revision:{numericValue:{value:value.revision}},observed_at:{timestamp:{value:value.observedAt}},valid_until:{timestamp:{value:value.validUntil}},
    private:{boolean:{value:value.private}},unconfirmed:{boolean:{value:value.unconfirmed}},content:{longText:{text:JSON.stringify(descriptor(r))}}};
  if(value.displayName){p.app_name={longText:{text:value.displayName}};}
  if(request&&request.iconPixelSize){if(r.icon&&typeof r.icon!=='string'){p.icon=imageProperty(r.icon);}if(r.artwork){p.artwork=imageProperty(r.artwork);}}
  [['entityRef','entity_ref'],['actions','actions'],['openApp','open_app']].forEach(function(pair){if(r[pair[0]]!==undefined){p[pair[1]]={longText:{text:JSON.stringify(r[pair[0]])}};}});
  return {instanceId:r.id,properties:p};
}
function provider(options,snapshot){
  options=options||{};
  if(!wire.uuid(options.pluginUuid)||!options.storage||typeof options.storage.getItem!=='function'||typeof options.storage.setItem!=='function'||typeof options[snapshot?'readSnapshot':'readCurrent']!=='function'){throw new Error('INVALID_PROVIDER');}
  var refresh=options.refreshSeconds===undefined?30:options.refreshSeconds,validity=options.validitySeconds===undefined?90:options.validitySeconds;
  if(!wire.integer(refresh,1,MAX)||!wire.integer(validity,refresh+1,MAX)){throw new Error('INVALID_VALIDITY');}
  var now=options.now||Date.now,key=options.metadataKey||META_KEY;
  function reserve(){
    var meta;
    try{meta=JSON.parse(options.storage.getItem(key));}catch(ignored){}
    if(!known(meta,['version','incarnation','sequence'])||meta.version!==1||!text(meta.incarnation,64)||!wire.integer(meta.sequence,0,MAX)){
      meta={version:1,incarnation:String(now())+'-'+String(Math.random()).slice(2),sequence:0};
    }
    if(meta.sequence===MAX){throw new Error('SEQUENCE_EXHAUSTED');}meta.sequence++;
    var encoded=JSON.stringify(meta);options.storage.setItem(key,encoded);if(options.storage.getItem(key)!==encoded){throw new Error('STORAGE_UNAVAILABLE');}
    return meta;
  }
  function source(request){
    return Promise.resolve().then(function(){
    var meta=reserve();
    return Promise.resolve(options[snapshot?'readSnapshot':'readCurrent'](request||{})).then(function(raw){
      var records=Array.isArray(raw)?raw:raw&&raw.records,time=now(),observed=Math.max(1,Math.floor(time/1000)),seen=Object.create(null),instances=[];
      if(!Array.isArray(records)||records.length>16){throw new Error('INVALID_SNAPSHOT');}
      records.forEach(function(input){
        var entry;
        if(snapshot){entry=typeof options.adapt==='function'?options.adapt(input):input;}
        else{entry={record:input,revision:meta.sequence,observedAt:observed,validUntil:Math.min(MAX,observed+validity),private:true,unconfirmed:false};}
        if(!entry){throw new Error('INVALID_SNAPSHOT');}
        var copy={};Object.keys(entry).forEach(function(k){copy[k]=entry[k];});copy.displayName=options.displayName||copy.displayName;
        if(copy.record&&copy.record.visibleUntil!==undefined&&wire.integer(copy.record.visibleUntil,1,MAX)&&copy.record.visibleUntil<=observed){return;}
        if(copy.record&&copy.record.icon===undefined&&options.icon!==undefined){copy.record=helper({icon:options.icon},copy.record);}
        var result=sourceRecord(copy,options.pluginUuid);if(!result||seen[result.id]){throw new Error('INVALID_SNAPSHOT');}seen[result.id]=true;
        if(result.record.type==='standard'&&(result.record.state==='completed'||result.record.state==='cancelled')&&!result.record.result){return;}
        if(result.validUntil>observed){var instance=toSourceInstance(result,request);if(!instance){throw new Error('INVALID_SNAPSHOT');}instances.push(instance);}
      });
      var count=instances.length;
      instances.unshift({instanceId:'@snapshot',properties:{schema_version:{numericValue:{value:4}},publisher_incarnation:{longText:{text:meta.incarnation}},publisher_mode:{shortText:{text:snapshot?'snapshot':'fresh'}},snapshot_sequence:{numericValue:{value:meta.sequence}},activity_count:{numericValue:{value:count}}}});
      var expiry=Math.min(MAX*1000,time+(snapshot?refresh:validity)*1000);
      if(raw&&!Array.isArray(raw)&&raw.validUntilMs!==undefined){if(!wire.integer(raw.validUntilMs,1,MAX*1000)){throw new Error('INVALID_SNAPSHOT');}expiry=Math.min(expiry,raw.validUntilMs);}
      return {validUntilMs:expiry,instances:instances};
    });
    });
  }
  function handleSource(request,respond){
    if(!request||request.category!=='activity'||request.item!=='summary'){if(respond&&respond.error){respond.error('INVALID_REQUEST','Unsupported source');}return Promise.resolve();}
    return Promise.resolve().then(function(){return source(request);}).then(function(result){respond.data(result);},function(error){respond.error(error&&/^(STORAGE_UNAVAILABLE|SEQUENCE_EXHAUSTED)$/.test(error.message)?error.message:'INVALID_DATA','Activity source unavailable');});
  }
  return {source:source,handleSource:handleSource,sourceDeclaration:{category:'activity',items:['summary'],properties:SOURCE_PROPERTIES,supportsMultiple:true,suggestedRefreshIntervalSec:refresh}};
}
function helper(base,options){var result={};Object.keys(options||{}).forEach(function(k){result[k]=options[k];});Object.keys(base).forEach(function(k){result[k]=base[k];});return result;}
function timerSnapshot(raw){
  var original=wire.normalize(raw);if(!original||original.kind!=='timer'){return null;}
  var headline;
  if(original.state==='active'&&original.clock==='deadline'){headline={type:'clock',mode:'countdown',deadline:original.deadline};}
  else if(original.state==='paused'&&original.clock==='deadline'){headline={type:'clock',mode:'countdown',seconds:original.duration};}
  else{headline={type:'text',text:original.state==='completed'?'Finished':'Cancelled'};}
  var record={id:original.id,type:'standard',icon:'timer',headline:headline,state:original.state,result:raw.showTerminal===true,
    openApp:{watchAppUuid:'50e9ef12-a5ab-4369-a3b5-3447bfba5151'}};
  var name=text(original.footer,64);if(name){record.name=name;}
  var validUntil=original.validUntil;
  if(original.state==='paused'){validUntil=Math.min(validUntil,original.observedAt+300);}
  if(original.state==='active'&&original.deadline){validUntil=Math.min(validUntil,original.deadline+60);}
  return {record:record,revision:original.revision,observedAt:original.observedAt,validUntil:validUntil,private:original.private,unconfirmed:true};
}
function toView(input,provider){return require('./summary-view').fromSummary(input,provider);}
module.exports={VERSION:4,CATEGORY:'activity',ITEM:'summary',LIMITS:LIMITS,ICONS:ICONS,DIRECTIONS:DIRECTIONS,METADATA_KEY:META_KEY,
  SOURCE_PROPERTIES:SOURCE_PROPERTIES,PROPERTIES:Object.keys(SOURCE_PROPERTIES),normalize:normalize,datum:datum,sourceRecord:sourceRecord,sourceCard:sourceCard,header:header,
  descriptor:descriptor,toSourceInstance:toSourceInstance,toView:toView,extension:extension,
  standard:function(id,options){return helper({id:id,type:'standard'},options);},media:function(id,options){return helper({id:id,type:'media'},options);},
  text:function(value,options){return helper({type:'text',text:value},options);},
  value:function(value,unit,options){var out={type:'value',value:value};if(unit!==undefined&&unit!==''){out.unit=unit;}return helper(out,options);},
  countdown:function(options){return helper({type:'clock',mode:'countdown'},options);},elapsed:function(options){return helper({type:'clock',mode:'elapsed'},options);},
  defineProvider:function(options){return provider(options,false);},defineSnapshotProvider:function(options){return provider(options,true);},adapters:{timerSnapshot:timerSnapshot}};
