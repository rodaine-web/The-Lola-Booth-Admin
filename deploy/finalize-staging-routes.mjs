// Run after copying the Vite build into a staging deployment bundle.
// Vercel serves a physical root index before applying our host-based rewrite.
import { readFile, unlink, access } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node deploy/finalize-staging-routes.mjs <staging-bundle-directory>");
const root = path.resolve(directory);
const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
if (!config.rewrites?.some(route => route.source === "/" && route.destination === "/staging-site/index.html" && route.has?.some(condition => condition.type === "host" && condition.value === "staging.thelolabooth.com"))) {
  throw new Error("Expected the staging website homepage rewrite; refusing to modify this bundle.");
}
await access(path.join(root, "staging-site/index.html"));
const admin = await readFile(path.join(root, "admin.html"), "utf8");
const indexPath = path.join(root, "index.html");
let index;
try { index = await readFile(indexPath, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (index !== undefined) {
  if (index !== admin) throw new Error("Root index differs from Admin; refusing to remove it.");
  await unlink(indexPath);
}
console.log("Staging bundle ready: website root uses its host rewrite; Admin uses admin.html.");
