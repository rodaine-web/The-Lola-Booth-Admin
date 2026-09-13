import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";
import { logger } from "../src/config/logger.js";

const permissions = [
  "*",
  "read:dashboard", "read:admin",
  "read:sales", "write:sales",
  "read:events", "write:events",
  "read:operations", "write:operations",
  "event.operations.view", "event.operations.manage",
  "event.checklist.manage",
  "event.incident.create", "event.incident.manage",
  "equipment.checkout", "equipment.return", "equipment.override",
  "staff.brief.send", "gallery.delivery.send",
  "read:finance", "write:finance",
  "read:content", "write:content",
  "read:tasks", "write:tasks",
  "read:analytics",
  "read:audit",
  "read:settings", "write:settings",
  "read:integrations", "write:integrations",
  "read:website", "write:website", "publish:website",
  "read:notifications", "write:notifications",
  "issue:refunds",
  "read:attendant"
];

const rolePermissions = {
  OWNER: ["*"],
  ADMIN: permissions.filter((key) => key !== "*"),
  SALES: ["read:dashboard", "read:sales", "write:sales", "read:events", "read:content", "read:tasks", "write:tasks"],
  EVENT_MANAGER: ["read:dashboard", "read:events", "write:events", "read:operations", "write:operations", "event.operations.view", "event.operations.manage", "event.checklist.manage", "event.incident.create", "event.incident.manage", "equipment.checkout", "equipment.return", "staff.brief.send", "gallery.delivery.send", "read:content", "read:tasks", "write:tasks", "read:notifications", "write:notifications"],
  ATTENDANT: ["read:attendant", "event.operations.view", "event.checklist.manage", "event.incident.create", "equipment.checkout", "equipment.return", "read:notifications"]
};

async function upsertOne(client, sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const key of permissions) {
      await client.query("INSERT INTO permissions (key) VALUES ($1) ON CONFLICT (key) DO NOTHING", [key]);
    }

    for (const [role, allowed] of Object.entries(rolePermissions)) {
      const roleRow = await upsertOne(client, "INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET updated_at=now() RETURNING *", [role]);
      for (const key of allowed) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE key=$2
           ON CONFLICT DO NOTHING`,
          [roleRow.id, key]
        );
      }
    }

    const hash = await bcrypt.hash("LolaAdmin!2026", 12);
    const owner = await upsertOne(
      client,
      `INSERT INTO users (name, email, password_hash)
       VALUES ('LOLA Owner', 'owner@lolabooths.com', $1)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, active=true, updated_at=now()
       RETURNING *`,
      [hash]
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name='OWNER'
       ON CONFLICT DO NOTHING`,
      [owner.id]
    );

    const experiences = [
      ["LOLA Glam", "lola-glam", "Editorial glam photo booth experience with polished beauty lighting.", "499.00", 3, ["glam booth", "lighting kit"], 1],
      ["LOLA 360", "lola-360", "Immersive 360 video activation for high-energy events.", "799.00", 3, ["360 booth", "lighting kit"], 1],
      ["LOLA Vogue", "lola-vogue", "A luxe magazine-style booth moment with striking stills and motion.", "899.00", 3, ["vogue setup", "lighting kit"], 1],
      ["LOLA Audio Guestbook", "lola-audio-guestbook", "A nostalgic phone-based audio guestbook for messages and memories.", "299.00", 4, ["audio phone"], 0],
      ["Digital Booth", "digital-booth", "A compact digital sharing booth for modern, social-first events.", "399.00", 3, ["digital booth"], 1],
      ["Corporate / Brand Activation", "corporate-custom", "Tailored brand activations, capture workflows, and custom deliverables.", "0.00", 4, ["custom"], 1]
    ];
    for (const item of experiences) {
      await client.query(
        `INSERT INTO experiences (name, slug, description, base_price, default_duration, equipment_required, staff_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, base_price=EXCLUDED.base_price, updated_at=now()`,
        [item[0], item[1], item[2], item[3], item[4], JSON.stringify(item[5]), item[6]]
      );
    }

    const packages = [
      ["THE ESSENTIAL", "A refined photo booth foundation for intimate celebrations.", "499.00", 2, 1, ["2 hours", "Digital gallery", "Instant sharing", "On-site attendant"]],
      ["THE SIGNATURE", "LOLA's most booked experience for polished events.", "799.00", 3, 2, ["3 hours", "Glam or Vogue", "GIFs", "Boomerangs", "Instant sharing", "Custom print design", "Props", "On-site attendant"]],
      ["THE LUXE", "A fuller premium package for statement events and elevated guest flow.", "1099.00", 4, 3, ["4 hours", "Premium backdrop", "Custom print design", "Guestbook option", "Priority delivery", "On-site attendant"]],
      ["CUSTOM", "Custom quote for brand activations, corporate needs, and multi-booth events.", "0.00", null, 4, ["Custom scope", "Custom duration", "Custom staffing", "Custom deliverables"]]
    ];
    for (const item of packages) {
      const pkg = await upsertOne(
        client,
        `INSERT INTO packages (name, description, starting_price, duration, display_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        item.slice(0, 5)
      );
      const packageRow = pkg || (await client.query("SELECT * FROM packages WHERE name=$1", [item[0]])).rows[0];
      await client.query("DELETE FROM package_items WHERE package_id=$1", [packageRow.id]);
      for (const [index, label] of item[5].entries()) {
        await client.query("INSERT INTO package_items (package_id, label, display_order) VALUES ($1,$2,$3)", [packageRow.id, label, index]);
      }
    }

    const addons = [
      ["Extra Hour", "Extend booth coverage by one hour.", "150.00", "PER_HOUR"],
      ["Premium Backdrop", "Upgrade to a premium backdrop selection.", "250.00", "FIXED"],
      ["Additional Prints", "Add extra print volume for larger guest counts.", "100.00", "FIXED"],
      ["Guestbook", "Printed keepsake guestbook with guest notes.", "175.00", "FIXED"],
      ["Audio Guestbook", "Add audio messages to the event experience.", "299.00", "FIXED"],
      ["Custom Signage", "Event signage tailored to the brand or celebration.", "200.00", "FIXED"],
      ["Branding", "Brand-forward overlays, microsite copy, or sponsor treatment.", "300.00", "FIXED"],
      ["Data Capture", "Lead capture and export for corporate activations.", "350.00", "FIXED"],
      ["Rush Delivery", "Prioritized gallery and file delivery.", "125.00", "FIXED"],
      ["Travel", "Travel outside standard service area.", "0.00", "CUSTOM"]
    ];
    for (const addon of addons) {
      await client.query(
        `INSERT INTO addons (name, description, price, pricing_type)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        addon
      );
    }

    const equipment = [
      ["EQ-GLAM-001", "Glam Booth #1", "Booth"],
      ["EQ-GLAM-002", "Glam Booth #2", "Booth"],
      ["EQ-360-001", "360 Booth #1", "Booth"],
      ["EQ-VOGUE-001", "Vogue Setup #1", "Booth"],
      ["EQ-AUDIO-001", "Audio Phone #1", "Audio"],
      ["EQ-AUDIO-002", "Audio Phone #2", "Audio"],
      ["EQ-PRINTER-001", "Printer #1", "Printer"],
      ["EQ-PRINTER-002", "Printer #2", "Printer"],
      ["EQ-BACKDROP-001", "Backdrop Stand #1", "Backdrop"],
      ["EQ-LIGHT-001", "Lighting Kit #1", "Lighting"]
    ];
    for (const item of equipment) {
      await client.query(
        `INSERT INTO equipment (equipment_id, name, category, status)
         VALUES ($1,$2,$3,'AVAILABLE')
         ON CONFLICT (equipment_id) DO NOTHING`,
        item
      );
    }

    const clientRow = await upsertOne(
      client,
      `INSERT INTO clients (name,email,phone,company,billing_address,client_type,referral_source)
       VALUES ('Avery Williams','avery@example.com','555-0142',null,'Dallas, TX','INDIVIDUAL','Instagram')
       ON CONFLICT DO NOTHING RETURNING *`,
      []
    ) || (await client.query("SELECT * FROM clients WHERE email='avery@example.com'")).rows[0];

    const signature = (await client.query("SELECT id FROM packages WHERE name='THE SIGNATURE'")).rows[0];
    const glam = (await client.query("SELECT id FROM experiences WHERE slug='lola-glam'")).rows[0];

    let event = (await client.query("SELECT * FROM events WHERE event_name='Avery + Jordan Wedding' AND deleted_at IS NULL LIMIT 1")).rows[0];
    if (!event) {
      event = await upsertOne(
      client,
      `INSERT INTO events (event_name, client_id, event_type, event_date, start_time, end_time, setup_time, breakdown_time, venue_name, venue_address, guest_count, package_id, experience_id, status, internal_notes)
       VALUES ('Avery + Jordan Wedding', $1, 'Wedding', current_date + interval '18 days', '18:00', '22:00', '16:30', '23:00', 'The Mason Dallas', '123 Commerce St, Dallas, TX', 175, $2, $3, 'CONFIRMED', 'Confirm backdrop selection one week prior.')
       RETURNING *`,
      [clientRow.id, signature.id, glam.id]
      );
    }

    await client.query(
      `INSERT INTO bookings (event_id, client_id, subtotal, add_ons_total, travel_fee, custom_charges, discount, total, deposit_required, amount_paid, balance_due, payment_status)
       SELECT $1,$2,799,250,50,0,0,1099,329.70,329.70,769.30,'PARTIAL'
       WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE event_id=$1 AND deleted_at IS NULL)`,
      [event.id, clientRow.id]
    );

    await client.query(
      `INSERT INTO leads (first_name,last_name,email,phone,event_date,event_start_time,event_end_time,event_type,guest_count,city,state,preferred_experience_id,preferred_package_id,referral_source,message,lead_source,status,assigned_user_id)
       SELECT 'Mia','Chen','mia@example.com','555-0199',current_date + interval '45 days','19:00','23:00','Corporate Gala',250,'Austin','TX',$1,$2,'Planner referral','Looking for Vogue or Glam with branded prints.','WEBSITE','NEW',$3
       WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email='mia@example.com' AND deleted_at IS NULL)`,
      [glam.id, signature.id, owner.id]
    );

    await client.query("INSERT INTO tasks (title, description, due_date, assigned_user_id, status, priority) VALUES ('Call new lead', 'Qualify event scope and preferred experience.', current_date - interval '1 day', $1, 'OPEN', 'HIGH') ON CONFLICT DO NOTHING", [owner.id]);
    await client.query("INSERT INTO business_settings (business_email, phone, website, service_area) SELECT 'hello@lolabooths.com', '(555) 010-LOLA', 'https://lolabooths.com', 'Dallas-Fort Worth and destination events' WHERE NOT EXISTS (SELECT 1 FROM business_settings)");

    await client.query("UPDATE packages SET most_popular = (name = 'THE SIGNATURE')");

    const staff = [
      ["Jordan Lee", "jordan.staff@lolabooths.com", "555-0201", "LEAD_ATTENDANT"],
      ["Sam Rivera", "sam.staff@lolabooths.com", "555-0202", "ATTENDANT"],
      ["Taylor Brooks", "taylor.staff@lolabooths.com", "555-0203", "EVENT_MANAGER"],
      ["Morgan Lane", "morgan.staff@lolabooths.com", "555-0204", "ATTENDANT"]
    ];
    for (const member of staff) {
      await client.query(
        `INSERT INTO staff_profiles (name, email, phone, role)
         SELECT $1,$2,$3,$4
         WHERE NOT EXISTS (SELECT 1 FROM staff_profiles WHERE email=$2 AND deleted_at IS NULL)`,
        member
      );
    }

    const extraClients = [
      ["Harper Stone", "harper@example.com", "555-0301", null, "Plano, TX", "INDIVIDUAL", "Google"],
      ["NOVA Events", "events@nova.test", "555-0302", "NOVA Events", "Austin, TX", "PLANNER", "Planner referral"],
      ["Oak & Pearl", "hello@oakpearl.test", "555-0303", "Oak & Pearl", "Fort Worth, TX", "VENUE", "Venue partner"],
      ["Camila Reyes", "camila@example.com", "555-0304", null, "Dallas, TX", "INDIVIDUAL", "Instagram"],
      ["Brightline Co.", "people@brightline.test", "555-0305", "Brightline Co.", "Frisco, TX", "CORPORATE", "LinkedIn"],
      ["Elena Park", "elena@example.com", "555-0306", null, "McKinney, TX", "INDIVIDUAL", "TikTok"],
      ["Monarch Studio", "bookings@monarch.test", "555-0307", "Monarch Studio", "Dallas, TX", "CORPORATE", "Repeat client"]
    ];
    for (const row of extraClients) {
      await client.query(
        `INSERT INTO clients (name,email,phone,company,billing_address,client_type,referral_source)
         SELECT $1,$2,$3,$4,$5,$6,$7
         WHERE NOT EXISTS (SELECT 1 FROM clients WHERE email=$2 AND deleted_at IS NULL)`,
        row
      );
    }

    const essential = (await client.query("SELECT id FROM packages WHERE name='THE ESSENTIAL'")).rows[0];
    const luxe = (await client.query("SELECT id FROM packages WHERE name='THE LUXE'")).rows[0];
    const custom = (await client.query("SELECT id FROM packages WHERE name='CUSTOM'")).rows[0];
    const vogue = (await client.query("SELECT id FROM experiences WHERE slug='lola-vogue'")).rows[0];
    const booth360 = (await client.query("SELECT id FROM experiences WHERE slug='lola-360'")).rows[0];
    const corporate = (await client.query("SELECT id FROM experiences WHERE slug='corporate-custom'")).rows[0];

    const leadRows = [
      ["Noah", "Bennett", "noah@example.com", "555-0401", 7, "18:00", "21:00", "Birthday", 80, "Dallas", "TX", glam.id, essential.id, "Instagram", "Interested in Glam for a milestone birthday.", "NEW"],
      ["Lina", "Patel", "lina@example.com", "555-0402", 12, "17:00", "22:00", "Wedding", 140, "Plano", "TX", vogue.id, signature.id, "Google", "Would like Vogue and prints.", "CONTACTED"],
      ["Andre", "Cole", "andre@example.com", "555-0403", 20, "19:00", "23:00", "Corporate Party", 300, "Frisco", "TX", booth360.id, luxe.id, "LinkedIn", "Looking for a 360 booth activation.", "QUALIFIED"],
      ["Priya", "Shah", "priya@example.com", "555-0404", 26, "16:00", "20:00", "Graduation", 90, "Irving", "TX", glam.id, essential.id, "TikTok", "Needs instant sharing.", "PROPOSAL_SENT"],
      ["Owen", "Miles", "owen@example.com", "555-0405", 35, "18:30", "22:30", "Gala", 220, "Dallas", "TX", corporate.id, custom.id, "Planner referral", "Brand activation with data capture.", "FOLLOW_UP"],
      ["Sofia", "Nguyen", "sofia@example.com", "555-0406", 44, "18:00", "23:00", "Wedding", 160, "Fort Worth", "TX", vogue.id, luxe.id, "Venue partner", "Wants premium backdrop.", "VIEWED"],
      ["Miles", "Walker", "miles@example.com", "555-0407", 54, "20:00", "23:59", "Holiday Party", 260, "Austin", "TX", booth360.id, signature.id, "Google", "Comparing Signature and Luxe.", "NEW"],
      ["Grace", "Kim", "grace@example.com", "555-0408", 68, "15:00", "19:00", "Baby Shower", 70, "Dallas", "TX", glam.id, essential.id, "Instagram", "Soft editorial look requested.", "LOST"],
      ["Elliot", "James", "elliot@example.com", "555-0409", 82, "18:00", "22:00", "Product Launch", 180, "Dallas", "TX", corporate.id, custom.id, "LinkedIn", "Needs branded capture and export.", "NEW"]
    ];
    for (const row of leadRows) {
      const status = row[15] === "VIEWED" ? "QUALIFIED" : row[15];
      await client.query(
        `INSERT INTO leads (first_name,last_name,email,phone,event_date,event_start_time,event_end_time,event_type,guest_count,city,state,preferred_experience_id,preferred_package_id,referral_source,message,lead_source,status,assigned_user_id)
         SELECT $1,$2,$3,$4,current_date + ($5 || ' days')::interval,$6::time,$7::time,$8,$9,$10,$11,$12,$13,$14,$15,'WEBSITE',$16,$17
         WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email=$3 AND deleted_at IS NULL)`,
        [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], status, owner.id]
      );
    }

    const proposalStatuses = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "EXPIRED"];
    const proposalLeads = (await client.query("SELECT id, preferred_package_id FROM leads WHERE deleted_at IS NULL ORDER BY created_at LIMIT 5")).rows;
    for (const [index, lead] of proposalLeads.entries()) {
      const proposal = await upsertOne(
        client,
        `INSERT INTO proposals (lead_id, status, notes, total)
         SELECT $1,$2,$3,$4
         WHERE NOT EXISTS (SELECT 1 FROM proposals WHERE lead_id=$1 AND deleted_at IS NULL)
         RETURNING *`,
        [lead.id, proposalStatuses[index], `Development ${proposalStatuses[index].toLowerCase()} proposal`, index === 0 ? 499 : index === 1 ? 799 : 1099]
      ) || (await client.query("SELECT * FROM proposals WHERE lead_id=$1 LIMIT 1", [lead.id])).rows[0];
      await client.query(
        `INSERT INTO proposal_versions (proposal_id, version_number, snapshot, created_by)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (proposal_id, version_number) DO NOTHING`,
        [proposal.id, JSON.stringify({ seeded: true, status: proposal.status }), owner.id]
      );
      await client.query(
        `INSERT INTO proposal_deliveries (proposal_id, recipient_email, status, sent_at)
         SELECT $1, l.email, CASE WHEN $2='DRAFT' THEN 'PENDING' ELSE 'SENT' END, CASE WHEN $2='DRAFT' THEN NULL ELSE now() END
         FROM leads l WHERE l.id=$3
         ON CONFLICT DO NOTHING`,
        [proposal.id, proposal.status, lead.id]
      );
    }

    const eventClients = (await client.query("SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY created_at LIMIT 8")).rows;
    const eventTemplates = [
      ["Harper Birthday Celebration", "Birthday", 10, "The Adolphus", essential.id, glam.id, "PENDING_DEPOSIT"],
      ["NOVA Brand Mixer", "Corporate Party", 21, "South Congress Hotel", custom.id, corporate.id, "CONFIRMED"],
      ["Oak & Pearl Open House", "Venue Activation", 32, "Oak & Pearl", signature.id, vogue.id, "READY"],
      ["Brightline Team Gala", "Gala", -18, "The Joule", luxe.id, booth360.id, "COMPLETED"]
    ];
    for (const [index, template] of eventTemplates.entries()) {
      const customer = eventClients[index + 1] || clientRow;
      const seededEvent = await upsertOne(
        client,
        `INSERT INTO events (event_name, client_id, event_type, event_date, start_time, end_time, setup_time, breakdown_time, venue_name, venue_address, guest_count, package_id, experience_id, status)
         SELECT $1,$2,$3,current_date + ($4 || ' days')::interval,'18:00','22:00','16:30','23:00',$5,$6,$7,$8,$9,$10
         WHERE NOT EXISTS (SELECT 1 FROM events WHERE event_name=$1 AND deleted_at IS NULL)
         RETURNING *`,
        [template[0], customer.id, template[1], template[2], template[3], `${template[3]}, TX`, 120 + index * 30, template[4], template[5], template[6]]
      ) || (await client.query("SELECT * FROM events WHERE event_name=$1 LIMIT 1", [template[0]])).rows[0];
      await client.query(
        `INSERT INTO bookings (event_id, client_id, subtotal, add_ons_total, travel_fee, custom_charges, discount, total, deposit_required, amount_paid, balance_due, payment_status)
         SELECT $1,$2,$3,0,0,0,0,$3,($3 * 0.30),CASE WHEN $4='PAID' THEN $3 WHEN $4='PARTIAL' THEN ($3 * 0.30) ELSE 0 END,CASE WHEN $4='PAID' THEN 0 WHEN $4='PARTIAL' THEN ($3 * 0.70) ELSE $3 END,$4
         WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE event_id=$1 AND deleted_at IS NULL)`,
        [seededEvent.id, customer.id, index === 0 ? 499 : index === 1 ? 1500 : index === 2 ? 799 : 1099, index === 3 ? "PAID" : index === 0 ? "UNPAID" : "PARTIAL"]
      );
    }

    const invoiceEvents = (await client.query("SELECT e.id, e.client_id, e.event_name, b.total, b.amount_paid, b.balance_due FROM events e JOIN bookings b ON b.event_id=e.id WHERE e.deleted_at IS NULL ORDER BY e.created_at LIMIT 4")).rows;
    const invoiceStatuses = ["PARTIAL", "SENT", "PAID", "SENT"];
    for (const [index, invoiceEvent] of invoiceEvents.entries()) {
      const invoiceNumber = `LOLA-${String(index + 1001).padStart(4, "0")}`;
      await client.query(
        `INSERT INTO invoices (invoice_number, client_id, event_id, status, subtotal, total, amount_paid, balance_due, due_date)
         SELECT $1,$2,$3,$4,$5,$5,$6,$7,current_date + ($8 || ' days')::interval
         WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number=$1)`,
        [invoiceNumber, invoiceEvent.client_id, invoiceEvent.id, invoiceStatuses[index], invoiceEvent.total, invoiceEvent.amount_paid, invoiceEvent.balance_due, index === 1 ? -5 : 14 + index]
      );
    }

    const paidBooking = (await client.query("SELECT event_id, client_id, amount_paid FROM bookings WHERE amount_paid > 0 LIMIT 1")).rows[0];
    if (paidBooking) {
      await client.query(
        `INSERT INTO payments (event_id, client_id, amount, payment_method, reference_number, payment_date, notes, recorded_by)
         SELECT $1,$2,$3,'CARD','SEED-DEPOSIT',current_date,'Seeded manual payment',$4
         WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number='SEED-DEPOSIT')`,
        [paidBooking.event_id, paidBooking.client_id, paidBooking.amount_paid, owner.id]
      );
    }

    const paidBookings = (await client.query("SELECT event_id, client_id, amount_paid FROM bookings WHERE amount_paid > 0 ORDER BY created_at")).rows;
    for (const [index, booking] of paidBookings.entries()) {
      const reference = `SEED-PAYMENT-${index + 1}`;
      await client.query(
        `INSERT INTO payments (event_id, client_id, amount, payment_method, reference_number, payment_date, notes, recorded_by)
         SELECT $1,$2,$3,CASE WHEN $4 % 2 = 0 THEN 'CARD' ELSE 'BANK_TRANSFER' END,$5,current_date - ($4 || ' days')::interval,'Seeded finance activity',$6
         WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number=$5)`,
        [booking.event_id, booking.client_id, booking.amount_paid, index, reference, owner.id]
      );
    }

    const media = await upsertOne(
      client,
      `INSERT INTO media_library (filename, alt_text, mime_type, size_bytes, storage_key, visibility, permission_state, uploaded_by)
       SELECT 'lola-glam-sample.jpg','LOLA Glam sample event image','image/jpeg',240000,'seed/lola-glam-sample.jpg','PRIVATE','UNKNOWN',$1
       WHERE NOT EXISTS (SELECT 1 FROM media_library WHERE storage_key='seed/lola-glam-sample.jpg')
       RETURNING *`,
      [owner.id]
    ) || (await client.query("SELECT * FROM media_library WHERE storage_key='seed/lola-glam-sample.jpg'")).rows[0];

    await client.query(
      `INSERT INTO website_hero_slides (image_media_id, alt_text, caption, headline, subheadline, cta_label, cta_url, display_order, status)
       SELECT $1,'Guests posing at a LOLA booth','Signature editorial booth moment','LOLA Booths','Premium photo booth experiences for modern events','Book Now','/book-now',1,'DRAFT'
       WHERE NOT EXISTS (SELECT 1 FROM website_hero_slides WHERE headline='LOLA Booths')`,
      [media.id]
    );
    await client.query(
      `INSERT INTO website_content (content_key, title, body, seo_title, seo_description, status)
       VALUES ('homepage.intro','Homepage Intro',$1,'LOLA Booths | Premium Photo Booths','Premium photo booth experiences for weddings, corporate events, and celebrations.','DRAFT')
       ON CONFLICT (content_key) DO NOTHING`,
      [JSON.stringify({ eyebrow: "Premium photo booths", copy: "Warm, editorial, polished event capture." })]
    );
    await client.query("INSERT INTO testimonials (client_name,event_type,quote,rating,display_order,status) SELECT 'Avery Williams','Wedding','LOLA made the reception feel polished, personal, and effortless.',5,1,'DRAFT' WHERE NOT EXISTS (SELECT 1 FROM testimonials WHERE client_name='Avery Williams')");
    await client.query("INSERT INTO faqs (question,answer,display_order,status) SELECT 'How far in advance should we book?','Popular dates book quickly, so earlier is better. The admin workflow supports inquiries before confirmation.',1,'DRAFT' WHERE NOT EXISTS (SELECT 1 FROM faqs WHERE question='How far in advance should we book?')");

    const integrations = [
      ["PAYMENTS", "stripe"],
      ["PAYMENTS", "paypal"],
      ["EMAIL", "resend"],
      ["EMAIL", "postmark"],
      ["STORAGE", "s3-compatible"],
      ["CALENDAR", "google"],
      ["CALENDAR", "outlook"],
      ["MARKETING", "meta"],
      ["MARKETING", "tiktok"],
      ["MARKETING", "linkedin"]
    ];
    for (const integration of integrations) {
      await client.query(
        `INSERT INTO integration_connections (category, provider, status)
         VALUES ($1,$2,'DISCONNECTED')
         ON CONFLICT (category, provider) DO NOTHING`,
        integration
      );
    }

    await client.query("COMMIT");
    logger.info("seed complete");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error(error, "seed failed");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
