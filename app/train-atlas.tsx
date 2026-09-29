'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { geoDistance, geoGraticule10, geoMercator, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';
import demo from './data/demo-train-data.json';
import directory from './data/stations.json';
import { formatDuration, normaliseTrainRows, serviceNames, validateStations } from './lib/train-data';
import type { Journey, TrainDataset } from './lib/train-data';
import { getRailTrace, railwayGeoJson, tracePosition } from './lib/rail-routes';

const demoDataset=normaliseTrainRows(demo.journeys,validateStations(demo.stations)).dataset;
const land=feature(land50 as never,(land50 as unknown as {objects:{land:never}}).objects.land);
type Coordinate=[number,number];
const number=(n:number)=>new Intl.NumberFormat('zh-CN').format(n);
function countBy<T>(items:T[],key:(item:T)=>string){const counts=new Map<string,number>();items.forEach(i=>counts.set(key(i),(counts.get(key(i))??0)+1));return [...counts].sort((a,b)=>b[1]-a[1]);}
function download(text:string,name:string,type:string){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function seatLabel(j:Journey){return j.seat==='无座'?'无座':j.seat?.match(/[ABCDF]$/i)?.[0].toUpperCase()??(j.seat?'其他':'未记录');}

export default function TrainAtlas(){
  const [dataset,setDataset]=useState<TrainDataset>(demoDataset);
  const [localDataset,setLocalDataset]=useState<TrainDataset|null>(null);
  const [source,setSource]=useState('示例行程');
  const [message,setMessage]=useState('导入乘车记录，查看你的铁路足迹。');
  const [warnings,setWarnings]=useState<string[]>([]);
  const [importing,setImporting]=useState(false);
  const [year,setYear]=useState('all');const [service,setService]=useState('all');const [station,setStation]=useState('all');
  const [query,setQuery]=useState('');const [showAll,setShowAll]=useState(false);
  const [index,setIndex]=useState(0);const [progress,setProgress]=useState(0);const [playing,setPlaying]=useState(true);
  const [speed,setSpeed]=useState(1);const [history,setHistory]=useState(true);const [follow,setFollow]=useState(true);
  const [view,setView]=useState<'region'|'globe'>('region');const [zoom,setZoom]=useState(1);
  const [compactMap,setCompactMap]=useState(false);
  const [rotation,setRotation]=useState<[number,number,number]>([-118,-32,0]);
  const [pan,setPan]=useState<Coordinate>([0,0]);
  const progressRef=useRef(0);const importStarted=useRef(false);
  const drag=useRef<{x:number;y:number;rotation:[number,number,number];pan:Coordinate;factor:number}|null>(null);
  const {journeys,stations}=dataset;

  useEffect(()=>{const media=window.matchMedia('(max-width: 640px)');const update=()=>setCompactMap(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);

  useEffect(()=>{
    const controller=new AbortController();
    fetch(new URL('data/local-train-data.json',document.baseURI),{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('未找到本地行程');return r.json() as Promise<{journeys?:unknown;stations?:unknown}>;}).then(raw=>{
      if(!Array.isArray(raw.journeys))return;
      const result=normaliseTrainRows(raw.journeys,{...validateStations(directory),...validateStations(raw.stations)});
      if(result.accepted&&!importStarted.current){setDataset(result.dataset);setLocalDataset(result.dataset);setSource('train.xlsx · 本地行程');setMessage(`已加载本地行程，共 ${result.accepted} 段。`);setWarnings(result.warnings);setIndex(0);progressRef.current=0;setProgress(0);}
    }).catch(()=>undefined);return ()=>controller.abort();
  },[]);
  const years=useMemo(()=>[...new Set(journeys.map(j=>j.year))].sort(),[journeys]);
  const services=useMemo(()=>[...new Set(journeys.map(j=>j.serviceType))].sort(),[journeys]);
  const allStations=useMemo(()=>[...new Set(journeys.flatMap(j=>[j.origin,j.destination]))].sort(),[journeys]);
  const filtered=useMemo(()=>journeys.filter(j=>(year==='all'||j.year===Number(year))&&(service==='all'||j.serviceType===service)&&(station==='all'||j.origin===station||j.destination===station)),[journeys,year,service,station]);
  const active=filtered[index];
  const activeOrigin=active?stations[active.origin]:undefined;const activeDestination=active?stations[active.destination]:undefined;
  const traces=useMemo(()=>new Map(journeys.map(j=>[j.id,getRailTrace(j)])),[journeys]);
  const activeTrace=active?traces.get(active.id):null;

  useEffect(()=>{
    if(!playing||!active)return;
    let frame=0;let previous=performance.now();let arrived=0;
    const animate=(now:number)=>{
      const elapsed=Math.min(now-previous,100);previous=now;
      progressRef.current=Math.min(1,progressRef.current+elapsed/(3200/speed));setProgress(progressRef.current);
      if(progressRef.current>=1){arrived+=elapsed;if(arrived>=500){progressRef.current=0;setProgress(0);setIndex(i=>(i+1)%filtered.length);if(filtered.length>1)return;arrived=0;}}
      frame=requestAnimationFrame(animate);
    };frame=requestAnimationFrame(animate);return ()=>cancelAnimationFrame(frame);
  },[playing,active,speed,filtered.length]);

  const geometries=useMemo(()=>new Map(journeys.map(j=>{
    const trace=traces.get(j.id);
    return [j.id,trace?{type:'LineString' as const,coordinates:trace.coordinates}:null] as const;
  })),[journeys,traces]);
  const mapped=filtered.filter(j=>geometries.get(j.id));
  const centre=useMemo(()=>follow&&activeTrace?tracePosition(activeTrace,.5).coordinate:null,[follow,activeTrace]);
  const globeRotation:[number,number,number]=centre?[-centre[0],-centre[1],0]:rotation;
  const projection=useMemo(()=>{
    if(view==='globe')return geoOrthographic().translate([750,280]).scale((compactMap?200:250)*zoom).clipAngle(90).rotate(globeRotation).precision(0.35);
    let points:Coordinate[]=[...new Set(filtered.map(j=>traces.get(j.id)).filter(Boolean))].flatMap(t=>t!.coordinates);
    if(follow&&activeTrace)points=activeTrace.coordinates;
    if(!points.length)points=[[110,22],[124,40]];
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const [lon,lat] of points){minX=Math.min(minX,lon);maxX=Math.max(maxX,lon);minY=Math.min(minY,lat);maxY=Math.max(maxY,lat);}
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2,dx=Math.max(0.7,(maxX-minX)*1.3),dy=Math.max(0.5,(maxY-minY)*1.4);
    const p=geoMercator().fitExtent(compactMap?[[510,105],[990,425]]:[[460,105],[1085,425]],{type:'MultiPoint',coordinates:[[cx-dx/2,cy-dy/2],[cx+dx/2,cy+dy/2]]});
    const t=p.translate();return p.scale(p.scale()*zoom).translate([775+(t[0]-775)*zoom+pan[0],265+(t[1]-265)*zoom+pan[1]]).clipExtent([[0,0],[1200,600]]);
  // Projection depends on scalar rotation values to avoid rebuilding it for every playback frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view,zoom,filtered,traces,follow,activeTrace,pan,compactMap,globeRotation[0],globeRotation[1]]);
  const path=useMemo(()=>geoPath(projection),[projection]);
  const landPath=useMemo(()=>path(land as never)??'',[path]);const gridPath=useMemo(()=>path(geoGraticule10())??'',[path]);
  const routePaths=useMemo(()=>filtered.map(j=>{const g=geometries.get(j.id);return g?path(g)??'':'';}),[filtered,geometries,path]);
  const position=activeTrace?tracePosition(activeTrace,progress):null;
  const movingCoordinate=position?.coordinate;
  const activePath=position&&progress>0?path({type:'LineString',coordinates:position.coordinates})??'':'';
  const visible=(c:Coordinate)=>view==='region'||geoDistance([-globeRotation[0],-globeRotation[1]],c)<Math.PI/2;
  const movingPoint=movingCoordinate&&visible(movingCoordinate)?projection(movingCoordinate):null;

  const stationCounts=countBy(filtered.flatMap(j=>[j.origin,j.destination]),s=>s);
  const serviceCounts=countBy(filtered,j=>j.serviceType);const seatCounts=countBy(filtered,seatLabel);
  const routeCounts=countBy(filtered,j=>[j.origin,j.destination].sort().join(' ↔ ')).slice(0,6);
  const totalMinutes=journeys.reduce((sum,j)=>sum+(j.durationMinutes??0),0);
  const timed=filtered.filter(j=>j.durationMinutes!==null);const selectedMinutes=timed.reduce((sum,j)=>sum+j.durationMinutes!,0);
  const longest=[...timed].sort((a,b)=>b.durationMinutes!-a.durationMinutes!)[0];
  const shortest=[...timed].sort((a,b)=>a.durationMinutes!-b.durationMinutes!)[0];
  const totalDistance=filtered.reduce((sum,j)=>sum+(j.distanceKm??0),0);
  const annual=years.map(y=>({year:y,count:filtered.filter(j=>j.year===y).length}));const maxAnnual=Math.max(1,...annual.map(y=>y.count));
  const colours=['var(--cyan)','var(--amber)','#789ab4','#b39ccc','#8cbd99','#df8e7a'];
  let angle=0;const stops:string[]=[];
  for(const [i,[,n]] of serviceCounts.entries()){const start=angle;angle+=n/Math.max(1,filtered.length)*100;stops.push(`${colours[i%colours.length]} ${start}% ${angle}%`);}
  const gradient=stops.join(',');
  const log=filtered.filter(j=>!query.trim()||[j.date,j.trainNumber,j.origin,j.destination,j.serviceOrigin,j.serviceDestination,j.seat,serviceNames[j.serviceType],stations[j.origin]?.name,stations[j.destination]?.name].some(v=>v?.toLowerCase().includes(query.trim().toLowerCase())));
  const bands=[{label:'不足 1 小时',count:timed.filter(j=>j.durationMinutes!<60).length,className:'band-short'},{label:'1–3 小时',count:timed.filter(j=>j.durationMinutes!>=60&&j.durationMinutes!<180).length,className:'band-medium'},{label:'3 小时及以上',count:timed.filter(j=>j.durationMinutes!>=180).length,className:'band-long'}];
  let minutes=0;const points:{x:number;y:number}[]=[];
  for(const [i,j] of filtered.entries()){minutes+=j.durationMinutes??0;points.push({x:filtered.length<2?500:38+i/(filtered.length-1)*924,y:188-minutes/Math.max(1,selectedMinutes)*154});}
  const line=points.length?`M ${points.map(p=>`${p.x} ${p.y}`).join(' L ')}`:'';
  const area=line?`${line} L ${points.at(-1)!.x} 188 L ${points[0].x} 188 Z`:'';

  function resetProgress(){progressRef.current=0;setProgress(0);setIndex(0);setPlaying(false);setShowAll(false);}
  function resetFilters(){setYear('all');setService('all');setStation('all');resetProgress();}
  function select(i:number){if(!filtered.length)return;setIndex((i+filtered.length)%filtered.length);progressRef.current=0;setProgress(0);setPlaying(false);}
  function apply(data:TrainDataset,label:string,note:string,issues:string[]=[]){setDataset(data);setSource(label);setMessage(note);setWarnings(issues);resetFilters();setQuery('');setZoom(1);setPan([0,0]);setPlaying(true);}
  async function importFile(file?:File){if(!file)return;importStarted.current=true;setImporting(true);setMessage(`正在读取 ${file.name}…`);try{const {importTrainFile}=await import('./lib/import-trains');const r=await importTrainFile(file);apply(r.dataset,file.name,`已导入 ${r.accepted} 段行程。${r.rejected?`已跳过 ${r.rejected} 条无效记录。`:''}`,r.warnings);}catch(e){setMessage(e instanceof Error&&/[\u4e00-\u9fff]/.test(e.message)?e.message:'文件导入失败，请检查文件格式后重试。');}finally{setImporting(false);}}
  function onPointerDown(e:ReactPointerEvent<SVGSVGElement>){e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,rotation:globeRotation,pan,factor:(compactMap?600:1200)/e.currentTarget.getBoundingClientRect().width};if(view==='globe'){setRotation(globeRotation);setFollow(false);}}
  function onPointerMove(e:ReactPointerEvent<SVGSVGElement>){if(!drag.current)return;const d=drag.current,dx=(e.clientX-d.x)*d.factor,dy=(e.clientY-d.y)*d.factor;if(view==='globe')setRotation([d.rotation[0]+dx*.2,Math.max(-85,Math.min(85,d.rotation[1]-dy*.2)),0]);else setPan([d.pan[0]+dx,d.pan[1]+dy]);}
  function onPointerUp(e:ReactPointerEvent<SVGSVGElement>){if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drag.current=null;}
  function exportCsv(){const escape=(v:unknown)=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};const rows=[['日期','车次','上车站','上车时间','下车站','下车时间','始发站','终到站','座位','跨天数'],...[...log].reverse().map(j=>[j.date,j.trainNumber,j.origin,j.departureTime,j.destination,j.arrivalTime,j.serviceOrigin,j.serviceDestination,j.seat,j.arrivalDayOffset])];download('\uFEFF'+rows.map(r=>r.map(escape).join(',')).join('\r\n'),'铁路足迹-行程记录.csv','text/csv;charset=utf-8');}

  return <main className="site-shell">
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">铁</span><span>铁路足迹</span></a><nav aria-label="主导航"><a href="#map">地图</a><a href="#patterns">统计</a><a href="#logbook">行程</a><a href="#import">导入</a></nav><p className="topbar-meta">{source}</p></header>
    <section className="hero" id="top"><div className="hero-copy"><p className="eyebrow">铁路行程档案 · {years[0]??'—'}–{years.at(-1)??'—'}</p><h1>沿着铁轨，<br/>记录每次远行。</h1><p className="hero-deck">一站又一站，串起你的铁路足迹。</p></div><div className="hero-kpis" aria-label="行程概览"><div><span>累计行程</span><strong>{journeys.length}</strong></div><div><span>乘车时长</span><strong>{formatDuration(totalMinutes)}</strong><small>{journeys.filter(j=>j.durationMinutes!==null).length} 段行程已记录时长</small></div><div><span>到访车站</span><strong>{allStations.length}</strong></div><div><span>乘坐车次</span><strong>{new Set(journeys.map(j=>j.trainNumber).filter(n=>n!=='—')).size}</strong></div></div></section>
    <section className="filter-bar" aria-label="行程筛选"><label><span>年份</span><select value={year} onChange={e=>{setYear(e.target.value);resetProgress();}}><option value="all">全部年份</option>{years.map(y=><option key={y}>{y}</option>)}</select></label><label><span>列车类型</span><select value={service} onChange={e=>{setService(e.target.value);resetProgress();}}><option value="all">全部类型</option>{services.map(s=><option key={s} value={s}>{s==='Other'?'':s+' · '}{serviceNames[s]}</option>)}</select></label><label><span>车站</span><select value={station} onChange={e=>{setStation(e.target.value);resetProgress();}}><option value="all">全部车站</option>{allStations.map(s=><option key={s}>{s}</option>)}</select></label><div className="filter-result"><span>{filtered.length} 段符合条件的行程</span><button onClick={resetFilters}>重置筛选</button></div></section>
    <section className="map-section" id="map" aria-labelledby="map-title"><div className="section-heading"><div><p className="eyebrow">行程回放</p><h2 id="map-title">我的铁路地图</h2></div><p>{mapped.length} 段行程 · 真实铁路轨道</p></div>
      <div className="map-card"><svg className="world-map" viewBox={compactMap?"350 0 800 600":"0 0 1200 600"} preserveAspectRatio={compactMap?"xMidYMid slice":"xMidYMid meet"} role="img" aria-label="真实铁路轨迹交互地图" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <defs><filter id="route-glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="map-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#101f2c"/><stop offset="100%" stopColor="#08131d"/></linearGradient></defs>
        {view==='globe'&&<path d={path({type:'Sphere'})??''} fill="url(#map-fade)" className="globe-sphere"/>}<path d={gridPath} className="graticule"/><path d={landPath} className="land"/>
        {history&&routePaths.map((r,i)=>r&&i!==index?<path key={filtered[i].id} d={r} className={i<index?'route route-visited':'route route-future'}/>:null)}
        {active&&routePaths[index]&&<><path d={routePaths[index]} className="route route-guide"/><path d={activePath} className="route route-active"/></>}
        {[...new Set(filtered.flatMap(j=>[j.origin,j.destination]))].map(code=>{const s=stations[code];if(!s)return null;const c:Coordinate=[s.longitude,s.latitude];const p=visible(c)?projection(c):null;if(!p)return null;const isOrigin=code===active?.origin,isDest=code===active?.destination;return <g key={code} aria-label={`${code} · ${s.name}`} transform={`translate(${p[0].toFixed(3)} ${p[1].toFixed(3)})`}><circle r={isOrigin||isDest?4:2.5} className="airport-node"/>{(isOrigin||isDest)&&<text className="station-label" x={isOrigin?-10:10} y={isOrigin?-13:22} textAnchor={isOrigin?'end':'start'}>{code}</text>}</g>;})}
        {movingPoint&&<g transform={`translate(${movingPoint[0].toFixed(3)} ${movingPoint[1].toFixed(3)})`} filter="url(#route-glow)"><circle r="10" className="moving-halo"/><rect x="-5" y="-6" width="10" height="12" rx="3" className="moving-flight"/></g>}
      </svg><div className="globe-actions"><div className="view-switch"><button className={view==='region'?'is-active':''} onClick={()=>{setView('region');setZoom(1);setPan([0,0]);}}>区域</button><button className={view==='globe'?'is-active':''} onClick={()=>{setView('globe');setZoom(1);}}>地球</button></div><button className={follow?'is-active':''} aria-pressed={follow} onClick={()=>{setFollow(f=>!f);setPan([0,0]);setZoom(1);}}>跟随</button><button aria-pressed={history} className={history?'is-active':''} onClick={()=>setHistory(h=>!h)}>全部线路</button><button aria-label="缩小地图" onClick={()=>setZoom(z=>Math.max(.5,z/1.4))}>−</button><button aria-label="放大地图" onClick={()=>setZoom(z=>Math.min(12,z*1.4))}>+</button><button onClick={()=>{setZoom(1);setPan([0,0]);setFollow(false);setRotation([-118,-32,0]);}}>重置视图</button></div>
      <div className="map-overlay">{active?<><p className="overlay-label">行程 {String(index+1).padStart(2,'0')} · {active.date}</p><div className="rail-route"><strong>{active.origin}</strong><span>至</span><strong>{active.destination}</strong></div><p>{activeOrigin?.name??'暂无车站坐标'}</p><p>{activeDestination?.name??'暂无车站坐标'}</p><div className="overlay-rule"/><div className="train-ticket"><strong>{active.trainNumber}</strong><span>{serviceNames[active.serviceType]}</span></div><p className="ticket-time">{active.departureTime??'—'} <span>—</span> {active.arrivalTime??'—'}{active.arrivalDayOffset>0&&<small> +{active.arrivalDayOffset} 天</small>}</p><p className="overlay-distance">{formatDuration(active.durationMinutes)}</p><p>座位：{active.seat??'—'}</p><p className="service-endpoints">列车全程：{active.serviceOrigin??'—'} → {active.serviceDestination??'—'}</p>{activeTrace&&<p className="track-name">{activeTrace.route.line}</p>}{!activeTrace&&<p className="map-warning">暂无此行程的铁路轨道数据，因此不绘制连线。</p>}<div className="flight-stage"><i><b style={{width:`${progress*100}%`}}/></i><span>{progress>=1?'已到达':playing?'行驶中':'已暂停'} · {Math.round(progress*100)}%</span></div></>:<><p className="overlay-label">暂无符合条件的行程</p><strong>请调整或重置筛选条件。</strong></>}</div>
      <p className="map-method">© 开放街图贡献者 · 沿真实铁路轨道重建</p><div className="timeline-controls"><button className="step-button" disabled={!active} onClick={()=>select(index-1)} aria-label="上一段行程">‹</button><button className="play-button" disabled={!active} onClick={()=>setPlaying(p=>!p)} aria-label={playing?'暂停行程回放':'播放行程回放'}>{playing?'Ⅱ':'▶'}</button><button className="step-button" disabled={!active} onClick={()=>select(index+1)} aria-label="下一段行程">›</button><input type="range" aria-label="行程时间轴" min="0" max={Math.max(0,filtered.length-1)} value={active?index:0} disabled={!active} onChange={e=>select(Number(e.target.value))}/><div className="speed-control" aria-label="播放速度">{[.5,1,2].map(s=><button key={s} className={s===speed?'is-active':''} onClick={()=>setSpeed(s)}>{s}×</button>)}</div><div className="timeline-date"><span>{active?`${index+1} / ${filtered.length}`:'0 / 0'}</span><strong>{active?.date??'未选择行程'}</strong></div></div></div>
      <div className="track-provenance"><div><span className="eyebrow">铁路轨道数据</span><p>{activeTrace?<>{activeTrace.route.line} · {number(Math.round(activeTrace.route.distanceKm))} 公里 · {number(activeTrace.coordinates.length)} 个轨迹点</>:'暂无当前行程对应的铁路轨道数据。'}</p><small>线路依据途经站和真实轨道重建；历史列车径路、站内股道可能存在差异。{activeTrace&&!activeTrace.trainMatched?'当前车次尚未匹配，显示这两个车站间的已知铁路线路。':''}</small></div><div className="track-actions"><button disabled={!mapped.length} onClick={()=>download(JSON.stringify(railwayGeoJson(filtered)),'铁路足迹-轨道数据.geojson','application/geo+json')}>导出铁路轨迹</button>{activeTrace&&<a href={activeTrace.route.sourceUrl} target="_blank" rel="noreferrer">轨道数据来源</a>}</div></div>
    </section>
    <section className="analytics-section" id="patterns"><div className="section-heading"><div><p className="eyebrow">出行统计</p><h2>铁轨上的时光</h2></div><p>统计随筛选条件更新</p></div><div className="insight-strip"><article><span>已选行程时长</span><strong>{timed.length?formatDuration(selectedMinutes):'—'}</strong><small>{filtered.length} 段行程中，{timed.length} 段已记录时长</small></article><article><span>最长行程</span><strong>{longest?`${longest.origin} — ${longest.destination}`:'—'}</strong><small>{longest?`${longest.trainNumber} · ${formatDuration(longest.durationMinutes)}`:'暂无数据'}</small></article><article><span>最常到访车站</span><strong>{stationCounts[0]?.[0]??'—'}</strong><small>{stationCounts[0]?`${stationCounts[0][1]} 次出发或到达`:'暂无数据'}</small></article><article><span>到访车站</span><strong>{stationCounts.length}</strong><small>{new Set(filtered.map(j=>[j.origin,j.destination].sort().join('|'))).size} 条不同线路</small></article></div>
      <div className="analytics-grid"><article className="chart-panel annual-panel"><div className="panel-title"><div><span>01</span><h3>年度行程</h3></div><p>点击年份筛选</p></div><div className="year-chart" aria-label="年度行程">{annual.map(y=><button key={y.year} className="year-column" onClick={()=>{setYear(String(y.year));resetProgress();}} aria-label={`${y.year} 年：${y.count} 段行程`}><span className="year-value">{y.count}</span><span className="year-bar" style={{height:`${Math.max(3,y.count/maxAnnual*100)}%`}}/><span className="year-label">{y.year}</span></button>)}</div></article>
      <article className="chart-panel maker-panel"><div className="panel-title"><div><span>02</span><h3>列车类型</h3></div></div><div className="maker-chart" style={{background:gradient?`conic-gradient(${gradient})`:'var(--line)'}}><div><strong>{filtered.length}</strong><span>段行程</span></div></div><ul className="legend-list">{serviceCounts.map(([s,n],i)=><li key={s}><i className="dot" style={{background:colours[i%colours.length]}}/><span>{s==='Other'?'':s+' · '}{serviceNames[s]}</span><strong>{n}</strong></li>)}</ul></article>
      <article className="chart-panel rank-panel"><div className="panel-title"><div><span>03</span><h3>常到车站</h3></div></div><div className="rank-list">{stationCounts.slice(0,7).map(([s,n])=><button key={s} onClick={()=>{setStation(s);resetProgress();}}><span className="rank-name"><strong>{s}</strong><small>{stations[s]?.name??'暂无坐标'}</small></span><span className="rank-track"><i style={{width:`${n/(stationCounts[0]?.[1]??1)*100}%`}}/></span><strong className="rank-value">{n}</strong></button>)}</div></article>
      <article className="chart-panel rank-panel"><div className="panel-title"><div><span>04</span><h3>座位分布</h3></div><p>按原始座位字母统计</p></div><div className="rank-list seat-ranks">{seatCounts.map(([s,n])=><div key={s}><span className="rank-name"><strong>{s}</strong></span><span className="rank-track"><i style={{width:`${n/(seatCounts[0]?.[1]??1)*100}%`}}/></span><strong className="rank-value">{n}</strong></div>)}</div></article>
      <article className="chart-panel routes-panel"><div className="panel-title"><div><span>05</span><h3>常乘线路</h3></div><p>往返方向合并统计</p></div><div className="route-ranking">{routeCounts.map(([r,n],i)=><div key={r}><span>{String(i+1).padStart(2,'0')}</span><strong>{r}</strong><i/><small>{n} 次</small></div>)}</div></article>
      <article className="chart-panel cumulative-panel"><div className="panel-title"><div><span>06</span><h3>乘车时长</h3></div><p>累计已记录乘车时长</p></div><div className="cumulative-chart"><svg viewBox="0 0 1000 220" role="img" aria-label="累计乘车时长曲线"><defs><linearGradient id="time-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#69e0df" stopOpacity=".34"/><stop offset="100%" stopColor="#69e0df" stopOpacity="0"/></linearGradient></defs>{[34,85,136,188].map(y=><line key={y} x1="38" x2="962" y1={y} y2={y} className="chart-gridline"/>)}{area&&<path d={area} fill="url(#time-area)"/>}{line&&<path d={line} className="cumulative-line"/>}</svg><div className="cumulative-axis"><span>{filtered[0]?.date??'—'}</span><strong>{timed.length?formatDuration(selectedMinutes):'—'}</strong><span>{filtered.at(-1)?.date??'—'}</span></div></div></article>
      <article className="chart-panel profile-panel"><div className="panel-title"><div><span>07</span><h3>行程时长分布</h3></div><p>{filtered.length-timed.length} 段行程缺少完整时间</p></div><div className="distance-stack">{bands.map(b=><i key={b.label} className={b.className} style={{width:`${b.count/Math.max(1,timed.length)*100}%`}}/>)}</div><ul className="profile-list">{bands.map(b=><li key={b.label}><span><i className={b.className}/>{b.label}</span><strong>{b.count}</strong></li>)}</ul><div className="duration-note">到达时间早于出发时间时，默认次日到达；填写“跨天数”可指定到达日期。</div></article>
      <article className="chart-panel fleet-age-panel"><div className="panel-title"><div><span>08</span><h3>旅途数据</h3></div></div><div className="age-hero"><strong>{timed.length?Math.round(selectedMinutes/timed.length):'—'}</strong><span>分钟<br/>平均每段行程</span></div><div className="age-extremes"><div><span>最短行程</span><strong>{shortest?.trainNumber??'—'}</strong><small>{shortest?formatDuration(shortest.durationMinutes):'暂无数据'}</small></div><div><span>铁路里程</span><strong>{mapped.length?number(totalDistance)+' 公里':'—'}</strong><small>{mapped.length} 段行程 · 按轨迹估算</small></div></div></article></div>
    </section>
    <section className="logbook-section" id="logbook"><div className="section-heading"><div><p className="eyebrow">乘车记录</p><h2>我的行程簿</h2></div><p>{log.length} 条记录 · 最新在前</p></div><div className="logbook-tools"><label><span>搜索行程</span><input type="search" aria-label="搜索乘车记录" value={query} onChange={e=>{setQuery(e.target.value);setShowAll(false);}} placeholder="搜索车站、车次、日期或座位"/></label><button onClick={exportCsv} disabled={!log.length}>导出 {log.length} 条记录</button></div><div className="logbook-table-wrap"><table><thead><tr><th>日期</th><th>乘车区间</th><th>车次</th><th>出发与到达</th><th>时长</th><th>座位</th><th>列车全程</th></tr></thead><tbody>{[...log].reverse().slice(0,showAll?undefined:12).map(j=><tr key={j.id}><td>{j.date}</td><td><button className="route-link" title="在地图上查看此行程" onClick={()=>{select(filtered.findIndex(f=>f.id===j.id));document.getElementById('map')?.scrollIntoView({behavior:'smooth'});}}>{j.origin}<span>→</span>{j.destination}</button></td><td><strong>{j.trainNumber}</strong><small>{serviceNames[j.serviceType]}</small></td><td>{j.departureTime??'—'}<span>→</span>{j.arrivalTime??'—'}{j.arrivalDayOffset>0&&<small>+{j.arrivalDayOffset} 天</small>}</td><td>{formatDuration(j.durationMinutes)}</td><td>{j.seat??'—'}</td><td>{j.serviceOrigin??'—'}<span>→</span>{j.serviceDestination??'—'}</td></tr>)}</tbody></table>{!log.length&&<p className="empty-table">暂无符合当前筛选和搜索条件的行程。</p>}</div>{log.length>12&&<button className="show-more" onClick={()=>setShowAll(s=>!s)}>{showAll?'仅显示近期行程':`显示全部 ${log.length} 段行程`}</button>}</section>
    <section className="import-section" id="import"><div className="import-copy"><p className="eyebrow">导入乘车记录</p><h2>下一程，继续记录。</h2><p>支持导入 Excel、CSV 或 JSON 文件，兼容中英文表头。地图按你的上、下车站绘制行程，列车始发站和终到站保留在记录中。</p><div className="import-links"><a href="templates/train-atlas-template.csv" download>下载表格模板</a><a href="api/train-atlas.schema.json" target="_blank" rel="noreferrer">数据格式说明</a><a href="api/v1/import" target="_blank" rel="noreferrer">接口说明</a></div></div><div className="import-card"><div className="source-badge"><span>当前数据来源</span><strong>{source}</strong></div><label className="file-picker"><input type="file" aria-label="选择行程文件" accept=".xlsx,.xls,.csv,.json" disabled={importing} onChange={e=>{void importFile(e.currentTarget.files?.[0]);e.currentTarget.value='';}}/><span>{importing?'正在读取文件…':'选择行程文件'}</span><small>.xlsx · .xls · .csv · .json</small></label><p className="privacy-note" role="status">{message}</p>{warnings.length>0&&<details className="import-warnings"><summary>{warnings.length} 条导入提示</summary><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}<div className="dataset-actions"><button disabled={source==='示例行程'} onClick={()=>{importStarted.current=true;apply(demoDataset,'示例行程','已恢复示例行程。');}}>恢复示例行程</button>{localDataset&&<button onClick={()=>apply(localDataset,'train.xlsx · 本地行程',`已恢复 ${localDataset.journeys.length} 段本地行程。`)}>恢复本地行程</button>}<button onClick={()=>download(JSON.stringify(dataset,null,2)+'\n','铁路足迹-行程数据.json','application/json')}>下载整理后的数据</button></div><p className="local-processing">导入文件仅在当前浏览器中处理。</p></div></section>
    <footer><p><strong>铁路足迹</strong> · 与飞行足迹一起记录旅程。</p><p>铁路轨道数据：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© 开放街图贡献者 · 开放数据库许可协议</a>；路径计算：<a href="https://brouter.de/" target="_blank" rel="noreferrer">BRouter</a>。路线依据真实铁路轨道和途经站重建，不代表历史列车的定位实录；里程由轨迹估算。</p></footer>
  </main>;
}
