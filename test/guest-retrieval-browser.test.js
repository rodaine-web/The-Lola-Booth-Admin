import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
test(
  "guest retrieval requires full email confirmation and provides safe recovery at desktop/mobile sizes",
  { skip: process.env.KEEPSAKES_BROWSER_TEST !== "true", timeout: 120000 },
  async () => {
    const output = path.join(os.tmpdir(), "lola-guest-retrieval-browser");
    await fs.mkdir(output, { recursive: true });
    const vite = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: path.join(os.tmpdir(), "lola-guest-ui-cache"),
      plugins: [
        react(),
        {
          name: "guest-retrieval-fixture",
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (!req.url?.startsWith("/guest-qa")) return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await server.transformIndexHtml(
                  req.url,
                  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{BrowserRouter,Routes,Route}from"react-router-dom";import{KeepsakesPhotos}from"/src/contexts/KeepsakesPhotos.jsx";import{FindPhotos,CheckEmail}from"/src/components/KeepsakesPhotoJourney.jsx";import"/src/styles/keepsakes-shop.css";createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(KeepsakesPhotos,null,React.createElement("main",{className:"lola-shop"},React.createElement(Routes,null,React.createElement(Route,{path:"/guest-qa",element:React.createElement(FindPhotos,{journeyBase:"/guest-qa"})}),React.createElement(Route,{path:"/guest-qa/check-email",element:React.createElement(CheckEmail,{journeyBase:"/guest-qa"})}))))));</script></body></html>',
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
      for (const width of [1440, 390, 320]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
          }),
          errors = [],
          confirmations = [];
        let returning = false;
        page.setDefaultTimeout(10000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(
          (url) => url.pathname.startsWith("/api/"),
          async (route) => {
            const p = new URL(route.request().url()).pathname;
            if (p.endsWith("/retrieval/start"))
              return route.fulfill({
                json: {
                  challenge: "synthetic-challenge",
                  sessionToken: "synthetic-session",
                  mode: returning ? "RETURNING" : "EMAIL_REQUIRED",
                  maskedEmail: returning ? "j••••@g••••.com" : null,
                },
              });
            if (p.endsWith("/retrieval/confirm")) {
              confirmations.push(route.request().postDataJSON());
              return route.fulfill({ json: { accepted: true } });
            }
            return route.fulfill({ json: {} });
          },
        );
        await page.goto(origin + "/guest-qa", {
          waitUntil: "domcontentloaded",
        });
        await page.getByRole("tab", { name: "Phone", exact: true }).click();
        await page
          .getByLabel("Your phone number", { exact: true })
          .fill("3125550123");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "Add Your Retrieval Email",
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("button", {
            name: "Confirm & Send My Photos",
            exact: true,
          })
          .click();
        assert.equal(
          confirmations.length,
          0,
          "Email is required, not a yes/no confirmation",
        );
        await page
          .getByLabel("Your retrieval email address", { exact: true })
          .fill("jordan@gmail.com");
        await page
          .getByRole("button", {
            name: "Confirm & Send My Photos",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: "Photo Link Requested", exact: true })
          .waitFor();
        assert.equal(confirmations.length, 1);
        returning = true;
        await page.goto(origin + "/guest-qa", {
          waitUntil: "domcontentloaded",
        });
        await page.getByRole("tab", { name: "Phone", exact: true }).click();
        await page
          .getByLabel("Your phone number", { exact: true })
          .fill("3125550123");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Welcome Back!", exact: true })
          .waitFor();
        assert.equal(
          await page.getByText("j••••@g••••.com", { exact: true }).count(),
          1,
        );
        assert.ok(
          !(await page.locator("body").innerText()).includes(
            "jordan@gmail.com",
          ),
        );
        assert.equal(
          await page
            .getByRole("link", { name: "Contact support", exact: true })
            .getAttribute("href"),
          "https://staging.thelolabooth.com/contact.html",
        );
        assert.equal(
          await page.getByRole("button", { name: "Yes", exact: true }).count(),
          0,
        );
        assert.equal(await page.locator('a[href*="#code="]').count(), 0);
        await page.screenshot({
          path: path.join(output, `returning-${width}.png`),
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page
          .getByLabel("Confirm Your Email Address", { exact: true })
          .fill("jordan@gmail.com");
        await page
          .getByRole("button", {
            name: "Confirm & Send My Photos",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: "Photo Link Requested", exact: true })
          .waitFor();
        assert.equal(confirmations.length, 2);
        assert.deepEqual(Object.keys(confirmations[1]).sort(), [
          "challenge",
          "email",
          "sessionToken",
        ]);
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
);

test(
  "Admin retrieval corrections require an explicit identity review on desktop/mobile",
  { skip: process.env.KEEPSAKES_BROWSER_TEST !== "true", timeout: 60000 },
  async () => {
    const output = path.join(os.tmpdir(), "lola-guest-retrieval-browser");
    await fs.mkdir(output, { recursive: true });
    const vite = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: path.join(os.tmpdir(), "lola-guest-admin-ui-cache"),
      plugins: [
        react(),
        {
          name: "guest-admin-fixture",
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (!req.url?.startsWith("/guest-admin-qa")) return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await server.transformIndexHtml(
                  req.url,
                  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import View from"/src/components/GalleryGuestRetrieval.jsx";import"/src/styles/global.css";import"/src/styles/experience.css";createRoot(document.getElementById("root")).render(React.createElement("main",{className:"page"},React.createElement(View,{albumId:"synthetic-album",canCorrect:true})));</script></body></html>',
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
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
          }),
          updates = [],
          errors = [];
        let restricted = true,
          masked = "j••••@g••••.com";
        page.setDefaultTimeout(10000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(
          (url) => url.pathname.startsWith("/api/"),
          async (route) => {
            const req = route.request(),
              p = new URL(req.url()).pathname;
            if (req.method() === "PUT") {
              const input = req.postDataJSON();
              updates.push({ path: p, input });
              if (p.endsWith("/restriction")) restricted = input.restricted;
              else masked = "n••••@e••••.invalid";
            }
            return route.fulfill({
              json: {
                restricted,
                addresses: [
                  {
                    id: "synthetic-address",
                    name: "Synthetic Guest",
                    maskedEmail: masked,
                    status: "ACTIVE",
                    verificationStatus: "UNVERIFIED",
                    version: 1,
                  },
                ],
              },
            });
          },
        );
        await page.goto(origin + "/guest-admin-qa", {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("heading", { name: "Guest Retrieval Emails", exact: true })
          .waitFor();
        await page
          .getByLabel(
            "Restrict temporary phone retrieval and hide masked email hints",
            { exact: true },
          )
          .click();
        await page
          .getByText(
            "Temporary phone retrieval enabled for this Gallery. Guest addresses remain unverified.",
            { exact: true },
          )
          .waitFor();
        await page
          .getByRole("button", { name: "Review & Correct", exact: true })
          .click();
        const save = page.getByRole("button", {
          name: "Save Audited Correction",
          exact: true,
        });
        assert.equal(await save.isEnabled(), false);
        await page
          .getByLabel("Corrected retrieval email", { exact: true })
          .fill("new@example.invalid");
        await page
          .getByLabel("Identity review evidence", { exact: true })
          .fill(
            "Synthetic identity review against original event guest records.",
          );
        await page
          .getByLabel(
            "I reviewed the guest’s identity and authority for this event’s photos.",
            { exact: true },
          )
          .check();
        assert.equal(await save.isEnabled(), true);
        await page.screenshot({
          path: path.join(output, `admin-${width}.png`),
          fullPage: true,
        });
        await save.click();
        await page
          .getByText(
            "Correction recorded. Previous retrieval links and sessions no longer grant access through this association.",
            { exact: true },
          )
          .waitFor();
        assert.equal(updates.at(-1).input.reviewed, true);
        assert.equal(updates.at(-1).input.email, "new@example.invalid");
        assert.equal(
          await page.getByText("n••••@e••••.invalid", { exact: true }).count(),
          1,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser?.close();
      await vite.close();
    }
  },
);
