'use strict';

// Public notification-style activities. The ACT2 card is an internal transport
// adapter; plugins never arrange slots, mandatory labels, meters or layouts.
var wire=require('./wire'),view=require('./view'),MAX=wire.MAX_EPOCH;
var LIMITS={text:192,label:64,appName:32,descriptor:512};
var SOURCE_PROPERTIES={schema_version:['numericValue'],kind:['shortText'],state:['shortText'],revision:['numericValue'],
  app_name:['longText'],observed_at:['timestamp'],valid_until:['timestamp'],private:['boolean'],
  unconfirmed:['boolean'],show_terminal:['boolean'],content:['longText'],detail:['longText'],artwork:['image','icon']};
var FIELDS=['provider','id','kind','state','revision','appName','observedAt','validUntil','private','unconfirmed','showTerminal','content','detail','image'];
var DATUM_FIELDS=['label','observedAt','validUntil','estimated'];
function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
function known(value,keys){return wire.object(value)&&Object.keys(value).every(function(key){return keys.indexOf(key)>=0;});}
function bool(value){return value===undefined||typeof value==='boolean';}
function finite(value){return typeof value==='number'&&isFinite(value);}
function string(value,limit){return typeof value==='string'&&value.length<=limit&&wire.utf8(value).length<=limit?wire.text(value,limit):null;}
function datum(input,card){
  if(typeof input==='string'){input={text:input};}
  if(!wire.object(input)){return null;}
  var keys=DATUM_FIELDS.concat(own(input,'text')?['text']:own(input,'value')?['value','unit']:['clock','deadline','seconds','since']);
  if(!known(input,keys)||!bool(input.estimated)){return null;}
  var out={},label=input.label===undefined?'':string(input.label,LIMITS.label);
  if(label===null){return null;}if(label){out.label=label;}
  if(input.observedAt!==undefined){out.observedAt=input.observedAt;}
  if(input.validUntil!==undefined){out.validUntil=input.validUntil;}
  if(input.estimated!==undefined){out.estimated=input.estimated;}
  var observed=input.observedAt===undefined?card.observedAt:input.observedAt;
  var expiry=input.validUntil===undefined?card.validUntil:input.validUntil;
  if(!wire.integer(observed,1,card.observedAt)||!wire.integer(expiry,observed,card.validUntil)){return null;}
  if(own(input,'text')){
    out.text=string(input.text,LIMITS.text);if(!out.text){return null;}
  }else if(own(input,'value')){
    if(finite(input.value)){out.value=input.value;}
    else if(typeof input.value==='string'&&input.unit===undefined){out.value=string(input.value,LIMITS.text);if(!out.value){return null;}}
    else{return null;}
    if(input.unit!==undefined){out.unit=string(input.unit,16);if(out.unit===null){return null;}}
    if(wire.utf8(typeof out.value==='string'?out.value:view.numericText(out.value,out.unit)).length>LIMITS.text){return null;}
  }else{
    out.clock=input.clock;
    if(out.clock==='countdown'){
      if(input.since!==undefined||own(input,'deadline')===own(input,'seconds')){return null;}
      if(own(input,'deadline')){if(!wire.integer(input.deadline,1,MAX)){return null;}out.deadline=input.deadline;}
      else{if(!wire.integer(input.seconds,0,MAX)){return null;}out.seconds=input.seconds;}
    }else if(out.clock==='elapsed'){
      if(input.deadline!==undefined||input.since===undefined&&input.seconds===undefined){return null;}
      if(input.since!==undefined){if(!wire.integer(input.since,1,observed)){return null;}out.since=input.since;}
      if(input.seconds!==undefined){if(!wire.integer(input.seconds,0,MAX)){return null;}out.seconds=input.seconds;}
    }else{return null;}
  }
  return wire.utf8(JSON.stringify(out)).length<=LIMITS.descriptor?out:null;
}
function normalize(input,provider){
  if(!known(input,FIELDS)||!wire.uuid(provider||input.provider)||!wire.identity(input.id,64)||
      !wire.integer(input.revision,1,MAX)||!wire.integer(input.observedAt,1,MAX)||
      !wire.integer(input.validUntil,input.observedAt,MAX)||!bool(input.private)||!bool(input.unconfirmed)||!bool(input.showTerminal)){return null;}
  var kind=input.kind===undefined?'activity':wire.identity(input.kind,24),state=input.state===undefined?'active':input.state;
  if(!kind||!own(wire.STATES,state)){return null;}kind=kind.toLowerCase();
  var app=input.appName===undefined?'':string(input.appName,LIMITS.appName);if(app===null){return null;}
  var result={provider:provider||input.provider,id:input.id,kind:kind,state:state,revision:input.revision,
    observedAt:input.observedAt,validUntil:input.validUntil,private:input.private!==false||kind==='music'||kind==='notification'||kind==='notifications',
    unconfirmed:input.unconfirmed===true,showTerminal:input.showTerminal===true,appName:app};
  if(result.private&&result.unconfirmed){return null;}
  result.content=datum(input.content,result);if(!result.content){return null;}
  result.detail=input.detail===undefined||input.detail===null?null:datum(input.detail,result);
  if(input.detail!==undefined&&input.detail!==null&&!result.detail){return null;}
  if(input.image!==undefined&&input.image!==null){result.image=wire.image(input.image);if(!result.image){return null;}}
  return result;
}
function compiledDatum(input,card){
  var label=input.label||card.appName||'Activity';
  var observed=input.observedAt===undefined?card.observedAt:input.observedAt;
  var out={label:label,observedAt:observed,validUntil:input.validUntil===undefined?card.validUntil:input.validUntil,
    estimated:input.estimated===true,retain:!card.private};
  if(input.text!==undefined){out.type='text';out.text=input.text;}
  else if(input.value!==undefined){out.type='value';if(typeof input.value==='string'){out.text=input.value;}else{out.value=input.value;out.unit=input.unit||'';}}
  else{
    out.type='clock';out.mode=input.clock==='countdown'?'deadline':'elapsed';
    out.running=input.deadline!==undefined||input.since!==undefined;
    out.anchorAt=out.running?(input.since===undefined?observed:input.since):0;
    out.baseSeconds=input.deadline===undefined?input.seconds||0:Math.max(0,input.deadline-observed);
  }
  return out;
}
function toView(input,provider){
  var record=normalize(input,provider);if(!record){return null;}
  var projection={provider:record.provider,id:record.id,kind:record.kind,state:record.state,revision:record.revision,
    observedAt:record.observedAt,validUntil:record.validUntil,private:record.private,unconfirmed:record.unconfirmed,
    showTerminal:record.showTerminal,caption:record.appName||'Activity',main:compiledDatum(record.content,record),
    support:record.detail?compiledDatum(record.detail,record):null,image:record.image};
  var card=view.normalize(projection);
  // A bounded native host can omit optional detail, never an essential value,
  // unit or clock. This does not modify the authoritative source/fingerprint.
  if(!card&&projection.support){projection.support=null;card=view.normalize(projection);}
  if(card){card.sourceFormat=3;if(record.appName){card.providerName=record.appName;}}
  return card;
}
function scalar(p,name,shape,field){return p&&p[name]&&p[name][shape]?p[name][shape][field||'value']:undefined;}
function parseDescriptor(p,name,optional){
  if(!p||p[name]===undefined){return optional?null:undefined;}
  var raw=scalar(p,name,'longText','text');
  if(typeof raw!=='string'||raw.length>LIMITS.descriptor||wire.utf8(raw).length>LIMITS.descriptor){return undefined;}
  try{var value=JSON.parse(raw);return wire.object(value)||typeof value==='string'?value:undefined;}catch(ignored){return undefined;}
}
function sourceCard(instance,provider){
  var p=instance&&instance.properties;if(!wire.object(p)||scalar(p,'schema_version','numericValue')!==3){return null;}
  var malformed=Object.keys(SOURCE_PROPERTIES).some(function(name){
    if(p[name]===undefined||name==='artwork'){return false;}
    var shape=SOURCE_PROPERTIES[name][0],field=shape==='shortText'||shape==='longText'?'text':'value';
    return !wire.object(p[name])||!wire.object(p[name][shape])||scalar(p,name,shape,field)===undefined;
  });
  if(malformed||p.artwork!==undefined&&(!wire.object(p.artwork)||!p.artwork.image&&!p.artwork.icon)){return null;}
  var content=parseDescriptor(p,'content',false),detail=parseDescriptor(p,'detail',true);
  if(content===undefined||detail===undefined){return null;}
  return normalize({provider:provider,id:instance.instanceId,kind:scalar(p,'kind','shortText','text'),state:scalar(p,'state','shortText','text'),
    revision:scalar(p,'revision','numericValue'),appName:scalar(p,'app_name','longText','text'),observedAt:scalar(p,'observed_at','timestamp'),
    validUntil:scalar(p,'valid_until','timestamp'),private:scalar(p,'private','boolean'),unconfirmed:scalar(p,'unconfirmed','boolean'),
    showTerminal:scalar(p,'show_terminal','boolean'),content:content,detail:detail,image:p.artwork&&(p.artwork.image||p.artwork.icon)},provider);
}
function toSourceInstance(input,request){
  var record=normalize(input);if(!record){return null;}
  var p={schema_version:{numericValue:{value:3}},kind:{shortText:{text:record.kind}},state:{shortText:{text:record.state}},
    revision:{numericValue:{value:record.revision}},app_name:{longText:{text:record.appName}},observed_at:{timestamp:{value:record.observedAt}},
    valid_until:{timestamp:{value:record.validUntil}},private:{boolean:{value:record.private}},unconfirmed:{boolean:{value:record.unconfirmed}},
    show_terminal:{boolean:{value:record.showTerminal}},content:{longText:{text:JSON.stringify(record.content)}}};
  if(record.detail){p.detail={longText:{text:JSON.stringify(record.detail)}};}
  if(record.image&&request&&request.iconPixelSize){
    var internal=view.toSourceInstance(toView(record),request);if(!internal){return null;}p.artwork=internal.properties.artwork;
  }
  return {instanceId:record.id,properties:p};
}
function fromLegacy(input,options){
  options=options||{};var record=wire.normalize(input);if(!record){return null;}
  var content;
  if(record.clock==='deadline'){content={clock:'countdown'};content[record.state==='active'?'deadline':'seconds']=record.state==='active'?record.deadline:record.duration;}
  else if(record.clock==='elapsed'){content={clock:'elapsed',seconds:record.duration};if(record.state==='active'){content.since=record.clockAt;}}
  else if(record.kind==='timer'&&(record.state==='completed'||record.state==='cancelled')){content=record.state==='completed'?'Finished':'Cancelled';}
  else{content=record.value===undefined?record.main:{value:record.value,unit:record.unit};}
  return normalize({provider:record.provider,id:record.id,kind:record.kind,state:record.state,revision:record.revision,
    appName:options.appName||'',observedAt:record.observedAt,validUntil:record.validUntil,private:record.private,
    unconfirmed:record.unconfirmed,showTerminal:input.showTerminal===true,content:content,image:record.image});
}
function helper(value,options){var result={};Object.keys(options||{}).forEach(function(k){result[k]=options[k];});Object.keys(value).forEach(function(k){result[k]=value[k];});return result;}
function value(number,unit,options){var out={value:number};if(unit!==undefined){out.unit=unit;}return helper(out,options);}
function countdown(options){return helper({clock:'countdown'},options);}
function elapsed(options){return helper({clock:'elapsed'},options);}
function createProvider(options){
  options=options||{};if(!wire.uuid(options.pluginUuid)||typeof options.getActivities!=='function'){throw new Error('INVALID_PROVIDER');}
  var now=options.now||Date.now;
  function source(request){
    var input=options.getActivities(),instances=[];if(!Array.isArray(input)||input.length>wire.LIMITS.instances){throw new Error('INVALID_ACTIVITIES');}
    var time=now(),ids=Object.create(null);
    input.forEach(function(raw){
      var copy={};if(!wire.object(raw)){throw new Error('INVALID_ACTIVITY');}Object.keys(raw).forEach(function(k){copy[k]=raw[k];});
      if(copy.appName===undefined){copy.appName=options.appName;}
      var record=normalize(copy,options.pluginUuid);if(!record||ids[record.id]){throw new Error('INVALID_ACTIVITY');}ids[record.id]=true;
      if(record.validUntil*1000>time){var instance=toSourceInstance(record,request);if(!instance){throw new Error('INVALID_ACTIVITY');}instances.push(instance);}
    });
    return {validUntilMs:Math.min(MAX*1000,Math.floor(time+30000)),instances:instances};
  }
  function handleSource(request,respond){
    if(!request||request.category!=='activity'||request.item!=='live'){if(respond&&typeof respond.error==='function'){respond.error('INVALID_REQUEST','Unsupported source');}return;}
    try{respond.data(source(request));}catch(ignored){if(respond&&typeof respond.error==='function'){respond.error('INVALID_DATA','Invalid activity snapshot');}}
  }
  return {source:source,handleSource:handleSource};
}
module.exports={VERSION:3,CATEGORY:'activity',ITEM:'live',LIMITS:LIMITS,SOURCE_PROPERTIES:SOURCE_PROPERTIES,PROPERTIES:Object.keys(SOURCE_PROPERTIES),
  normalize:normalize,toView:toView,sourceCard:sourceCard,toSourceInstance:toSourceInstance,fromLegacy:fromLegacy,
  value:value,countdown:countdown,elapsed:elapsed,createProvider:createProvider};
