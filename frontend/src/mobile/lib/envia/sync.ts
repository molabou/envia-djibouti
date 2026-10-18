import {api} from './api';
import {queue,put,remove} from './offline';
let running=false;
export async function syncQueue(canSync:()=>boolean){if(running||!canSync())return {sent:0};running=true;let sent=0;try{for(const item of await queue()){if(!canSync())break;try{if(!item.server_id){const event=await api.create(item.payload,item.id);item.server_id=event.id;await put('outbox',item);}
 for(const m of item.files){if(m.uploaded)continue;if(!canSync())throw new Error('Connexion interrompue.');await api.upload(item.server_id,m.file,m.id);m.uploaded=true;await put('outbox',item);}
 await remove(item.id);sent++;
 }catch(e){item.error=e instanceof Error?e.message:'Synchronisation interrompue.';await put('outbox',item);break;}}
 return {sent};}finally{running=false;}}
