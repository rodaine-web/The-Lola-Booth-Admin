import AgreementList from '../components/AgreementList.jsx';
import {useAuth} from '../context/AuthContext.jsx';
export default function Agreements(){const {can}=useAuth();return <main className="page"><h1>Agreements</h1><p>Find client agreements, review their status and download the branded PDF.</p>{can('read:sales')?<AgreementList/>:<p role="alert">You do not have permission to view agreements.</p>}</main>;}
