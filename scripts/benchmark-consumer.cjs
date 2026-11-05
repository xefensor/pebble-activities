#!/usr/bin/env node
'use strict';

// Deterministic JSON-work counters, not watch/phone CPU or battery timings.
// Compare a committed baseline and the checkout without changing either tree:
// node scripts/benchmark-consumer.cjs BASELINE_REVISION
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),child=require('node:child_process');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),baseline=process.argv[2];
const N=1700000000;
function run(revision,customSelection){
  const totals={parseCalls:0,parseChars:0,stringifyCalls:0,stringifyChars:0,timerSchedules:0,timerCancellations:0,subscriptions:0};
  const json={parse(text){totals.parseCalls++;totals.parseChars+=text.length;return JSON.parse(text);},
    stringify(value,replacer,space){const text=JSON.stringify(value,replacer,space);totals.stringifyCalls++;totals.stringifyChars+=text?text.length:0;return text;}};
  const context=vm.createContext({JSON:json,setTimeout,clearTimeout,Promise}),cache=new Map();
  function load(relative){
    const file=path.resolve(root,relative),name=path.relative(root,file);
    if(cache.has(name))return cache.get(name).exports;
    const source=revision?child.execFileSync('git',['show',revision+':'+name],{cwd:root,encoding:'utf8'}):fs.readFileSync(file,'utf8');
    const module={exports:{}};cache.set(name,module);
    vm.runInContext('(function(module,exports,require){'+source+'\n})',context,{filename:name})(module,module.exports,request=>{
      if(!request.startsWith('.'))throw Error('Unexpected external import: '+request);
      let target=path.resolve(path.dirname(file),request);
      if(!path.extname(target))target+=(request==='./src/js'?'/index.js':'.js');
      return load(path.relative(root,target));
    });
    return module.exports;
  }
  const create=load('src/js/consumer.js'),view=load('src/js/view.js');
  const P='01234567-89ab-cdef-0123-456789abcdef';
  let now=N*1000,request,next=0;const timers=new Map(),frames=crypto.createHash('sha256');
  const options={nativeFormat:2,pebble:{enumeratePlugins:()=>[{uuid:P,name:'Example',sources:[{category:'activity',items:['card'],properties:view.SOURCE_PROPERTIES}]}],
    subscribeToSource:value=>{totals.subscriptions++;request=value;return {unsubscribe(){}};}},now:()=>now,
    later:(fn,ms)=>{totals.timerSchedules++;const id=++next;timers.set(id,{fn,at:now+ms});return id;},cancelLater:id=>{totals.timerCancellations++;timers.delete(id);},
    onView(){},send(payload,ok){if(payload.ACTIVITY_DATA){frames.update(Buffer.from(payload.ACTIVITY_DATA));}ok();}};
  if(customSelection)options.select=cards=>cards.slice(0,2);
  const consumer=create(options);consumer.refresh(true,42);
  const instances=Array.from({length:16},(_,i)=>view.toSourceInstance({provider:P,id:'run:'+i,kind:'timer',revision:1,state:'active',
    observedAt:N,validUntil:N+600,private:false,caption:'Timer '+i,
    main:{type:'clock',label:'Left',mode:'deadline',running:true,anchorAt:N,baseSeconds:600+i,retain:true},
    image:{width:40,height:40,palette:[192,255],pixels:Array(800).fill(1)}},{iconPixelSize:{w:40,h:40}}));
  request.onData({pluginUuid:P,validUntilMs:(N+30)*1000,instances});
  const results={};
  function measure(name,fn){for(const key of Object.keys(totals))totals[key]=0;fn();results[name]=Object.assign({},totals);}
  measure('100 status reads',()=>{for(let i=0;i<100;i++)consumer.status();});
  measure('20 catalogue reads',()=>{for(let i=0;i<20;i++)consumer.catalogue();});
  measure('20 forced projections',()=>{for(let i=0;i<20;i++)consumer.reproject();});
  measure('20 duplicate source deliveries',()=>{for(let i=0;i<20;i++)request.onData({pluginUuid:P,validUntilMs:(N+30)*1000,instances});});
  measure('20 unchanged settings updates',()=>{for(let i=0;i<20;i++)consumer.configure();});
  measure('source availability expiry',()=>{now=(N+30)*1000;const due=[...timers].filter(([,v])=>v.at<=now);for(const [id,timer]of due){timers.delete(id);timer.fn();}});
  consumer.stop();return {work:results,frameSha256:frames.digest('hex')};
}
const report={description:'JSON calls/UTF-16 character counts and timer/subscription calls for sixteen 40px cards; counters exclude setup. No persistent data or phone timing.',
  baseline:baseline||null,defaultSelection:{before:baseline?run(baseline,false):null,after:run(null,false)},
  customSelection:{before:baseline?run(baseline,true):null,after:run(null,true)}};
if(baseline){for(const policy of ['defaultSelection','customSelection']){
  assert.equal(report[policy].after.frameSha256,report[policy].before.frameSha256,policy+' must emit byte-identical frames');
}}
process.stdout.write(JSON.stringify(report,null,2)+'\n');
