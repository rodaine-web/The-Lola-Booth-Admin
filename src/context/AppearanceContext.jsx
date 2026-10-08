import {createContext,useContext,useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {DEFAULT_APPEARANCE,normalizeAppearance,appearanceMode,APPEARANCE_PALETTES} from '../../shared/admin-appearance.js';
const AppearanceContext=createContext(null);
export function AppearanceProvider({children}){
 const [saved,setSaved]=useState({...DEFAULT_APPEARANCE}),[preview,setPreview]=useState(null),[deviceDark,setDeviceDark]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api.get('/preferences/appearance').then(value=>active&&setSaved(normalizeAppearance(value))).catch(e=>active&&setError(e.message));return()=>{active=false;};},[]);
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const change=()=>setDeviceDark(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const current=preview||saved,mode=appearanceMode(current.mode,deviceDark);
 const style={'--admin-background':current.background,...Object.fromEntries(APPEARANCE_PALETTES[current.palette].map((color,i)=>[`--chart-${i}`,color]))};
 async function save(value){const updated=await api.patch('/preferences/appearance',value);setSaved(normalizeAppearance(updated));setPreview(null);setError('');}
 return <AppearanceContext.Provider value={{saved,current,setPreview,save,error}}><div className={`admin-appearance ${mode==='NIGHT'?'admin-night':'admin-day'}`} style={style}>{children}</div></AppearanceContext.Provider>;
}
export const useAppearance=()=>useContext(AppearanceContext);
