import { getRailTrace } from './rail-routes.ts';
export type Station = { code: string; name: string; city: string; latitude: number; longitude: number; source?: string; aliases?: string[] };
export type Journey = {
  id: number; date: string; year: number; trainNumber: string; serviceType: string;
  origin: string; destination: string; departureTime: string | null; arrivalTime: string | null;
  arrivalDayOffset: number; durationMinutes: number | null; serviceOrigin: string | null;
  serviceDestination: string | null; seat: string | null; distanceKm: number | null;
};
export type TrainDataset = { stations: Record<string, Station>; journeys: Journey[] };
export type ImportResult = { dataset: TrainDataset; accepted: number; rejected: number; warnings: string[] };
export type Row = Record<string, unknown>;
export const serviceNames: Record<string,string> = { G: '高速动车组', D: '动车组', C: '城际动车组', Z: '直达特快', T: '特快', K: '快速', Other: '其他车次' };
const aliases = {
  date: ['date','traveldate','日期','乘车日期'], trainNumber: ['trainnumber','train','trainno','车次','列车号'],
  origin: ['origin','from','boardingstation','上车站','出发站'], destination: ['destination','to','alightingstation','下车站','到达站'],
  departureTime: ['departuretime','departure','上车时间','出发时间'], arrivalTime: ['arrivaltime','arrival','下车时间','到达时间'],
  serviceOrigin: ['serviceorigin','始发站'], serviceDestination: ['servicedestination','终到站'],
  seat: ['seat','座位','座位号'], arrivalDayOffset: ['arrivaldayoffset','到达日偏移','跨天数'],
} as const;
const clean = (v: unknown) => v == null ? '' : String(v).trim();
const header = (v: string) => v.toLowerCase().replace(/[\s_()-]/g,'');
function value(row: Row, field: keyof typeof aliases) {
  const fields = new Map(Object.entries(row).map(([k,v])=>[header(k),v]));
  for (const key of aliases[field]) { const v=fields.get(header(key)); if(v!=null&&clean(v)!=='')return v; }
  return null;
}
export function parseDate(v: unknown): string | null {
  if(v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0,10);
  const raw=clean(v);
  const m=raw.match(/^(\d{4})[-/.年]?(\d{2})[-/.月]?(\d{2})(?:日|T.*)?$/);
  if(m) {
    const date=`${m[1]}-${m[2]}-${m[3]}`;const d=new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date ? date : null;
  }
  if(typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<100000) return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);
  return null;
}
export function parseTime(v: unknown): string | null {
  if(v==null||clean(v)==='')return null;
  let h:number, m:number;
  if(v instanceof Date) { h=v.getUTCHours();m=v.getUTCMinutes(); }
  else if(typeof v==='number'&&v>=0&&v<1) { const minutes=Math.round(v*1440)%1440; h=Math.floor(minutes/60);m=minutes%60; }
  else {
    const raw=clean(v);const colon=raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if(colon){h=Number(colon[1]);m=Number(colon[2]);}
    else if(/^\d{1,4}$/.test(raw)){const n=Number(raw);h=Math.floor(n/100);m=n%100;}
    else return null;
  }
  return h>=0&&h<24&&m>=0&&m<60 ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` : null;
}
export function formatDuration(minutes: number | null) {
  if(minutes===null)return '—';return `${Math.floor(minutes/60)} 小时 ${String(minutes%60).padStart(2,'0')} 分钟`;
}
function stationKey(v: unknown, stations: Record<string,Station>) {
  const name=clean(v).replace(/(?:火车站|站)$/,'');if(stations[name])return name;
  return Object.values(stations).find(s=>[s.code,s.name,...(s.aliases??[])].some(alias=>alias.toLowerCase()===name.toLowerCase()))?.code??name;
}
export function validateStations(raw: unknown): Record<string,Station> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};const result:Record<string,Station>={};
  for(const [code,s] of Object.entries(raw)) {
    if(!s||typeof s!=='object')continue;const a=s as Station;
    if(typeof a.name==='string'&&typeof a.city==='string'&&Number.isFinite(a.latitude)&&Math.abs(a.latitude)<=90&&Number.isFinite(a.longitude)&&Math.abs(a.longitude)<=180)
      result[code]={code,name:a.name,city:a.city,latitude:a.latitude,longitude:a.longitude,...(typeof a.source==='string'?{source:a.source}:{}),...(Array.isArray(a.aliases)?{aliases:a.aliases.filter((v):v is string=>typeof v==='string')}:{})};
  }return result;
}
export function normaliseTrainRows(rows: unknown[], lookup: Record<string,Station>): ImportResult {
  const journeys:Journey[]=[];const used=new Set<string>();const warnings:string[]=[];let rejected=0;
  rows.forEach((raw,index)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){rejected++;warnings.push(`第 ${index+2} 行：不是有效的行程记录。`);return;}
    const row=raw as Row;const date=parseDate(value(row,'date'));const origin=stationKey(value(row,'origin'),lookup);const destination=stationKey(value(row,'destination'),lookup);
    if(!date||!origin||!destination){rejected++;warnings.push(`第 ${index+2} 行：日期无效，或缺少上、下车站。`);return;}
    const trainNumber=clean(value(row,'trainNumber')).toUpperCase().replace(/\s/g,'')||'—';
    const departureTime=parseTime(value(row,'departureTime'));const arrivalTime=parseTime(value(row,'arrivalTime'));
    for(const field of ['departureTime','arrivalTime'] as const)if(value(row,field)!=null&&!parseTime(value(row,field)))warnings.push(`第 ${index+2} 行：${field==='departureTime'?'上车时间':'下车时间'}无效，已留空。`);
    const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
    const explicitOffset=value(row,'arrivalDayOffset');const inferredOffset=departureTime&&arrivalTime&&minutes(arrivalTime)<minutes(departureTime)?1:0;
    const offsetNumber=explicitOffset==null?inferredOffset:Number(explicitOffset);const validOffset=Number.isInteger(offsetNumber)&&offsetNumber>=0&&offsetNumber<=30;
    const arrivalDayOffset=validOffset?offsetNumber:0;
    if(!validOffset)warnings.push(`第 ${index+2} 行：跨天数无效，无法计算乘车时长。`);
    let durationMinutes=departureTime&&arrivalTime&&validOffset?minutes(arrivalTime)-minutes(departureTime)+arrivalDayOffset*1440:null;
    if(durationMinutes!==null&&durationMinutes<0){warnings.push(`第 ${index+2} 行：到达时间早于出发时间，请检查跨天数。`);durationMinutes=null;}
    for(const key of [origin,destination]) { if(lookup[key])used.add(key);else warnings.push(`未知车站：${key}。已保留行程；可在数据文件中补充车站坐标，铁路轨迹需另行提供。`); }
    const trace=getRailTrace({origin,destination,trainNumber});
    if(!trace)warnings.push(`暂无 ${origin}—${destination} 的铁路轨道数据。已保留行程，暂不绘制线路或计算里程。`);
    journeys.push({id:0,date,year:Number(date.slice(0,4)),trainNumber,serviceType:serviceNames[trainNumber[0]]?trainNumber[0]:'Other',origin,destination,departureTime,arrivalTime,arrivalDayOffset,durationMinutes,serviceOrigin:clean(value(row,'serviceOrigin'))||null,serviceDestination:clean(value(row,'serviceDestination'))||null,seat:clean(value(row,'seat'))||null,distanceKm:trace?Math.round(trace.route.distanceKm):null});
  });
  journeys.sort((a,b)=>`${a.date}${a.departureTime??''}`.localeCompare(`${b.date}${b.departureTime??''}`));journeys.forEach((j,i)=>{j.id=i+1;});
  return {dataset:{stations:Object.fromEntries([...used].map(k=>[k,lookup[k]])),journeys},accepted:journeys.length,rejected,warnings:[...new Set(warnings)]};
}
