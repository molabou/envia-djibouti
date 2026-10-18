import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MapContainer, TileLayer, Marker, Popup, useMap} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

const API='http://localhost:8000';
const defaultIcon=new L.Icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});
const pointIcon=new L.DivIcon({className:'collection-pin',html:'♻',iconSize:[28,28],iconAnchor:[14,14]});

async function api(path, options={}){
  const token=localStorage.getItem('envia_token');
  const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}), ...(options.headers||{})};
  if(token) headers.Authorization=`Bearer ${token}`;
  const r=await fetch(API+path,{...options,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.detail||`Erreur ${r.status}`);
  return data;
}

function App(){
  const [user,setUser]=useState(()=>JSON.parse(localStorage.getItem('envia_user')||'null'));
  const [view,setView]=useState('dashboard');
  const [events,setEvents]=useState([]),[alerts,setAlerts]=useState([]),[points,setPoints]=useState([]),[stats,setStats]=useState(null);
  const [toast,setToast]=useState('');
  const refresh=async()=>{try{const [e,a,p,s]=await Promise.all([api('/api/v1/events'),api('/api/v1/alerts'),api('/api/v1/collection-points'),api('/api/v1/statistics')]);setEvents(e);setAlerts(a);setPoints(p);setStats(s)}catch(err){setToast(err.message)}};
  useEffect(()=>{if(user) refresh()},[user]);
  if(!user) return <Login onLogin={u=>setUser(u)}/>;
  const logout=()=>{localStorage.clear();setUser(null)};
  return <div className="app">
    <aside><div className="brand"><div className="logo">E</div><div><b>ENVIA</b><span>DJIBOUTI</span></div></div>
      <div className="profile"><strong>{user.display_name}</strong><small>{roleLabel(user.role)}</small></div>
      <nav>{[['dashboard','⌂','Dashboard'],['report','＋','Nouveau signalement'],['map','◉','Carte'],['events','▣','Événements'],['alerts','⚠','Alertes'],['stats','◫','Statistiques']].map(([id,ic,label])=><button className={view===id?'active':''} onClick={()=>setView(id)} key={id}><span>{ic}</span>{label}{id==='alerts'&&alerts.filter(a=>a.status==='open').length>0?<em>{alerts.filter(a=>a.status==='open').length}</em>:null}</button>)}</nav>
      <div className="tag">Observer. Collecter.<br/>Comprendre. Alerter. Protéger.</div><button className="logout" onClick={logout}>↪ Déconnexion</button>
    </aside>
    <main><header><div><small>PLATEFORME NATIONALE</small><h1>{titles[view]}</h1></div><div className="status">● Système opérationnel</div></header>
      {view==='dashboard'&&<Dashboard events={events} alerts={alerts} setView={setView}/>} 
      {view==='report'&&<Report user={user} onDone={async()=>{await refresh();setView('events')}}/>}
      {view==='map'&&<MapView events={events} points={points}/>} 
      {view==='events'&&<Events events={events} user={user} refresh={refresh}/>} 
      {view==='alerts'&&<Alerts alerts={alerts} refresh={refresh}/>} 
      {view==='stats'&&<Stats stats={stats}/>} 
    </main>{toast&&<div className="toast" onClick={()=>setToast('')}>{toast}</div>}
  </div>
}
const titles={dashboard:'Vue générale',report:'Nouveau signalement',map:'Carte environnementale',events:'Signalements',alerts:'Centre d’alertes',stats:'Statistiques'};
const roleLabel=r=>({admin:'Administrateur',expert:'Expert',ecogarde:'Écogarde',citizen:'Citoyen'}[r]||r);
function Login({onLogin}){const [username,setUsername]=useState('ecogarde'),[password,setPassword]=useState('ecogarde123'),[error,setError]=useState('');const go=async e=>{e.preventDefault();try{const d=await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username,password})});localStorage.setItem('envia_token',d.token);localStorage.setItem('envia_user',JSON.stringify(d.user));onLogin(d.user)}catch(err){setError(err.message)}};return <div className="login"><div className="loginCard"><div className="bigLogo">E</div><h1>ENVIA <span>DJIBOUTI</span></h1><p>Intelligence environnementale pour un Djibouti durable.</p><form onSubmit={go}><label>Identifiant<input value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Mot de passe<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button className="primary">SE CONNECTER</button></form><div className="demo">Démo : ecogarde / ecogarde123 · admin / admin123 · expert / expert123</div></div></div>}
function Dashboard({events,alerts,setView}){const high=events.filter(e=>['high','critical'].includes(e.priority)).length;return <><section className="cards"><Card title="Signalements" value={events.length} icon="◉"/><Card title="À vérifier" value={events.filter(e=>e.status==='pending').length} icon="⌁"/><Card title="Alertes ouvertes" value={alerts.filter(a=>a.status==='open').length} icon="⚠"/><Card title="Confirmés" value={events.filter(e=>e.status==='confirmed').length} icon="✓"/></section><section className="grid"><div className="panel hero"><div className="panelHead"><h2>Centre opérationnel</h2><button onClick={()=>setView('report')} className="smallBtn">+ Signaler</button></div><div className="heroText"><div><strong>{high}</strong><span>signalement(s) prioritaire(s)</span></div><div><strong>{events.filter(e=>e.category.includes('requin')).length}</strong><span>observation(s) requin</span></div><div><strong>{events.filter(e=>e.category.includes('Déchets')).length}</strong><span>signalement(s) déchets</span></div></div></div><div className="panel"><div className="panelHead"><h2>Derniers signalements</h2><button className="linkBtn" onClick={()=>setView('events')}>Voir tout</button></div><EventList events={events.slice(0,6)}/></div></section></>}
function Card({title,value,icon}){return <div className="card"><div className="ci">{icon}</div><div><span>{title}</span><strong>{value}</strong></div></div>}
function EventList({events}){if(!events.length)return <div className="empty">Aucun signalement pour le moment.</div>;return <div className="list">{events.map(e=><div className="row" key={e.id}><div className={`dot ${e.priority}`}></div><div className="grow"><b>{e.category}{e.subcategory?` · ${e.subcategory}`:''}</b><p>{e.description||'Sans description'}</p><small>{e.region||'Localisation GPS'} · {new Date(e.created_at).toLocaleString('fr-FR')}</small></div><span className={`badge ${e.status}`}>{statusLabel(e.status)}</span></div>)}</div>}
const statusLabel=s=>({pending:'À vérifier',confirmed:'Confirmé',rejected:'Rejeté'}[s]||s);
function Report({user,onDone}){
 const isEco=user.role==='ecogarde';
 const [cat,setCat]=useState('Déchets & pollution'),[desc,setDesc]=useState(''),[lat,setLat]=useState(''),[lon,setLon]=useState(''),[priority,setPriority]=useState('normal'),[photo,setPhoto]=useState(null),[audio,setAudio]=useState(null),[ai,setAi]=useState(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const gps=()=>navigator.geolocation?.getCurrentPosition(p=>{setLat(p.coords.latitude.toFixed(6));setLon(p.coords.longitude.toFixed(6))},()=>setMsg('GPS indisponible : saisissez la position manuellement.'));
 const analyze=async()=>{try{setAi(await api('/api/v1/ai/analyze',{method:'POST',body:JSON.stringify({description:desc,category_hint:isEco?'':cat})}))}catch(e){setMsg(e.message)}};
 const submit=async e=>{e.preventDefault();setBusy(true);try{const chosen=ai?.category||cat;const ev=await api('/api/v1/events',{method:'POST',body:JSON.stringify({category:chosen,description:desc||'Signalement créé depuis le mode écogarde.',latitude:Number(lat),longitude:Number(lon),priority,source:isEco?'ecogarde':'manual',reporter:user.display_name})});if(photo){const fd=new FormData();fd.append('file',photo);await api(`/api/v1/events/${ev.id}/media`,{method:'POST',body:fd})}if(audio){const fd=new FormData();fd.append('file',audio);await api(`/api/v1/events/${ev.id}/media`,{method:'POST',body:fd})}setMsg('Signalement enregistré avec succès.');setTimeout(onDone,700)}catch(e){setMsg(e.message)}finally{setBusy(false)}};
 return <div className="formPanel">{isEco?<div className="ecoMode"><div className="ecoTitle">📷 <strong>MODE ÉCOGARDE</strong></div><p>Prends une photo, récupère le GPS et ajoute une description vocale ou écrite si nécessaire. ENVIA prépare la fiche ; tu confirmes avant l’enregistrement.</p></div>:<div className="roleHint">Mode <strong>{roleLabel(user.role)}</strong> · Formulaire complet disponible.</div>}
 <form onSubmit={submit} className="form">
 {isEco?<div className="ecoButtons"><label className="photoBig">📷<strong>PRENDRE UNE PHOTO</strong><small>{photo?photo.name:'Photo recommandée'}</small><input type="file" accept="image/*" capture="environment" onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label><button type="button" className="secondary bigAction" onClick={gps}>📍 GPS AUTOMATIQUE{lat?` · ${lat}, ${lon}`:''}</button><label className="secondary audioAction">🎙️ AJOUTER UN AUDIO<input type="file" accept="audio/*" capture onChange={e=>setAudio(e.target.files?.[0]||null)}/></label></div>:<><div className="two"><label>Catégorie<select value={cat} onChange={e=>setCat(e.target.value)}>{['Déchets & pollution','Pollution marine','Eau','Biodiversité marine','Biodiversité terrestre','Incendie','Chaleur / climat','Habitat / écosystème','Pêche / capture de requin'].map(x=><option key={x}>{x}</option>)}</select></label><label>Priorité<select value={priority} onChange={e=>setPriority(e.target.value)}><option>normal</option><option>high</option><option>critical</option></select></label></div><div className="actions"><button type="button" className="secondary" onClick={gps}>📍 Récupérer mon GPS</button><label className="fileBtn">📷 Photo<input type="file" accept="image/*" capture="environment" onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label><label className="fileBtn">🎙️ Audio<input type="file" accept="audio/*" capture onChange={e=>setAudio(e.target.files?.[0]||null)}/></label></div></>}
 <label>Description / dictée<textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder={isEco?'Ex. J’ai trouvé un requin mort près de la plage d’Obock…':'Décrivez ce que vous avez observé…'}/></label>
 {isEco&&<div className="two"><label>Latitude<input value={lat} onChange={e=>setLat(e.target.value)} required/></label><label>Longitude<input value={lon} onChange={e=>setLon(e.target.value)} required/></label></div>}
 {!isEco&&<div className="two"><label>Latitude<input value={lat} onChange={e=>setLat(e.target.value)} required/></label><label>Longitude<input value={lon} onChange={e=>setLon(e.target.value)} required/></label></div>}
 <div className="aiBox"><div><strong>🤖 Assistance ENVIA-AI</strong><p>{ai?`${ai.category}${ai.subcategory?' · '+ai.subcategory:''} · confiance ${Math.round(ai.confidence*100)}% · validation humaine requise`:'Suggestion automatique à partir du texte ; aucune donnée manquante n’est inventée.'}</p></div><button type="button" className="secondary" onClick={analyze}>Analyser</button></div>
 {msg&&<div className="notice">{msg}</div>}<button disabled={busy} className="primary">{busy?'ENREGISTREMENT…':isEco?'CONFIRMER ET ENREGISTRER':'ENREGISTRER LE SIGNALEMENT'}</button>
 </form></div>
}
function MapView({events,points}){return <div className="panel mapPanel"><div className="panelHead"><h2>Djibouti · événements et points de collecte</h2><span>{events.length} signalements · {points.length} points</span></div><MapContainer center={[11.57,42.95]} zoom={8} scrollWheelZoom className="leafmap"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{events.map(e=><Marker key={'e'+e.id} position={[e.latitude,e.longitude]} icon={defaultIcon}><Popup><strong>{e.category}</strong><br/>{e.description||'Sans description'}<br/>Statut : {statusLabel(e.status)}</Popup></Marker>)}{points.map(p=><Marker key={'p'+p.id} position={[p.latitude,p.longitude]} icon={pointIcon}><Popup><strong>{p.name}</strong><br/>{p.city}<br/>{p.point_type} · {p.status}<br/>{p.info}</Popup></Marker>)}</MapContainer></div>}
function Events({events,user,refresh}){const confirm=async(id,status)=>{await api(`/api/v1/events/${id}`,{method:'PATCH',body:JSON.stringify({status})});refresh()};return <div className="panel"><div className="panelHead"><h2>{events.length} signalement(s)</h2><span>Validation humaine</span></div><EventList events={events}/>{(user.role==='admin'||user.role==='expert')&&<div className="tableActions">Pour valider, utilise l’API ou ouvre la fiche détaillée dans la prochaine itération.</div>}{events.slice(0,5).map(e=><div className="review" key={e.id}><span># {e.id}</span><strong>{e.category}</strong><small>{e.region||'GPS'} · {statusLabel(e.status)}</small>{e.status==='pending'&&<><button onClick={()=>confirm(e.id,'confirmed')}>Confirmer</button><button onClick={()=>confirm(e.id,'rejected')} className="danger">Rejeter</button></>}</div>)}</div>}
function Alerts({alerts,refresh}){return <div className="panel"><div className="panelHead"><h2>Alertes</h2><span>{alerts.filter(a=>a.status==='open').length} ouvertes</span></div>{!alerts.length?<div className="empty">Aucune alerte générée.</div>:alerts.map(a=><div className={`alert ${a.severity}`} key={a.id}><div><strong>{a.title}</strong><p>{a.message}</p><small>{new Date(a.created_at).toLocaleString('fr-FR')}</small></div>{a.status==='open'&&<button onClick={async()=>{await api(`/api/v1/alerts/${a.id}/close`,{method:'PATCH'});refresh()}}>Clôturer</button>}</div>)}</div>}
function Stats({stats}){if(!stats)return <div className="panel">Chargement…</div>;return <div className="statsGrid"><div className="panel"><h2>Par catégorie</h2>{Object.entries(stats.by_category).map(([k,v])=><Bar key={k} label={k} value={v} max={Math.max(...Object.values(stats.by_category))}/>)}</div><div className="panel"><h2>Par statut</h2>{Object.entries(stats.by_status).map(([k,v])=><Bar key={k} label={statusLabel(k)} value={v} max={stats.total||1}/>)}</div><div className="panel"><h2>Priorités</h2>{Object.entries(stats.by_priority).map(([k,v])=><Bar key={k} label={k} value={v} max={stats.total||1}/>)}</div></div>}
function Bar({label,value,max}){return <div className="bar"><div><span>{label}</span><b>{value}</b></div><i style={{width:`${Math.max(4,(value/max)*100)}%`}}/></div>}
createRoot(document.getElementById('root')).render(<App/>);
