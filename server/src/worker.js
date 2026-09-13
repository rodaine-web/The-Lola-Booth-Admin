import { logger } from "./config/logger.js";
import { pool } from "./db/pool.js";
import { processDueJobs } from "./services/automation-service.js";
import { recordWorkerHeartbeat } from "./services/system-health-service.js";

let stopping = false;

async function tick() {
  if (stopping) return;
  try {
    await recordWorkerHeartbeat("automation-worker", { pid: process.pid });
    const result = await processDueJobs({ limit: 25 });
    if (result.processed.length) logger.info({ processed: result.processed.length }, "automation jobs processed");
  } catch (error) {
    logger.error({ err: error }, "automation worker tick failed");
  }
}

async function shutdown() {
  stopping = true;
  clearInterval(interval);
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info("LOLA automation worker started");
await tick();
const interval = setInterval(tick, 30000);
