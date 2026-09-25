import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function RelationshipSelect({ resource, value, onChange, placeholder = "Select", disabled = false }) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.get(`/pickers/${resource}?q=${encodeURIComponent(search)}`)
      .then((result) => {
        if (live) {setOptions(result.data || []);setError('');}
      })
      .catch((err) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [resource, search]);

  return (
    <div className="relationship-select">
      <input aria-label={`Search ${placeholder}`} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${placeholder.toLowerCase()}...`} />
      <select aria-label={placeholder} value={value || ""} disabled={disabled} onChange={(event) => onChange(event.target.value || null)}>
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
