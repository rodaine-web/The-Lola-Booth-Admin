import dotenv from "dotenv";

dotenv.config();

const required = ["DATABASE_URL", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[config] Missing ${key}. Copy .env.example to .env before running production.`);
  }
}

const productionReadinessIssues = [];
if ((process.env.NODE_ENV || "development") === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes("development")) productionReadinessIssues.push("JWT_SECRET must be a unique production secret of at least 32 characters.");
  if (!process.env.INTEGRATION_SECRET_KEY || process.env.INTEGRATION_SECRET_KEY.length < 32 || process.env.INTEGRATION_SECRET_KEY.includes("development")) productionReadinessIssues.push("INTEGRATION_SECRET_KEY must be a unique production encryption secret.");
  if (!process.env.PUBLIC_BASE_URL?.startsWith("https://")) productionReadinessIssues.push("PUBLIC_BASE_URL must use HTTPS in production.");
  if (!process.env.CLIENT_ORIGIN?.startsWith("https://")) productionReadinessIssues.push("CLIENT_ORIGIN must use HTTPS in production.");
  const emailProvider = (process.env.EMAIL_PROVIDER || "development").toLowerCase();
  if (emailProvider === "development") productionReadinessIssues.push("EMAIL_PROVIDER must be set to an active production adapter before launch.");
  if (emailProvider === "microsoft") {
    for (const key of ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_SENDER_EMAIL"]) {
      if (!process.env[key]) productionReadinessIssues.push(`${key} is required when EMAIL_PROVIDER=microsoft.`);
    }
  }
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) productionReadinessIssues.push("STRIPE_WEBHOOK_SECRET is required when Stripe is configured.");
  if (process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_WEBHOOK_ID) productionReadinessIssues.push("PAYPAL_WEBHOOK_ID is required when PayPal is configured.");
}

export const envCatalog = [
  { key: "NODE_ENV", class: "REQUIRED", required: true, default: "development" },
  { key: "DATABASE_URL", class: "REQUIRED", required: true, secret: true },
  { key: "JWT_SECRET", class: "REQUIRED", required: true, secret: true },
  { key: "INTEGRATION_SECRET_KEY", class: "REQUIRED", required: true, secret: true },
  { key: "CLIENT_ORIGIN", class: "REQUIRED", required: true, default: "http://localhost:5173" },
  { key: "PUBLIC_BASE_URL", class: "REQUIRED", required: true, default: "http://localhost:5173" },
  { key: "PUBLIC_APP_URL", class: "REQUIRED", required: true, default: "http://localhost:5173" },
  { key: "PORT", class: "OPTIONAL", required: false, default: "4000" },
  { key: "RATE_LIMIT_WINDOW_MS", class: "OPTIONAL", required: false, default: "900000" },
  { key: "RATE_LIMIT_MAX", class: "OPTIONAL", required: false, default: "120" },
  { key: "STORAGE_PROVIDER", class: "PROVIDER_SPECIFIC", required: false, default: "local" },
  { key: "LOCAL_STORAGE_ROOT", class: "PROVIDER_SPECIFIC", required: false, default: "storage/uploads" },
  { key: "EMAIL_PROVIDER", class: "PROVIDER_SPECIFIC", required: false, default: "development" },
  { key: "SMS_PROVIDER", class: "PROVIDER_SPECIFIC", required: false, default: "none" },
  { key: "FORM_NOTIFICATION_EMAIL", class: "PROVIDER_SPECIFIC", required: false },
  { key: "MICROSOFT_TENANT_ID", class: "PROVIDER_SPECIFIC", required: (process.env.EMAIL_PROVIDER || "").toLowerCase() === "microsoft" },
  { key: "MICROSOFT_CLIENT_ID", class: "PROVIDER_SPECIFIC", required: (process.env.EMAIL_PROVIDER || "").toLowerCase() === "microsoft" },
  { key: "MICROSOFT_CLIENT_SECRET", class: "PROVIDER_SPECIFIC", required: (process.env.EMAIL_PROVIDER || "").toLowerCase() === "microsoft", secret: true },
  { key: "MICROSOFT_SENDER_EMAIL", class: "PROVIDER_SPECIFIC", required: (process.env.EMAIL_PROVIDER || "").toLowerCase() === "microsoft" },
  { key: "STRIPE_SECRET_KEY", class: "PROVIDER_SPECIFIC", required: false, secret: true },
  { key: "STRIPE_WEBHOOK_SECRET", class: "PROVIDER_SPECIFIC", required: false, secret: true },
  { key: "PAYPAL_CLIENT_ID", class: "PROVIDER_SPECIFIC", required: false },
  { key: "PAYPAL_CLIENT_SECRET", class: "PROVIDER_SPECIFIC", required: false, secret: true },
  { key: "PAYPAL_WEBHOOK_ID", class: "PROVIDER_SPECIFIC", required: false },
  { key: "META_WEBHOOK_VERIFY_TOKEN", class: "PROVIDER_SPECIFIC", required: false, secret: true },
  { key: "TIKTOK_WEBHOOK_SECRET", class: "PROVIDER_SPECIFIC", required: false, secret: true }
];

export { productionReadinessIssues };

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/lola_admin",
  jwtSecret: process.env.JWT_SECRET || "development-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || 14),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  publicInquiryAllowedOrigins: (process.env.PUBLIC_INQUIRY_ALLOWED_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
  storageProvider: process.env.STORAGE_PROVIDER || "local",
  localStorageRoot: process.env.LOCAL_STORAGE_ROOT || "storage/uploads",
  emailProvider: (process.env.EMAIL_PROVIDER || "development").toLowerCase(),
  smsProvider: process.env.SMS_PROVIDER || "none",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || "",
  paypalEnvironment: process.env.PAYPAL_ENVIRONMENT || "sandbox",
  integrationSecretKey: process.env.INTEGRATION_SECRET_KEY || process.env.JWT_SECRET || "development-only-secret-change-me",
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || "202609",
  metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
  tiktokWebhookSecret: process.env.TIKTOK_WEBHOOK_SECRET || "",
  emailFrom: process.env.EMAIL_FROM || "The LOLA Booth <info@thelolabooth.com>",
  formNotificationEmail: process.env.FORM_NOTIFICATION_EMAIL || "",
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || "",
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || "",
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
  microsoftSenderEmail: process.env.MICROSOFT_SENDER_EMAIL || ""
};
