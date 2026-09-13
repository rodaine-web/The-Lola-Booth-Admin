import { query } from "../db/pool.js";

function cents(decimalString) {
  return Math.round(Number(decimalString || 0) * 100);
}

function dollars(amountCents) {
  return (amountCents / 100).toFixed(2);
}

export async function calculateBookingPricing({ packageId, addonIds = [], travelFee = "0.00", customCharges = "0.00", discount = "0.00", depositPercent = null }) {
  const packageResult = await query("SELECT starting_price FROM packages WHERE id = $1 AND deleted_at IS NULL", [packageId]);
  const packageSubtotal = cents(packageResult.rows[0]?.starting_price || "0.00");

  let addonSubtotal = 0;
  if (addonIds.length) {
    const addons = await query("SELECT price FROM addons WHERE id = ANY($1::uuid[]) AND active = true", [addonIds]);
    addonSubtotal = addons.rows.reduce((sum, addon) => sum + cents(addon.price), 0);
  }

  const total = Math.max(0, packageSubtotal + addonSubtotal + cents(travelFee) + cents(customCharges) - cents(discount));
  const settings = await query("SELECT default_deposit_percent FROM business_settings LIMIT 1");
  const deposit = depositPercent ?? Number(settings.rows[0]?.default_deposit_percent || 30);

  return {
    packageSubtotal: dollars(packageSubtotal),
    addonSubtotal: dollars(addonSubtotal),
    travelFee: dollars(cents(travelFee)),
    customCharges: dollars(cents(customCharges)),
    discount: dollars(cents(discount)),
    total: dollars(total),
    depositRequired: dollars(Math.round(total * (deposit / 100))),
    balanceDue: dollars(total)
  };
}
