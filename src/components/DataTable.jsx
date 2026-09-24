import { useNavigate } from "react-router-dom";

export default function DataTable({ columns, rows, empty = "No records found.", getRowHref, onEdit }) {
  const navigate = useNavigate();

  if (!rows?.length) return <div className="empty-state">{empty}</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{labelize(column)}</th>)}
            {onEdit && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={getRowHref ? "clickable-row" : ""}
              tabIndex={getRowHref ? 0 : undefined}
              aria-label={getRowHref ? `Open ${String(row[columns[0]] || "record")}` : undefined}
              onKeyDown={event => { if (getRowHref && event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); navigate(getRowHref(row)); } }}
              onClick={() => getRowHref && navigate(getRowHref(row))}
            >
              {columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}
              {onEdit && <td><button className="table-action" onClick={(event) => { event.stopPropagation(); onEdit(row); }}>Edit</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function labelize(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Active" : "Inactive";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleDateString();
  return value;
}
