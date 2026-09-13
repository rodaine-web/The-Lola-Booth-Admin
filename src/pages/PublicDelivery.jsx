import { ExternalLink, Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function PublicDelivery() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/delivery/${token}`).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || "Delivery link unavailable.");
      setPayload(data);
    }).catch((err) => setError(err.message));
  }, [token]);

  if (error) return <PublicShell><div className="empty-state">Delivery link unavailable.</div></PublicShell>;
  if (!payload) return <PublicShell><div className="empty-state">Opening delivery...</div></PublicShell>;
  const delivery = payload.delivery;

  return (
    <PublicShell>
      <div className="public-heading">
        <p className="eyebrow">LOLA Delivery</p>
        <h1>{delivery.event_name}</h1>
        <p className="lede">{delivery.event_date || "Your event"} · Good people. Better photos.</p>
      </div>
      <section className="panel">
        <h2>Your Photos Are Ready</h2>
        <p className="note-text">{delivery.thank_you_message || "Thank you for having LOLA be part of your event."}</p>
        {delivery.expires_at && <p className="note-text">Available until {new Date(delivery.expires_at).toLocaleDateString()}.</p>}
      </section>
      <section className="detail-grid">
        {payload.items.map((item) => (
          <article className="panel" key={item.id}>
            <h2>{item.label}</h2>
            <p className="note-text">{item.item_type.replaceAll("_", " ")}</p>
            {item.url && <a className="primary-action" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open</a>}
          </article>
        ))}
      </section>
      {delivery.review_url && (
        <section className="public-success">
          <Heart size={22} />
          <div>
            <h2>Loved your LOLA experience?</h2>
            <p><a className="inline-link" href={delivery.review_url}>Leave us a review</a></p>
          </div>
        </section>
      )}
      <p className="note-text">Need help? Contact {delivery.contact_email || "the LOLA team"}{delivery.contact_phone ? ` · ${delivery.contact_phone}` : ""}</p>
    </PublicShell>
  );
}

function PublicShell({ children }) {
  return <main className="public-document"><div className="brand large public-brand"><img className="brand-logo brand-logo-public-stacked" src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" /><div><strong>LOLA Booths</strong><span>Good people. Better photos.</span></div></div>{children}</main>;
}
