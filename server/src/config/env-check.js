import { env, envCatalog, productionReadinessIssues } from "./env.js";

function classify() {
  return envCatalog.map((item) => ({
    ...item,
    present: Boolean(process.env[item.key]),
    value: item.secret ? undefined : process.env[item.key] || item.default || "",
    validation: validateEntry(item)
  }));
}

function validateEntry(item) {
  const value = process.env[item.key] || "";
  if (item.required && !value) return "MISSING";
  if (!value) return "MISSING";
  if (item.key === "DATABASE_URL") {
    if (!/^postgres(ql)?:\/\//.test(value)) return "INVALID FORMAT";
    return "PRESENT";
  }
  if (item.secret && (value.length < 32 || /development|example|change.?me|changeme|replace-with/i.test(value))) return "INVALID FORMAT";
  if (item.key.includes("URL") || item.key.includes("ORIGIN")) {
    if (env.nodeEnv === "production" && !value.startsWith("https://")) return "INVALID FORMAT";
    if (!/^https?:\/\//.test(value)) return "INVALID FORMAT";
  }
  if (item.key === "PAYPAL_ENVIRONMENT" && !["sandbox", "live"].includes(value)) return "INVALID FORMAT";
  return "PRESENT";
}

const rows = classify();
const missingRequired = rows.filter((item) => item.required && !item.present);
const invalidRequired = rows.filter((item) => item.required && item.validation === "INVALID FORMAT");

console.log(JSON.stringify({
  nodeEnv: env.nodeEnv,
  status: env.nodeEnv === "production" && (missingRequired.length || invalidRequired.length || productionReadinessIssues.length) ? "MISCONFIGURED" : "OK",
  requiredMissing: missingRequired.map((item) => item.key),
  requiredInvalid: invalidRequired.map((item) => item.key),
  productionReadinessIssues,
  variables: rows
}, null, 2));

if (env.nodeEnv === "production" && (missingRequired.length || invalidRequired.length || productionReadinessIssues.length)) {
  process.exitCode = 1;
}
