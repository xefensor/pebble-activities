'use strict';
var fs=require('node:fs'),path=require('node:path'),wire=require('../../src/js/wire');
var provider='c9e7cb18-eaf7-4b30-9b09-9a8fae187801';
var base={provider:provider,id:'timer:7',kind:'timer',state:'active',clock:'deadline',revision:7,observedAt:1700000000,validUntil:1700000630,deadline:1700000600,duration:0,clockAt:0,main:'',footer:'Pasta',private:false};
var paused=Object.assign({},base,{state:'paused',revision:8,observedAt:1700000120,validUntil:1700086520,deadline:0,duration:480});
var value={provider:'c9e7cb18-eaf7-4b30-9b09-9a8fae187802',id:'reading:1',kind:'glucose',state:'active',clock:'none',revision:1,observedAt:1700000000,validUntil:1700000300,main:'6.2 mmol/L',footer:'Glucose',value:6.2,unit:'mmol/L',private:true,image:{width:3,height:1,palette:[192,255],pixels:[1,16]}};
var cases={'timer-active':[base],'timer-paused':[paused],mixed:[base,value],empty:[]};
Object.keys(cases).forEach(function(name){fs.writeFileSync(path.join(__dirname,name+'.bin'),Buffer.from(wire.encode(cases[name],{session:42,revision:1,sentAt:1700000001})));});
fs.writeFileSync(path.join(__dirname,'source.json'),JSON.stringify({version:1,session:42,revision:1,sentAt:1700000001,cases:cases},null,2)+'\n');
