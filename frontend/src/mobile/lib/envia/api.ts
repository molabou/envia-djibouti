import type {Payload,Report,User} from './model';
export class ApiError extends Error {
 kind:'private_access'|'session'|'service';
 status:number;
 constructor(message:string,kind:'private_access'|'session'|'service'='service',status=0){super(message);this.name='ApiError';this.kind=kind;this.status=status;}
}
// Shared ENVIA FastAPI adapter; bearer token is also used by the Web.
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 let response:Response;
 try{response=await fetch(`/api-server/api/v1${path}`,{...options,credentials:'include',cache:'no-store',headers:{Accept:'application/json',...(localStorage.getItem('envia_token')?{Authorization:`Bearer ${localStorage.getItem('envia_token')}`} : {}),...(options.body instanceof FormData||options.body===undefined?{}:{'Content-Type':'application/json'}),...options.headers}});}
 catch{throw new ApiError('Connexion au service impossible. Vérifiez votre réseau ou vérifiez que ENVIA est démarré sur votre ordinateur.');}
 const contentType=response.headers.get('content-type')??'';
 const body=await response.text();
 if(!contentType.toLowerCase().includes('application/json')&&!contentType.toLowerCase().includes('+json')){
  if(body.trimStart().startsWith('<')&&(response.ok||response.redirected||response.status===401||response.status===403)){
   throw new ApiError('Le proxy de votre API ENVIA est indisponible. Vérifiez que le backend est démarré.','service',response.status);
  }
  throw new ApiError('Le service a renvoyé une réponse inattendue. Votre saisie est conservée ; vous pouvez réessayer.','service',response.status);
 }
 let data:T & {detail?:unknown;error?:unknown};
 try{data=JSON.parse(body);}catch{throw new ApiError('La réponse du service est incomplète. Votre saisie est conservée ; réessayez.','service',response.status);}
 if(!response.ok){const message=typeof data?.detail==='string'?data.detail:typeof data?.error==='string'?data.error:'Connexion au service impossible.';throw new ApiError(response.status===401?'Votre session a expiré. Reconnectez-vous ; vos signalements en attente sont conservés.':message,response.status===401?'session':'service',response.status);}
 return data;
}
function normalizeUser(u:User):User{return {...u,id:String(u.id)};}
function normalizeReport(r:Report):Report{return {...r,id:String(r.id),region:r.region||'Djibouti',history:r.history||[],media:(r.media||[]).map(m=>({...m,id:String(m.id),url:m.url.startsWith('/uploads/')?'/api-server'+m.url:m.url}))};}
export const api={
 login:async(username:string,password:string)=>{const result=await request<{token:string;user:User}>('/auth/login',{method:'POST',body:JSON.stringify({username,password})});localStorage.setItem('envia_token',result.token);localStorage.setItem('envia_user',JSON.stringify(result.user));return {user:normalizeUser(result.user)};},
 logout:async()=>{try{await request('/auth/logout',{method:'POST'});}finally{localStorage.removeItem('envia_token');localStorage.removeItem('envia_user');}},
 me:async()=>normalizeUser(await request<User>('/auth/me')),
 list:async()=>{const data=await request<Report[]>('/events');if(!Array.isArray(data))throw new ApiError('La liste des signalements est indisponible.');return data.map(normalizeReport);},
 create:async(payload:Payload,key:string)=>normalizeReport(await request<Report>('/events',{method:'POST',body:JSON.stringify(payload),headers:{'Idempotency-Key':key}})),
 upload:(id:string,file:File,key:string)=>{const f=new FormData();f.set('file',file);return request(`/events/${id}/media`,{method:'POST',body:f,headers:{'Idempotency-Key':key}});},
 advance:async(_id:string):Promise<Report>=>{throw new ApiError('Le statut est géré depuis le Web par un expert ou un administrateur.');}
};
