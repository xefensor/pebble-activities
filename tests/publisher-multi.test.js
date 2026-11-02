'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const lib=require('../src/js/publisher');
const PROVIDER='c9e7cb18-eaf7-4b30-9b09-9a8fae187801';
const NOW=1700000000;
function storage(){const map=new Map();return {map,getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,value)};}
function card(slot,revision,overrides={}){return Object.assign({schemaVersion:1,slot,provider:PROVIDER,id:'timer:'+slot+':1',kind:'timer',state:'active',clock:'deadline',revision,
  observedAt:NOW,validUntil:NOW+630,deadline:NOW+600,duration:0,clockAt:0,main:'',footer:(slot+1)+' min timer',private:false},overrides);}
function publisher(store,options={}){return lib.createPublisher(Object.assign({storage:store,pluginUuid:PROVIDER,maxRecords:8},options));}
function source(store,seconds=0){return lib.createProvider({storage:store,pluginUuid:PROVIDER,now:()=>1000*(NOW+seconds)}).source({});}
function accepted(p,c){assert.equal(p.accept(c).ACTIVITY_ACCEPTED_REVISION,c.revision);}

test('legacy record and revision migrate at the same storage key into slot zero',()=>{
  const store=storage(),legacy=publisher(store,{maxRecords:1});
  const first=card(0,20);delete first.slot;accepted(legacy,first);
  const original=JSON.parse(store.getItem(lib.DEFAULT_KEY));assert.ok(original.card);assert.equal(original.slots,undefined);
  const current=publisher(store);assert.equal(current.lastRevision(),20);
  accepted(current,card(1,21));
  const saved=JSON.parse(store.getItem(lib.DEFAULT_KEY));assert.equal(saved.card,undefined);assert.equal(saved.slots.length,8);
  assert.deepEqual(source(store).instances.map(x=>x.instanceId),['timer:0:1','timer:1:1']);
  assert.equal(source(store).instances[0].properties.observed_at.timestamp.value,NOW);
  const defaultPayload=card(0,22,{state:'paused',deadline:0,duration:100});delete defaultPayload.slot;accepted(current,defaultPayload);
  assert.equal(source(store).instances[0].properties.state.shortText.text,'paused');
});

test('eight stable slots survive cold reads and independent pause and cancel updates',()=>{
  const store=storage(),p=publisher(store);
  for(let slot=7;slot>=0;slot--)accepted(p,card(slot,8-slot));
  assert.deepEqual(source(store).instances.map(x=>x.instanceId),Array.from({length:8},(_,i)=>'timer:'+i+':1'));
  const cold=publisher(store);assert.equal(cold.lastRevision(),8);
  accepted(cold,card(3,9,{state:'paused',deadline:0,duration:200}));
  accepted(cold,card(5,10,{state:'cancelled',clock:'none',deadline:0}));
  const instances=source(store).instances;
  assert.equal(instances.length,8);assert.equal(instances[3].properties.duration.numericValue.value,200);
  assert.equal(instances[5].properties.state.shortText.text,'cancelled');
  assert.equal(instances[0].properties.revision.numericValue.value,8);
});

test('offline slot reuse atomically replaces its predecessor without evicting other live timers',()=>{
  const store=storage(),p=publisher(store);
  for(let slot=0;slot<8;slot++)accepted(p,card(slot,slot+1));
  const next=card(2,9,{id:'timer:2:4'});accepted(p,next);
  const ids=source(store).instances.map(x=>x.instanceId);
  assert.equal(ids.length,8);assert.equal(ids.includes('timer:2:1'),false);assert.equal(ids[2],'timer:2:4');
  assert.deepEqual(p.accept(card(2,3)),{ACTIVITY_ERROR:'STALE_REVISION'});
  assert.deepEqual(p.accept(next),{ACTIVITY_ACCEPTED_RUN:next.id,ACTIVITY_ACCEPTED_REVISION:9});
});

test('source-wide revisions reject conflicting slot snapshots and exact receipts remain idempotent',()=>{
  const store=storage(),p=publisher(store);accepted(p,card(0,1));accepted(p,card(1,2));
  assert.equal(p.accept(card(0,2,{footer:'Changed'})).ACTIVITY_ERROR,'REVISION_CONFLICT');
  assert.equal(p.accept(card(0,1)).ACTIVITY_ERROR,'STALE_REVISION');
  accepted(p,card(1,2));
  accepted(p,card(1,3,{state:'completed',clock:'none',deadline:0}));
  assert.equal(p.accept(card(1,4)).ACTIVITY_ERROR,'TERMINAL_RUN');
  assert.equal(p.accept(card(2,4,{id:'timer:0:1'})).ACTIVITY_ERROR,'SLOT_CONFLICT');
  assert.equal(p.lastRevision(),3);
});

test('slot and capacity bounds fail without writing or acknowledging a dropped timer',()=>{
  const store=storage(),p=publisher(store);
  for(const bad of [-1,8,0.5,'0',null,NaN,Infinity])assert.equal(p.accept(card(bad,1)).ACTIVITY_ERROR,'INVALID_SLOT');
  assert.equal(store.map.size,0);
  for(const limit of [0,9,0.5,'8',null])assert.throws(()=>publisher(store,{maxRecords:limit}),/INVALID_RECORD_LIMIT/);
  assert.equal(publisher(store,{maxRecords:1}).accept(card(1,1)).ACTIVITY_ERROR,'INVALID_SLOT');
});

test('a smaller or default writer cannot silently truncate another occupied slot',()=>{
  const store=storage(),p=publisher(store);accepted(p,card(0,1));accepted(p,card(7,2));
  const before=store.getItem(lib.DEFAULT_KEY);
  for(const limit of [1,2,7]){
    const smaller=publisher(store,{maxRecords:limit});
    assert.equal(smaller.accept(card(0,3)).ACTIVITY_ERROR,'RECORD_LIMIT_CONFLICT');
    assert.equal(smaller.lastRevision(),2);assert.equal(store.getItem(lib.DEFAULT_KEY),before);
  }
  assert.deepEqual(source(store).instances.map(x=>x.instanceId),['timer:0:1','timer:7:1']);
  accepted(p,card(0,3));
});

test('multi-slot privacy retraction erases only that slot and never saves private identity or body',()=>{
  const store=storage(),p=publisher(store);accepted(p,card(0,1,{footer:'Public first'}));accepted(p,card(1,2,{footer:'Public second'}));
  const result=p.accept(card(0,3,{id:'private-new-run',private:true,footer:'Hidden reading'}));
  assert.equal(result.ACTIVITY_ERROR,'PRIVATE_PERSISTENCE_DISABLED');assert.equal(p.lastRevision(),3);
  const saved=store.getItem(lib.DEFAULT_KEY);assert.doesNotMatch(saved,/Public first|private-new-run|Hidden reading|timer:0:1/);
  assert.match(saved,/Public second/);assert.deepEqual(source(store).instances.map(x=>x.instanceId),['timer:1:1']);
  assert.equal(p.accept(card(0,1)).ACTIVITY_ERROR,'STALE_REVISION');
  assert.equal(p.accept(card(0,3)).ACTIVITY_ERROR,'REVISION_CONFLICT');
});

test('each slot retains original observation and expires independently without claiming completion',()=>{
  const store=storage(),p=publisher(store);accepted(p,card(0,1,{validUntil:NOW+20}));accepted(p,card(1,2));
  const first=source(store);const later=source(store,25);
  assert.equal(first.instances.length,2);assert.equal(later.instances.length,1);
  assert.equal(later.instances[0].properties.observed_at.timestamp.value,NOW);
  assert.equal(later.instances[0].properties.valid_until.timestamp.value,NOW+630);
  assert.equal(later.instances[0].properties.state.shortText.text,'active');
  assert.equal(later.instances[0].properties.unconfirmed.boolean.value,true);
  assert.equal(source(store,631).instances.length,0);
});

test('native slot is a bridge-only key and successful receipts still echo the exact transport ticket',()=>{
  const store=storage(),p=publisher(store);
  const receipt=p.handleMessage({ACTIVITY_SCHEMA_VERSION:1,ACTIVITY_SLOT:7,ACTIVITY_RUN:'native:7:1',ACTIVITY_REVISION:1,
    ACTIVITY_STATE:'running',ACTIVITY_KIND:'timer',ACTIVITY_CLOCK:'deadline',ACTIVITY_FOOTER:'Timer',
    ACTIVITY_OBSERVED_AT:NOW,ACTIVITY_VALID_UNTIL:NOW+630,ACTIVITY_DEADLINE:NOW+600,ACTIVITY_PRIVATE:0,ACTIVITY_PUBLISH_SESSION:40});
  assert.deepEqual(receipt,{ACTIVITY_ACCEPTED_RUN:'native:7:1',ACTIVITY_ACCEPTED_REVISION:1,ACTIVITY_PUBLISH_SESSION:40});
  const instance=source(store).instances[0];assert.equal(instance.instanceId,'native:7:1');assert.equal(instance.properties.slot,undefined);
  const invalid=p.handleMessage({ACTIVITY_SCHEMA_VERSION:1,ACTIVITY_SLOT:8,ACTIVITY_RUN:'native:8:1',ACTIVITY_REVISION:2,
    ACTIVITY_STATE:'running',ACTIVITY_KIND:'timer',ACTIVITY_CLOCK:'deadline',ACTIVITY_FOOTER:'Timer',
    ACTIVITY_OBSERVED_AT:NOW,ACTIVITY_VALID_UNTIL:NOW+630,ACTIVITY_DEADLINE:NOW+600,ACTIVITY_PRIVATE:0,ACTIVITY_PUBLISH_SESSION:41});
  assert.deepEqual(invalid,{ACTIVITY_ERROR:'INVALID_SLOT',ACTIVITY_PUBLISH_SESSION:41});assert.equal(p.lastRevision(),1);
});

test('multi-slot receipt fails if storage write or readback loses another timer',()=>{
  const store=storage(),p=publisher(store);accepted(p,card(0,1));
  const real=store.setItem;store.setItem=(key,value)=>{const data=JSON.parse(value);data.slots[0]=null;real(key,JSON.stringify(data));};
  assert.equal(p.accept(card(1,2)).ACTIVITY_ERROR,'STORAGE_FAILED');
});

test('malformed or private cached collections fail closed rather than returning a partial source',()=>{
  const store=storage();
  for(const slots of [Array(9).fill(null),[card(0,1),card(0,1)],[card(0,1,{private:true})],[{id:'invalid'}]]){
    store.setItem(lib.DEFAULT_KEY,JSON.stringify({schemaVersion:1,revision:9,slots}));
    assert.equal(source(store).instances.length,0);assert.equal(publisher(store).lastRevision(),9);
  }
});
