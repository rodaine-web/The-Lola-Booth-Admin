import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
const API=import.meta.env.VITE_API_URL||'/api';
const Photos=createContext(null),storage='lola-keepsakes-photo-session';
export async function photoRequest(path,body,token){
 const response=await fetch(`${API}/keepsakes/photos/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',referrerPolicy:'no-referrer'});
 const value=await response.json();if(!response.ok)throw Error(value.message||value.error?.message||'Photo access is unavailable. Please request a new link.');return value;
}
export function KeepsakesPhotos({children}){
 const [token,setToken]=useState(()=>sessionStorage.getItem(storage)||''),[collection,setCollection]=useState(null),[selected,setSelected]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(storage+'-selection')||'[]');}catch{return [];}}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const cache=useRef(new Map()),generation=useRef(0);
 useEffect(()=>{sessionStorage.setItem(storage+'-selection',JSON.stringify(selected));},[selected]);
 const accept=useCallback(value=>{sessionStorage.setItem(storage,value);setToken(value);setSelected([]);},[]);
 useEffect(()=>{
  const current=++generation.current;setCollection(null);setError('');setLoading(Boolean(token));
  for(const pending of cache.current.values())pending.then(url=>URL.revokeObjectURL(url)).catch(()=>{});cache.current.clear();
  if(token)photoRequest('collection',null,token).then(value=>{if(current!==generation.current)return;setCollection(value);setSelected(ids=>ids.filter(id=>value.assets.some(a=>a.id===id)));}).catch(e=>{if(current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[token]);
 useEffect(()=>()=>{for(const pending of cache.current.values())pending.then(url=>URL.revokeObjectURL(url)).catch(()=>{});},[]);
 const handoff=useCallback(target=>photoRequest('handoff',{target,selected},token),[selected,token]);
 const loadPhoto=useCallback(asset=>{
  if(!asset||!token)return Promise.reject(Error('Choose your photo'));
  const key=token+':'+asset.id;if(cache.current.has(key))return cache.current.get(key);
  const path=asset.url.replace(/^\/api/,API.replace(/\/$/,''));
  const pending=fetch(path,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',referrerPolicy:'no-referrer'}).then(async response=>{if(!response.ok)throw Error('Photo preview unavailable');return URL.createObjectURL(await response.blob());});
  cache.current.set(key,pending);pending.catch(()=>cache.current.delete(key));return pending;
 },[token]);
 const commerce=useCallback(async(path,body)=>{const response=await fetch(`${API}/keepsakes/books/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',referrerPolicy:'no-referrer'});const data=await response.json();if(!response.ok)throw Error(data.error?.message||data.message||'Book unavailable.');return data;},[token]);
 return <Photos.Provider value={{commerce,collection,selected,setSelected,accept,handoff,loadPhoto,error,loading,hasSession:Boolean(token)}}>{children}</Photos.Provider>;
}
export const useKeepsakesPhotos=()=>useContext(Photos);
export function GuestPhoto({asset,...props}){
 const {loadPhoto}=useKeepsakesPhotos(),[src,setSrc]=useState(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;setSrc(null);setFailed(false);if(asset)loadPhoto(asset).then(url=>{if(active)setSrc(url);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[asset?.id,loadPhoto]);
 return src?<img {...props} src={src}/>:<span className="shop-photo-loading" role="status">{failed?'Photo unavailable':'Loading your photo…'}</span>;
}
