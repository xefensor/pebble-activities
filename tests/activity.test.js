'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const lib=require('../src/js'),activity=lib.activity,view=lib.view;
const P='c9e7cb18-eaf7-4b30-9b09-9a8fae187801',N=1700000000;
const copy=value=>JSON.parse(JSON.stringify(value));
function record(extra={}){return Object.assign({provider:P,id:'run',revision:1,observedAt:N,validUntil:N+600,appName:'Example',content:'Ready'},extra);}
function host(plugins){let now=N*1000;const requests=[],sent=[],timers=[];
 const consumer=lib.createActivities({nativeFormat:2,pebble:{enumeratePlugins:()=>plugins,subscribeToSource:request=>{requests.push(request);return {unsubscribe(){}};}},
  now:()=>now,later:(fn,delay)=>{timers.push({fn,delay});return timers.length;},cancelLater(){},send:(payload,ok)=>{sent.push(payload);if(ok)ok();}});
 consumer.refresh(true,42);return {consumer,requests,sent,setNow:value=>{now=value*1000;},data:(instance)=>requests.at(-1).onData({pluginUuid:P,validUntilMs:(N+30)*1000,instances:[instance]})};
}

test('public activity model has one content, optional detail/image and no required layout or labels',()=>{
 const normalized=activity.normalize(record());assert.equal(activity.ITEM,'live');assert.equal(activity.VERSION,3);
 assert.deepEqual(normalized.content,{text:'Ready'});assert.equal(normalized.detail,null);assert.equal(normalized.private,true);
 assert.equal(normalized.state,'active');assert.equal(normalized.kind,'activity');
 assert.equal(Object.keys(activity.SOURCE_PROPERTIES).some(key=>/^main_|^support_|^meter_/.test(key)),false);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src/js/activity.js'),'utf8'),/\b(?:window|document|TextEncoder|Buffer)\b/);
 for(const extra of [{main:{text:'Ready'}},{support:'Detail'},{meter:{}},{layout:'compact'},{content:{text:'Ready',layout:'large'}},{content:{type:'text',text:'Ready'}}])assert.equal(activity.normalize(record(extra)),null);
});
test('one text, scalar or independently anchored clock is compiled without inventing visible field names',()=>{
 const source=record({kind:'workout',private:false,content:activity.countdown({deadline:N+80,label:'Rest'}),detail:activity.elapsed({since:N-300})});
 const before=copy(source),compiled=activity.toView(source);
 assert.equal(compiled.main.label,'Rest');assert.equal(compiled.main.baseSeconds,80);assert.equal(compiled.main.anchorAt,N);
 assert.equal(compiled.support.label,'Example');assert.equal(compiled.support.mode,'elapsed');assert.equal(compiled.support.baseSeconds,0);assert.equal(compiled.support.anchorAt,N-300);
 assert.equal(compiled.sourceFormat,3);assert.equal(compiled.providerName,'Example');assert.equal(compiled.meter,null);assert.deepEqual(source,before);
 const scalar=activity.toView(record({content:activity.value(6.2,'mmol/L')}));assert.equal(scalar.main.text,'6.2 mmol/L');assert.equal(scalar.main.type,'value');
 assert.equal(activity.toView(record({content:activity.value('2–1')})).main.text,'2–1');
 assert.equal(activity.toView(record()).main.label,'Example');
});
test('paused activity cannot freeze a separately running clock; zero does not complete the source',()=>{
 const paused=activity.toView(record({state:'paused',content:activity.countdown({seconds:80}),detail:activity.elapsed({since:N-300})}));
 assert.equal(paused.main.running,false);assert.equal(paused.main.anchorAt,0);assert.equal(paused.support.running,true);
 const due=activity.toView(record({content:activity.countdown({deadline:N-1})}));assert.equal(due.main.baseSeconds,0);assert.equal(due.state,'active');
});
test('descriptors reject unbounded, nested, conflicting and invalid timing inputs',()=>{
 for(const content of [{text:'x',extra:1},{text:['x']},{text:{value:'x'}},{text:'x'.repeat(193)},[],null,
  {clock:'countdown',deadline:N+30,seconds:5},{clock:'countdown',deadline:0},{clock:'countdown',seconds:-1},
  {clock:'elapsed',since:N+1},{clock:'elapsed'},{clock:'elapsed',seconds:1.1},{clock:'elapsed',seconds:0,deadline:N},
  {value:Infinity},{value:72,unit:null},{value:'2–1',unit:'sets'},JSON.parse('{"text":"x","__proto__":{}}')])assert.equal(activity.normalize(record({content})),null);
 for(const extra of [{detail:[]},{observedAt:0},{validUntil:N-1},{state:'toString'},{private:'false'},{private:true,unconfirmed:true},
  {content:{text:'x',observedAt:N+1}},{content:{text:'x',validUntil:N+601}},{content:{text:'x',estimated:'yes'}}])assert.equal(activity.normalize(record(extra)),null);
});
test('source3 roundtrips content/detail/image through standard property shapes with bounded JSON',()=>{
 const source=record({private:false,content:activity.value(72,'%'),detail:activity.countdown({deadline:N+80,label:'ETA'}),image:{width:2,height:1,palette:[192,255],pixels:[0x10]}});
 const normalized=activity.normalize(source),instance=activity.toSourceInstance(source,{iconPixelSize:{w:40,h:40}});
 assert.deepEqual(activity.sourceCard(instance,P),normalized);assert.equal(instance.properties.schema_version.numericValue.value,3);
 assert.ok(instance.properties.content.longText.text.length<=512);assert.ok(instance.properties.detail.longText.text.length<=512);
 assert.equal(instance.properties.main_label,undefined);assert.equal(instance.properties.meter_kind,undefined);
 assert.equal(instance.properties.show_terminal.boolean.value,false);assert.equal(activity.toSourceInstance(source,{}).properties.artwork,undefined);
 for(const name of ['private','unconfirmed','state','content','artwork']){const bad=copy(instance);bad.properties[name]={};assert.equal(activity.sourceCard(bad,P),null);}
 for(const raw of ['[1]','null','{"text":{"nested":"x"}}','{"text":"'+'x'.repeat(600)+'"}']){const bad=copy(instance);bad.properties.content.longText.text=raw;assert.equal(activity.sourceCard(bad,P),null);}
});
test('long optional detail yields to the native pool without truncating the essential content or unit',()=>{
 const source=record({appName:'A'.repeat(32),content:{value:'V'.repeat(185)+' mmol/L',label:'L'.repeat(64)},detail:'D'.repeat(192)});
 const before=copy(source);assert.ok(activity.normalize(source));const native=activity.toView(source);
 assert.ok(native);assert.equal(native.main.text,source.content.value);assert.equal(native.main.label,source.content.label);assert.equal(native.support,null);assert.deepEqual(source,before);
});
test('new providers serve simple sources without storage, preserving source observations on polling',()=>{
 let now=N*1000;const source=record({provider:undefined,appName:undefined,content:activity.countdown({deadline:N+60})});
 const provider=activity.createProvider({pluginUuid:P,appName:'Timer',now:()=>now,getActivities:()=>[source]});
 const request={category:'activity',item:'live'},first=provider.source(request);now+=10000;const later=provider.source(request);
 assert.deepEqual(first.instances,later.instances);assert.equal(activity.sourceCard(first.instances[0],P).appName,'Timer');assert.equal(source.appName,undefined);
 now=(N+601)*1000;assert.equal(provider.source(request).instances.length,0);
 let error;provider.handleSource({category:'activity',item:'card'},{error:code=>error=code});assert.equal(error,'INVALID_REQUEST');
 assert.throws(()=>activity.createProvider({pluginUuid:P,getActivities:()=>[source,source]}).source(request),/INVALID_ACTIVITY/);
});
test('native providers opt into live while retaining session/card compatibility and hidden completion',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const publisher=lib.createPublisher({storage,pluginUuid:P,private:false});
 const saved={schemaVersion:1,id:'tea',kind:'timer',clock:'deadline',state:'active',revision:1,observedAt:N,validUntil:N+660,private:false,main:'',footer:'1 min timer',deadline:N+60,duration:0,clockAt:0,showTerminal:false};
 assert.equal(publisher.accept(saved).ACTIVITY_ACCEPTED_REVISION,1);
 const provider=lib.createProvider({storage,pluginUuid:P,presentation:'simple',appName:'Timer',timerPresentation:'compact',now:()=>N*1000});
 const request={category:'activity',item:'live'},instance=provider.source(request).instances[0],simple=activity.sourceCard(instance,P);
 assert.equal(simple.appName,'Timer');assert.deepEqual(simple.content,{clock:'countdown',deadline:N+60});assert.equal(simple.detail,null);assert.equal(simple.unconfirmed,true);
 assert.equal(provider.source({item:'session'}).instances[0].properties.schema_version.numericValue.value,1);
 assert.equal(provider.source({item:'card'}).instances[0].properties.schema_version.numericValue.value,2);
 saved.revision=2;saved.state='completed';saved.clock='none';saved.deadline=0;saved.showTerminal=false;publisher.accept(saved);
 const complete=activity.sourceCard(provider.source(request).instances[0],P);assert.equal(complete.state,'completed');assert.equal(complete.content.text,'Finished');assert.equal(complete.showTerminal,false);
});
test('consumers prefer live, validate the new contract and retain immutable revisions before host presentation',()=>{
 const plugins=[{uuid:P,name:'Installed Name',sources:[{category:'activity',items:['session','card','live'],properties:{schema_version:['numericValue']}}]}],h=host(plugins);
 assert.equal(h.requests[0].item,'live');assert.deepEqual(h.requests[0].properties,activity.PROPERTIES);
 const source=record({private:false,content:activity.countdown({deadline:N+60})}),instance=activity.toSourceInstance(source,{});h.data(instance);
 const card=h.consumer.catalogue()[0];assert.equal(card.sourceFormat,3);assert.equal(card.main.baseSeconds,60);assert.equal(card.providerName,'Installed Name');
 h.setNow(N+10);h.consumer.reproject();assert.equal(h.consumer.catalogue()[0].observedAt,N);
 const changed=copy(instance);changed.properties.content.longText.text=JSON.stringify({clock:'countdown',deadline:N+120});h.data(changed);assert.equal(h.consumer.catalogue().length,0);
 source.revision=2;source.content=activity.countdown({deadline:N+120});h.data(activity.toSourceInstance(source,{}));assert.equal(h.consumer.catalogue()[0].revision,2);
 const old=lib.createActivities({nativeFormat:1});assert.equal(lib.createActivities.compatible(plugins[0],1),true);old.stop();
});
test('private schema3 data clears on malformed retraction and stale terminal runs cannot resurrect',()=>{
 const plugins=[{uuid:P,sources:[{category:'activity',items:['live'],properties:{schema_version:['numericValue']}}]}],h=host(plugins),source=record({kind:'music'});
 h.data(activity.toSourceInstance(source,{}));assert.equal(h.consumer.catalogue().length,1);
 const bad=activity.toSourceInstance(source,{});bad.properties.detail={longText:{text:'[]'}};h.data(bad);assert.equal(h.consumer.catalogue().length,0);
 source.revision=2;source.kind='activity';source.private=false;source.state='completed';source.showTerminal=true;h.data(activity.toSourceInstance(source,{}));assert.equal(h.consumer.catalogue().length,1);
 source.revision=3;source.state='active';h.data(activity.toSourceInstance(source,{}));assert.equal(h.consumer.catalogue().length,0);
});
test('production C receives schema3 projections with independently ticking content/detail and private expiry',()=>{
 const root=path.resolve(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'simple-activities-'));
 try{
  const native=activity.toView(record({content:activity.countdown({deadline:N+60}),detail:activity.elapsed({since:N-300})}));
  fs.writeFileSync(path.join(scratch,'packet.bin'),Buffer.from(view.encode([native],{session:42,revision:1,sentAt:N})));
  fs.writeFileSync(path.join(scratch,'test.c'),`#include "pebble-activity-view.h"\n#include <assert.h>\n#include <stdio.h>\nint main(int argc,char **argv){assert(argc==2);FILE*f=fopen(argv[1],"rb");assert(f);uint8_t b[PAV_MAX_PACKET_BYTES];size_t n=fread(b,1,sizeof b,f);fclose(f);PavState s;pav_state_init(&s,42,true);assert(pav_state_receive(&s,b,n,1700000000));const PavCard*c=pav_state_select(&s,1700000002,0);assert(c);assert(pav_clock_value(c,&c->main,1700000002,true).seconds==58);assert(pav_clock_value(c,&c->support,1700000002,true).seconds==302);assert(!pav_card_visible(c,1700000002,false));assert(!pav_card_visible(c,1700000601,true));return 0;}\n`);
  const binary=path.join(scratch,'native');assert.equal(spawnSync(process.env.CC||'cc',['-std=c99','-Wall','-Wextra','-Werror','-pedantic','-I',path.join(root,'include'),path.join(scratch,'test.c'),path.join(root,'src/c/activity-view.c'),'-o',binary],{stdio:'inherit'}).status,0);
  assert.equal(spawnSync(binary,[path.join(scratch,'packet.bin')],{stdio:'inherit'}).status,0);
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});
