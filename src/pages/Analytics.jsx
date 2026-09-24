import AsyncState from "../components/AsyncState.jsx";
import { formatDisplay, formatMoney } from "../utils/display.js";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";

export default function Analytics() {
  const [data, setData] = useState(null);
  const [error,setError]=useState(""),[range,setRange]=useState("mtd"),[revision,setRevision]=useState(0);

  useEffect(() => {
    setError(""); api.get(`/analytics?range=${range}`).then(setData).catch(e=>setError(e.message));
  }, [range,revision]);

  if(error)return <main className="page"><AsyncState error={error} noun="analytics" onRetry={()=>setRevision(r=>r+1)}/></main>;
  if (!data) return <main className="page"><div className="empty-state">Loading analytics...</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>Analytics</h1>
        </div>
      </div>
      <label>Date range<select value={range} onChange={e=>setRange(e.target.value)}><option value="today">Today</option><option value="week">This week</option><option value="mtd">Month to date</option><option value="ytd">Year to date</option></select></label><p className="note-text">Revenue and average booking value share the Dashboard definitions and selected period. Outstanding is the current unpaid balance.</p>
      <section className="kpi-grid compact">
        {Object.entries(data.summary).map(([key, value]) => (
          <article className="kpi" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{formatDisplay(value,key)}</strong></article>
        ))}
      </section>
      <section className="chart-grid">
        <Chart title="Revenue by Month" data={data.revenueByMonth} x="month" y="revenue" />
        <Chart title="Bookings by Package" data={data.bookingsByPackage} x="name" y="bookings" />
        <Chart title="Bookings by Experience" data={data.bookingsByExperience} x="name" y="bookings" />
        <Chart title="Lead Source Performance" data={data.leadSourcePerformance} x="source" y="leads" />
      </section>
    </main>
  );
}

function Chart({ title, data, x, y }) {
  return (
    <section className="panel chart-panel">
      <h2>{title}</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid stroke="#eee8df" />
          <XAxis dataKey={x} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={value=>y==='revenue'?formatMoney(value):value}/>
          <Bar dataKey={y} fill="#B89B6B" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
