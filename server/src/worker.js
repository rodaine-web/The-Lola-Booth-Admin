import {processWebsiteProposalHandoffs} from './services/website-proposal-handoff-service.js';
import {queueBookingLifecycleReminders} from './services/booking-lifecycle-reminders.js';
import { processBookingInvoiceHandoffs } from './services/booking-invoice-handoff-service.js';
import {queueDueExternalMaintenance} from './services/external-integration-jobs.js';
import {processCampaignJobs} from "./services/campaign-service.js";
import {processFormOwnerNotifications} from "./services/form-owner-notifications.js";
import {assertDatabaseIdentity} from './config/database-identity.js';
import {processStagingQualificationJobs} from './services/staging-email-qualification-service.js';
import {buildInfo,stagingJobsPaused,isStaging} from './config/staging-safety.js';
import {recoverPublicInquiryAcknowledgments} from "./services/public-form-email-service.js";
import {processIntegrationJobs,queueDueReminders} from "./services/integration-jobs-service.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/pool.js";
import { processDueJobs } from "./services/automation-service.js";
import {queuePlanningReminders} from './services/planning-reminder-service.js';
import {expireBookingHolds} from './services/booking-hold-service.js';
import { recordWorkerHeartbeat, recordWorkerProcessingResult } from "./services/system-health-service.js";

const databaseSystemId = await assertDatabaseIdentity(pool);
let stopping = false;
let running = false;

async function tick() {
  if (stopping || running) return;
  running = true;
  try {
    await recordWorkerHeartbeat("automation-worker", { pid: process.pid, ...buildInfo(), jobsPaused:stagingJobsPaused(), databaseSystemId });
    const formNotifications=await processFormOwnerNotifications();
    if(formNotifications.processed.length){
      logger.info({processed:formNotifications.processed},'Owner form notifications processed');
      await recordWorkerProcessingResult("automation-worker",{success:formNotifications.processed.every(item=>item.status==='SENT_TO_PROVIDER'),processed:formNotifications.processed.length,ownerFormsOnly:true});
    }
    const campaigns=await processCampaignJobs({limit:25});
    if(campaigns.processed.length)await recordWorkerProcessingResult("automation-worker",{success:campaigns.processed.every(item=>item.status==='SENT_TO_PROVIDER'),processed:campaigns.processed.length,campaignsOnly:true});
    if(stagingJobsPaused()){if(isStaging()&&process.env.STAGING_EXTERNAL_INTEGRATIONS_ENABLED==='true'){await queueDueExternalMaintenance();await processIntegrationJobs({limit:25,externalOnly:true});}const result=await processStagingQualificationJobs();if(result.processed.length)await recordWorkerProcessingResult("automation-worker",{success:result.processed.every(item=>item.status!=='FAILED'),processed:result.processed.length,qualificationOnly:true});return;}
    const websiteProposals = await processWebsiteProposalHandoffs();
    if (websiteProposals.processed.length) logger.info({processed:websiteProposals.processed}, 'Website proposal handoffs processed');
    const invoiceHandoffs = await processBookingInvoiceHandoffs();
    if (invoiceHandoffs.processed.length) logger.info({processed:invoiceHandoffs.processed}, 'Booking invoice handoffs processed');
    if(!isStaging())await recoverPublicInquiryAcknowledgments();
    await queueDueReminders();
    await expireBookingHolds();
    await queuePlanningReminders();
    await queueBookingLifecycleReminders();
    const result = await processDueJobs({ limit: 25 });
    if(!isStaging()){await queueDueExternalMaintenance();await processIntegrationJobs({limit:25});}else if(process.env.STAGING_EXTERNAL_INTEGRATIONS_ENABLED==='true'){await queueDueExternalMaintenance();await processIntegrationJobs({limit:25,externalOnly:true});}
    await recordWorkerProcessingResult("automation-worker", { success: result.processed.every(item=>item.status!=="FAILED"&& !item.error), processed: result.processed.length });
    if (result.processed.length) logger.info({ processed: result.processed.length }, "automation jobs processed");
  } catch (error) {
    await recordWorkerProcessingResult("automation-worker", { success: false, error: error.message }).catch(() => null);
    logger.error({ err: error }, "automation worker tick failed");
  } finally { running = false; }
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
