'use strict';

// ACT2 is a bounded native view. Authoritative source revisions are checked by
// the consumer before projection; the frame sequence orders view changes.
var wire=require('./wire');
var MAX=wire.MAX_EPOCH;
var TYPES={text:1,value:2,clock:3};
var METERS={progress:1,level:2};
var LIMITS={cards:2,packet:2672,pool:320,label:64,text:192,caption:128};
var COMMON=['schema_version','kind','state','revision','name','caption','observed_at','valid_until','private','unconfirmed','show_terminal','artwork'];
var SOURCE_PROPERTIES={schema_version:['numericValue'],kind:['shortText'],state:['shortText'],revision:['numericValue'],
  name:['longText'],caption:['longText'],observed_at:['timestamp'],valid_until:['timestamp'],private:['boolean'],unconfirmed:['boolean'],show_terminal:['boolean'],artwork:['image','icon'],
  meter_kind:['shortText'],meter_source:['shortText'],meter_min:['numericValue'],meter_max:['numericValue']};
['main','support'].forEach(function(prefix){
  Object.keys({type:1,label:1,text:1,value:1,observed_at:1,valid_until:1,retain:1,estimated:1,clock:1,base:1,anchor:1,running:1}).forEach(function(suffix){
    SOURCE_PROPERTIES[prefix+'_'+suffix]=[suffix==='value'||suffix==='base'?'numericValue':suffix==='observed_at'||suffix==='valid_until'||suffix==='anchor'?'timestamp':suffix==='retain'||suffix==='estimated'||suffix==='running'?'boolean':suffix==='type'||suffix==='clock'?'shortText':'longText'];
  });
});
var PROPERTIES=Object.keys(SOURCE_PROPERTIES);
function bool(value){return value===undefined||typeof value==='boolean';}
function finite(value){return typeof value==='number'&&isFinite(value);}
function clean(value,limit){return wire.text(value,limit);}
function numericText(value,unit){return String(value)+(unit?(/^(%|°C|°F)$/.test(unit)?'':' ')+unit:'');}
function scalar(properties,name,shape,field){return properties&&properties[name]&&properties[name][shape]?properties[name][shape][field||'value']:undefined;}
function string(properties,name){var value=scalar(properties,name,'longText','text');return value===undefined?scalar(properties,name,'shortText','text'):value;}
function datum(input,card){
  if(!wire.object(input)||!Object.prototype.hasOwnProperty.call(TYPES,input.type)||!bool(input.retain)||!bool(input.estimated)||!bool(input.running)){return null;}
  var result={type:input.type,label:clean(input.label,LIMITS.label),text:'',
    observedAt:input.observedAt===undefined?card.observedAt:input.observedAt,
    validUntil:input.validUntil===undefined?card.validUntil:input.validUntil,
    retain:input.retain===true,estimated:input.estimated===true};
  if(!result.label||!wire.integer(result.observedAt,1,card.observedAt)||!wire.integer(result.validUntil,result.observedAt,card.validUntil)){return null;}
  if(input.type==='clock'){
    result.mode=input.mode;result.running=input.running===true;
    result.baseSeconds=input.baseSeconds===undefined?0:input.baseSeconds;
    result.anchorAt=input.anchorAt===undefined?0:input.anchorAt;
    if((result.mode!=='deadline'&&result.mode!=='elapsed')||!wire.integer(result.baseSeconds,0,MAX)||
        !wire.integer(result.anchorAt,0,result.observedAt)||(result.running?!result.anchorAt:result.anchorAt!==0)){return null;}
    if(input.text){return null;}
  } else {
    if(input.running===true||input.mode!==undefined||input.baseSeconds!==undefined&&input.baseSeconds!==0||input.anchorAt!==undefined&&input.anchorAt!==0){return null;}
    if(input.type==='value'&&input.value!==undefined){
      if(!finite(input.value)||input.unit!==undefined&&(typeof input.unit!=='string'||wire.utf8(input.unit).length>16)){return null;}
      result.value=input.value;result.unit=clean(input.unit,16);
      result.text=numericText(result.value,result.unit);
      if(input.text!==undefined&&input.text!==''&&clean(input.text,LIMITS.text)!==result.text){return null;}
    } else {result.text=clean(input.text,LIMITS.text);}
    if(!result.text||wire.utf8(result.text).length>LIMITS.text){return null;}
  }
  return result;
}
function poolFor(card){
  var bytes=[],known=Object.create(null);
  function add(value){
    value=value||'';
    if(Object.prototype.hasOwnProperty.call(known,value)){return known[value];}
    var encoded=wire.utf8(value),reference={offset:bytes.length,length:encoded.length};
    known[value]=reference;bytes=bytes.concat(encoded,[0]);return reference;
  }
  var refs={caption:add(card.caption),main:{label:add(card.main.label),text:add(card.main.text)}};
  if(card.support){refs.support={label:add(card.support.label),text:add(card.support.text)};}
  return {bytes:bytes,refs:refs};
}
function normalize(input,provider){
  if(!wire.object(input)||!wire.uuid(provider||input.provider)||!wire.identity(input.id,64)||!wire.identity(input.kind,24)||
      !wire.integer(input.revision,1,MAX)||!wire.integer(input.observedAt,1,MAX)||!wire.integer(input.validUntil,input.observedAt,MAX)||
      !Object.prototype.hasOwnProperty.call(wire.STATES,input.state)||!bool(input.private)||!bool(input.unconfirmed)||!bool(input.showTerminal)){return null;}
  var kind=input.kind.toLowerCase(),card={provider:provider||input.provider,id:input.id,kind:kind,revision:input.revision,state:input.state,
    observedAt:input.observedAt,validUntil:input.validUntil,private:input.private!==false||kind==='music'||kind==='notification'||kind==='notifications',
    unconfirmed:input.unconfirmed===true,showTerminal:input.showTerminal===true,caption:clean(input.caption===undefined?input.name:input.caption,LIMITS.caption)};
  if(card.private&&card.unconfirmed){return null;}
  card.main=datum(input.main,card);if(!card.main){return null;}
  card.support=input.support===undefined||input.support===null?null:datum(input.support,card);
  if(input.support!==undefined&&input.support!==null&&!card.support){return null;}
  card.meter=null;
  if(input.meter!==undefined&&input.meter!==null){
    var m=input.meter,target=card[m.source];
    if(!wire.object(m)||!Object.prototype.hasOwnProperty.call(METERS,m.kind)||(m.source!=='main'&&m.source!=='support')||!target||target.type!=='value'){return null;}
    var fraction;
    if(m.min!==undefined||m.max!==undefined){
      if(!finite(m.min)||!finite(m.max)||m.max<=m.min||!finite(target.value)||target.value<m.min||target.value>m.max){return null;}
      fraction=(target.value-m.min)/(m.max-m.min);
    } else {fraction=m.fraction;}
    if(!finite(fraction)||fraction<0||fraction>1){return null;}
    card.meter={kind:m.kind,source:m.source,fraction:fraction};
    if(m.min!==undefined){card.meter.min=m.min;card.meter.max=m.max;}
  }
  if(input.image!==undefined&&input.image!==null){card.image=wire.image(input.image);if(!card.image){return null;}}
  if(poolFor(card).bytes.length>LIMITS.pool){return null;}
  return card;
}
function fromLegacy(input,options){
  options=options||{};
  var legacy=wire.normalize(input);if(!legacy){return null;}
  var main,terminal=legacy.state==='completed'||legacy.state==='cancelled';
  if(legacy.clock!=='none'){
    main={type:'clock',label:legacy.clock==='deadline'?'Left':'Elapsed',mode:legacy.clock,running:legacy.state==='active',
      baseSeconds:legacy.clock==='deadline'&&legacy.state==='active'?Math.max(0,legacy.deadline-legacy.observedAt):legacy.duration,
      anchorAt:legacy.state==='active'?(legacy.clock==='deadline'?legacy.observedAt:legacy.clockAt):0,retain:!legacy.private};
  } else {
    main={type:legacy.value===undefined?'text':'value',label:terminal?'State':legacy.value===undefined?'Text':'Value',
      text:legacy.main|| (legacy.value===undefined?(terminal?legacy.state:''):numericText(legacy.value,legacy.unit))};
  }
  var card={provider:legacy.provider,id:legacy.id,kind:legacy.kind,revision:legacy.revision,state:legacy.state,
    observedAt:legacy.observedAt,validUntil:legacy.validUntil,private:legacy.private,unconfirmed:legacy.unconfirmed,
    caption:legacy.footer,main:main,image:legacy.image};
  if(legacy.kind==='timer'&&legacy.clock==='deadline'&&wire.integer(input.totalDuration,0,MAX)){
    card.support={type:'clock',label:'Elapsed',mode:'elapsed',running:legacy.state==='active',
      baseSeconds:Math.max(0,input.totalDuration-main.baseSeconds),anchorAt:legacy.state==='active'?legacy.observedAt:0,retain:!legacy.private};
  }
  if(options.terminalResults&&legacy.kind==='timer'&&legacy.state==='completed'){
    card.showTerminal=true;card.main={type:'text',label:'State',text:'Finished',retain:!legacy.private};
    if(wire.integer(input.totalDuration,0,MAX)){card.support={type:'clock',label:'Elapsed',mode:'elapsed',running:false,baseSeconds:input.totalDuration,anchorAt:0,retain:!legacy.private};}
  }
  // Legacy sources had separate maximum main/caption buffers. Fit the optional
  // caption into the shared pool; never trim a structured clock or value unit.
  var result=normalize(card);
  for(var limit=LIMITS.caption-1;!result&&limit>=0;limit--){card.caption=clean(legacy.footer,limit);result=normalize(card);}
  return result;
}
function put16(bytes,offset,value){bytes[offset]=value&255;bytes[offset+1]=(value>>>8)&255;}
function put32(bytes,offset,value){for(var i=0;i<4;i++){bytes[offset+i]=Math.floor(value/Math.pow(256,i))&255;}}
function writeDatum(header,offset,item,refs){
  if(!item){return;}
  header[offset]=TYPES[item.type];header[offset+1]=(item.type==='clock'&&item.mode==='elapsed'?1:0)|(item.running?2:0)|(item.retain?4:0)|(item.estimated?8:0);
  put32(header,offset+4,item.observedAt);put32(header,offset+8,item.validUntil);
  put32(header,offset+12,item.baseSeconds||0);put32(header,offset+16,item.anchorAt||0);
  put16(header,offset+20,refs.text.offset);put16(header,offset+22,refs.text.length);
  put16(header,offset+24,refs.label.offset);put16(header,offset+26,refs.label.length);
}
function encode(cards,options){
  options=options||{};var seq=options.sequence===undefined?options.revision:options.sequence;
  if(!Array.isArray(cards)||cards.length>2||!wire.integer(options.session,2,MAX)||!wire.integer(seq,1,MAX)||!wire.integer(options.sentAt,1,MAX)){throw new Error('INVALID_SNAPSHOT');}
  var out=[65,67,84,50,2,cards.length,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],seen=Object.create(null);
  put32(out,12,options.session);put32(out,16,seq);put32(out,20,options.sentAt);
  cards.forEach(function(raw){
    var card=normalize(raw);if(!card||seen[card.provider+'|'+card.id]){throw new Error('INVALID_ACTIVITY');}seen[card.provider+'|'+card.id]=true;
    var pool=poolFor(card),id=wire.utf8(card.id),header=[];
    for(var i=0;i<88;i++){header.push(0);}
    header[2]=wire.STATES[card.state];header[3]=(card.private?1:0)|(card.unconfirmed?2:0)|(card.showTerminal?4:0)|(card.image?8:0);
    put32(header,4,card.revision);put32(header,8,card.observedAt);put32(header,12,card.validUntil);
    header[16]=id.length;header[17]=card.image?card.image.width:0;header[18]=card.image?card.image.height:0;
    header[19]=card.meter?METERS[card.meter.kind]:0;put16(header,20,card.image?card.image.pixels.length:0);put16(header,22,pool.bytes.length);
    put16(header,24,pool.refs.caption.offset);put16(header,26,pool.refs.caption.length);
    put16(header,28,card.meter?Math.round(card.meter.fraction*65535):0);header[30]=card.meter&&card.meter.source==='support'?1:0;
    writeDatum(header,32,card.main,pool.refs.main);writeDatum(header,60,card.support,pool.refs.support);
    var record=header.concat(wire.utf8(card.provider),id,pool.bytes);
    if(card.image){record=record.concat(card.image.palette,card.image.pixels);}
    put16(record,0,record.length);out=out.concat(record);
  });
  if(out.length>LIMITS.packet){throw new Error('SNAPSHOT_TOO_LARGE');}
  put16(out,6,out.length);put16(out,8,wire.crc16(out));return out;
}
function readDatum(properties,prefix){
  var type=string(properties,prefix+'_type');if(type===undefined){return null;}
  var number=properties[prefix+'_value']&&properties[prefix+'_value'].numericValue;
  var body=string(properties,prefix+'_text');
  if(number&&(type!=='value'||body!==undefined&&body!=='')){return false;}
  return {type:type,label:string(properties,prefix+'_label'),text:body,
    value:number&&number.value,unit:number&&number.unit,observedAt:scalar(properties,prefix+'_observed_at','timestamp'),
    validUntil:scalar(properties,prefix+'_valid_until','timestamp'),retain:scalar(properties,prefix+'_retain','boolean'),estimated:scalar(properties,prefix+'_estimated','boolean'),
    mode:string(properties,prefix+'_clock'),running:scalar(properties,prefix+'_running','boolean'),
    baseSeconds:scalar(properties,prefix+'_base','numericValue'),anchorAt:scalar(properties,prefix+'_anchor','timestamp')};
}
function sourceCard(instance,provider){
  var p=instance&&instance.properties;if(!wire.object(p)||scalar(p,'schema_version','numericValue')!==2){return null;}
  var main=readDatum(p,'main'),support=readDatum(p,'support');if(!main||support===false){return null;}
  var meterKind=string(p,'meter_kind'),meter=meterKind&&meterKind!=='none'?{kind:meterKind,source:string(p,'meter_source'),min:scalar(p,'meter_min','numericValue'),max:scalar(p,'meter_max','numericValue')}:null;
  return normalize({provider:provider,id:instance.instanceId,kind:string(p,'kind'),revision:scalar(p,'revision','numericValue'),state:string(p,'state'),
    observedAt:scalar(p,'observed_at','timestamp'),validUntil:scalar(p,'valid_until','timestamp'),private:scalar(p,'private','boolean'),
    unconfirmed:scalar(p,'unconfirmed','boolean'),showTerminal:scalar(p,'show_terminal','boolean'),caption:string(p,'caption')===undefined?string(p,'name'):string(p,'caption'),
    main:main,support:support,meter:meter,image:p.artwork&&(p.artwork.image||p.artwork.icon)});
}
function base64(bytes){var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out='';for(var i=0;i<bytes.length;i+=3){var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;out+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|(c>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');}return out;}
function toSourceInstance(input,request){
  var card=normalize(input);if(!card){return null;}
  var p={schema_version:{numericValue:{value:2}},revision:{numericValue:{value:card.revision}},kind:{shortText:{text:card.kind}},state:{shortText:{text:card.state}},
    name:{longText:{text:card.caption}},caption:{longText:{text:card.caption}},observed_at:{timestamp:{value:card.observedAt}},valid_until:{timestamp:{value:card.validUntil}},
    private:{boolean:{value:card.private}},unconfirmed:{boolean:{value:card.unconfirmed}},show_terminal:{boolean:{value:card.showTerminal}}};
  ['main','support'].forEach(function(prefix){var d=card[prefix];if(!d){return;}
    p[prefix+'_type']={shortText:{text:d.type}};p[prefix+'_label']={longText:{text:d.label}};
    p[prefix+'_observed_at']={timestamp:{value:d.observedAt}};p[prefix+'_valid_until']={timestamp:{value:d.validUntil}};
    p[prefix+'_retain']={boolean:{value:d.retain}};p[prefix+'_estimated']={boolean:{value:d.estimated}};
    if(d.type==='clock'){p[prefix+'_clock']={shortText:{text:d.mode}};p[prefix+'_base']={numericValue:{value:d.baseSeconds,unit:'s'}};p[prefix+'_anchor']={timestamp:{value:d.anchorAt}};p[prefix+'_running']={boolean:{value:d.running}};}
    else if(d.type==='value'&&finite(d.value)){p[prefix+'_value']={numericValue:{value:d.value,unit:d.unit}};}
    else{p[prefix+'_text']={longText:{text:d.text}};}
  });
  if(card.meter){if(!finite(card.meter.min)||!finite(card.meter.max)){return null;}p.meter_kind={shortText:{text:card.meter.kind}};p.meter_source={shortText:{text:card.meter.source}};p.meter_min={numericValue:{value:card.meter.min}};p.meter_max={numericValue:{value:card.meter.max}};}
  if(card.image&&request&&request.iconPixelSize){p.artwork={image:{width:card.image.width,height:card.image.height,palette:base64(card.image.palette),pixels:base64(card.image.pixels)}};}
  return {instanceId:card.id,properties:p};
}
module.exports={VERSION:2,CATEGORY:'activity',ITEM:'card',TYPES:TYPES,METERS:METERS,LIMITS:LIMITS,PROPERTIES:PROPERTIES,SOURCE_PROPERTIES:SOURCE_PROPERTIES,
  normalize:normalize,createCard:normalize,encode:encode,fromLegacy:fromLegacy,sourceCard:sourceCard,toSourceInstance:toSourceInstance,poolFor:poolFor,numericText:numericText};
