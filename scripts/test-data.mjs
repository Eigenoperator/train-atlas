import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseDate,parseTime,normaliseTrainRows,validateStations} from '../app/lib/train-data.ts';
const stations=JSON.parse(fs.readFileSync(new URL('../app/data/stations.json',import.meta.url),'utf8'));
// 以下日期、时刻和座位均为虚构测试数据。
const row={日期:20260520,车次:'G101',上车站:'上海虹桥',上车时间:900,下车站:'北京南',下车时间:1400,始发站:'上海虹桥',终到站:'北京南',座位:'0101A'};
test('解析日历日期和电子表格日期序号，拒绝无效日期',()=>{
  assert.equal(parseDate(20260520),'2026-05-20');assert.equal(parseDate('2026-05-20'),'2026-05-20');
  assert.equal(parseDate(45292),'2024-01-01');assert.equal(parseDate('20250230'),null);assert.equal(parseDate('20240229'),'2024-02-29');assert.equal(parseDate(20261301),null);
});
test('区分时分数字、补零字符串和电子表格时间小数',()=>{
  assert.equal(parseTime(1700),'17:00');assert.equal(parseTime('0648'),'06:48');assert.equal(parseTime(0.5),'12:00');assert.equal(parseTime(0),'00:00');assert.equal(parseTime('24:00'),null);assert.equal(parseTime(1360),null);
});
test('中文表头保留座位，区分乘车区间与列车始终站',()=>{
  const r=normaliseTrainRows([{...row,下车站:'苏州北',下车时间:923}],stations);assert.equal(r.accepted,1);assert.equal(r.rejected,0);
  const j=r.dataset.journeys[0];assert.equal(j.destination,'苏州北');assert.equal(j.serviceDestination,'北京南');assert.equal(j.seat,'0101A');assert.equal(j.durationMinutes,23);assert.equal(j.serviceType,'G');assert.deepEqual(Object.keys(r.dataset.stations).sort(),['上海虹桥','苏州北'].sort());
});
test('计算过夜及指定跨天数的行程时长',()=>{
  const r=normaliseTrainRows([{...row,上车时间:'23:45',下车时间:'00:15'},{...row,上车时间:'23:45',下车时间:'00:15',跨天数:2}],stations);
  assert.deepEqual(r.dataset.journeys.map(j=>j.durationMinutes),[30,1470]);assert.equal(r.dataset.journeys[0].arrivalDayOffset,1);
  assert.equal(normaliseTrainRows([{...row,上车时间:'23:45',下车时间:'00:15',跨天数:0}],stations).dataset.journeys[0].durationMinutes,null);
});
test('保留未知车站与缺失时间，不虚构里程和时长',()=>{
  const r=normaliseTrainRows([{...row,上车站:'示例新站',上车时间:''}],stations);assert.equal(r.accepted,1);assert.equal(r.dataset.journeys[0].distanceKm,null);assert.equal(r.dataset.journeys[0].durationMinutes,null);assert.match(r.warnings[0],/未知车站/);
});
test('拒绝格式错误的记录并校验车站坐标',()=>{
  assert.equal(normaliseTrainRows([null,[],{...row,日期:20250230},row],stations).rejected,3);
  assert.deepEqual(validateStations({bad:{name:'Bad',city:'X',latitude:200,longitude:0}}),{});
});
test('整理后的 JSON 再次导入时保留全部字段及车站信息',()=>{
  const first=normaliseTrainRows([row,{...row,日期:20260521,上车时间:'23:30',下车时间:'01:00',跨天数:2}],stations);
  const json=JSON.parse(JSON.stringify(first.dataset));const again=normaliseTrainRows(json.journeys,json.stations);
  assert.deepEqual(again.dataset,first.dataset);
});
test('公开示例可以独立导入，且包含每段行程的上下车站',()=>{
  const demo=JSON.parse(fs.readFileSync(new URL('../app/data/demo-train-data.json',import.meta.url),'utf8'));assert.equal(demo.journeys.length,6);
  const result=normaliseTrainRows(demo.journeys,demo.stations);
  assert.equal(result.accepted,6);assert.equal(result.rejected,0);assert.deepEqual(result.warnings,[]);
  for(const [index,journey] of result.dataset.journeys.entries()){
    assert.ok(result.dataset.stations[journey.origin]);assert.ok(result.dataset.stations[journey.destination]);
    assert.equal(journey.seat,demo.journeys[index].seat);assert.equal(journey.date,demo.journeys[index].date);
  }
});
