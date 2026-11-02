'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const selection=require('../src/js').selection;
const A='50e9ef12-a5ab-4369-a3b5-3447bfba5151',B='c9e7cb18-eaf7-4b30-9b09-9a8fae187801';
const timer=(id,seconds,running=true)=>({provider:A,id,state:'active',main:{type:'clock',mode:'deadline',running,baseSeconds:seconds,anchorAt:running?100:0}});
test('provider preferences contain only stable validated keys and no source content',()=>{
  assert.deepEqual(selection.normalizePreferences({order:[A,'track title',A,'builtin:music',null],hidden:[B,'bad']}),{order:[A,'builtin:music'],hidden:[B]});
});
test('pure selection supports Music in either role and hiding any provider',()=>{
  const t=timer('timer',100),music={provider:B,selectionKey:'builtin:music',id:'track',state:'active'},health={provider:B,id:'health',state:'active'};
  const cards=[t,music,health],before=JSON.stringify(cards);
  assert.deepEqual(selection.select(cards,{order:['builtin:music',A]}),[music,t]);
  assert.deepEqual(selection.select(cards,{hidden:[A,'builtin:music']}),[health]);
  assert.equal(JSON.stringify(cards),before);
});
test('nearest active countdowns reorder only their provider positions even when interleaved',()=>{
  const later=timer('later',90),soon=timer('soon',10),paused=timer('paused',1,false),health={provider:B,id:'health',state:'active'};
  assert.deepEqual(selection.select([later,health,soon,paused]),[soon,health]);
  assert.deepEqual(selection.select([paused,health,later],{order:[A]}),[later,paused]);
});
test('opted-in terminal results yield to ongoing providers even when explicitly first',()=>{
  const done=Object.assign(timer('done',0,false),{state:'completed'}),active={provider:B,id:'active',state:'active'};
  assert.deepEqual(selection.select([done,active],{order:[A]}),[active,done]);
});
