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

test('configuration retries failed handles while keeping healthy provider subscriptions',()=>{
  for(const code of ['TIMEOUT','PLUGIN_UNAVAILABLE','RATE_LIMITED','PERMISSION_DENIED']){
    const f=fixture();f.consumer.refresh(true,42);f.data(source());
    const failed=f.subscriptions[0];failed.request.onError({code});
    f.configure({});assert.equal(f.subscriptions.length,2,code+' did not retry');assert.ok(failed.closed);
    failed.request.onData(source('first',2,6));assert.equal(f.consumer.status().providers[0].state,'waiting');
    f.data(source('first',2,6));assert.equal(f.consumer.catalogue()[0].revision,6);
    f.configure({});assert.equal(f.subscriptions.length,2,'healthy handle was replaced after recovery');
  }
});

test('periodic discovery retries a failed provider without depending on a settings edit',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());
  f.subscriptions[0].request.onError({code:'PLUGIN_UNAVAILABLE'});
  f.advance(60000);assert.equal(f.subscriptions.length,2);
  assert.ok(f.subscriptions[0].closed);assert.equal(f.consumer.status().providers[0].state,'waiting');
});

test('one failed provider recovers into its original primary role without rebinding the healthy secondary',()=>{
  const f=fixture(),other='11111111-1111-4111-8111-111111111111';
  f.pebble.enumeratePlugins=()=>[P,other].map(uuid=>({uuid,sources:[{category:'activity',items:['summary'],properties:api.summary.SOURCE_PROPERTIES}]}));
  f.consumer.refresh(true,42);
  const first=f.subscriptions.find(s=>s.request.plugin===P),second=f.subscriptions.find(s=>s.request.plugin===other);
  first.request.onData(source());second.request.onData({...source(),pluginUuid:other});
  assert.deepEqual(f.consumer.view().cards.map(c=>c.provider),[P,other]);
  first.request.onError({code:'PERMISSION_DENIED'});
  assert.deepEqual(f.consumer.view().cards.map(c=>c.provider),[other]);
  f.configure({});assert.equal(f.subscriptions.length,3);assert.equal(second.closed,false);
  f.subscriptions.at(-1).request.onData(source());
  assert.deepEqual(f.consumer.view().cards.map(c=>c.provider),[P,other]);
});

test('a re-bound source restores its exact cached summary without renewing owner observation or expiry',()=>{
  const f=fixture();f.consumer.refresh(true,42);const envelope=source();f.data(envelope);
  f.advance(5000);f.subscriptions[0].request.onError({code:'PERMISSION_DENIED'});
  assert.equal(f.consumer.catalogue().length,0);
  f.consumer.refresh(true,42);f.data(envelope);
  assert.equal(f.consumer.status().providers[0].state,'ready');
  const restored=f.consumer.catalogue()[0];assert.ok(restored);
  assert.equal(restored.revision,5);assert.equal(restored.observedAt,NOW);assert.equal(restored.validUntil,NOW+630);
});

test('the same source handle can recover an identical valid summary after a transient error or permission recovery',()=>{
  for(const code of ['TIMEOUT','PERMISSION_DENIED']){
    const f=fixture();f.consumer.refresh(true,42);const cached=source();
    cached.instances[1].properties.private.boolean.value=true;f.data(cached);
    f.advance(5000);f.subscriptions[0].request.onError({code});assert.equal(f.consumer.catalogue().length,0);
    f.data(cached);assert.equal(f.consumer.status().error,'');assert.equal(f.subscriptions.length,1);
    const restored=f.consumer.catalogue()[0];assert.ok(restored);assert.equal(restored.revision,5);
    assert.equal(restored.observedAt,NOW);assert.equal(restored.validUntil,NOW+630);
    f.advance(25000);assert.equal(f.consumer.catalogue().length,0,'cached recovery renewed source availability');
  }
});

test('an exact summary with a shortened availability lease clears private content at that original deadline',()=>{
  const f=fixture();f.consumer.refresh(true,42);const cached=source();cached.instances[1].properties.private.boolean.value=true;
  f.data(cached);f.advance(1000);f.data({...cached,validUntilMs:(NOW+2)*1000});
  f.advance(1000);assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'SOURCE_EXPIRED');
  f.data({...cached,validUntilMs:(NOW+2)*1000});assert.equal(f.consumer.catalogue().length,0);
});

test('rejecting a malformed complete summary cannot poison a sibling owner revision or terminal history',()=>{
  for(const terminal of [false,true]){
    const f=fixture();f.consumer.refresh(true,42);f.data(source());
    const bad=source('first',2,terminal?6:999),record=JSON.parse(bad.instances[1].properties.content.longText.text);
    if(terminal){record.state='completed';record.result=true;bad.instances[1].properties.content.longText.text=JSON.stringify(record);}
    bad.instances.push({instanceId:'malformed-sibling',properties:{}});
    bad.instances[0].properties.activity_count.numericValue.value=2;
    f.data(bad);assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'INVALID_SOURCE');
    f.data(source('first',3,terminal?7:6));
    assert.equal(f.consumer.status().error,'');assert.equal(f.consumer.catalogue().length,1);
    assert.equal(f.consumer.catalogue()[0].revision,terminal?7:6);
  }
});

test('a malformed declaration from another plugin cannot hide a valid provider',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());
  f.pebble.enumeratePlugins=()=>[
    {uuid:P,sources:[{category:'activity',items:['summary'],properties:api.summary.SOURCE_PROPERTIES}]},
    {uuid:'11111111-1111-4111-8111-111111111111',sources:[null]}
  ];
  f.configure({});assert.equal(f.consumer.status().error,'');assert.equal(f.consumer.catalogue().length,1);
  assert.equal(f.subscriptions.length,1);
});

test('synchronous unsubscribe callbacks cannot republish a provider being disabled',()=>{
  const f=fixture();const views=[];
  f.pebble.subscribeToSource=request=>{
    f.subscriptions.push({request,closed:false});
    return {unsubscribe(){request.onData(source('first',2,6));}};
  };
  f.consumer.refresh(true,42);f.data(source());const before=f.sends.length;
  f.configure({disabledProviders:[P]});
  for(const sent of f.sends.slice(before)){
    const bytes=sent.payload.ACTIVITY_DATA;if(bytes)views.push(bytes[5]);
  }
  assert.ok(views.length);assert.deepEqual(views,[0]);
});

test('recovery cannot restore expired private content or accept a changed owner observation at the same revision',()=>{
  const f=fixture();f.consumer.refresh(true,42);const cached=source();
  cached.instances[1].properties.private.boolean.value=true;cached.validUntilMs=(NOW+2)*1000;f.data(cached);
  f.subscriptions.at(-1).request.onError({code:'PERMISSION_DENIED'});f.configure({});f.advance(3000);
  f.consumer.refresh(true,42);f.data(cached);
  assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'SOURCE_EXPIRED');
  const conflict=source('first',2);conflict.instances[1].properties.private.boolean.value=true;
  conflict.instances[1].properties.observed_at.timestamp.value=NOW+1;
  f.data(conflict);assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().error,'INVALID_SOURCE');
});

test('discovery and configuration never bypass an unacknowledged incarnation clear barrier',()=>{
  const f=fixture();f.consumer.refresh(true,42);f.data(source());f.sends.at(-1).ok();
  f.data(source('replacement',1,1));const barrier=f.sends.at(-1);
  assert.ok(f.subscriptions[0].closed);assert.equal(f.consumer.catalogue().length,0);
  f.configure({});f.advance(60000);
  assert.equal(f.subscriptions.length,1,'waiting reset was rebound before its native clear');
  barrier.ok();assert.equal(f.subscriptions.length,2);
});
