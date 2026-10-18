import {validatePayload} from './model';
import type {Report,QueuedReport} from './model';
export type Transfer={format:'envia-reports-v1';exported_at:string;reports:Array<Omit<Report,'media'>&{media:Array<Report['media'][number]&{base64:string}>}>};
const MAX_BYTES=100*1024*1024;
function encode(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);}
export async function createTransfer(reports:Report[],readMedia:(url:string)=>Promise<ArrayBuffer>):Promise<Transfer>{
 const output:Transfer={format:'envia-reports-v1',exported_at:new Date().toISOString(),reports:[]};let size=0;
 for(const report of reports.filter(r=>!r.demo)){
  const media=[];
  for(const m of report.media){const bytes=new Uint8Array(await readMedia(m.url));size+=bytes.byteLength;if(size>MAX_BYTES)throw new Error('Le transfert dépasse 100 Mo. Contactez votre administrateur pour une reprise complète.');media.push({...m,base64:encode(bytes)});}
  output.reports.push({...report,media});
 }
 return output;
}
export function parseTransfer(value:unknown):QueuedReport[]{
 const transfer=value as Transfer;
 if(!transfer||transfer.format!=='envia-reports-v1'||!Array.isArray(transfer.reports)||transfer.reports.length>200)throw new Error('Ce fichier n’est pas un export ENVIA compatible.');
 let size=0;const ids=new Set<string>();
 return transfer.reports.map(r=>{
  if(typeof r.id!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(r.id)||ids.has(r.id)||!Array.isArray(r.media)||r.media.length>5)throw new Error('Un signalement de l’export est invalide.');ids.add(r.id);
  const payload=validatePayload(r);const mediaIds=new Set<string>();
  const files=r.media.map(m=>{
   if(typeof m.id!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(m.id)||mediaIds.has(m.id)||typeof m.base64!=='string'||typeof m.filename!=='string'||m.filename.length>255||typeof m.media_type!=='string'||!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/wav'].includes(m.media_type))throw new Error('Un média de l’export est invalide.');mediaIds.add(m.id);
   const raw=atob(m.base64);size+=raw.length;if(raw.length>15*1024*1024||size>MAX_BYTES)throw new Error('Le transfert dépasse la taille autorisée.');
   const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   return {id:'prototype-'+m.id,file:new File([bytes],m.filename,{type:m.media_type}),uploaded:false};
  });
  return {id:'prototype-'+r.id,payload,files,created_at:typeof r.created_at==='string'&&!Number.isNaN(Date.parse(r.created_at))?r.created_at:new Date().toISOString()};
 });
}
