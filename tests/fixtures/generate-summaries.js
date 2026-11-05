'use strict';
var fs=require('node:fs'),path=require('node:path'),summary=require('../../summary'),view=require('../../summary-view');
var provider='01234567-89ab-cdef-0123-456789abcdef';
function source(record,extra){return Object.assign({provider:provider,record:record,revision:1,observedAt:100,validUntil:1000,private:false,unconfirmed:false},extra);}
var cases={
  'summary-clock':[summary.toView(source(summary.standard('timer',{icon:'timer',name:'Tea',state:'paused',headline:summary.countdown({deadline:160}),detail:summary.elapsed({since:90,seconds:30}),summary:'detail'})))],
  'summary-media':[summary.toView(source(summary.media('player',{title:'A song',artist:'Artist',itemId:'track-1',artwork:{width:2,height:2,palette:[255,192],pixels:[16,1]}})))],
  'summary-paused-media':[summary.toView(source(summary.media('player',{title:'A song',artist:'Artist',itemId:'track-1',playback:'paused'})))],
  'summary-long-media':[summary.toView(source(summary.media('long',{title:'A'.repeat(192),artist:'B'.repeat(192)})))],
  'summary-direction':[summary.toView(source(summary.standard('route',{icon:'navigation',headline:summary.value(200,'m',{range:{max:1000},symbol:'turn-right'}),detail:summary.value(80,'m',{symbol:'turn-left'}),summary:'detail',name:'Home'})))]
};
var image={width:40,height:40,palette:[255],pixels:Array(800).fill(0)};
cases['summary-max']=[0,1].map(function(i){return {provider:provider,id:String(i).repeat(64),kind:'activity',state:'active',revision:1,observedAt:100,validUntil:1000,main:{type:'text',label:'',text:'A'.repeat(192)},caption:'',qualifier:'B'.repeat(109),image:image};});
Object.keys(cases).forEach(function(name){fs.writeFileSync(path.join(__dirname,name+'.bin'),Buffer.from(view.encode(cases[name],{session:17,sequence:1,sentAt:100})));});
