'use strict';

// ACT3 is the bounded two-role projection. It preserves ACT2's datum layout
// while adding explicit media, summary and semantic-symbol metadata.
var wire=require('./wire'),view=require('./view'),summary=require('./summary'),MAX=wire.MAX_EPOCH;
var PRESENTATIONS={text:1,media:2,clock:3,value:4,ranged:5};
var LIMITS={cards:2,packet:2672,pool:304,header:104};
function own(v,k){return Object.prototype.hasOwnProperty.call(v,k);}
function clone(v){return JSON.parse(JSON.stringify(v));}
function put16(b,o,v){b[o]=v&255;b[o+1]=(v>>>8)&255;}
function put32(b,o,v){for(var i=0;i<4;i++){b[o+i]=Math.floor(v/Math.pow(256,i))&255;}}
function numericText(value,unit){return String(value)+(unit?(/^(%|°|°C|°F)$/.test(unit)?'':' ')+unit:'');}
function token(value){
  var bytes=wire.utf8(value||''),a=2166136261,b=2246822519;
  bytes.forEach(function(x){a=(a^x)>>>0;a=(a*16777619)>>>0;b=(b^x)>>>0;b=(b*65599)>>>0;});
  var out=[];put32(out,0,a);put32(out,4,b);return out;
}
function poolFor(card){
  var bytes=[],known=Object.create(null);
  function add(value){value=value||'';if(own(known,value)){return known[value];}var data=wire.utf8(value),ref={offset:bytes.length,length:data.length};known[value]=ref;bytes=bytes.concat(data,[0]);return ref;}
  var refs={caption:add(card.caption),main:{label:add(card.main.label),text:add(card.main.text)},qualifier:add(card.qualifier)};
  if(card.support){refs.support={label:add(card.support.label),text:add(card.support.text)};}
  return {bytes:bytes,refs:refs};
}
function normalize(input){
  var card=view.normalize(input,undefined,true);if(!card){return null;}
  card.main.label=wire.text(card.main.label,32);if(card.support){card.support.label=wire.text(card.support.label,32);}
  card.presentation=input.presentation===undefined?(card.main.type==='clock'?PRESENTATIONS.clock:card.main.type==='value'?(card.meter?PRESENTATIONS.ranged:PRESENTATIONS.value):PRESENTATIONS.text):input.presentation;
  card.identitySymbol=input.identitySymbol===undefined?0:input.identitySymbol;
  card.compactItem=input.compactItem===undefined?0:input.compactItem;
  card.directions=input.directions===undefined?[0,0]:input.directions;
  card.qualifier=typeof input.qualifier==='string'?wire.text(input.qualifier,304):'';
  card.visualToken=input.visualToken===undefined?[0,0,0,0,0,0,0,0]:input.visualToken;
  if(!wire.integer(card.presentation,1,5)||!wire.integer(card.identitySymbol,0,10)||!wire.integer(card.compactItem,0,1)||card.compactItem&&!card.support||
    !Array.isArray(card.directions)||card.directions.length!==2||!card.directions.every(function(x){return wire.integer(x,0,4);})||
    !Array.isArray(card.visualToken)||card.visualToken.length!==8||!card.visualToken.every(function(x){return wire.integer(x,0,255);})){return null;}
  if(card.presentation===PRESENTATIONS.media&&(card.main.type!=='text'||card.support&&card.support.type!=='text'||card.compactItem||card.meter)){return null;}
  if(card.presentation===PRESENTATIONS.text&&card.main.type!=='text'||card.presentation===PRESENTATIONS.clock&&card.main.type!=='clock'||card.presentation===PRESENTATIONS.value&&card.main.type!=='value'||card.presentation===PRESENTATIONS.ranged&&(!card.meter||card.main.type!=='value'||card.meter.source!=='main')){return null;}
  if(card.directions[0]&&card.main.type!=='value'||card.directions[1]&&(!card.support||card.support.type!=='value')||card.presentation!==PRESENTATIONS.media&&card.visualToken.some(function(x){return x!==0;})){return null;}
  ['providerName','selectionKey','name','openApp','playback','sourceFormat','entityRef','actions','mediaItemId'].forEach(function(k){if(input[k]!==undefined){card[k]=clone(input[k]);}});
  // Keep shrinking monotonic even when strings share a pool reference.
  // Splitting a deduplicated string can increase storage, so optional aliases
  // are omitted rather than leaving ellipsis-only context behind.
  var fields=[['qualifier'],['caption'],['main','label'],['support','label']];
  if(card.support&&card.support.type==='text'){fields.push(['support','text']);}
  if(card.main.type==='text'){fields.push(['main','text']);}
  for(var f=0;poolFor(card).bytes.length>304&&f<fields.length;f++){
    var field=fields[f],owner=field.length===1?card:card[field[0]],key=field[field.length-1];if(!owner||!owner[key]){continue;}
    var requiredText=key==='text'&&(field[0]==='main'||card.compactItem===1||card.presentation===PRESENTATIONS.media);
    var before=poolFor(card).bytes.length,original=owner[key],size=wire.utf8(original).length;
    var limit=Math.max(requiredText?8:0,size-(before-304));
    owner[key]=limit<4?'':wire.text(original,limit);
    if(poolFor(card).bytes.length>=before){owner[key]=requiredText?wire.text(original,8):'';}
    if(field[0]==='support'&&key==='text'&&!owner.text){card.support=null;card.directions[1]=0;if(card.meter&&card.meter.source==='support'){card.meter=null;}}
  }
  if(poolFor(card).bytes.length>304||!card.main.text&&card.main.type!=='clock'||card.compactItem===1&&(!card.support||!card.support.text&&card.support.type!=='clock')){return null;}
  return card;
}
function compiledDatum(d,source){
  var out={type:d.type,label:d.label||'',observedAt:source.observedAt,validUntil:source.validUntil,retain:!source.private,estimated:false};
  if(d.type==='text'){out.text=d.text;}
  else if(d.type==='value'){out.text=numericText(d.value,d.unit||'');if(typeof d.value==='number'){out.value=d.value;out.unit=d.unit||'';}}
  else{out.mode=d.mode==='countdown'?'deadline':'elapsed';out.running=d.deadline!==undefined||d.since!==undefined;out.anchorAt=out.running?(d.since===undefined?source.observedAt:d.since):0;out.baseSeconds=d.deadline===undefined?d.seconds||0:Math.max(0,d.deadline-source.observedAt);}
  return out;
}
function textPart(d){return d&&d.type==='text'?(d.label?d.label+': ':'')+d.text:'';}
function unique(parts){var seen=Object.create(null);return parts.filter(function(x){if(!x||seen[x]){return false;}seen[x]=true;return true;}).join(' · ');}
function fromSummary(input,provider){
  var source=summary.sourceRecord(input,provider);if(!source){return null;}
  var r=source.record,media=r.type==='media',selected=r.summary==='detail'?1:0;
  var card={provider:source.provider,id:r.id,kind:media?'music':typeof r.icon==='string'?r.icon:'activity',revision:source.revision,state:media?'active':r.state,
    observedAt:source.observedAt,validUntil:source.validUntil,private:source.private,unconfirmed:source.unconfirmed,showTerminal:!media&&r.result,
    caption:media?r.artist||'':r.name||source.displayName||'',main:media?compiledDatum({type:'text',text:r.title},source):compiledDatum(r.headline,source),
    support:media?(r.artist?compiledDatum({type:'text',text:r.artist},source):null):(r.detail?compiledDatum(r.detail,source):null),
    image:media?r.artwork||typeof r.icon==='object'&&r.icon:typeof r.icon==='object'?r.icon:undefined,
    compactItem:media?0:selected,identitySymbol:summary.ICONS.indexOf(typeof r.icon==='string'?r.icon:media?'media':'activity'),
    directions:media?[0,0]:[summary.DIRECTIONS.indexOf(r.headline.symbol)+1,summary.DIRECTIONS.indexOf(r.detail&&r.detail.symbol)+1],
    presentation:media?PRESENTATIONS.media:r.headline.type==='clock'?PRESENTATIONS.clock:r.headline.type==='value'?(r.headline.range?PRESENTATIONS.ranged:PRESENTATIONS.value):PRESENTATIONS.text,
    visualToken:media?token(r.itemId===undefined?r.title:r.itemId):[0,0,0,0,0,0,0,0],
    qualifier:media?unique([r.name,r.artist].filter(function(part){return part!==r.title;})):unique([textPart(selected?r.headline:r.detail),r.name].filter(function(part){var d=selected?r.detail:r.headline;return part!==d.label&&part!==textPart(d);})),sourceFormat:4,playback:r.playback,mediaItemId:r.itemId};
  if(!card.image){delete card.image;}
  if(r.headline&&r.headline.range){card.meter={kind:'progress',source:'main',min:r.headline.range.min,max:r.headline.range.max};}
  if(r.openApp){card.openApp=r.openApp;}if(r.actions){card.actions=r.actions;}if(r.entityRef){card.entityRef=r.entityRef;}
  if(source.displayName){card.providerName=source.displayName;}if(r.name){card.name=r.name;}
  return normalize(card);
}
function fromLegacy(input){
  var card=input&&input.main?clone(input):view.fromLegacy(input);if(!card){return null;}
  var media=card.kind==='music';
  card.presentation=media?PRESENTATIONS.media:card.main.type==='clock'?PRESENTATIONS.clock:card.main.type==='value'?(card.meter&&card.meter.source==='main'?PRESENTATIONS.ranged:PRESENTATIONS.value):PRESENTATIONS.text;
  var kind=card.kind==='music'?'media':card.kind==='notification'||card.kind==='notifications'?'message':card.kind;
  card.identitySymbol=Math.max(0,summary.ICONS.indexOf(kind));card.compactItem=0;card.directions=[0,0];card.qualifier='';
  if(media){
    if(card.caption&&card.caption.indexOf('__dynamic_media__')===0){card.caption=card.caption.slice('__dynamic_media__'.length);}
    card.visualToken=token(card.main.text);card.qualifier=card.support?card.support.text:'';card.caption=card.support?card.support.text:'';
  }
  [card.main,card.support].forEach(function(d){if(d&&['Track','Artist','Text','Value','Left','Activity','Music',card.caption,card.providerName].indexOf(d.label)>=0){d.label='';}});
  if(!media){card.qualifier=unique([card.support&&card.support.type==='text'?card.support.text:'',card.caption]);}
  return normalize(card);
}
function writeDatum(header,offset,item,refs){
  if(!item){return;}header[offset]=view.TYPES[item.type];header[offset+1]=(item.type==='clock'&&item.mode==='elapsed'?1:0)|(item.running?2:0)|(item.retain?4:0)|(item.estimated?8:0);
  put32(header,offset+4,item.observedAt);put32(header,offset+8,item.validUntil);put32(header,offset+12,item.baseSeconds||0);put32(header,offset+16,item.anchorAt||0);
  put16(header,offset+20,refs.text.offset);put16(header,offset+22,refs.text.length);put16(header,offset+24,refs.label.offset);put16(header,offset+26,refs.label.length);
}
function encode(cards,options){
  options=options||{};var seq=options.sequence===undefined?options.revision:options.sequence;
  if(!Array.isArray(cards)||cards.length>2||!wire.integer(options.session,2,MAX)||!wire.integer(seq,1,MAX)||!wire.integer(options.sentAt,1,MAX)){throw new Error('INVALID_SNAPSHOT');}
  var out=[65,67,84,51,3,cards.length,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],seen=Object.create(null);
  put32(out,12,options.session);put32(out,16,seq);put32(out,20,options.sentAt);
  cards.forEach(function(raw){
    var card=normalize(raw);if(!card||seen[card.provider+'|'+card.id]){throw new Error('INVALID_ACTIVITY');}seen[card.provider+'|'+card.id]=true;
    var pool=poolFor(card),id=wire.utf8(card.id),h=[];for(var i=0;i<104;i++){h.push(0);}
    h[2]=wire.STATES[card.state];h[3]=(card.private?1:0)|(card.unconfirmed?2:0)|(card.showTerminal?4:0)|(card.image?8:0);
    put32(h,4,card.revision);put32(h,8,card.observedAt);put32(h,12,card.validUntil);h[16]=id.length;h[17]=card.image?card.image.width:0;h[18]=card.image?card.image.height:0;h[19]=card.meter?view.METERS[card.meter.kind]:0;
    put16(h,20,card.image?card.image.pixels.length:0);put16(h,22,pool.bytes.length);put16(h,24,pool.refs.caption.offset);put16(h,26,pool.refs.caption.length);
    put16(h,28,card.meter?Math.round(card.meter.fraction*65535):0);h[30]=card.meter&&card.meter.source==='support'?1:0;
    writeDatum(h,32,card.main,pool.refs.main);writeDatum(h,60,card.support,pool.refs.support);
    h[88]=card.presentation;h[89]=card.identitySymbol;h[90]=card.compactItem;h[91]=card.directions[0]|card.directions[1]<<3;
    put16(h,92,pool.refs.qualifier.offset);put16(h,94,pool.refs.qualifier.length);for(i=0;i<8;i++){h[96+i]=card.visualToken[i];}
    var record=h.concat(wire.utf8(card.provider),id,pool.bytes);if(card.image){record=record.concat(card.image.palette,card.image.pixels);}put16(record,0,record.length);out=out.concat(record);
  });
  if(out.length>2672){throw new Error('SNAPSHOT_TOO_LARGE');}put16(out,6,out.length);put16(out,8,wire.crc16(out));return out;
}
function formatDatum(d,now){
  if(d.type==='text'){return textPart(d);}
  if(d.type==='value'){return numericText(d.value,d.unit||'');}
  return wire.formatClock(d.mode==='countdown'?(d.deadline===undefined?d.seconds:Math.max(0,d.deadline-now)):Math.min(MAX,(d.seconds||0)+(d.since===undefined?0:Math.max(0,now-d.since))));
}
function compactText(record,now){
  var r=summary.normalize(record,now);if(!r){return null;}
  if(r.type==='media'){return unique([r.title,r.name,r.artist]);}
  var selected=r.summary==='detail'?r.detail:r.headline,other=r.summary==='detail'?r.headline:r.detail;
  return unique([formatDatum(selected,now),selected.type==='text'?'':selected.label,textPart(other),r.name]);
}
module.exports={VERSION:3,PRESENTATIONS:PRESENTATIONS,LIMITS:LIMITS,normalize:normalize,encode:encode,fromSummary:fromSummary,fromLegacy:fromLegacy,poolFor:poolFor,compactText:compactText,visualToken:token,numericText:numericText};
