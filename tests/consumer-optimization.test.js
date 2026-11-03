'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const child=require('node:child_process');
const path=require('node:path');
const api=require('../src/js');
const P='01234567-89ab-cdef-0123-456789abcdef',NOW=1700000000;

function fixture(extra={}){
  let request;
  const packets=[];
  const consumer=api.createActivities(Object.assign({nativeFormat:2,
    pebble:{enumeratePlugins:()=>[{uuid:P,name:'Original app',sources:[{category:'activity',items:['card'],properties:api.view.SOURCE_PROPERTIES}]}],
      subscribeToSource:value=>{request=value;return {unsubscribe(){}};}},
    now:()=>NOW*1000,later:()=>1,cancelLater(){},send(payload,ok){packets.push(payload);ok();}
  },extra));
  consumer.refresh(true,42);
  const card={provider:P,id:'one',kind:'workout',state:'active',revision:1,observedAt:NOW,validUntil:NOW+600,
    private:false,caption:'Original caption',main:{type:'value',label:'Charge',value:72,unit:'%'},
    image:{width:2,height:1,palette:[192,255],pixels:[1]}};
  const instance=api.view.toSourceInstance(card,{iconPixelSize:{w:40,h:40}});
  request.onData({pluginUuid:P,validUntilMs:(NOW+60)*1000,instances:[instance]});
  return {consumer,card,packets};
}

test('host entry retains the read-only APIs without loading the publisher bridge',()=>{
  const script="const host=require('./host'); const full=require.resolve('./src/js/publisher');"+
    "if(require.cache[full])throw new Error('publisher loaded');"+
    "for(const name of ['createActivities','createContext'])if(typeof host[name]!=='function')throw new Error(name);"+
    "if(!host.summary||!host.summaryView||!host.selection)throw new Error('missing host API');";
  child.execFileSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..')});
  assert.equal(typeof api.createPublisher,'function');
});

test('accept callbacks cannot mutate saved cards, pixels or source revision checks',()=>{
  const f=fixture({acceptActivity(card){card.id='changed';card.revision=900;card.main.text='Wrong';card.image.pixels[0]=255;return true;}});
  const card=f.consumer.catalogue()[0];
  assert.equal(card.id,'one');assert.equal(card.revision,1);assert.equal(card.main.text,'72%');
  assert.equal(card.image.pixels[0],1);assert.equal(f.consumer.status().count,1);
  f.consumer.reproject();
  assert.equal(f.consumer.catalogue()[0].main.text,'72%');
});

test('select callbacks may change their projection without changing the source catalogue',()=>{
  const f=fixture({select(cards){cards.forEach(card=>{card.caption='Display caption';card.image.pixels[0]=0;});return cards;}});
  assert.equal(f.consumer.view().cards[0].caption,'Display caption');
  assert.equal(f.consumer.view().cards[0].image.pixels[0],0);
  assert.equal(f.consumer.catalogue()[0].caption,'Original caption');
  assert.equal(f.consumer.catalogue()[0].image.pixels[0],1);
});

test('view callback and all public snapshots own their nested data',()=>{
  const f=fixture({onView(snapshot){if(snapshot.cards.length){snapshot.cards[0].main.text='Wrong';snapshot.cards[0].image.pixels[0]=255;}}});
  const view=f.consumer.view(),catalogue=f.consumer.catalogue(),providers=f.consumer.providers();
  view.cards[0].image.pixels[0]=255;view.cards[0].main.text='Wrong again';
  catalogue[0].main.text='Wrong source';catalogue[0].image.palette[0]=0;providers[0].name='Wrong app';
  assert.equal(f.consumer.view().cards[0].main.text,'72%');
  assert.equal(f.consumer.view().cards[0].image.pixels[0],1);
  assert.equal(f.consumer.catalogue()[0].main.text,'72%');
  assert.equal(f.consumer.catalogue()[0].image.palette[0],192);
  assert.equal(f.consumer.providers()[0].name,'Original app');
});

test('a rejected or throwing acceptance callback cannot leak a mutated card',()=>{
  for(const callback of [card=>{card.private=false;return false;},card=>{card.private=false;throw Error('Rejected');}]){
    const f=fixture({acceptActivity:callback});
    assert.equal(f.consumer.catalogue().length,0);assert.equal(f.consumer.status().count,0);
    assert.equal(f.consumer.view().cards.length,0);
  }
});
