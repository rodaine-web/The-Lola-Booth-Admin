import {query} from '../db/pool.js';

export async function searchAdmin(user, input) {
  const permissions = user?.permissions || [];
  const can = key => permissions.includes('*') || permissions.includes(key);
  const term = `%${String(input || '').slice(0,150)}%`;
  const searches = [
    ['read:sales',"SELECT 'client' AS type, id, name AS title, email AS subtitle FROM clients WHERE deleted_at IS NULL AND (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) LIMIT 8"],
    ['read:sales',"SELECT 'lead' AS type, id, first_name || ' ' || last_name AS title, email AS subtitle FROM leads WHERE deleted_at IS NULL AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) LIMIT 8"],
    ['read:events',"SELECT 'event' AS type, id, event_name AS title, venue_name AS subtitle FROM events WHERE deleted_at IS NULL AND (event_name ILIKE $1 OR venue_name ILIKE $1) LIMIT 8"],
    ['read:finance',"SELECT 'invoice' AS type, id, invoice_number AS title, status AS subtitle FROM invoices WHERE deleted_at IS NULL AND invoice_number ILIKE $1 LIMIT 8"]
  ];
  const results = await Promise.all(searches.filter(([permission])=>can(permission)).map(([,sql])=>query(sql,[term])));
  return results.flatMap(result=>result.rows);
}
