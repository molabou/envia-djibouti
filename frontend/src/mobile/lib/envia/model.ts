export const categories = [
 {id:'waste',label:'Déchets & pollution',icon:'Recycle'}, {id:'marine_pollution',label:'Pollution marine',icon:'Waves'},
 {id:'water',label:'Eau',icon:'Droplets'},{id:'marine_biodiversity',label:'Biodiversité marine',icon:'Fish'},
 {id:'terrestrial_biodiversity',label:'Biodiversité terrestre',icon:'Leaf'},{id:'fire',label:'Incendie',icon:'Flame'},
 {id:'climate',label:'Chaleur / climat',icon:'Sun'},{id:'habitat',label:'Habitat / écosystème',icon:'Trees'},
 {id:'shark',label:'Pêche / capture de requin',icon:'Fish'}
] as const;
export const statuses:Record<string,string>={pending:'À vérifier',to_validate:'En validation',validated:'Validé',processed:'En traitement',closed:'Clôturé',rejected:'Rejeté',queued:'À synchroniser'};
export const stages=['pending','to_validate','validated','processed','closed'];
export const priorities:Record<string,string>={low:'Faible',medium:'Normale',high:'Haute',critical:'Critique'};
export type User={id:string;username:string;display_name:string;role:'ecogarde'|'citizen'|'expert'|'admin'};
export type Payload={category:string;subcategory?:string;description:string;latitude:number;longitude:number;priority:string;source:string;region:string;reporter?:string};
export type Media={id:string;filename:string;url:string;media_type:string};
export type Report=Payload & {id:string;status:string;created_at:string;updated_at:string;media:Media[];history:{status:string;at:string}[];demo?:boolean;client_id?:string};
export type QueuedFile={id:string;file:File;uploaded:boolean};
export type QueuedReport={id:string;payload:Payload;files:QueuedFile[];created_at:string;server_id?:string;error?:string};
export function validatePayload(value:unknown):Payload {
 if(!value||typeof value!=='object')throw new Error('Signalement invalide.');
 const p=value as Payload;
 if(!categories.some(c=>c.id===p.category))throw new Error('Choisissez une catégorie.');
 if(typeof p.description!=='string'||p.description.trim().length<10||p.description.length>4000)throw new Error('La description doit contenir entre 10 et 4 000 caractères.');
 if(!Number.isFinite(p.latitude)||p.latitude< -90||p.latitude>90||!Number.isFinite(p.longitude)||p.longitude< -180||p.longitude>180)throw new Error('Renseignez des coordonnées GPS valides.');
 if(!Object.hasOwn(priorities,p.priority))throw new Error('Priorité invalide.');
 if(typeof p.region!=='string'||!['Djibouti','Obock','Tadjourah','Ali Sabieh','Dikhil','Arta'].includes(p.region))throw new Error('Choisissez une région.');
 return {category:p.category,subcategory:p.subcategory?.slice(0,120),description:p.description.trim(),latitude:p.latitude,longitude:p.longitude,priority:p.priority,source:'field',region:p.region};
}
export function label(c:string){return categories.find(x=>x.id===c)?.label??c;}
export const demoReports:Report[]=[
 {id:'DEMO-001',category:'waste',description:'Déchets plastiques observés dans la mangrove de Godoria, à proximité du sentier côtier.',latitude:12.083,longitude:43.393,priority:'high',source:'field',region:'Obock',status:'processed',created_at:'2026-10-05T08:15:00Z',updated_at:'2026-10-06T09:00:00Z',media:[],history:[{status:'pending',at:'2026-10-05T08:15:00Z'},{status:'to_validate',at:'2026-10-05T09:30:00Z'},{status:'validated',at:'2026-10-05T11:00:00Z'},{status:'processed',at:'2026-10-06T09:00:00Z'}],demo:true},
 {id:'DEMO-002',category:'marine_biodiversity',description:'Observation de tortues marines à proximité du littoral de Khor Angar. Zone à surveiller.',latitude:12.388,longitude:43.34,priority:'medium',source:'field',region:'Obock',status:'validated',created_at:'2026-10-04T07:40:00Z',updated_at:'2026-10-05T12:00:00Z',media:[],history:[{status:'pending',at:'2026-10-04T07:40:00Z'},{status:'to_validate',at:'2026-10-04T12:00:00Z'},{status:'validated',at:'2026-10-05T12:00:00Z'}],demo:true}
];
