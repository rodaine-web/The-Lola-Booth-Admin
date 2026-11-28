import {Link} from 'react-router-dom';
import {formatMoney,formatCount} from '../utils/display.js';
import {InsightPanel} from './workspace/InsightPanels.jsx';
import './keepsakes-sales-reporting.css';
const money=cents=>formatMoney(Number(cents||0)/100);
export function KeepsakesSalesSummary({commerce,bookingCollected}){
 if(!commerce?.available)return null;
 const totals=commerce.totals;
 return <InsightPanel title="Sales collected · Bookings & Keepsakes" link="/sales/keepsakes?tab=orders" note="Paid transactions in the selected period, less confirmed refunds to date. Booking value is reported separately from collected payments.">
  <p className="ksr-test" role="note">Staging preview · Keepsakes figures include test payments. These are not live business revenue.</p>
  <div className="ksr-cards">
   {[['Booking payments collected',formatMoney(bookingCollected)],['Keepsakes net receipts',money(totals.netReceiptsCents)],['Combined collected preview',money(commerce.combinedCollectedPreviewCents)],['Paid Keepsakes orders',formatCount(totals.paidOrders)]].map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}
  </div>
  <dl className="ksr-breakdown">{[['Keepsakes merchandise after discounts',totals.merchandiseCents],['Discounts applied',totals.discountCents],['Shipping charged',totals.shippingCents],['Tax collected',totals.taxCents],['Total charged',totals.chargedCents],['Confirmed refunds',totals.refundedCents],['Receipts on payment/refund hold',totals.heldCents]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
  <p className="ksr-note">Net receipts include shipping and tax; they are not profit. The combined preview excludes held Keepsakes receipts and payments already represented in booking collections. Merchandise, shipping and tax are before refunds; confirmed refunds are shown separately.</p>
 </InsightPanel>;
}
export function KeepsakesInventoryReport({commerce}){
 if(!commerce?.available)return <InsightPanel title="Keepsakes & Inventory"><p>Keepsakes reporting is available to financial administrators in staging.</p></InsightPanel>;
 return <div className="ksr-inventory"><InsightPanel title="Keepsakes products sold" note="Paid-order cohort for the selected period; quantities exclude canceled units. Test orders only."><div className="reports-table-wrap"><table className="ksr-products-table"><thead><tr><th>Product</th><th>Units sold</th></tr></thead><tbody>{commerce.products.map(row=><tr key={row.key}><td>{row.title}</td><td>{formatCount(row.units)}</td></tr>)}</tbody></table>{!commerce.products.length&&<p>No paid Keepsakes orders in this period.</p>}</div></InsightPanel>
 <InsightPanel title="In-house inventory" link="/sales/keepsakes?tab=products" note="Current inventory, independent of the sales date filter. Update stock using Configure ordering in Keepsakes products."><div className="reports-table-wrap"><table className="ksr-stock-table"><thead><tr><th>Product</th><th>Available for new orders</th><th>Committed to production</th><th>Supply</th><th>Ordering</th></tr></thead><tbody>{commerce.inventory.map(row=><tr key={row.id}><td>{row.title}</td><td data-label="Available">{row.available_units==null?<span className="ksr-unknown">Quantity not tracked</span>:formatCount(row.available_units)}</td><td data-label="Committed">{formatCount(row.committed_units)}</td><td data-label="Supply">{row.supply_confirmed?'Confirmed':'Needs review'}</td><td data-label="Ordering">{row.active?'Available':'Unavailable'}</td></tr>)}</tbody></table></div><p className="ksr-note">Available units have already had paid reservations deducted. Committed units await production completion. These are product quantities, not a physical count of shared blanks or consumables. Blank quantities do not mean zero stock. Digital products and supplier products do not use in-house inventory.</p></InsightPanel></div>;
}
