import crypto from "node:crypto";
import { query, transaction, pool } from "../db/pool.js";
import { buildProposalSnapshot, getProposal, nextNumber, proposalPdfBuffer, proposalPreviewHtml, sendProposal } from "../services/proposal-service.js";
import { createInvoice, getInvoice, publicInvoiceUrl, sendInvoice } from "../services/invoice-service.js";
import { publicPaymentOptions } from "../services/payment-service.js";

const TARGET = "olawandeadams@gmail.com";
const CLIENT_EMAIL = "qa-approved-template-20261001@thelolabooth.com";
const MARKER = "QA-APPROVED-PROPOSAL-FLOW-2026-10-01";
const PUBLIC_API = "https://api.thelolabooth.com";
const PUBLIC_SITE = "https://thelolabooth.com";

function fakeReq(userId, body = {}) {
  return { body, user: { id: userId }, ip: "127.0.0.1", headers: { "user-agent": "LOLA approved-template production smoke test" } };
}

async function ensureEntities() {
  const owner = (await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.deleted_at IS NULL AND u.active=true AND r.name IN ('OWNER','ADMIN') ORDER BY CASE r.name WHEN 'OWNER' THEN 0 ELSE 1 END, u.created_at LIMIT 1")).rows[0];
  if (!owner) throw new Error("No active OWNER/ADMIN user found");

  let client = (await query("SELECT * FROM clients WHERE deleted_at IS NULL AND lower(email)=lower($1) LIMIT 1", [CLIENT_EMAIL])).rows[0];
  if (!client) client = (await query("INSERT INTO clients (name,email,client_type,referral_source) VALUES ($1,$2,'INDIVIDUAL','SYSTEM_TEST') RETURNING *", ["QA Jordan & Taylor", CLIENT_EMAIL])).rows[0];

  const exps=(await query("SELECT * FROM experiences WHERE deleted_at IS NULL AND active=true AND (lower(name) LIKE '%glam%' OR lower(name) LIKE '%vogue%') ORDER BY display_order, created_at")).rows;
  const glam=exps.find(x=>String(x.name).toLowerCase().includes("glam"));
  const vogue=exps.find(x=>String(x.name).toLowerCase().includes("vogue"));
  if(!glam||!vogue) throw new Error("Glam/Vogue experiences not found");

  let event=(await query("SELECT * FROM events WHERE deleted_at IS NULL AND client_id=$1 AND internal_notes=$2 LIMIT 1",[client.id,MARKER])).rows[0];
  if(!event) event=(await query(
    "INSERT INTO events (event_name,client_id,event_type,event_date,experience_id,status,internal_notes,venue_name,city,state,guest_count) VALUES ($1,$2,'WEDDING',$3,$4,'DRAFT',$5,$6,'Chicago','IL',120) RETURNING *",
    ["QA Wedding - DO NOT FULFILL",client.id,"2026-12-30",glam.id,MARKER,"QA Test Venue"]
  )).rows[0];
  return {owner,client,event,glam,vogue};
}

async function ensureProposal({owner,client,event,glam,vogue}) {
  let proposal=(await query("SELECT * FROM proposals WHERE notes=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",[MARKER])).rows[0];
  if(proposal) return getProposal(proposal.id);

  const input={
    client_id:client.id,event_id:event.id,experience_id:glam.id,
    proposal_type:"WEDDING",
    proposal_title:"QA Wedding Proposal - The Glam + The Vogue",
    proposal_date:new Date().toISOString().slice(0,10),
    notes:MARKER,tax_rate:0,discount:0,deposit_type:"PERCENTAGE",deposit_value:30,
    selected_experiences:[
      {experience_id:glam.id,key:"glam",name:"The Glam",package_name:"QA Signature",price:0.50,headline:"Clean. Classic. Beautifully you.",description:"Polished portraits with an editorial finish."},
      {experience_id:vogue.id,key:"vogue",name:"The Vogue",package_name:"QA Signature",price:0.50,headline:"Make your guests the cover story.",description:"A full-size editorial installation made for the celebration."}
    ],
    visual_sections:[]
  };
  const snapshot=await buildProposalSnapshot(input);
  proposal=await transaction(async db=>{
    const number=await nextNumber(db,"next_proposal_number","proposal_prefix","PROP");
    return (await db.query(
      `INSERT INTO proposals (
        proposal_number,client_id,event_id,owner_user_id,experience_id,secure_token,status,notes,total,
        valid_through,content,pricing_snapshot,line_items_snapshot,document_template_key,editable_sections,
        proposal_source,proposal_title,proposal_date,proposal_type,selected_experiences,proposal_visuals,visual_sections
      ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,'GENERATED',$15,$16,$17,$18,$19,$20) RETURNING *`,
      [number,client.id,event.id,owner.id,glam.id,crypto.randomBytes(24).toString("hex"),MARKER,snapshot.pricing.total,snapshot.validThrough,
       JSON.stringify(snapshot.content),JSON.stringify(snapshot.pricing),JSON.stringify(snapshot.lineItems),snapshot.documentTemplateKey,
       JSON.stringify(snapshot.editableSections),snapshot.proposalTitle,snapshot.proposalDate,snapshot.proposalType,
       JSON.stringify(snapshot.selectedExperiences),JSON.stringify(snapshot.proposalVisuals),JSON.stringify(snapshot.visualSections)]
    )).rows[0];
  });
  return getProposal(proposal.id);
}

async function run(){
  const entities=await ensureEntities();
  let proposal=await ensureProposal(entities);

  const preview=await proposalPreviewHtml(proposal);
  const required=["WEDDING EXPERIENCE PROPOSAL","Let’s make this one worth remembering.","THE LOLA STANDARD","DUE TO RESERVE DATE","From proposal to booked."];
  const missing=required.filter(x=>!preview.includes(x));
  if(missing.length) throw new Error("Approved proposal template markers missing: "+missing.join(", "));
  if(!preview.includes("The Glam")||!preview.includes("The Vogue")) throw new Error("Selected experience sections missing");
  const proposalPdf=await proposalPdfBuffer(proposal,"pdf");
  if(!proposalPdf.subarray(0,4).equals(Buffer.from("%PDF"))) throw new Error("Proposal PDF invalid");

  let proposalEmail=null;
  if(!["SENT","VIEWED","ACCEPTED"].includes(proposal.status)){
    proposalEmail=(await sendProposal(fakeReq(entities.owner.id,{recipient:TARGET,subject:"QA - Approved LOLA Wedding Proposal Template"}),proposal)).email;
    proposal=await getProposal(proposal.id);
  }

  const proposalPageUrl=`${PUBLIC_SITE}/proposal/${proposal.secure_token}`;
  const proposalPage=await fetch(proposalPageUrl,{redirect:"follow"});
  if(!proposalPage.ok) throw new Error(`Public proposal page failed: ${proposalPage.status}`);

  if(proposal.status!=="ACCEPTED"){
    const accept=await fetch(`${PUBLIC_API}/api/public/proposals/${proposal.secure_token}/accept`,{
      method:"POST",headers:{"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({acceptedByName:"QA Approved Flow"})
    });
    const body=await accept.json().catch(()=>({}));
    if(!accept.ok) throw new Error(`Proposal acceptance failed: ${accept.status} ${JSON.stringify(body)}`);
  }
  proposal=await getProposal(proposal.id);
  if(proposal.status!=="ACCEPTED") throw new Error("Proposal did not reach ACCEPTED");

  const notifications=(await query("SELECT id,user_id,role_target,category,severity,title,body,action_url,metadata FROM notifications WHERE entity_type='proposal' AND entity_id=$1 AND title ILIKE '%accepted%' ORDER BY created_at DESC",[proposal.id])).rows;
  if(!notifications.length) throw new Error("Acceptance notification was not created");

  let invoice=(await query("SELECT * FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL AND COALESCE(pricing_snapshot->>'payment_mode','')='DEPOSIT_REQUEST' ORDER BY created_at DESC LIMIT 1",[proposal.id])).rows[0];
  if(!invoice) invoice=await createInvoice(fakeReq(entities.owner.id,{proposal_id:proposal.id,depositOnly:true,notes:MARKER}));
  invoice=await getInvoice(invoice.id);

  const options=await publicPaymentOptions(invoice);
  if(Math.abs(Number(options.amountDue)-0.30)>0.001) throw new Error(`Expected $0.30 deposit due, got ${options.amountDue}`);
  if(Math.abs(Number(options.fullAmount)-1.00)>0.001) throw new Error(`Expected $1.00 full amount, got ${options.fullAmount}`);
  if(options.allowPayInFull!==true||options.allowCustomAmount!==true) throw new Error("Full/custom payment choices unavailable");
  if(Math.abs(Number(options.minimumAmount)-0.30)>0.001) throw new Error(`Expected custom minimum $0.30, got ${options.minimumAmount}`);

  const invoiceUrl=publicInvoiceUrl(invoice);
  if(!invoiceUrl?.includes("/pay/")) throw new Error("Invoice payment URL does not use /pay/:token");
  const payPage=await fetch(invoiceUrl,{redirect:"follow"});
  if(!payPage.ok) throw new Error(`Public payment page failed: ${payPage.status}`);

  let invoiceEmail=null;
  if(invoice.status!=="SENT"){
    invoiceEmail=(await sendInvoice(fakeReq(entities.owner.id,{recipient:TARGET,subject:"QA - LOLA Deposit Invoice Payment Choices"}),invoice)).email;
    invoice=await getInvoice(invoice.id);
  }

  console.log(JSON.stringify({
    smokeTest:"PASS",
    marker:MARKER,
    proposal:{
      id:proposal.id,number:proposal.proposal_number,status:proposal.status,total:Number(proposal.total),
      templateMarkers:required,htmlBytes:Buffer.byteLength(preview),pdfBytes:proposalPdf.length,
      publicPageStatus:proposalPage.status,
      email:proposalEmail?{provider:proposalEmail.provider,status:proposalEmail.status,providerMessageId:proposalEmail.providerMessageId,deliveredExternally:proposalEmail.deliveredExternally}:null
    },
    acceptance:{
      notificationCount:notifications.length,
      latestNotification:{category:notifications[0].category,severity:notifications[0].severity,title:notifications[0].title,actionUrl:notifications[0].action_url},
      nextStep:"CREATE_DEPOSIT_INVOICE"
    },
    invoice:{
      id:invoice.id,number:invoice.invoice_number,status:invoice.status,total:Number(invoice.total),
      paymentUrl:invoiceUrl,paymentPageStatus:payPage.status,
      amountDue:Number(options.amountDue),fullAmount:Number(options.fullAmount),minimumAmount:Number(options.minimumAmount),
      allowPayInFull:options.allowPayInFull,allowCustomAmount:options.allowCustomAmount,
      providers:(options.providers||[]).map(x=>x.provider),
      email:invoiceEmail?{provider:invoiceEmail.provider,status:invoiceEmail.status,providerMessageId:invoiceEmail.providerMessageId,deliveredExternally:invoiceEmail.deliveredExternally}:null,
      paymentSessionCreated:false
    }
  }));
}

run().catch(err=>{console.error("APPROVED_FLOW_SMOKE_FAILED",err);process.exitCode=1;}).finally(async()=>{await pool.end();});
