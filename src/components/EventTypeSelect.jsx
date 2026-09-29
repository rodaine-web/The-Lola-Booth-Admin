import {useEffect, useState} from 'react';
import {api} from '../api/client.js';
export default function EventTypeSelect({value = '', onChange, required = false}) {
  const [names, setNames] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.get('/lookups/event-types').then(result => { if (active) setNames(result.data.map(row => row.name)); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  return <><select aria-label="Event type" required={required} value={value} onChange={event => onChange(event.target.value)}><option value="">Select event type…</option>{value && !names.includes(value) && <option value={value}>{value}</option>}{names.map(name => <option key={name} value={name}>{name}</option>)}</select>{error && <small role="alert">{error}</small>}</>;
}
