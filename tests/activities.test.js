'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const child=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const lib=require('../src/js');
const wire=lib.wire;
const consumer=require('../src/js/consumer');
const PROVIDER='c9e7cb18-eaf7-4b30-9b09-9a8fae187801';
const SECOND='c9e7cb18-eaf7-4b30-9b09-9a8fae187802';
const NOW=1700000000;
const card=(overrides={})=>Object.assign({schemaVersion:1,provider:PROVIDER,id:'run:1',kind:'timer',state:'active',clock:'deadline',revision:1,
  observedAt:NOW,validUntil:NOW+630,deadline:NOW+600,duration:0,clockAt:0,main:'',footer:'Pasta',private:false},overrides);
function storage(){const map=new Map();return {getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,value),map};}
function source(record,provider=PROVIDER,expiry=NOW+30){
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:provider,private:false});
  const reply=publisher.accept(Object.assign({},record,{provider}));assert.ok(reply.ACTIVITY_ACCEPTED_RUN);
  return Object.assign({pluginUuid:provider},lib.createProvider({storage:store,pluginUuid:provider,now:()=>NOW*1000}).source({}));
}
function plugin(uuid=PROVIDER){return {uuid,sources:[{category:'activity',items:['session'],properties:{schema_version:['numericValue']}}]};}
function fixture(initial={}){
  let time=NOW*1000,settings=initial.settings||{},plugins=initial.plugins||[plugin()],next=0;
  const timers=new Map(),subscriptions=[],sent=[],callbacks=[];
  const f={};
  const options={pebble:{enumeratePlugins:()=>plugins,subscribeToSource:request=>{const sub={request,closed:false};subscriptions.push(sub);return {unsubscribe:()=>{sub.closed=true;}};}},
    keys:{ACTIVITY_DATA:100,REQUEST_ACTIVITIES:101},getSettings:()=>settings,now:()=>time,
    later:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},cancelLater:id=>timers.delete(id),
    send:(payload,ok,fail)=>{sent.push(payload);callbacks.push({ok,fail});if(!initial.hold){ok();}}};
  const coordinator=lib.createActivities(options);
  Object.assign(f,{coordinator,sent,subscriptions,callbacks,timers,options,
    data:(data,index=subscriptions.length-1)=>subscriptions[index].request.onData(data),
    error:(code,index=subscriptions.length-1)=>subscriptions[index].request.onError({code}),
    configure:s=>{settings=s;coordinator.configure();},plugins:p=>{plugins=p;},
    advance:seconds=>{const end=time+seconds*1000;let count=0;while(true){const entry=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry){break;}if(++count>100){throw new Error('Timer loop');}timers.delete(entry[0]);time=entry[1].at;entry[1].fn();}time=end;},
    packet:()=>sent.filter(p=>p[100]).at(-1)?.[100]});
  return f;
}
function nativeDictionary(overrides={}){return Object.assign({ACTIVITY_SCHEMA_VERSION:1,ACTIVITY_RUN:'run:1',ACTIVITY_REVISION:1,ACTIVITY_STATE:'running',ACTIVITY_KIND:'timer',ACTIVITY_CLOCK:'deadline',ACTIVITY_NAME:'Pasta',ACTIVITY_FOOTER:'Pasta',ACTIVITY_OBSERVED_AT:NOW,ACTIVITY_VALID_UNTIL:NOW+630,ACTIVITY_DEADLINE:NOW+600,ACTIVITY_DURATION:0,ACTIVITY_CLOCK_AT:0,ACTIVITY_PRIVATE:0,ACTIVITY_PUBLISH_SESSION:4},overrides);}

test('standalone public entry has no Core runtime dependency',()=>{
  assert.equal(typeof lib.createContext,'function');assert.equal(typeof lib.createActivities,'function');
  for(const file of ['index.js','wire.js','consumer.js','publisher.js']){assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src/js',file),'utf8'),/require\(['"]pebble-watchface-core/);}
});
test('Unicode limits count UTF-8 bytes and keep valid scalar boundaries',()=>{
  const text=wire.text('Žluťoučký 🐢 '.repeat(50),192);assert.ok(Buffer.byteLength(text)<=192);assert.ok(text.endsWith('…'));assert.equal(Buffer.from(text).toString('utf8'),text);
  assert.equal(wire.text('a\u202eb\u0000c',192),'a b c');
});
test('wire validates required identity, revisions, clocks and finite numeric values',()=>{
  for(const bad of [card({provider:'x'}),card({id:''}),card({revision:0}),card({validUntil:NOW-1}),card({clock:'none'}),card({duration:1}),card({value:Infinity}),card({private:true,unconfirmed:true})]){assert.equal(wire.normalize(bad),null);}
  assert.ok(wire.normalize(card({clock:'none',deadline:0,main:'6.2 mmol/L',value:6.2,unit:'mmol/L'})));
  assert.equal(wire.normalize(card({clock:'none',deadline:0,main:'',value:null})),null);
});
test('elapsed duration excludes pauses and tolerates backward wall-clock changes',()=>{
  const active=card({clock:'elapsed',deadline:0,duration:120,clockAt:NOW});
  assert.equal(wire.clockValue(active,NOW+10),130);assert.equal(wire.clockValue(active,NOW-10),120);
  const paused=Object.assign({},active,{state:'paused',clockAt:0});assert.equal(wire.clockValue(paused,NOW+100),120);
  assert.equal(wire.formatClock(3661),'1:01:01');assert.equal(wire.formatClock(0),'00:00');
});
test('deadline reaching zero is not an app-confirmed completion',()=>{
  const c=card();assert.equal(wire.clockValue(c,NOW+610),0);assert.equal(c.state,'active');assert.equal(wire.clockValue(c,NOW-100),600);
});
test('binary format stays bounded with two maximum cards and 40px artwork',()=>{
  const maximum=card({id:'x'.repeat(64),kind:'k'.repeat(24),main:'m'.repeat(192),footer:'f'.repeat(128),unit:'u'.repeat(16),image:{width:40,height:40,palette:[192],pixels:Array(800).fill(0)}});
  const packet=wire.encode([maximum,Object.assign({},maximum,{provider:SECOND})],{session:42,revision:1,sentAt:NOW});
  assert.equal(packet.length,2672);assert.equal(Buffer.from(packet).readUInt16LE(6),packet.length);assert.equal(Buffer.from(packet).readUInt16LE(8),wire.crc16(packet));
  assert.throws(()=>wire.encode([maximum,maximum,maximum],{session:42,revision:1,sentAt:NOW}),/INVALID_SNAPSHOT/);
});
test('odd-width image padding is canonicalized without changing pixels',()=>{
  assert.deepEqual(wire.image({width:3,height:1,palette:[192,255],pixels:[1,31]}).pixels,[1,16]);
  assert.equal(wire.image({width:3,height:1,palette:[192],pixels:[1,0]}),null);
});
test('cross-language fixtures match the JS encoder exactly',()=>{
  const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/source.json')));
  for(const [name,cards] of Object.entries(fixtures.cases)){assert.deepEqual(Buffer.from(wire.encode(cards,fixtures)),fs.readFileSync(path.join(__dirname,'fixtures',name+'.bin')));}
});
test('publisher acknowledges only after write and read-back, with exact ticket',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:false});
  const receipt=publisher.handleMessage(nativeDictionary());
  assert.deepEqual(receipt,{ACTIVITY_ACCEPTED_RUN:'run:1',ACTIVITY_ACCEPTED_REVISION:1,ACTIVITY_PUBLISH_SESSION:4});
  assert.equal(publisher.lastRevision(),1);assert.match([...store.map.values()][0],/Pasta/);
});
test('publisher detects failed storage and does not falsely acknowledge transport delivery',()=>{
  const store={getItem:()=>null,setItem:()=>{}};
  assert.deepEqual(lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:false}).handleMessage(nativeDictionary()),{ACTIVITY_ERROR:'STORAGE_FAILED',ACTIVITY_PUBLISH_SESSION:4});
});
test('native privacy accepts only explicit booleans or zero/one and never persists malformed private data',()=>{
  for(const privacy of [2,-1,0.5,'true','false',null,[],{},NaN,Infinity]){
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:false});
    assert.deepEqual(publisher.handleMessage(nativeDictionary({ACTIVITY_PRIVATE:privacy})),
      {ACTIVITY_ERROR:'INVALID_SNAPSHOT',ACTIVITY_PUBLISH_SESSION:4});
    assert.equal(store.map.size,0);
  }
  for(const privacy of [false,0,true,1]){
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:false});
    const receipt=publisher.handleMessage(nativeDictionary({ACTIVITY_PRIVATE:privacy}));
    if(privacy===false || privacy===0){assert.equal(receipt.ACTIVITY_ACCEPTED_REVISION,1);}
    else{assert.equal(receipt.ACTIVITY_ERROR,'PRIVATE_PERSISTENCE_DISABLED');assert.doesNotMatch([...store.map.values()].join(''),/Pasta|run:1/);}
  }
  for(const explicitPublic of [false,true]){
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:!explicitPublic});
    const payload=nativeDictionary();delete payload.ACTIVITY_PRIVATE;
    const receipt=publisher.handleMessage(payload);
    assert.equal(receipt.ACTIVITY_ACCEPTED_REVISION===1,explicitPublic);
  }
});
test('publisher refuses private persistent snapshots',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});
  assert.equal(p.accept(card({private:true})).ACTIVITY_ERROR,'PRIVATE_PERSISTENCE_DISABLED');assert.doesNotMatch([...store.map.values()].join(''),/Pasta|run:1/);
});
test('publisher rejects stale same-run and cross-run deliveries, retaining terminal tombstone',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});
  assert.ok(p.accept(card({revision:10,state:'cancelled',clock:'none',deadline:0})).ACTIVITY_ACCEPTED_RUN);
  assert.equal(p.accept(card({revision:9})).ACTIVITY_ERROR,'STALE_REVISION');
  assert.equal(p.accept(card({id:'older-run',revision:8})).ACTIVITY_ERROR,'STALE_REVISION');
  assert.equal(p.accept(card({revision:10})).ACTIVITY_ERROR,'TERMINAL_RUN');assert.equal(p.accept(card({revision:11})).ACTIVITY_ERROR,'TERMINAL_RUN');
});
test('a reset native producer can recover the phone revision floor without clearing storage',()=>{
  const store=storage(),old=lib.createPublisher({storage:store,pluginUuid:PROVIDER});old.accept(card({revision:70}));
  const reinstalled=lib.createPublisher({storage:store,pluginUuid:PROVIDER});assert.equal(reinstalled.lastRevision(),70);
  const nextRevision=Math.max(1,reinstalled.lastRevision())+1;
  assert.ok(reinstalled.accept(card({id:'new-install-run',revision:nextRevision})).ACTIVITY_ACCEPTED_RUN);
  assert.equal(reinstalled.accept(card({revision:70})).ACTIVITY_ERROR,'STALE_REVISION');
});
test('cold provider calls preserve native observation and expiry while renewing only availability',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});p.accept(card());
  const first=lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000}).source({});
  const second=lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000+60000}).source({});
  assert.equal(first.instances[0].properties.observed_at.timestamp.value,NOW);
  assert.equal(second.instances[0].properties.observed_at.timestamp.value,NOW);
  assert.equal(second.instances[0].properties.valid_until.timestamp.value,NOW+630);
  assert.equal(second.validUntilMs-first.validUntilMs,60000);
  assert.equal(lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000+631000}).source({}).instances.length,0);
});
test('provider returns terminal state until its original tombstone expiry',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});p.accept(card({state:'completed',clock:'none',deadline:0}));
  assert.equal(lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000}).source({}).instances[0].properties.state.shortText.text,'completed');
});
test('provider requests expose standard bitmap shapes as base64 only when requested',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});p.accept(card({image:{width:2,height:1,palette:[192],pixels:[0]}}));
  const provider=lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000});
  assert.equal(provider.source({}).instances[0].properties.artwork,undefined);
  const image=provider.source({iconPixelSize:{w:40,h:40}}).instances[0].properties.artwork.image;
  assert.equal(typeof image.palette,'string');assert.equal(typeof image.pixels,'string');assert.ok(wire.image(image));
});
test('consumer enumerates every compatible provider explicitly and ignores unrelated sources',()=>{
  const f=fixture({plugins:[plugin(SECOND),{uuid:'bad',sources:[]},plugin()]});f.coordinator.refresh(true,42);
  assert.deepEqual(f.subscriptions.map(s=>s.request.plugin),[PROVIDER,SECOND]);assert.ok(f.subscriptions.every(s=>s.request.category==='activity'&&s.request.item==='session'));
});
test('consumer rejects preferred-provider fallback and removes previous content',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));assert.equal(f.coordinator.catalogue().length,1);
  f.data(Object.assign(source(card()),{pluginUuid:SECOND}));assert.equal(f.coordinator.catalogue().length,0);assert.equal(f.coordinator.status().error,'INVALID_SOURCE');assert.equal(f.packet()[5],0);
});
test('consumer accepts valid numeric and Unicode source properties',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card({clock:'none',deadline:0,main:'Žluťoučký 6,2',value:6.2,unit:'mmol/L'})));
  assert.equal(f.coordinator.catalogue()[0].value,6.2);assert.equal(f.coordinator.catalogue()[0].unit,'mmol/L');
});
test('new revisions update in place; older revisions and completion replay do not resurrect a run',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card({revision:5})));f.data(source(card({revision:4,footer:'Old'})));
  assert.equal(f.coordinator.catalogue()[0].revision,5);assert.equal(f.coordinator.catalogue()[0].footer,'Pasta');
  f.data(source(card({revision:6,state:'completed',clock:'none',deadline:0})));assert.equal(f.coordinator.catalogue().length,0);
  f.data(source(card({revision:5})));assert.equal(f.coordinator.catalogue().length,0);
  f.data(source(card({revision:6})));assert.equal(f.coordinator.catalogue().length,0);
  assert.equal(f.coordinator.status().error,'INVALID_SOURCE');
  f.data(source(card({revision:7})));assert.equal(f.coordinator.catalogue().length,0);
});
test('source withdrawal and privacy redaction remove activity immediately',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));f.data({pluginUuid:PROVIDER,instances:[]});assert.equal(f.packet()[5],0);
  f.data(source(card()));f.data({pluginUuid:PROVIDER,instances:[{instanceId:'run:1',properties:{}}]});assert.equal(f.coordinator.catalogue().length,0);
});
test('source availability expiry retains only public clocks as unconfirmed using original validity',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));f.advance(31);
  const retained=f.coordinator.catalogue()[0];assert.equal(retained.validUntil,NOW+630);assert.equal(retained.observedAt,NOW);assert.equal(retained.unconfirmed,true);assert.ok(f.packet()[26]&8);
  f.advance(600);assert.equal(f.coordinator.catalogue().length,0);
});
test('private source data is cleared on source expiry instead of retained as uncertain',()=>{
  const f=fixture();f.coordinator.refresh(true,42);
  const envelope=source(card());envelope.instances[0].properties.private.boolean.value=true;envelope.instances[0].properties.unconfirmed.boolean.value=false;f.data(envelope);f.advance(31);assert.equal(f.coordinator.catalogue().length,0);
});
test('permission denial clears even public clocks; a timeout may retain them as uncertain',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));f.error('TIMEOUT');assert.equal(f.coordinator.catalogue()[0].unconfirmed,true);
  f.error('PERMISSION_DENIED');assert.equal(f.coordinator.catalogue().length,0);
});
test('disabled and removed providers are unsubscribed without allowing late updates',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));const old=f.subscriptions[0];
  f.configure({providers:[]});assert.ok(old.closed);old.request.onData(source(card({revision:2})));assert.equal(f.coordinator.catalogue().length,0);
  f.configure({});f.data(source(card()));f.plugins([]);f.coordinator.refresh(true,42);assert.equal(f.coordinator.catalogue().length,0);
});
test('global disable retracts native frame and keeps source contents out of status',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card({footer:'Sensitive timer label'})));
  assert.doesNotMatch(JSON.stringify(f.coordinator.status()),/Sensitive timer label|run:1/);
  f.configure({enabled:false});assert.equal(f.packet()[5],0);assert.ok(f.subscriptions[0].closed);assert.equal(f.coordinator.catalogue().length,0);
});
test('source and packet budgets are bounded',()=>{
  const f=fixture();f.coordinator.refresh(true,42);
  const data=source(card());data.instances=Array.from({length:17},(_,i)=>Object.assign({},data.instances[0],{instanceId:'run:'+i}));f.data(data);assert.equal(f.coordinator.catalogue().length,0);
});
test('connection loss closes subscriptions; old callbacks cannot cross a new native session',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));const old=f.subscriptions[0];f.coordinator.connectionChanged(false);
  assert.equal(f.coordinator.catalogue().length,0);assert.ok(old.closed);f.coordinator.connectionChanged(true,43);old.request.onData(source(card({revision:100})));assert.equal(f.coordinator.catalogue().length,0);
  f.data(source(card({revision:2})));assert.equal(Buffer.from(f.packet()).readUInt32LE(12),43);
});
test('bootstrap uses an explicit request and emits no payload with an unknown native session',()=>{
  const f=fixture();f.coordinator.refresh();f.data(source(card()));assert.equal(f.packet(),undefined);assert.ok(f.sent.some(p=>p[101]===1));
  f.coordinator.refresh(true,42);f.data(source(card()));assert.ok(f.packet());
});
test('stable projections retain first-seen order rather than moving on refreshed values',()=>{
  const f=fixture({plugins:[plugin(),plugin(SECOND)]});f.coordinator.refresh(true,42);f.data(source(card({id:'second'}),SECOND),1);f.data(source(card()),0);
  assert.deepEqual(f.coordinator.catalogue().map(c=>c.id),['second','run:1']);f.data(source(card({revision:2})),0);assert.deepEqual(f.coordinator.catalogue().map(c=>c.id),['second','run:1']);
});
test('phone runtime APIs missing is a supported unavailable state',()=>{
  const sent=[],c=lib.createActivities({pebble:{},now:()=>NOW*1000,send:p=>sent.push(p),later:()=>1,cancelLater:()=>{}});c.refresh(true,42);assert.equal(c.status().error,'API_UNAVAILABLE');assert.equal(sent.at(-1).ACTIVITY_DATA[5],0);c.stop();
});
test('provider bundle cold-starts without Node or a webview API',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pebble-activity-plugin-'));
  try {
    fs.writeFileSync(path.join(temp,'entry.js'),"var p=require('pebble-activities/publisher').createProvider({storage:localStorage,pluginUuid:'"+PROVIDER+"'});Pebble.registerSourceHandler(p.handleSource);\n");
    child.execFileSync('python3',[path.join(__dirname,'../scripts/bundle-js.py'),path.join(temp,'entry.js'),path.join(temp,'plugin.js')]);
    let handler;vm.runInNewContext(fs.readFileSync(path.join(temp,'plugin.js'),'utf8'),{localStorage:storage(),Pebble:{registerSourceHandler:h=>{handler=h;}}});
    let answer;handler({category:'activity',item:'session'},{data:d=>{answer=d;}});assert.equal(answer.instances.length,0);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('same revision is immutable and exact duplicate deliveries preserve original observation',()=>{
  const f=fixture();f.coordinator.refresh(true,42);f.data(source(card()));f.advance(5);f.data(source(card()));assert.equal(f.coordinator.catalogue()[0].observedAt,NOW);
  f.data(source(card({footer:'Conflicting text'})));assert.equal(f.coordinator.catalogue().length,0);assert.equal(f.coordinator.status().error,'INVALID_SOURCE');
});

test('host policy applies immediately and reserved private kinds cannot opt out',()=>{
  let permit=true;const f=fixture();f.options.acceptActivity=()=>permit;f.coordinator.refresh(true,42);f.data(source(card()));assert.equal(f.coordinator.catalogue().length,1);permit=false;assert.equal(f.coordinator.catalogue().length,0);
  assert.equal(wire.normalize(card({kind:'Music'})).private,true);
  assert.equal(wire.normalize(card({kind:'Notification'})).private,true);
});
test('every reserved kind is case-folded before enforcing native private flags',()=>{
  for(const kind of ['music','Music','MUSIC','notification','Notification','NOTIFICATION','notifications','Notifications','NOTIFICATIONS']){
    const normalized=wire.normalize(card({kind:kind,private:false}));
    assert.equal(normalized.kind,kind.toLowerCase());assert.equal(normalized.private,true);
    const packet=wire.encode([card({kind:kind,private:false})],{session:42,revision:1,sentAt:NOW});
    assert.ok(packet[26]&1);
    const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER,private:false});
    assert.equal(publisher.handleMessage(nativeDictionary({ACTIVITY_KIND:kind})).ACTIVITY_ERROR,'PRIVATE_PERSISTENCE_DISABLED');
    assert.doesNotMatch([...store.map.values()].join(''),/Pasta|run:1/);
  }
});

test('fresh polling of a saved native snapshot remains last-reported after reconnection',()=>{
  const store=storage(),publisher=lib.createPublisher({storage:store,pluginUuid:PROVIDER});publisher.accept(card());
  const provider=lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000+20000});
  const f=fixture();f.coordinator.refresh(true,42);f.data(Object.assign({pluginUuid:PROVIDER},provider.source({})));
  assert.equal(f.coordinator.catalogue()[0].unconfirmed,true);f.coordinator.connectionChanged(false);f.coordinator.connectionChanged(true,43);
  f.data(Object.assign({pluginUuid:PROVIDER},provider.source({})));assert.equal(f.coordinator.catalogue()[0].unconfirmed,true);assert.ok(f.packet()[26]&8);
});

test('failed old sends do not retry a redacted snapshot and current retries are bounded',()=>{
  const f=fixture({hold:true});f.coordinator.refresh(true,42);f.data(source(card()));const old=f.callbacks.at(-1);f.data({pluginUuid:PROVIDER,instances:[]});const before=f.sent.length;old.fail({code:'TIMEOUT'});f.advance(2);assert.equal(f.sent.length,before);assert.equal(f.packet()[5],0);
  f.callbacks.at(-1).fail({code:'TIMEOUT'});f.advance(2);f.callbacks.at(-1).fail({code:'TIMEOUT'});f.advance(2);f.callbacks.at(-1).fail({code:'TIMEOUT'});const after=f.sent.length;f.advance(10);assert.equal(f.sent.length,after);
});

test('privacy retraction removes prior public bridge content without persisting private metadata',()=>{
  const store=storage(),p=lib.createPublisher({storage:store,pluginUuid:PROVIDER});p.accept(card());
  assert.equal(p.accept(card({private:true,revision:2,footer:'Private new label'})).ACTIVITY_ERROR,'PRIVATE_PERSISTENCE_DISABLED');
  assert.doesNotMatch([...store.map.values()].join(''),/Pasta|Private new label|run:1/);assert.equal(p.lastRevision(),2);
  assert.equal(lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>NOW*1000}).source({}).instances.length,0);
  assert.equal(p.accept(card()).ACTIVITY_ERROR,'STALE_REVISION');assert.equal(p.accept(card({revision:2})).ACTIVITY_ERROR,'REVISION_CONFLICT');
});

test('availability provenance can change at the same authoritative revision',()=>{
  const f=fixture();f.coordinator.refresh(true,42);const data=source(card());f.data(data);data.instances[0].properties.unconfirmed.boolean.value=false;f.data(data);
  assert.equal(f.coordinator.catalogue().length,1);assert.equal(f.coordinator.catalogue()[0].unconfirmed,false);assert.equal(f.coordinator.status().error,'');
});
