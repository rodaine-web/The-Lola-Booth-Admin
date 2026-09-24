import { formatDisplay, labelize } from "../utils/display.js";
import StatusBadge from "./StatusBadge.jsx";
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
              {columns.map((column) => <td key={column}>{/(^status$|_status$)/.test(column) ? <StatusBadge status={row[column]} /> : formatDisplay(row[column],column)}</td>)}
              {onEdit && <td><button className="table-action" onClick={(event) => { event.stopPropagation(); onEdit(row); }}>Edit</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
