import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";

export default function Analytics() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics").then(setData);
  }, []);

  if (!data) return <main className="page"><div className="empty-state">Loading analytics...</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>Analytics</h1>
        </div>
      </div>
      <section className="kpi-grid compact">
        {Object.entries(data.summary).map(([key, value]) => (
          <article className="kpi" key={key}><span>{key.replaceAll("_", " ")}</span><strong>{String(value)}</strong></article>
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
          <Tooltip />
          <Bar dataKey={y} fill="#B89B6B" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
