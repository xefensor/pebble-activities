'use strict';
var fs=require('node:fs');
var path=require('node:path');
var view=require('../../src/js/view');
var source=JSON.parse(fs.readFileSync(path.join(__dirname,'view-source.json'),'utf8'));
Object.keys(source.cases).forEach(function(name){
  fs.writeFileSync(path.join(__dirname,name+'.bin'),Buffer.from(view.encode(source.cases[name],source)));
});
