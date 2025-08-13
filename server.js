import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health & root
app.get("/", (_, res) => res.type("text").send("ingest-api OK"));
app.get("/healthz", (_, res) => res.json({ ok: true }));

const AUTH_TOKEN = process.env.AUTH_TOKEN || null;
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  const hdr = req.get("Authorization") || "";
  if (hdr === `Bearer ${AUTH_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

app.get("/", (_, res) => res.type("text").send("OK"));
app.get("/healthz", (_, res) => res.json({ ok: true }));

app.get("/render", async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url param" });
  const wait = Math.min(Math.max(parseInt(String(req.query.wait || "0"), 10) || 0, 0), 15000);
  const selector = typeof req.query.selector === "string" ? req.query.selector : null;

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox","--disable-setuid-sandbox"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; MedicalExRender/1.0)",
      javaScriptEnabled: true,
      viewport: { width: 1366, height: 768 }
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    if (selector) await page.waitForSelector(selector, { timeout: 20000 }).catch(()=>{});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    if (wait > 0) await page.waitForTimeout(wait);
    const html = await page.content();
    res.status(200).type("text/html").send(html);
  } catch (e) {
    console.error("RENDER ERROR:", e);
    res.status(500).json({ error: String(e) });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`render-api listening on :${port}`));
