'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../src/js');
const P='01234567-89ab-cdef-0123-456789abcdef',NOW=1700000000;

function fixture(extra={}){
  let time=NOW*1000,settings={},next=0;
  const subscriptions=[],sends=[],timers=new Map(),work={later:0,cancel:0};
  const pebble={enumeratePlugins:()=>[{uuid:P,sources:[{category:'activity',items:['summary'],properties:api.summary.SOURCE_PROPERTIES}]}],
    subscribeToSource:request=>{const sub={request,closed:false};subscriptions.push(sub);return {unsubscribe(){sub.closed=true;}};}};
  const consumer=api.createActivities(Object.assign({nativeFormat:3,
    pebble,
    getSettings:()=>settings,now:()=>time,
    later:(fn,delay)=>{const id=++next;work.later++;timers.set(id,{fn,at:time+delay});return id;},
    cancelLater:id=>{work.cancel++;timers.delete(id);},
    send:(payload,ok,fail)=>sends.push({payload,ok,fail})
  },extra));
  return {consumer,pebble,subscriptions,sends,timers,work,
    configure(value){settings=value;consumer.configure();},
    data(envelope){subscriptions.at(-1).request.onData(envelope);},
    advance(ms){const end=time+ms;let count=0;for(;;){
      const due=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;assert(++count<100);timers.delete(due[0]);time=due[1].at;due[1].fn();
    }time=end;}
  };
}

function source(incarnation='first',sequence=1,revision=5){
  const record=api.summary.standard('one',{headline:api.summary.countdown({deadline:NOW+600})});
  const item=api.summary.toSourceInstance({provider:P,record,revision,observedAt:NOW,validUntil:NOW+630,private:false},{});
  return {pluginUuid:P,validUntilMs:(NOW+30)*1000,instances:[
    {instanceId:'@snapshot',properties:{schema_version:{numericValue:{value:4}},
      publisher_mode:{shortText:{text:'fresh'}},publisher_incarnation:{longText:{text:incarnation}},
      snapshot_sequence:{numericValue:{value:sequence}},activity_count:{numericValue:{value:1}}}},item]};
}

test('duplicate deliveries retain one absolute expiry callback without moving the source lease',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());
  const before={...f.work},count=f.sends.length;
  for(let i=0;i<20;i++)f.data(source('first',i+2));
  assert.deepEqual(f.work,before);assert.equal(f.sends.length,count);
  f.advance(30000);
  assert.equal(f.consumer.status().error,'SOURCE_EXPIRED');
  assert.equal(f.consumer.catalogue()[0].observedAt,NOW);
  assert.equal(f.consumer.catalogue()[0].validUntil,NOW+630);
  assert.equal(f.consumer.catalogue()[0].unconfirmed,true);
});

test('settings-only reconfiguration keeps healthy subscriptions and invalidates disabled callbacks',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());
  const original=f.subscriptions[0];
  for(let i=0;i<20;i++)f.configure({activityOrder:[P]});
  assert.equal(f.subscriptions.length,1);assert.equal(original.closed,false);
  f.configure({disabledProviders:[P]});assert.equal(original.closed,true);
  original.request.onData(source('first',2,6));assert.equal(f.consumer.catalogue().length,0);
  f.configure({});assert.equal(f.subscriptions.length,2);
  f.data(source('first',2,6));assert.equal(f.consumer.catalogue()[0].revision,6);
});

test('provider disable withdraws private data before deferred discovery settles and rejects late delivery',async()=>{
  const f=fixture();f.consumer.refresh(true,42);
  const envelope=source();envelope.instances[1].properties.private.boolean.value=true;
  f.data(envelope);assert.equal(f.consumer.view().cards.length,1);
  const original=f.subscriptions[0];let resolve;
  f.pebble.enumeratePlugins=()=>new Promise(done=>{resolve=done;});
  f.configure({disabledProviders:[P]});
  assert.equal(original.closed,true);assert.equal(f.consumer.catalogue().length,0);
  assert.equal(f.consumer.view().cards.length,0);
  original.request.onData(source('first',2,6));
  assert.equal(f.consumer.catalogue().length,0);
  resolve([{uuid:P,sources:[{category:'activity',items:['summary'],properties:api.summary.SOURCE_PROPERTIES}]}]);
  await Promise.resolve();
  assert.equal(f.subscriptions.length,1);assert.equal(f.consumer.view().cards.length,0);
});

test('disabling during bootstrap permits a fresh request after re-enabling',()=>{
  const f=fixture();f.consumer.refresh();
  assert.equal(f.sends.filter(s=>s.payload.REQUEST_ACTIVITIES).length,1);
  f.configure({enabled:false});f.advance(10000);f.configure({enabled:true});
  assert.equal(f.sends.filter(s=>s.payload.REQUEST_ACTIVITIES).length,2);
  /* The old queue result cannot arm another bootstrap retry. */
  const timers=f.timers.size;f.sends[0].ok();assert.equal(f.timers.size,timers);
});

test('a view queued before an incarnation reset cannot acknowledge that reset barrier',()=>{
  const f=fixture();f.consumer.refresh(true,42);
  const oldEmpty=f.sends.at(-1);
  f.data(source());f.sends.at(-1).ok();
  f.data(source('replacement',1,1));
  const clear=f.sends.at(-1);assert.equal(f.consumer.catalogue().length,0);
  oldEmpty.ok();assert.equal(f.subscriptions.length,1);
  clear.ok();assert.equal(f.subscriptions.length,2);
  f.data(source('replacement',2,2));assert.equal(f.consumer.catalogue()[0].revision,2);
});

test('old-session success and failure callbacks cannot affect a new session with reused sequences',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());f.sends.at(-1).ok();
  f.data(source('replacement',1,1));const oldClear=f.sends.at(-1);
  f.consumer.refresh(true,43);const subscriptions=f.subscriptions.length;
  oldClear.ok();assert.equal(f.subscriptions.length,subscriptions);

  const beforeReconnect=f.sends.at(-1);
  f.consumer.connectionChanged(false);f.consumer.connectionChanged(true,44);
  const timers=f.timers.size,sends=f.sends.length;
  beforeReconnect.fail({code:'TIMEOUT'});
  assert.equal(f.timers.size,timers);f.advance(2000);assert.equal(f.sends.length,sends);
});

test('disconnect, disable and stop release the retained public view including private capabilities',()=>{
  for(const finish of [f=>f.consumer.connectionChanged(false),f=>f.configure({enabled:false}),f=>f.consumer.stop()]){
    const f=fixture();f.consumer.refresh(true,42);
    const envelope=source();envelope.instances[1].properties.private.boolean.value=true;
    f.data(envelope);assert.equal(f.consumer.view().cards.length,1);
    finish(f);assert.equal(f.consumer.view(),null);
  }
});
