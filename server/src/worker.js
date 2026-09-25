import {processStagingQualificationJobs} from './services/staging-email-qualification-service.js';
import {buildInfo,stagingJobsPaused} from './config/staging-safety.js';
import {recoverPublicInquiryAcknowledgments} from "./services/public-form-email-service.js";
import {processIntegrationJobs,queueDueReminders} from "./services/integration-jobs-service.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/pool.js";
import { processDueJobs } from "./services/automation-service.js";
import { recordWorkerHeartbeat, recordWorkerProcessingResult } from "./services/system-health-service.js";

let stopping = false;

async function tick() {
  if (stopping) return;
  try {
    await recordWorkerHeartbeat("automation-worker", { pid: process.pid, ...buildInfo(), jobsPaused:stagingJobsPaused() });
    if(stagingJobsPaused()){const result=await processStagingQualificationJobs();if(result.processed.length)await recordWorkerProcessingResult("automation-worker",{success:true,processed:result.processed.length,qualificationOnly:true});return;}
    await recoverPublicInquiryAcknowledgments();
    await queueDueReminders();
    const result = await processDueJobs({ limit: 25 });
    await processIntegrationJobs({limit:25});
    await recordWorkerProcessingResult("automation-worker", { success: true, processed: result.processed.length });
    if (result.processed.length) logger.info({ processed: result.processed.length }, "automation jobs processed");
  } catch (error) {
    await recordWorkerProcessingResult("automation-worker", { success: false, error: error.message }).catch(() => null);
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
