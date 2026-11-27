import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import os from "node:os";
test(
  "notification dashboard and explicit modal confirmation are usable on desktop and mobile",
  { skip: process.env.KEEPSAKES_BROWSER_TEST !== "true", timeout: 120000 },
  async () => {
    const vite = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: path.join(os.tmpdir(), "lola-notify-vite"),
      plugins: [
        react(),
        {
          name: "notification-ui-fixture",
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (!req.url?.startsWith("/notification-qa")) return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await server.transformIndexHtml(
                  req.url,
                  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif;background:#f8f5ef;color:#30291e}button{font:inherit;border:1px solid #d8c8b0;background:white;padding:10px 14px;border-radius:7px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary-action{background:#906b2d;color:white}.eyebrow{font-size:11px;letter-spacing:2px}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import Panel from"/src/components/GalleryGuestNotifications.jsx";createRoot(document.getElementById("root")).render(React.createElement(Panel,{albumId:"synthetic-gallery",canApprove:true,reviewRequest:1}));</script></body></html>',
                ),
              );
            });
          },
        },
      ],
      server: { host: "127.0.0.1", port: 0 },
    });
    let browser;
    try {
      await vite.listen();
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
      const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
          }),
          page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error("UI error", e.message);
        });
        page.on("requestfailed", (r) =>
          console.error("request failed", r.url(), r.failure()),
        );
        let decisions = [],
          reviewId = 0;
        await page.route(
          (url) => url.pathname.startsWith("/api/"),
          async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname.endsWith("/review"))
              return route.fulfill({
                json: {
                  id: "review-" + ++reviewId,
                  eventName: "The Carter Celebration · Synthetic QA",
                  eventId: "synthetic-event-id",
                  totalGuests: 425,
                  validMobile: 412,
                  duplicates: 5,
                  consentExcluded: 7,
                  alreadyNotified: 0,
                  eligible: 400,
                  segments: 800,
                  estimatedMicros: 9600000,
                  remainingMicros: 50000000,
                  mode: "SIMULATED",
                  sampleBody:
                    "Your photos from The Lola Booth are ready! View your memories: https://staginggallery.thelolabooth.com/photos/phone-access#code=[recipient-specific link] Reply STOP to opt out. Reply HELP for help.",
                  expiresAt: new Date(Date.now() + 900000).toISOString(),
                  warning: true,
                  reasons: [],
                },
              });
            if (pathname.endsWith("/decision")) {
              decisions.push(JSON.parse(route.request().postData()).decision);
              return route.fulfill({
                json: {
                  decision: decisions.at(-1),
                  recipients: 400,
                  mode: "SIMULATED",
                },
              });
            }
            if (pathname.endsWith("/notifications"))
              return route.fulfill({
                json: {
                  published: true,
                  eligibleEmail: 300,
                  eligibleSms: 400,
                  mode: "SIMULATED",
                  deliveries: [
                    {
                      id: "email-1",
                      channel: "EMAIL",
                      recipient: "g•••@example.invalid",
                      status: "SENT_TO_PROVIDER",
                      email_status: "SENT_TO_PROVIDER",
                      updated_at: new Date().toISOString(),
                    },
                    {
                      id: "sms-1",
                      channel: "SMS",
                      recipient: "••• ••• 0123",
                      status: decisions.includes("APPROVED")
                        ? "SIMULATED"
                        : "APPROVED",
                      segments: 2,
                      estimated_micros: 24000,
                      actual_micros: null,
                      updated_at: new Date().toISOString(),
                    },
                  ],
                  events: decisions.map((d, i) => ({
                    id: "event-" + i,
                    kind: d === "CANCELED" ? "SMS_CANCELED" : "SMS_APPROVED",
                    created_at: new Date().toISOString(),
                    details: { synthetic: true },
                  })),
                },
              });
            return route.fulfill({ json: {} });
          },
        );
        await page.goto(origin + "/notification-qa");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ timeout: 10000 }).catch(async (e) => {
          console.log(await page.locator("body").innerText());
          throw e;
        });
        assert.equal(
          await page
            .getByRole("button", { name: "Cancel SMS", exact: true })
            .evaluate((el) => el === document.activeElement),
          true,
        );
        assert.deepEqual(decisions, []);
        const heading = await page
          .getByRole("heading", {
            name: "Send Photo Links by SMS?",
            exact: true,
          })
          .boundingBox();
        assert.ok(heading.y >= 0 && heading.y + heading.height < 1000);
        const cancel = await page
          .getByRole("button", { name: "Cancel SMS", exact: true })
          .boundingBox();
        assert.ok(cancel.y >= 0 && cancel.y + cancel.height <= 1000);
        assert.ok(await dialog.getByText("400", { exact: true }).count());
        await page.screenshot({
          path: path.join(os.tmpdir(), `lola-gallery-sms-confirm-${width}.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Cancel SMS", exact: true })
          .click();
        await dialog.waitFor({ state: "detached" });
        assert.deepEqual(decisions, ["CANCELED"]);
        await page
          .getByRole("button", { name: "Review SMS Delivery", exact: true })
          .click();
        await dialog.waitFor();
        await page
          .getByRole("button", { name: "Confirm & Send SMS", exact: true })
          .click();
        await dialog.waitFor({ state: "detached" });
        assert.deepEqual(decisions, ["CANCELED", "APPROVED"]);
        await page.screenshot({
          path: path.join(
            os.tmpdir(),
            `lola-gallery-notification-dashboard-${width}.png`,
          ),
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
);

test('event photo campaigns select an event, import Fiesta and confirm one grouped delivery on desktop/mobile',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:90000},async()=>{
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(os.tmpdir(),'lola-event-photo-campaign-ui'),plugins:[react(),{name:'event-photo-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/event-photo-qa'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;background:#f8f5ef;font-family:Arial}*{box-sizing:border-box}</style></head><body class="campaign-module"><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{BrowserRouter}from"react-router-dom";import Panel from"/src/components/campaigns/EventPhotoCampaign.jsx";import"/src/styles/campaign-module.css";createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(Panel,{can:()=>true,onClose:()=>{}})));</script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();const origin='http://127.0.0.1:'+vite.httpServer.address().port;
 for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:1000}}),writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let queued=false;
 await page.route('**/api/campaigns/event-photos/**',route=>{const req=route.request(),url=new URL(req.url()),body=req.method()==='GET'?null:req.postDataJSON();if(body)writes.push({path:url.pathname,body});
 if(url.pathname.endsWith('/options'))return route.fulfill({json:{events:[{id:'event-a',event_name:'Synthetic Wedding',event_date:'2035-12-01',galleries:[{id:'gallery-a',title:'Wedding photos',status:'PUBLISHED',fiestaEventCode:'PHOTOQA'}]},{id:'event-b',event_name:'Synthetic Conference',event_date:'2035-12-02',galleries:[{id:'gallery-b',title:'Conference',status:'DRAFT'}]}],staging:true,sms:{mode:'SIMULATED',liveSendingAvailable:false}}});
 if(url.pathname.endsWith('/import'))return route.fulfill({json:{matched:4,pending:1}});
 if(url.pathname.endsWith('/authorize'))return route.fulfill({json:{authorized:2}});
 if(url.pathname.endsWith('/review'))return route.fulfill({json:{id:'review-a',emails:1,sms:1,recipients:2,alreadyNotified:1,reasons:[],photoLinks:[{channel:'EMAIL',recipient:'g•••@example.invalid',photos:2},{channel:'SMS',recipient:'••• ••• 7770',photos:2}],smsReview:{segments:2,estimatedMicros:24000,sampleBody:'Your photos from The Lola Booth are ready! [recipient-specific link] Reply STOP to opt out.'}}});
 if(url.pathname.endsWith('/decision')){queued=true;return route.fulfill({json:{queued:2,decision:body.decision}});}
 return route.fulfill({json:{event:{id:url.pathname.split('/').at(-1)},publishedGalleries:1,importedContacts:3,duplicatesCombined:2,invalidContacts:0,unmatchedMappings:1,permissionExcluded:0,recipients:[{channel:'EMAIL',recipient:'g•••@example.invalid',photos:2,galleries:1,previousStatus:queued?'QUEUED':null},{channel:'SMS',recipient:'••• ••• 7770',photos:2,galleries:1,previousStatus:queued?'SIMULATED':null}],deliveries:queued?[{channel:'EMAIL',status:'QUEUED',count:1},{channel:'SMS',status:'SIMULATED',count:1}]:[],history:[]}});
 });
 await page.goto(origin+'/event-photo-qa');await page.getByLabel('Select photo delivery event').selectOption('event-a');await page.getByRole('heading',{name:'1. Match Fiesta contacts to event photos',exact:true}).waitFor();await page.getByText('Import a Fiesta Excel or CSV file',{exact:true}).click();await page.getByLabel('Original Fiesta sharing file',{exact:true}).setInputFiles({name:'Fiesta.csv',mimeType:'text/csv',buffer:Buffer.from('Synthetic CSV fixture')});await page.getByRole('button',{name:'Import contact-to-photo mapping',exact:true}).click();await page.getByRole('status').filter({hasText:'Fiesta mapping imported'}).waitFor();assert.equal(Buffer.from(writes[0].body.data,'base64').toString(),'Synthetic CSV fixture');assert.equal(writes[0].body.albumId,'gallery-a');
 await page.getByRole('checkbox',{name:'Text message · simulated in staging',exact:true}).check();await page.getByText('Record transactional photo-delivery permission',{exact:true}).click();await page.getByLabel('Source and wording of guest permission',{exact:true}).fill('Synthetic guests requested photo delivery during Fiesta sharing.');await page.getByRole('checkbox',{name:/I reviewed the source/}).check();await page.getByRole('button',{name:'Record photo-delivery permission',exact:true}).click();await page.getByRole('status').filter({hasText:'Photo-delivery permission recorded'}).waitFor();
 await page.getByRole('button',{name:'Review recipients & SMS cost',exact:true}).click();await page.getByRole('heading',{name:'Final delivery summary',exact:true}).waitFor();assert.equal(writes.filter(w=>w.path.endsWith('/decision')).length,0);assert.equal(await page.getByRole('button',{name:'Confirm & queue photo delivery',exact:true}).isEnabled(),false);await page.screenshot({path:path.join(os.tmpdir(),`lola-event-photo-campaign-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})))));await page.getByRole('checkbox',{name:/I reviewed the event, recipients/}).check();await page.getByRole('button',{name:'Confirm & queue photo delivery',exact:true}).click();await page.getByRole('status').filter({hasText:'Delivery queued once per contact'}).waitFor();assert.equal(writes.filter(w=>w.path.endsWith('/decision')).length,1);assert.deepEqual(writes.find(w=>w.path.endsWith('/review')).body.channels,['EMAIL','SMS']);await page.getByText('SMS · SIMULATED · 1',{exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();}
 }finally{await browser?.close();await vite.close();}
});
