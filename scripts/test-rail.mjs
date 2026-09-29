import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getRailTrace,tracePosition,segmentLength,railwayGeoJson} from '../app/lib/rail-routes.ts';
import {normaliseTrainRows,validateStations} from '../app/lib/train-data.ts';
import * as XLSX from 'xlsx';

const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const catalog=read('../app/data/rail-routes.json');
const stations=validateStations(read('../app/data/stations.json'));

test('19 条线路均包含连续的真实铁路轨迹及来源',()=>{
  assert.equal(catalog.routes.length,19);
  assert.equal(new Set(catalog.routes.map(r=>r.id)).size,19);
  for(const r of catalog.routes){
    assert.ok(r.coordinates.length>100,r.id);
    assert.ok(r.wayTags.length&&r.wayTags.every(t=>t.includes('railway=rail')),r.id);
    assert.equal(new URL(r.sourceUrl).searchParams.get('profile'),'rail');
    assert.ok(r.timetableSources.length,r.id);
    let km=0;
    r.coordinates.forEach((p,i)=>{
      assert.ok(p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);
      if(i){const d=segmentLength(r.coordinates[i-1],p);assert.ok(d<8,`${r.id}: unexpected ${d} km gap`);km+=d;}
    });
    assert.ok(Math.abs(km-r.distanceKm)/r.distanceKm<.005,`${r.id}: distance mismatch`);
    const from=stations[r.origin],to=stations[r.destination];
    assert.ok(segmentLength(r.coordinates[0],[from.longitude,from.latitude])<1.5,r.id+' origin');
    assert.ok(segmentLength(r.coordinates.at(-1),[to.longitude,to.latitude])<1.5,r.id+' destination');
  }
});

test('返程反向沿铁路运行，播放进度位于真实轨道分段上',()=>{
  for(const r of catalog.routes){
    const forward=getRailTrace({origin:r.origin,destination:r.destination,trainNumber:r.trains[0]});
    const reverse=getRailTrace({origin:r.destination,destination:r.origin,trainNumber:r.trains[0]});
    assert.deepEqual(reverse.coordinates,[...forward.coordinates].reverse());
    assert.deepEqual(tracePosition(forward,0).coordinate,forward.coordinates[0]);
    assert.deepEqual(tracePosition(forward,1).coordinate,forward.coordinates.at(-1));
    for(const progress of [.01,.25,.5,.73,.99]){
      const pos=tracePosition(forward,progress),back=tracePosition(reverse,1-progress);
      assert.ok(segmentLength(pos.coordinate,back.coordinate)<.000001);
      assert.deepEqual(pos.coordinates.slice(0,-1),forward.coordinates.slice(0,pos.segmentIndex));
      const i=pos.segmentIndex,a=forward.coordinates[i-1],b=forward.coordinates[i];
      const cross=(pos.coordinate[0]-a[0])*(b[1]-a[1])-(pos.coordinate[1]-a[1])*(b[0]-a[0]);
      assert.ok(Math.abs(cross)<1e-10);
    }
  }
});

test('未知线路不绘制虚构曲线，车次不匹配时明确标记',()=>{
  assert.equal(getRailTrace({origin:'上海',destination:'火星站',trainNumber:'G1'}),null);
  assert.equal(getRailTrace({origin:'上海',destination:'镇江',trainNumber:'X999'}).trainMatched,false);
  assert.equal(railwayGeoJson([{origin:'上海',destination:'火星站',trainNumber:'G1'}]).features.length,0);
});

test('青岛与千岛湖方向保留各自的实际铁路走向',()=>{
  const qingdao=catalog.routes.find(r=>r.id==='shanghai-qingdao');
  for(const name of ['丹徒','扬州东','淮安东','连云港'])assert.ok(qingdao.via.includes(name));
  assert.ok(!qingdao.via.includes('南通'));
  for(const r of catalog.routes.filter(r=>r.id.includes('qiandaohu'))){
    for(const name of ['上海松江','苏州南','湖州东','杭州西'])assert.ok(r.via.includes(name));
    assert.ok(!r.via.includes('杭州东'));
  }
});

test('虚构工作簿导入覆盖全部线路，保留座位并合并重复轨迹',()=>{
  const fixtures=catalog.routes.map((route,index)=>({
    日期:20260601+index,车次:route.trains[0],上车站:route.origin,下车站:route.destination,
    上车时间:900,下车时间:1025,座位:index===1?'无座':'0101A',
  }));
  fixtures.push({...fixtures[0],日期:20260620,上车站:fixtures[0].下车站,下车站:fixtures[0].上车站});
  const source=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source,XLSX.utils.json_to_sheet(fixtures),'虚构测试行程');
  const wb=XLSX.read(XLSX.write(source,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellDates:false});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null,raw:true});
  const result=normaliseTrainRows(rows,stations);
  assert.equal(result.accepted,fixtures.length);assert.equal(result.rejected,0);assert.deepEqual(result.warnings,[]);
  assert.equal(result.dataset.journeys.reduce((n,j)=>n+j.durationMinutes,0),fixtures.length*85);
  assert.equal(result.dataset.journeys[0].seat,'0101A');assert.equal(result.dataset.journeys[1].seat,'无座');
  assert.equal(result.dataset.journeys.at(-1).departureTime,'09:00');
  for(const j of result.dataset.journeys){const t=getRailTrace(j);assert.ok(t&&t.trainMatched,j.trainNumber);assert.equal(j.distanceKm,Math.round(t.route.distanceKm));}
  const geo=railwayGeoJson(result.dataset.journeys);assert.equal(geo.features.length,19);assert.equal(geo.license,'ODbL-1.0');
});
