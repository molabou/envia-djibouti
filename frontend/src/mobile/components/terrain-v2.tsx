import {useState} from 'react';
import {Camera,MapPin,Send,ShieldCheck} from 'lucide-react';
import {put} from '@/lib/envia/offline';
import type {QueuedReport,Payload} from '@/lib/envia/model';

const endpoint='/api-server/api/v1';
function gps():Promise<GeolocationPosition>{return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:20000,maximumAge:0}));}
function auth(){return {Authorization:`Bearer ${localStorage.getItem('envia_token')||''}`};}
export default function TerrainV2({onSaved}:{onSaved:()=>Promise<void>}){
 const [mode,setMode]=useState<'simple'|'assisted'>('simple');
 const [file,setFile]=useState<File|null>(null);
 const [category,setCategory]=useState('habitat');
 const [description,setDescription]=useState('Observation photographique en attente de classification et validation par un expert.');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 async function send(){if(!file)return;setBusy(true);setMessage('Localisation GPS en cours…');try{
   const position=await gps();const cat=category,desc=description;
   const payload:Payload={category:cat,description:desc,latitude:position.coords.latitude,longitude:position.coords.longitude,priority:'medium',source:'field',region:'Obock'};
   const item:QueuedReport={id:crypto.randomUUID(),payload,files:[{id:crypto.randomUUID(),file,uploaded:false}],created_at:new Date().toISOString()};
   await put('outbox',item);await onSaved();setFile(null);setMessage('Photo et GPS enregistrés. Synchronisation et validation experte à suivre.');
 }catch(e){setMessage(e instanceof GeolocationPositionError?'Autorisez le GPS avant d’envoyer.':e instanceof Error?e.message:'Enregistrement impossible.');}finally{setBusy(false);}}
 async function saveNest(){setBusy(true);try{const p=await gps();const r=await fetch(`${endpoint}/turtle-nests`,{method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy_m:p.coords.accuracy})});if(!r.ok)throw new Error('Connexion nécessaire ou accès non autorisé.');setMessage('Nid enregistré confidentiellement. Les coordonnées ne sont visibles que par les experts.');}catch(e){setMessage(e instanceof Error?e.message:'GPS indisponible.');}finally{setBusy(false);}}
 return <section style={{padding:20,maxWidth:640,margin:'auto'}}>
 <h2>ENVIA · Terrain intelligent</h2>
 <p>Photographiez et envoyez votre observation.</p>
 <div style={{display:'flex',gap:10,marginBottom:20}}><button className={mode==='simple'?'primary':'secondary'} onClick={()=>setMode('simple')}>📷 Simplifié</button><button className={mode==='assisted'?'primary':'secondary'} onClick={()=>setMode('assisted')}>✏️ Assisté</button></div>
 <label style={{display:'block',padding:24,border:'2px dashed #458b70',borderRadius:16,textAlign:'center',cursor:'pointer'}}><Camera size={50} style={{margin:'auto'}}/><strong style={{display:'block',fontSize:22}}>Prendre une photo</strong><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{setFile(e.target.files?.[0]||null);setCategory('habitat');setDescription('Observation photographique en attente de classification et validation par un expert.');}} style={{marginTop:12,maxWidth:'100%'}}/></label>
 {file&&<p>📷 {file.name}</p>}
 {mode==='assisted'&&<div style={{marginTop:16}}><label>Catégorie proposée (modifiable)<select value={category} onChange={e=>setCategory(e.target.value)} style={{display:'block',width:'100%',padding:12}}>{[['habitat','Habitat'],['waste','Déchets'],['marine_pollution','Pollution marine'],['marine_biodiversity','Biodiversité marine'],['terrestrial_biodiversity','Biodiversité terrestre'],['water','Eau'],['fire','Incendie'],['climate','Climat'],['shark','Pêche']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} style={{display:'block',width:'100%',minHeight:100,padding:12}}/></label><small>L’expert vérifiera le signalement après l’envoi.</small></div>}
 <button className="primary" style={{width:'100%',marginTop:20,padding:22,fontSize:22}} onClick={send} disabled={!file||busy}><Send/> {busy?'Patientez…':'ENVOYER'}</button>
 <hr style={{margin:'30px 0'}}/><h3><ShieldCheck/> Biodiversité confidentielle</h3><p>Marquer un nid de tortue (GPS réservé aux experts)</p><button className="secondary" disabled={busy||!navigator.onLine} onClick={saveNest}><MapPin/> Enregistrer un nid</button>
 {message&&<p role="status" style={{marginTop:16}}>{message}</p>}
 </section>;
}
