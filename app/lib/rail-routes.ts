import catalog from '../data/rail-routes.json' with { type: 'json' };

export type Coordinate=[number,number];
export type RailRoute={
  id:string;origin:string;destination:string;line:string;trains:string[];
  coordinates:Coordinate[];distanceKm:number;geometrySource:string;geometryRetrievedAt:string;
  sourceUrl:string;routeBasis:string;timetableSources:string[];
  viaStations:{name:string;coordinate:number[];source:string}[];
};
export type RailTrace={route:RailRoute;coordinates:Coordinate[];cumulative:number[];length:number;trainMatched:boolean};
const routes=catalog.routes as unknown as RailRoute[];
const cached=new Map<string,RailTrace>();
export function segmentLength(a:Coordinate,b:Coordinate){
  const r=Math.PI/180;const h=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;
  return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function getRailTrace(j:{origin:string;destination:string;trainNumber:string}):RailTrace|null{
  const candidates=routes.filter(r=>(r.origin===j.origin&&r.destination===j.destination)||(r.origin===j.destination&&r.destination===j.origin));
  const route=candidates.find(r=>r.trains.includes(j.trainNumber))??candidates[0];if(!route)return null;
  const trainMatched=route.trains.includes(j.trainNumber);const reversed=route.origin!==j.origin;const key=`${route.id}:${reversed}:${trainMatched}`;
  if(cached.has(key))return cached.get(key)!;
  const coordinates=reversed?[...route.coordinates].reverse():route.coordinates;
  const cumulative=[0];for(let i=1;i<coordinates.length;i++)cumulative.push(cumulative[i-1]+segmentLength(coordinates[i-1],coordinates[i]));
  const trace={route,coordinates,cumulative,length:cumulative.at(-1)??0,trainMatched};cached.set(key,trace);return trace;
}
export function tracePosition(trace:RailTrace,progress:number){
  const target=Math.max(0,Math.min(1,progress))*trace.length;
  let lo=0,hi=trace.cumulative.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(trace.cumulative[mid]<target)lo=mid+1;else hi=mid;}
  const end=Math.max(1,lo);const start=end-1;const span=trace.cumulative[end]-trace.cumulative[start];const fraction=span?(target-trace.cumulative[start])/span:0;
  const a=trace.coordinates[start],b=trace.coordinates[end];
  const coordinate:Coordinate=[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction];
  return {coordinate,segmentIndex:end,coordinates:[...trace.coordinates.slice(0,end),coordinate]};
}
export function railwayGeoJson(journeys:{origin:string;destination:string;trainNumber:string}[]){
  const seen=new Set<string>();return {type:'FeatureCollection',attribution:catalog.attribution,license:catalog.license,features:journeys.flatMap(j=>{
    const t=getRailTrace(j);if(!t||seen.has(t.route.id))return [];seen.add(t.route.id);
    return [{type:'Feature',properties:{id:t.route.id,line:t.route.line,source:t.route.sourceUrl,geometrySource:t.route.geometrySource,retrievedAt:t.route.geometryRetrievedAt,routeBasis:t.route.routeBasis,distanceKm:t.route.distanceKm},geometry:{type:'LineString',coordinates:t.route.coordinates}}];
  })};
}
