import {CheckCircle2,AlertTriangle,XCircle,Info,MinusCircle} from 'lucide-react';
import {statusTone,labelize} from '../utils/display.js';
export default function StatusBadge({status,label}){const tone=statusTone(status);const Icon={success:CheckCircle2,warning:AlertTriangle,danger:XCircle,info:Info,neutral:MinusCircle}[tone];return <span className={`semantic-status semantic-${tone}`}><Icon size={14} aria-hidden="true"/>{label||labelize(status)||'Not set'}</span>;}
