import directory from '../../../data/stations.json';
import {normaliseTrainRows,validateStations} from '../../../lib/train-data';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
export function OPTIONS(){return new Response(null,{status:204,headers});}
export function GET(){return json({name:'铁路足迹导入接口',version:'1.0',storage:'none',method:'POST',requiredFields:['date','origin','destination'],optionalFields:['trainNumber','departureTime','arrivalTime','arrivalDayOffset','serviceOrigin','serviceDestination','seat'],acceptedBody:'行程记录数组，或包含 journeys 数组和可选 stations 车站字典的对象',notes:['支持中文及英文表头。','未知车站的行程会保留。补充车站坐标后可定位车站，线路轨迹需另行提供。','里程根据内置的开放街图铁路轨迹估算；未知线路不绘制连线。','到达时间早于出发时间时，默认次日到达；可通过 arrivalDayOffset 指定跨天数。']});}
export async function POST(request:Request){
 try{
  const limit=5_000_000;
  if(Number(request.headers.get('content-length'))>limit)return json({ok:false,error:'请求内容不能超过 5 兆字节。'},413);
  const reader=request.body?.getReader();if(!reader)return json({ok:false,error:'请求内容为空。'},400);
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();return json({ok:false,error:'请求内容不能超过 5 兆字节。'},413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const parsed=JSON.parse(new TextDecoder().decode(bytes));const rows=Array.isArray(parsed)?parsed:parsed?.journeys;
  if(!Array.isArray(rows))return json({ok:false,error:'请提交行程数组，或包含 journeys 数组的对象。'},400);
  if(rows.length>5000)return json({ok:false,error:'最多支持 5,000 条记录。'},413);
  const r=normaliseTrainRows(rows,{...validateStations(directory),...validateStations(parsed?.stations)});
  return json({ok:r.accepted>0,dataset:r.dataset,meta:{accepted:r.accepted,rejected:r.rejected,warnings:r.warnings}},r.accepted?200:422);
 }catch{return json({ok:false,error:'请求内容不是有效的 JSON 数据。'},400);}
}
