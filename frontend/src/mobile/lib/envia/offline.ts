import type {QueuedReport,Report} from './model';
let account='anonymous';
export function setStorageAccount(id:string){if(account!==id){opening?.then(db=>db.close());opening=undefined;account=id;}}
let opening:Promise<IDBDatabase>|undefined;
function open(){return opening??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(`envia-shared-mobile-${account}`,1);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('outbox',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=undefined;reject(new Error('Le stockage local est indisponible. Gardez cette page ouverte.'));};});}
export async function get<T>(store:string,key:IDBValidKey):Promise<T|undefined>{const d=await open();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function put(store:string,value:unknown,key?:IDBValidKey){const d=await open();return new Promise<void>((res,rej)=>{const t=d.transaction(store,'readwrite');if(key===undefined)t.objectStore(store).put(value);else t.objectStore(store).put(value,key);t.oncomplete=()=>res();t.onerror=()=>rej(new Error('Espace local insuffisant. Votre signalement reste ouvert.'));});}
export async function remove(id:string){const d=await open();return new Promise<void>((res,rej)=>{const t=d.transaction('outbox','readwrite');t.objectStore('outbox').delete(id);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
export async function queue():Promise<QueuedReport[]>{const d=await open();return new Promise((res,rej)=>{const r=d.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export const cacheReports=(r:Report[])=>put('state',r,'reports');
