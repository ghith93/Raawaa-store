import {simulate} from './engine.mjs';
// Fixed candidate rules, not selected or optimized against either window.
export function compareWindows(rows) {
  if (rows.length < 120) throw new Error('للمقارنة نحتاج 120 ساعة متصلة على الأقل.');
  const split = Math.floor(rows.length * 0.6);
  const definitions = [
    {name:'تمويل > 0.01%',options:{entry:0.0001,exit:0.00005}},
    {name:'تمويل > 0.02%',options:{entry:0.0002,exit:0.00005}},
    {name:'تمويل > 0.01% + اتجاه هابط',options:{entry:0.0001,exit:0.00005,trendFilter:true,cooldownHours:4}}
  ];
  const run = (data,options) => simulate(data,options);
  const results = definitions.map(d=>({name:d.name,first:run(rows.slice(0,split),d.options),second:run(rows.slice(split),d.options),stress:run(rows.slice(split),{...d.options,fee:0.0009,slippage:0.001})}));
  return {split, definitions, results, firstStart:rows[0].time, firstEnd:rows[split-1].time, secondStart:rows[split].time, secondEnd:rows.at(-1).time};
}
