'use strict';
var test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
var api=require('..'),summary=require('../summary'),view=require('../summary-view');
var PROVIDER='01234567-89ab-cdef-0123-456789abcdef';
function store(){var values={};return {values:values,getItem:function(k){return Object.prototype.hasOwnProperty.call(values,k)?values[k]:null;},setItem:function(k,v){values[k]=v;}};}
function owner(record,options){return Object.assign({provider:PROVIDER,record:record,revision:1,observedAt:100,validUntil:1000,private:false,unconfirmed:false},options);}
function author(id,headline,options){return summary.standard(id,Object.assign({headline:headline||summary.text('Working')},options));}
function provider(storage,readCurrent,extra){return summary.defineProvider(Object.assign({pluginUuid:PROVIDER,storage:storage,now:function(){return 100000;},readCurrent:readCurrent},extra));}
function harness(){
  var subscriptions=[],sent=[],views=[],now=100000;
  var consumer=api.createActivities({nativeFormat:3,pebble:{enumeratePlugins:function(){return [{uuid:PROVIDER,name:'Example',sources:[{category:'activity',items:['summary','live','card','session'],properties:summary.SOURCE_PROPERTIES}]}];},subscribeToSource:function(request){subscriptions.push(request);return {unsubscribe:function(){}};}},
    now:function(){return now;},later:function(){return 1;},cancelLater:function(){},onView:function(v){views.push(v);},send:function(payload,ok,fail){sent.push({payload:payload,ok:ok,fail:fail});}});
  consumer.refresh(true,17);
  return {consumer:consumer,subscriptions:subscriptions,sent:sent,views:views,advance:function(ms){now+=ms;},deliver:function(envelope){subscriptions[0].onData(Object.assign({pluginUuid:PROVIDER},envelope));}};
}
test('summary namespace and bounded author helpers expose no layout instructions',function(){
  assert.equal(api.summary,summary);assert.equal(api.summaryView,view);assert.equal(summary.VERSION,4);
  assert.deepEqual(summary.countdown({seconds:0}),{type:'clock',mode:'countdown',seconds:0});
  assert.ok(summary.normalize(author('a',summary.value('5:12','/km',{label:'Pace'}))));
  assert.equal(summary.normalize(Object.assign(author('a'),{layout:'compact'})),null);
  assert.equal(summary.normalize(author('@snapshot')),null);
});
test('all agreed source examples reduce to their exact compact meaning and independent clocks',function(){
  var fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/design/notification-activities-examples.json'),'utf8'));
  fixtures.cases.forEach(function(entry){
    var normalized=summary.normalize(entry.record,fixtures.now);assert.ok(normalized,entry.case);
    assert.equal(view.compactText(entry.record,fixtures.now),entry.summaryAtNow,entry.case);
    if(entry.summaryAfterOneSecond){assert.equal(view.compactText(entry.record,fixtures.now+1),entry.summaryAfterOneSecond,entry.case);}
    var projected=summary.toView(owner(entry.record,{observedAt:fixtures.now,validUntil:fixtures.now+300}));
    assert.ok(projected,entry.case);assert.ok(view.encode([projected],{session:17,sequence:1,sentAt:fixtures.now}).length<=2672);
  });
  (fixtures.rejectedExamples||[]).forEach(function(entry){assert.equal(summary.normalize(entry.record,fixtures.now),null,entry.case);});
});
test('typed values, Unicode bounds, range and elapsed clocks reject ambiguous or invalid fields',function(){
  [summary.value(NaN),summary.value(Infinity),summary.value('abc','m',{range:{max:100}}),summary.value(2,'m',{range:{min:3,max:4}}),
    summary.countdown({deadline:150,seconds:30}),summary.elapsed({since:101}),summary.text('a\nb')].forEach(function(d){assert.equal(summary.normalize(author('x',d),100),null);});
  assert.equal(summary.normalize(author('x',summary.text('ě'.repeat(97)))),null);
  assert.ok(summary.normalize(author('x',summary.text('ě'.repeat(96)))));
  assert.equal(summary.normalize(author('x',summary.text('Fine'),{summary:'detail'})),null);
  assert.equal(summary.normalize(author('x',undefined,{result:true})),null);
  assert.equal(summary.normalize(summary.media('x',{title:'Song',state:'active'})),null);
});
test('optional app navigation is independent of at most three explicit actions and entity linking',function(){
  var r=author('a',undefined,{openApp:{watchAppUuid:PROVIDER},entityRef:{category:'home',item:'washer',instanceId:'one'},actions:[{id:'stop',label:'Stop',action:'stop',args:{run:'a'},semantic:'stop'}]});
  assert.ok(summary.normalize(r));assert.equal(summary.normalize(Object.assign({},r,{openApp:{plugin:PROVIDER}})),null);
  assert.equal(summary.normalize(Object.assign({},r,{openApp:{watchAppUuid:'00000000-0000-0000-0000-000000000000'}})),null);
  assert.equal(summary.normalize(Object.assign({},r,{actions:[{id:'one',label:'X',action:'go',args:{x:function(){}}}]})),null);
  var source=summary.toSourceInstance(owner(r),{});assert.ok(source.properties.open_app);assert.ok(source.properties.actions);
  assert.equal(JSON.parse(source.properties.content.longText.text).openApp,undefined);
  source.properties.open_app.longText.text='bad';source.properties.actions.longText.text='bad';
  var parsed=summary.sourceCard(source,PROVIDER);assert.ok(parsed);assert.equal(parsed.record.openApp,undefined);assert.equal(parsed.record.actions,undefined);assert.ok(parsed.record.entityRef);
});
test('fresh publication allocates only incarnation/sequence inside calls and stamps current observations',async function(){
  var storage=store(),time=100000,source=provider(storage,function(){return [author('secret-id',summary.text('private body'))];},{now:function(){return time;}});
  assert.deepEqual(storage.values,{});
  var first=await source.source({});assert.equal(summary.header(first).sequence,1);assert.equal(summary.header(first).mode,'fresh');
  assert.equal(first.instances[1].properties.observed_at.timestamp.value,100);assert.equal(first.validUntilMs,190000);
  time+=30000;var second=await source.source({});assert.equal(summary.header(second).sequence,2);assert.equal(second.instances[1].properties.observed_at.timestamp.value,130);
  assert.equal(second.instances[1].properties.private.boolean.value,true);
  var stored=JSON.stringify(storage.values);assert.ok(!stored.includes('secret-id'));assert.ok(!stored.includes('private body'));assert.equal(Object.keys(storage.values).length,1);
  var cold=provider(storage,function(){return [];});assert.equal(summary.header(await cold.source({})).sequence,3);
});
test('empty responses, hidden terminal results and business deadlines retain a counted sequence header',async function(){
  var storage=store(),data=[author('a',undefined,{state:'completed',result:false}),author('b',undefined,{visibleUntil:99})];
  var source=provider(storage,function(){return data;});var result=await source.source({});assert.equal(result.instances.length,1);assert.equal(summary.header(result).count,0);
  data=[author('a',undefined,{state:'completed',result:true})];assert.equal(summary.header(await source.source({})).count,1);
  data=[];assert.equal(summary.header(await source.source({})).count,0);
});
test('snapshot publication preserves native time/revision, pause cap and acknowledged removal',async function(){
  var storage=store(),now=100000,data=[{provider:PROVIDER,id:'tea',kind:'timer',state:'paused',clock:'deadline',revision:42,observedAt:90,validUntil:999,duration:25,private:false,footer:'Tea'}];
  var source=summary.defineSnapshotProvider({pluginUuid:PROVIDER,storage:storage,now:function(){return now;},readSnapshot:function(){return data;},adapt:summary.adapters.timerSnapshot});
  var first=await source.source({}),record=summary.sourceCard(first.instances[1],PROVIDER);
  assert.equal(record.revision,42);assert.equal(record.observedAt,90);assert.equal(record.validUntil,390);assert.equal(record.unconfirmed,true);
  now=110000;var second=await source.source({});assert.equal(summary.header(second).sequence,2);assert.equal(second.instances[1].properties.observed_at.timestamp.value,90);
  data=[Object.assign({},data[0],{revision:43,state:'completed',clock:'none',duration:0,showTerminal:false})];
  assert.equal(summary.header(await source.source({})).count,0);
});
test('provider read, bounds and metadata storage failures return content-free errors',async function(){
  var storage=store(),read=0,source=provider(storage,function(){read++;throw new Error('secret');});
  var response;await source.handleSource({category:'activity',item:'summary'},{data:function(){assert.fail();},error:function(code,message){response={code:code,message:message};}});
  assert.equal(response.code,'INVALID_DATA');assert.ok(!JSON.stringify(response).includes('secret'));assert.equal(read,1);
  var bad={getItem:function(){return null;},setItem:function(){}};await assert.rejects(provider(bad,function(){return [];}).source({}),/STORAGE_UNAVAILABLE/);
  assert.throws(function(){provider(storage,function(){return [];},{validitySeconds:30});},/INVALID_VALIDITY/);
  await assert.rejects(provider(store(),function(){return Array.from({length:17},function(_,i){return author(String(i));});}).source({}),/INVALID_SNAPSHOT/);
});
test('ACT3 packs explicit media, compact selection, semantic direction and range without marker labels',function(){
  var record=author('nav',summary.value(200,'m',{range:{max:1000},symbol:'turn-right'}),{detail:summary.countdown({deadline:160}),summary:'detail',icon:'navigation',name:'Home'});
  var card=summary.toView(owner(record)),bytes=view.encode([card],{session:17,sequence:2,sentAt:100});
  assert.equal(String.fromCharCode.apply(null,bytes.slice(0,4)),'ACT3');assert.equal(card.presentation,5);assert.equal(card.compactItem,1);assert.deepEqual(card.directions,[2,0]);
  assert.equal(bytes[24+88],5);assert.equal(bytes[24+90],1);assert.equal(bytes[24+91],2);
  assert.ok(!card.main.label);assert.equal(card.main.text,'200 m');assert.equal(card.support.running,true);
});
test('media item tokens change only with item identity or title fallback, never late artwork/artist',function(){
  var base=summary.media('player',{title:'Song',artist:'A',itemId:'item-1'}),a=summary.toView(owner(base)),b=summary.toView(owner(Object.assign({},base,{artist:'B'})));
  assert.deepEqual(a.visualToken,b.visualToken);
  assert.notDeepEqual(a.visualToken,summary.toView(owner(Object.assign({},base,{itemId:'item-2'}))).visualToken);
  var absent=summary.toView(owner(summary.media('radio',{title:'Live'})));assert.equal(absent.caption,'');assert.equal(absent.support,null);assert.equal(absent.identitySymbol,3);
});
test('both maximum ACT3 cards fit2672 bytes and fit never clips essential scalar units',function(){
  var image={width:40,height:40,palette:[255],pixels:Array(800).fill(0)},cards=[];
  for(var i=0;i<2;i++){cards.push({provider:PROVIDER,id:String(i).repeat(64),kind:'activity',state:'active',revision:1,observedAt:100,validUntil:1000,main:{type:'text',label:'',text:'A'.repeat(192)},caption:'',qualifier:'B'.repeat(109),image:image});}
  assert.equal(view.encode(cards,{session:17,sequence:1,sentAt:100}).length,2672);
  var values=author('v',summary.value('X'.repeat(64),'long unit'),{detail:summary.value('Y'.repeat(64),'other unit'),summary:'detail',name:'N'.repeat(64)});
  var card=summary.toView(owner(values));assert.equal(card.main.text,'X'.repeat(64)+' long unit');assert.equal(card.support.text,'Y'.repeat(64)+' other unit');
});
test('consumer prefers summary, freezes navigation mapping and rejects older nonempty after newer empty',async function(){
  var h=harness(),data=[author('a',undefined,{openApp:{watchAppUuid:PROVIDER}})],source=provider(store(),function(){return data;});
  assert.equal(h.subscriptions[0].item,'summary');h.deliver(await source.source({}));assert.equal(h.consumer.catalogue().length,1);assert.equal(h.views.at(-1).cards[0].openApp.watchAppUuid,PROVIDER);
  var first=await source.source({});data=[];h.deliver(await source.source({}));assert.equal(h.consumer.catalogue().length,0);h.deliver(first);assert.equal(h.consumer.catalogue().length,0);
});
test('consumer capability changes preserve imported owner revisions and malformed extensions drop only navigation',async function(){
  var h=harness(),data=owner(author('a',undefined,{openApp:{watchAppUuid:PROVIDER}})),source=summary.defineSnapshotProvider({pluginUuid:PROVIDER,storage:store(),now:function(){return 100000;},readSnapshot:function(){return [data];}});
  h.deliver(await source.source({}));var before=h.views.length;
  data=owner(author('a',undefined,{openApp:{watchAppUuid:'11111111-1111-4111-8111-111111111111'}}));h.deliver(await source.source({}));assert.equal(h.consumer.catalogue()[0].revision,1);assert.ok(h.views.length>before);
  var next=await source.source({});next.instances[1].properties.open_app.longText.text='bad';h.deliver(next);assert.equal(h.consumer.catalogue().length,1);assert.equal(h.consumer.catalogue()[0].openApp,undefined);
});
test('incarnation reset clears native source floors before accepting reset managed revisions',async function(){
  var h=harness(),storage=store(),data=[author('a')],source=provider(storage,function(){return data;});
  h.deliver(await source.source({}));h.sent.at(-1).ok();
  h.deliver(await source.source({}));h.sent.at(-1).ok();
  storage.values={};storage.getItem=function(k){return Object.prototype.hasOwnProperty.call(this.values,k)?this.values[k]:null;};storage.setItem=function(k,v){this.values[k]=v;};
  var oldCallback=h.subscriptions[0].onData;
  var oldEnvelope=await source.source({});
  storage.values={};
  var fresh=provider(storage,function(){return [author('a',summary.text('New generation'))];});h.deliver(await fresh.source({}));assert.equal(h.consumer.catalogue().length,0);assert.equal(h.views.at(-1).cards.length,0);
  h.sent.at(-1).ok();assert.equal(h.subscriptions.length,2);
  h.subscriptions[1].onData(Object.assign({pluginUuid:PROVIDER},await fresh.source({})));
  assert.equal(h.consumer.catalogue()[0].main.text,'New generation');
  oldCallback(Object.assign({pluginUuid:PROVIDER},oldEnvelope));assert.equal(h.consumer.catalogue()[0].main.text,'New generation');
});
test('malformed count, duplicate identities and private permission loss clear old summaries',async function(){
  var h=harness(),source=provider(store(),function(){return [author('a')];});h.deliver(await source.source({}));
  var broken=await source.source({});broken.instances[0].properties.activity_count.numericValue.value=0;h.deliver(broken);assert.equal(h.consumer.catalogue().length,0);
  h.deliver(await source.source({}));h.subscriptions[0].onError({code:'PERMISSION_DENIED'});assert.equal(h.consumer.catalogue().length,0);
});

test('compiled compact qualifier omits exact duplicate name or selected label',function(){
  var record=author('a',summary.countdown({seconds:45,label:'Tea'}),{name:'Tea'}),card=summary.toView(owner(record));
  assert.equal(card.qualifier,'');assert.equal(card.main.label,'Tea');
  var media=summary.toView(owner(summary.media('m',{title:'Same',artist:'Same'})));assert.equal(media.qualifier,'');
});
test('source identity must match descriptor identity and malformed core bitmap metadata fails',function(){
  var instance=summary.toSourceInstance(owner(author('a')),{});instance.instanceId='other';assert.equal(summary.sourceCard(instance,PROVIDER),null);
  instance.instanceId='a';instance.properties.artwork={};assert.equal(summary.sourceCard(instance,PROVIDER),null);
});

test('extreme media text fits without ellipsis-only footer and preserves an artist prefix',function(){
  var card=summary.toView(owner(summary.media('p',{title:'A'.repeat(192),artist:'B'.repeat(192)})));
  assert.ok(card);assert.ok(card.main.text.startsWith('AAAA'));assert.ok(card.support.text.startsWith('BBBB'));
  assert.notEqual(card.caption,'…');assert.notEqual(card.qualifier,'…');
  assert.ok(view.poolFor(card).bytes.length<=304);
});
test('expired records still undergo strict content validation before filtering',async function(){
  var source=provider(store(),function(){return [Object.assign(author('bad'),{visibleUntil:99,unknown:'invalid'})];});
  await assert.rejects(source.source({}),/INVALID_SNAPSHOT/);
});

test('encoder rejects semantic metadata that native would reject',function(){
  var base=summary.toView(owner(author('a')));
  assert.equal(view.normalize(Object.assign({},base,{directions:[1,0]})),null);
  assert.equal(view.normalize(Object.assign({},base,{visualToken:[1,0,0,0,0,0,0,0]})),null);
  assert.equal(view.normalize(Object.assign({},base,{presentation:view.PRESENTATIONS.clock})),null);
});
