import directory from '../data/stations.json';
import { normaliseTrainRows, validateStations } from './train-data';
export const stationLookup=validateStations(directory);
export async function importTrainFile(file: File) {
  if(file.size>5_000_000)throw new Error('请选择小于 5 兆字节的文件。');
  let rows:unknown[];let stations=stationLookup;
  if(file.name.toLowerCase().endsWith('.json')){
    let parsed;
    try{parsed=JSON.parse(await file.text());}catch{throw new Error('文件不是有效的 JSON 数据，请检查格式后重试。');}
    rows=Array.isArray(parsed)?parsed:parsed?.journeys;
    if(!Array.isArray(rows))throw new Error('数据必须是行程数组，或包含 journeys 数组的对象。');
    stations={...stations,...validateStations(parsed?.stations)};
  }else{
    const XLSX=await import('xlsx');
    let wb;
    try{wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});}catch{throw new Error('无法读取表格，请确认文件未损坏、未加密且格式正确。');}
    if(!wb.SheetNames.length)throw new Error('工作簿中没有工作表。');
    rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null,raw:true});
  }
  if(!rows.length)throw new Error('文件中没有行程记录。');
  if(rows.length>5000)throw new Error('最多支持导入 5,000 段行程。');
  const result=normaliseTrainRows(rows,stations);
  if(!result.accepted)throw new Error(result.warnings[0]??'未找到有效行程。');return result;
}
