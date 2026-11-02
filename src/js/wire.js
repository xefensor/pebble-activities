'use strict';

var MAX = 4294967295;
var STATES = {active:1, paused:2, completed:3, cancelled:4};
var CLOCKS = {none:0, deadline:1, elapsed:2};
var LIMITS = {providers:32, instances:16, cards:2, main:192, footer:128, id:64, kind:24, unit:16, image:40, packet:2672};
function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function integer(v, min, max) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max; }
function uuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v); }
function utf8(value) {
  var out=[];
  for (var i=0; i<value.length; i++) {
    var c=value.charCodeAt(i);
    if (c>=0xd800 && c<=0xdbff && i+1<value.length) {
      var next=value.charCodeAt(i+1);
      if (next>=0xdc00 && next<=0xdfff) { c=0x10000+((c-0xd800)<<10)+(next-0xdc00); i++; }
      else { c=0xfffd; }
    } else if (c>=0xd800 && c<=0xdfff) { c=0xfffd; }
    if (c<128) { out.push(c); }
    else if (c<2048) { out.push(192|(c>>6),128|(c&63)); }
    else if (c<65536) { out.push(224|(c>>12),128|((c>>6)&63),128|(c&63)); }
    else { out.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63)); }
  }
  return out;
}
function text(value, limit) {
  if (typeof value !== 'string') { return ''; }
  value=value.slice(0,4096).replace(/[\x00-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,' ').replace(/\s+/g,' ').trim();
  if (utf8(value).length<=limit) { return value; }
  var out='';
  for (var i=0; i<value.length; i++) {
    var c=value.charAt(i), code=value.charCodeAt(i);
    if (code>=0xd800 && code<=0xdbff && i+1<value.length) { c+=value.charAt(++i); }
    if (utf8(out+c).length>limit-3) { break; }
    out+=c;
  }
  return out+'\u2026';
}
function identity(v, limit) { return typeof v === 'string' && v.length>0 && !/[\x00-\x1f\x7f-\x9f]/.test(v) && utf8(v).length<=limit ? v : null; }
function bytes(v, max) {
  if (Array.isArray(v)) { return v.length<=max && v.every(function(n){return integer(n,0,255);}) ? v.slice() : null; }
  if (typeof v !== 'string' || v.length>Math.ceil(max/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)) { return null; }
  var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out=[];
  for (var i=0;i<v.length;i+=4) {
    var a=alphabet.indexOf(v[i]), b=alphabet.indexOf(v[i+1]), c=v[i+2]==='='?0:alphabet.indexOf(v[i+2]), d=v[i+3]==='='?0:alphabet.indexOf(v[i+3]);
    if (v[i+2]==='=' && (b&15) || v[i+3]==='=' && v[i+2]!=='=' && (c&3)) { return null; }
    out.push((a<<2)|(b>>4));
    if(v[i+2]!=='=') {out.push(((b&15)<<4)|(c>>2));}
    if(v[i+3]!=='=') {out.push(((c&3)<<6)|d);}
  }
  return out.length<=max ? out : null;
}
function image(v) {
  if (!object(v) || !integer(v.width,1,40) || !integer(v.height,1,40)) { return null; }
  var palette=bytes(v.palette,16), pixels=bytes(v.pixels,800), stride=Math.ceil(v.width/2);
  if (!palette || !palette.length || !pixels || pixels.length!==stride*v.height) { return null; }
  for (var y=0;y<v.height;y++) {
    for (var x=0;x<v.width;x++) { var pair=pixels[y*stride+(x>>1)], n=x&1 ? pair&15 : pair>>4; if(n>=palette.length) {return null;} }
    if(v.width&1) { pixels[y*stride+stride-1]&=240; }
  }
  while(palette.length<16) {palette.push(0);}
  return {width:v.width,height:v.height,palette:palette,pixels:pixels};
}
function normalize(v, provider) {
  if (!object(v) || !uuid(provider || v.provider)) { return null; }
  var id=identity(v.id,LIMITS.id), kind=identity(typeof v.kind==='string'?v.kind.toLowerCase():v.kind,LIMITS.kind);
  var state=v.state==='running'?'active':v.state==='finished'?'completed':v.state;
  if(!id || !kind || !STATES[state] || !Object.prototype.hasOwnProperty.call(CLOCKS,v.clock) ||
      !integer(v.revision,1,MAX) || !integer(v.observedAt,1,MAX) || !integer(v.validUntil,v.observedAt,MAX)) { return null; }
  var result={provider:provider || v.provider,id:id,kind:kind,state:state,clock:v.clock,revision:v.revision,
    observedAt:v.observedAt,validUntil:v.validUntil,deadline:v.deadline===undefined?0:v.deadline,
    duration:v.duration===undefined?0:v.duration,clockAt:v.clockAt===undefined?0:v.clockAt,
    main:text(v.main,LIMITS.main),footer:text(v.footer===undefined?v.name:v.footer,LIMITS.footer),unit:text(v.unit,LIMITS.unit),private:v.private!==false||kind==='music'||kind==='notification'||kind==='notifications',unconfirmed:v.unconfirmed===true};
  if(result.private && result.unconfirmed) {return null;}
  if(!integer(result.deadline,0,MAX) || !integer(result.duration,0,MAX) || !integer(result.clockAt,0,MAX)) { return null; }
  if(state==='completed' || state==='cancelled') { result.clock='none';result.deadline=result.duration=result.clockAt=0; }
  if(result.clock==='none' && (result.deadline || result.duration || result.clockAt)) {return null;}
  if(result.clock==='deadline') {
    if(state==='active' && (!result.deadline || result.duration || result.clockAt)) {return null;}
    if(state==='paused' && (result.deadline || result.clockAt)) {return null;}
  }
  if(result.clock==='elapsed' && (result.deadline || state==='active' && !result.clockAt || state==='paused' && result.clockAt)) {return null;}
  if(result.clock==='none' && (state==='active'||state==='paused') && !result.main && (v.value===undefined||v.value===null)) {return null;}
  if(v.value!==undefined && v.value!==null) { if(typeof v.value!=='number'||!isFinite(v.value)) {return null;} result.value=v.value; }
  if(v.image!==undefined && v.image!==null) {result.image=image(v.image);if(!result.image) {return null;}}
  return result;
}
function put16(out, at, v) {out[at]=v&255;out[at+1]=(v>>>8)&255;}
function put32(out, at, v) {for(var i=0;i<4;i++){out[at+i]=Math.floor(v/Math.pow(256,i))&255;}}
function crc16(out) {var crc=65535;for(var i=0;i<out.length;i++){if(i===8||i===9){continue;}crc^=out[i]<<8;for(var n=0;n<8;n++){crc=((crc<<1)^(crc&32768?0x1021:0))&65535;}}return crc;}
function encode(cards, options) {
  options=options||{};
  if(!Array.isArray(cards)||cards.length>2||!integer(options.session,2,MAX)||!integer(options.revision,1,MAX)||!integer(options.sentAt,1,MAX)) {throw new Error('INVALID_SNAPSHOT');}
  var out=[65,67,84,49,1,cards.length,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  put32(out,12,options.session);put32(out,16,options.revision);put32(out,20,options.sentAt);
  cards.forEach(function(raw){
    var card=normalize(raw);
    if(!card){throw new Error('INVALID_ACTIVITY');}
    var strings=[card.provider,card.id,card.kind,card.main,card.footer,card.unit].map(utf8), record=[];
    for(var i=0;i<48;i++){record.push(0);}
    record[0]=STATES[card.state];record[1]=CLOCKS[card.clock];record[2]=(card.private?1:0)|(card.image?2:0)|(card.value===undefined?0:4)|(card.unconfirmed?8:0);
    put32(record,4,card.revision);put32(record,8,card.observedAt);put32(record,12,card.validUntil);put32(record,16,card.deadline);put32(record,20,card.duration);put32(record,24,card.clockAt);
    if(card.value!==undefined){var b=new ArrayBuffer(8),view=new DataView(b);view.setFloat64(0,card.value,true);for(i=0;i<8;i++){record[28+i]=view.getUint8(i);}}
    strings.forEach(function(value,i){record[36+i]=value.length;});
    if(card.image){record[42]=card.image.width;record[43]=card.image.height;put16(record,44,card.image.pixels.length);}
    out=out.concat(record);strings.forEach(function(value){out=out.concat(value);});
    if(card.image){out=out.concat(card.image.palette,card.image.pixels);}
  });
  if(out.length>LIMITS.packet){throw new Error('SNAPSHOT_TOO_LARGE');}
  put16(out,6,out.length);put16(out,8,crc16(out));return out;
}
function clockValue(card, now) {
  if(card.clock==='deadline'){return card.state==='paused'?card.duration:Math.max(0,card.deadline-Math.max(now,card.observedAt));}
  if(card.clock==='elapsed'){return Math.min(MAX,card.duration+(card.state==='active'?Math.max(0,now-card.clockAt):0));}
  return null;
}
function formatClock(seconds) {seconds=Math.max(0,Math.floor(seconds));var hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60,s=seconds%60;return hours?hours+':'+('0'+minutes).slice(-2)+':'+('0'+s).slice(-2):('0'+minutes).slice(-2)+':'+('0'+s).slice(-2);}
module.exports={VERSION:1,CATEGORY:'activity',ITEM:'session',LIMITS:LIMITS,STATES:STATES,CLOCKS:CLOCKS,MAX_EPOCH:MAX,object:object,integer:integer,uuid:uuid,utf8:utf8,text:text,identity:identity,image:image,normalize:normalize,encode:encode,crc16:crc16,clockValue:clockValue,formatClock:formatClock};
