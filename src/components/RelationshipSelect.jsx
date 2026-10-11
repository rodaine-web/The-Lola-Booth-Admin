import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function RelationshipSelect({ resource, value, onChange, placeholder = "Select", disabled = false, required = false, filters = {} }) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const filterQuery = new URLSearchParams(Object.entries(filters).filter(([,value]) => value)).toString();

  useEffect(() => {
    let live = true;
    api.get(`/pickers/${resource}?q=${encodeURIComponent(search)}&${filterQuery}`)
      .then((result) => {
        if (live) {setOptions(result.data || []);setError('');}
      })
      .catch((err) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [resource, search, filterQuery]);

  return (
    <div className="relationship-select">
      <input aria-label={`Search ${placeholder}`} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${placeholder.toLowerCase()}...`} />
      <select required={required} aria-label={placeholder} value={value || ""} disabled={disabled} onChange={(event) => onChange(event.target.value || null, options.find(option => option.id === event.target.value) || null)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}{option.subtitle ? ` - ${option.subtitle}` : ""}
          </option>
        ))}
      </select>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
