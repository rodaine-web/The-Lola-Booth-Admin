import { formatDisplay, labelize } from "../utils/display.js";
import StatusBadge from "./StatusBadge.jsx";
import { useNavigate } from "react-router-dom";

export default function DataTable({ columns, rows, empty = "No records found.", getRowHref, onEdit, onView, columnLabels = {}, rowActions, renderCell, selection, onSort, sortKey, sortDirection, compactActions=false }) {
  const navigate = useNavigate();

  if (!rows?.length) return <div className="empty-state">{empty}</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selection && <th className="record-select-cell"><input type="checkbox" aria-label="Select displayed records" checked={rows.length>0&&rows.every(row=>selection.ids.includes(row.id))} onChange={event=>selection.toggleAll(rows,event.target.checked)}/></th>}
            {columns.map((column) => <th key={column} aria-sort={onSort?(sortKey===column?(sortDirection===1?"ascending":"descending"):"none"):undefined}>{onSort?<button className="record-header-sort" onClick={()=>onSort(column)}>{columnLabels[column] || labelize(column)}<span aria-hidden="true">{sortKey===column?(sortDirection===1?'↑':'↓'):'↕'}</span></button>:columnLabels[column] || labelize(column)}</th>)}
            {(onEdit || onView || rowActions || (compactActions&&getRowHref)) && <th><span className="sr-only">Actions</span></th>}
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
              {selection && <td className="record-select-cell" onClick={event=>event.stopPropagation()}><input type="checkbox" aria-label={`Select ${String(row.name||row.title||row.event_name||row.proposal_number||row.invoice_number||'record')}`} checked={selection.ids.includes(row.id)} onChange={event=>selection.toggle(row.id,event.target.checked)}/></td>}
              {columns.map((column) => <td key={column}>{renderCell?.(row,column) ?? (/(^status$|_status$)/.test(column) ? <StatusBadge status={row[column]} /> : formatDisplay(row[column],column))}</td>)}
              {(onEdit || onView || rowActions || (compactActions&&getRowHref)) && <td onClick={event=>event.stopPropagation()}>{compactActions?<details className="record-row-menu"><summary aria-label={`Actions for ${row.name||row.title||row.event_name||row.proposal_number||row.invoice_number||'record'}`}>•••</summary><div>{getRowHref&&<button onClick={()=>navigate(getRowHref(row))}>View details</button>}{onView&&<button onClick={()=>onView(row)}>History</button>}{onEdit&&<button onClick={()=>onEdit(row)}>Edit</button>}{rowActions?.(row)}</div></details>:<>{onView && <button className="table-action" onClick={()=>onView(row)}>History</button>}{onEdit && <button className="table-action" onClick={()=>onEdit(row)}>Edit</button>}{rowActions?.(row)}</>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
