'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('../src/js');
const view=lib.view;
const P='c9e7cb18-eaf7-4b30-9b09-9a8fae187801';
const N=1700000000;
const clone=value=>JSON.parse(JSON.stringify(value));
function clock(label,mode,seconds,extra={}){return Object.assign({type:'clock',label,mode,running:true,baseSeconds:seconds,anchorAt:N,retain:true},extra);}
function card(extra={}){return Object.assign({provider:P,id:'run:1',kind:'workout',revision:1,state:'active',observedAt:N,validUntil:N+3000,
  private:false,caption:'Interval run',main:clock('Rest','deadline',80),support:clock('Elapsed','elapsed',1458)},extra);}
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),values};}
function plugin(items=['session','card']){return {uuid:P,sources:[{category:'activity',items,properties:{schema_version:['numericValue']}}]};}
function source(record,expiry=N+30){const instance=view.toSourceInstance(record,{iconPixelSize:{w:40,h:40}});assert.ok(instance);return {pluginUuid:P,validUntilMs:expiry*1000,instances:[instance]};}
function fixture(extra={}){
  let time=N*1000,next=0,plugins=extra.plugins||[plugin()];const timers=new Map(),subs=[],sent=[];
  const options=Object.assign({nativeFormat:2,pebble:{enumeratePlugins:()=>plugins,subscribeToSource:request=>{const sub={request,closed:false};subs.push(sub);return {unsubscribe:()=>sub.closed=true};}},
    keys:{ACTIVITY_DATA:100,REQUEST_ACTIVITIES:101},now:()=>time,later:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},cancelLater:id=>timers.delete(id),
    send:(payload,ok)=>{sent.push(payload);if(ok)ok();}},extra);
  const consumer=lib.createActivities(options);
  return {consumer,subs,sent,options,data:(envelope,index=subs.length-1)=>subs[index].request.onData(envelope),error:code=>subs.at(-1).request.onError({code}),
    packet:()=>sent.filter(p=>p[100]).at(-1)?.[100],
    advance:seconds=>{const end=time+seconds*1000;let limit=100;while(limit--){const due=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);time=due[1].at;due[1].fn();}assert.ok(limit>=0);time=end;}};
}
function legacy(extra={}){return Object.assign({schemaVersion:1,id:'timer:1',provider:P,kind:'timer',revision:1,state:'active',observedAt:N,validUntil:N+630,
  private:false,clock:'deadline',deadline:N+600,duration:0,clockAt:0,main:'',footer:'Pasta'},extra);}

test('ACT2 public module exposes bounded source and wire helpers without browser APIs',()=>{
  assert.equal(require('../view'),view);assert.equal(view.ITEM,'card');assert.equal(view.VERSION,2);
  assert.equal(typeof view.createCard,'function');assert.deepEqual(view.SOURCE_PROPERTIES.main_value,['numericValue']);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src/js/view.js'),'utf8'),/\b(?:window|document|TextEncoder|Buffer)\b/);
});
test('two independently anchored clocks remain independent from source pause state',()=>{
  const normalized=view.normalize(card({state:'paused',main:clock('Rest','deadline',80,{running:false,anchorAt:0})}));
  assert.equal(normalized.main.running,false);assert.equal(normalized.support.running,true);
  const packet=view.encode([normalized],{session:42,sequence:7,sentAt:N});
  assert.equal(Buffer.from(packet).toString('ascii',0,4),'ACT2');assert.equal(packet[4],2);
  assert.equal(Buffer.from(packet).readUInt32LE(16),7);
  assert.equal(packet[24+32+1]&2,0);assert.equal(packet[24+60+1]&2,2);
});
test('datum times, booleans, clock anchors and unknown enums fail closed',()=>{
  for(const bad of [card({revision:0}),card({state:'toString'}),card({main:{type:'toString',label:'Bad',text:'Bad'}}),
    card({main:clock('Rest','deadline',80,{anchorAt:N+1})}),card({main:clock('Rest','deadline',80,{observedAt:N+1})}),
    card({main:clock('Rest','deadline',80,{validUntil:N+4000})}),card({main:clock('Rest','deadline',80,{running:'true'})}),
    card({main:clock('Rest','deadline',80,{running:false,anchorAt:N})}),card({private:true,unconfirmed:true})])assert.equal(view.normalize(bad),null);
});
test('numeric presentation and meter share one finite observation with explicit range',()=>{
  const c=card({main:{type:'value',label:'Charge',value:72,unit:'%',retain:true},support:clock('ETA','deadline',2220),meter:{kind:'progress',source:'main',min:0,max:100}});
  const normalized=view.normalize(c);assert.equal(normalized.main.text,'72%');assert.equal(normalized.meter.fraction,0.72);
  assert.deepEqual(view.normalize(normalized),normalized);
  for(const update of [{value:Infinity},{value:72,text:'99%'},{value:120}])assert.equal(view.normalize(Object.assign({},c,{main:Object.assign({},c.main,update)})),null);
  assert.equal(view.normalize(Object.assign({},c,{meter:{kind:'progress',source:'support',min:0,max:100}})),null);
  assert.equal(view.normalize(Object.assign({},c,{meter:{kind:'progress',source:'main',min:100,max:100}})),null);
  assert.equal(view.normalize(Object.assign({},c,{meter:{kind:'toString',source:'main',min:0,max:100}})),null);
});
test('formatted compound values and units are supported without fabricating numeric progress',()=>{
  assert.equal(view.normalize(card({main:{type:'value',label:'Score',text:'2–1'},support:null})).main.text,'2–1');
  assert.equal(view.normalize(card({main:{type:'value',label:'Glucose',value:6.2,unit:'mmol/L'},support:null})).main.text,'6.2 mmol/L');
  assert.equal(view.normalize(card({main:{type:'value',label:'Oven',text:'180 / 200 °C'},support:null})).meter,null);
  for(const unit of [null,42,{},'millimoles-per-litre'])assert.equal(view.normalize(card({main:{type:'value',label:'Value',value:6.2,unit},support:null})),null);
});
test('source schema2 roundtrips two datums, a meter and standard requested artwork',()=>{
  const c=card({kind:'print',main:{type:'value',label:'Complete',value:72,unit:'%'},support:clock('ETA','deadline',2220),
    meter:{kind:'progress',source:'main',min:0,max:100},image:{width:2,height:1,palette:[192,255],pixels:[1]}});
  const expected=view.normalize(c),instance=view.toSourceInstance(c,{iconPixelSize:{w:40,h:40}});
  assert.deepEqual(view.sourceCard(instance,P),expected);
  assert.equal(view.toSourceInstance(c,{}).properties.artwork,undefined);
  assert.equal(instance.properties.main_text,undefined);assert.equal(instance.properties.main_value.numericValue.value,72);
  const conflicting=clone(instance);conflicting.properties.main_text={longText:{text:'99%'}};assert.equal(view.sourceCard(conflicting,P),null);
  const unknown=clone(instance);unknown.properties.schema_version.numericValue.value=3;assert.equal(view.sourceCard(unknown,P),null);
});
test('cross-language ACT2 fixtures are stable and two maximum records fit the old frame budget',()=>{
  const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/view-source.json'),'utf8'));
  for(const [name,cards] of Object.entries(fixtures.cases))assert.deepEqual(Buffer.from(view.encode(cards,fixtures)),fs.readFileSync(path.join(__dirname,'fixtures',name+'.bin')));
  assert.equal(fs.statSync(path.join(__dirname,'fixtures/view-max.bin')).size,2672);
  const c=card({main:{type:'text',label:'L'.repeat(64),text:'M'.repeat(192)},caption:'C'.repeat(64),support:null});
  assert.equal(view.normalize(c),null);
  assert.throws(()=>view.encode([card(),card()],{session:42,revision:1,sentAt:N}),/INVALID_ACTIVITY/);
});
test('legacy adapter preserves its chosen summary without guessing extra metrics',()=>{
  const adapted=view.fromLegacy(legacy({value:72,unit:'%',main:'Do not reinterpret this'}));
  assert.equal(adapted.main.type,'clock');assert.equal(adapted.main.baseSeconds,600);assert.equal(adapted.support,null);
  assert.equal(adapted.main.anchorAt,N);assert.equal(adapted.caption,'Pasta');assert.equal(adapted.main.retain,true);
  const reading=view.fromLegacy(legacy({kind:'sensor',clock:'none',deadline:0,main:'6.2 mmol/L',value:6.2,unit:'mmol/L'}));
  assert.equal(reading.main.text,'6.2 mmol/L');assert.equal(reading.main.retain,false);
});
test('v2 consumer prefers the card source exactly once and v1 stays on session',()=>{
  const f=fixture();f.consumer.refresh(true,42);assert.equal(f.subs.length,1);assert.equal(f.subs[0].request.item,'card');
  f.data(source(card()));assert.equal(f.packet()[4],2);assert.equal(f.consumer.catalogue()[0].main.type,'clock');
  const old=fixture({nativeFormat:1});old.consumer.refresh(true,42);assert.equal(old.subs[0].request.item,'session');assert.equal(old.packet()[4],1);
});
test('provider metadata includes installed idle and disabled apps and never changes source fingerprints',()=>{
  const p=Object.assign(plugin(),{name:'Workout\u202e App'}),settings={disabledProviders:[P]};
  const f=fixture({plugins:[p],getSettings:()=>settings});f.consumer.refresh(true,42);
  assert.deepEqual(f.consumer.providers(),[{uuid:P,name:'Workout App',item:'card',available:true}]);
  assert.equal(f.subs.length,0);settings.disabledProviders=[];f.consumer.configure();f.data(source(card()));
  assert.equal(f.consumer.catalogue()[0].providerName,'Workout App');
  p.name='Renamed App';f.consumer.refresh();f.data(source(card()));
  assert.equal(f.consumer.catalogue()[0].providerName,'Renamed App');
  assert.equal(f.consumer.catalogue()[0].revision,1);assert.equal(f.consumer.status().error,'');
  const metadata=f.consumer.providers();metadata[0].name='Changed copy';assert.equal(f.consumer.providers()[0].name,'Renamed App');
});
test('v2 consumer adapts an existing session provider without requiring a provider upgrade',()=>{
  const f=fixture({plugins:[plugin(['session'])]});f.consumer.refresh(true,42);assert.equal(f.subs[0].request.item,'session');
  const store=storage();lib.createPublisher({storage:store,pluginUuid:P}).accept(legacy());
  const envelope=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000}).source({});envelope.pluginUuid=P;f.data(envelope);
  assert.equal(f.consumer.catalogue()[0].main.baseSeconds,600);assert.equal(f.packet()[4],2);
});
test('source conflicts fail while legitimate reprojected views retain the source revision',()=>{
  let caption='First';const f=fixture({select:cards=>cards.map(c=>Object.assign({},c,{caption}))});f.consumer.refresh(true,42);f.data(source(card()));
  const before=Buffer.from(f.packet()),revision=f.consumer.catalogue()[0].revision;
  caption='Second';f.consumer.reproject();const after=Buffer.from(f.packet());assert.ok(after.readUInt32LE(16)>before.readUInt32LE(16));
  assert.notDeepEqual(after,before);assert.equal(f.consumer.catalogue()[0].revision,revision);assert.equal(f.subs.length,1);
  f.data(source(card({caption:'Conflicting source'})));assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'INVALID_SOURCE');
});
test('public values opt into last-reported retention; private and unretained values clear',()=>{
  const reading=card({main:{type:'value',label:'Charge',value:72,unit:'%',retain:true},support:null});
  const f=fixture();f.consumer.refresh(true,42);f.data(source(reading));f.error('TIMEOUT');assert.equal(f.consumer.catalogue()[0].unconfirmed,true);
  f.error('PERMISSION_DENIED');assert.equal(f.consumer.catalogue().length,0);
  for(const change of [{private:true},{main:Object.assign({},reading.main,{retain:false})}]){
    const next=fixture();next.consumer.refresh(true,42);next.data(source(Object.assign({},reading,change)));next.error('TIMEOUT');assert.equal(next.consumer.catalogue().length,0);
  }
});
test('only explicit terminal result visibility is retained and no result can resurrect',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source(card({state:'completed',showTerminal:true,main:{type:'text',label:'State',text:'Finished',retain:true},support:null})));
  assert.equal(f.consumer.catalogue()[0].state,'completed');
  f.data(source(card({revision:2})));assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'INVALID_SOURCE');
  const hidden=fixture();hidden.consumer.refresh(true,42);hidden.data(source(card({state:'completed'})));assert.equal(hidden.consumer.catalogue().length,0);
});
test('initial asynchronous discovery is loading, not an authoritative empty catalogue',async()=>{
  let resolve;const deferred=new Promise(r=>resolve=r);const f=fixture({pebble:{enumeratePlugins:()=>deferred,subscribeToSource:()=>({unsubscribe(){}})}});
  f.consumer.refresh(true,42);assert.equal(f.consumer.status().ready,false);assert.equal(f.consumer.status().phase,'loading');
  resolve([]);await deferred;await Promise.resolve();assert.equal(f.consumer.status().ready,true);assert.equal(f.consumer.status().complete,true);assert.equal(f.consumer.status().count,0);
});
test('music validity is anchored to source observation across duplicate delivery',()=>{
  const f=fixture();f.consumer.refresh(true,42);const music=card({kind:'music',private:true,main:{type:'text',label:'Track',text:'Song'},support:null});
  f.data(source(music,N+120));const first=Buffer.from(f.packet()),expiry=f.consumer.catalogue()[0].validUntil;
  f.advance(5);f.data(source(music,N+125));const second=Buffer.from(f.packet());
  assert.equal(expiry,N+120);assert.equal(f.consumer.catalogue()[0].validUntil,expiry);assert.equal(first.readUInt32LE(24+12),second.readUInt32LE(24+12));
});
test('publisher total-duration metadata survives cold reads and is immutable per revision',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P,maxRecords:8});
  assert.equal(publisher.accept(legacy({totalDuration:900})).ACTIVITY_ACCEPTED_REVISION,1);
  assert.equal(publisher.accept(legacy({totalDuration:901})).ACTIVITY_ERROR,'REVISION_CONFLICT');
  assert.equal(publisher.accept(legacy({revision:2,totalDuration:-1})).ACTIVITY_ERROR,'INVALID_SNAPSHOT');
  const provider=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000+20000});
  const v2=provider.source({item:'card'}).instances[0].properties;
  assert.equal(v2.main_base.numericValue.value,600);assert.equal(v2.support_base.numericValue.value,300);assert.equal(v2.main_anchor.timestamp.value,N);
  assert.equal(v2.main_observed_at.timestamp.value,N);assert.equal(v2.unconfirmed.boolean.value,true);
  assert.equal(provider.source({item:'session'}).instances[0].properties.totalDuration,undefined);
});
test('saved native completion has a bounded cached result, while cancellation retracts',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
  publisher.accept(legacy({state:'completed',clock:'none',deadline:0,totalDuration:600,validUntil:N+60}));
  const provider=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000});const result=view.sourceCard(provider.source({item:'card'}).instances[0],P);
  assert.equal(result.showTerminal,true);assert.equal(result.main.text,'Finished');assert.equal(result.main.retain,true);assert.equal(result.support.baseSeconds,600);assert.equal(result.support.running,false);
  publisher.accept(legacy({revision:2,state:'cancelled',clock:'none',deadline:0,totalDuration:600}));
  assert.equal(view.sourceCard(provider.source({item:'card'}).instances[0],P).showTerminal,false);
});
test('compact Timer presentation has one identity caption without changing its source metadata',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
  publisher.accept(legacy({totalDuration:900}));
  const compact=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000,timerPresentation:'compact'});
  const result=view.sourceCard(compact.source({item:'card'}).instances[0],P);
  assert.equal(result.main.type,'clock');assert.equal(result.main.mode,'deadline');assert.equal(result.main.baseSeconds,600);
  assert.equal(result.caption,'Pasta');assert.equal(result.main.label,result.caption);assert.equal(result.support,null);
  assert.equal(result.observedAt,N);assert.equal(result.main.anchorAt,N);assert.equal(result.unconfirmed,true);
  assert.equal(JSON.parse(store.getItem(require('../src/js/publisher').DEFAULT_KEY)).card.totalDuration,900);
  const detailed=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000});
  assert.equal(view.sourceCard(detailed.source({item:'card'}).instances[0],P).support.baseSeconds,300);
  assert.deepEqual(compact.source({item:'session'}),detailed.source({item:'session'}));
  for(const footer of ['', 'Long name '.repeat(15)]){
    const projected=view.fromLegacy(legacy({footer,totalDuration:900}),{timerPresentation:'compact'});
    assert.ok(projected);assert.equal(projected.support,null);
    assert.equal(projected.main.label,footer?projected.caption:'Left');
    assert.ok(Buffer.byteLength(projected.main.label)<=view.LIMITS.label);
  }
  const paused=view.fromLegacy(legacy({state:'paused',deadline:0,duration:400,totalDuration:900}),{timerPresentation:'compact'});
  assert.equal(paused.main.running,false);assert.equal(paused.main.baseSeconds,400);assert.equal(paused.support,null);
  const workout=view.fromLegacy(legacy({kind:'workout',footer:'Workout'}),{timerPresentation:'compact'});
  assert.equal(workout.main.label,'Left');assert.equal(workout.caption,'Workout');
  assert.equal(view.fromLegacy(legacy(),{timerPresentation:'guess'}),null);
  assert.throws(()=>lib.createProvider({storage:store,pluginUuid:P,timerPresentation:'guess'}),/INVALID_TIMER_PRESENTATION/);
});
test('acknowledged completion publishes a hidden terminal revision and remains hidden after cold reads',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
  assert.equal(publisher.accept(legacy({revision:1,state:'completed',clock:'none',deadline:0,totalDuration:600,
    validUntil:N+60,showTerminal:true})).ACTIVITY_ACCEPTED_REVISION,1);
  const f=fixture();f.consumer.refresh(true,42);
  function envelope(at=N){
    const result=lib.createProvider({storage:store,pluginUuid:P,now:()=>at*1000,timerPresentation:'compact'}).source({item:'card'});
    result.pluginUuid=P;return result;
  }
  f.data(envelope());assert.equal(f.consumer.catalogue().length,1);
  const acknowledged=legacy({revision:2,state:'completed',clock:'none',deadline:0,totalDuration:600,
    validUntil:N+60,showTerminal:false});
  assert.equal(publisher.accept(acknowledged).ACTIVITY_ACCEPTED_REVISION,2);
  const hidden=view.sourceCard(envelope().instances[0],P);
  assert.equal(hidden.state,'completed');assert.equal(hidden.revision,2);assert.equal(hidden.showTerminal,false);
  assert.equal(hidden.observedAt,N);assert.equal(hidden.validUntil,N+60);
  f.data(envelope());assert.equal(f.consumer.catalogue().length,0);assert.equal(f.packet()[5],0);
  assert.equal(publisher.accept(Object.assign({},acknowledged,{showTerminal:true})).ACTIVITY_ERROR,'REVISION_CONFLICT');
  assert.equal(publisher.accept(Object.assign({},acknowledged,{revision:1,showTerminal:true})).ACTIVITY_ERROR,'STALE_REVISION');
  const reopened=lib.createPublisher({storage:store,pluginUuid:P});
  assert.equal(reopened.accept(Object.assign({},acknowledged,{revision:3})).ACTIVITY_ACCEPTED_REVISION,3);
  assert.equal(view.sourceCard(envelope(N+40).instances[0],P).showTerminal,false);
  assert.equal(envelope(N+61).instances.length,0);
  assert.equal(reopened.lastRevision(),3);
  assert.equal(reopened.accept(legacy({revision:4})).ACTIVITY_ERROR,'TERMINAL_RUN');
});
test('terminal visibility metadata is strict, revisioned and never persists private content',()=>{
  const base={ACTIVITY_SCHEMA_VERSION:1,ACTIVITY_RUN:'native:1',ACTIVITY_REVISION:1,ACTIVITY_STATE:'completed',
    ACTIVITY_KIND:'timer',ACTIVITY_CLOCK:'none',ACTIVITY_FOOTER:'Pasta',ACTIVITY_OBSERVED_AT:N,ACTIVITY_VALID_UNTIL:N+60,
    ACTIVITY_PRIVATE:0,ACTIVITY_PUBLISH_SESSION:40};
  for(const [value,expected] of [[true,true],[false,false],[1,true],[0,false]]){
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
    assert.equal(publisher.handleMessage(Object.assign({},base,{ACTIVITY_SHOW_TERMINAL:value})).ACTIVITY_ACCEPTED_REVISION,1);
    assert.equal(JSON.parse(store.getItem(require('../src/js/publisher').DEFAULT_KEY)).card.showTerminal,expected);
    const result=lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000}).source({item:'card'});
    assert.equal(view.sourceCard(result.instances[0],P).showTerminal,expected);
  }
  for(const value of ['false','true',null,2,-1,{},[]]){
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
    assert.deepEqual(publisher.handleMessage(Object.assign({},base,{ACTIVITY_SHOW_TERMINAL:value})),
      {ACTIVITY_ERROR:'INVALID_SNAPSHOT',ACTIVITY_PUBLISH_SESSION:40});
    assert.equal(store.values.size,0);
    assert.equal(publisher.accept(legacy({showTerminal:value})).ACTIVITY_ERROR,'INVALID_SNAPSHOT');
    assert.equal(view.fromLegacy(legacy({showTerminal:value}),{terminalResults:true}),null);
  }
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:P});
  assert.equal(publisher.handleMessage(Object.assign({},base,{ACTIVITY_PRIVATE:1,ACTIVITY_SHOW_TERMINAL:1})).ACTIVITY_ERROR,
    'PRIVATE_PERSISTENCE_DISABLED');
  assert.doesNotMatch(store.getItem(require('../src/js/publisher').DEFAULT_KEY),/Pasta|native:1|showTerminal/);
  assert.equal(lib.createProvider({storage:store,pluginUuid:P,now:()=>N*1000}).source({item:'card'}).instances.length,0);
});
