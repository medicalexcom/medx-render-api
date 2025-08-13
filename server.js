// medx-render-api/server.js (resilient)
import express from "express";
import cors from "cors";
import { chromium } from "playwright";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const AUTH_TOKEN = process.env.AUTH_TOKEN || null;
app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  const hdr = req.get("Authorization") || "";
  if (hdr === `Bearer ${AUTH_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

app.get("/", (_, res) => res.type("text").send("OK"));
app.get("/healthz", (_, res) => res.json({ ok: true }));

// Small helper to clamp numbers
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * GET /render?url=...&wait=ms&selector=.css&timeout=ms&mode=fast|full
 * - wait: extra settle time (0..15000)
 * - selector: CSS to wait for (optional)
 * - timeout: overall nav timeout (10000..90000)
 * - mode: "fast" blocks heavy resources; "full" loads everything (default: fast)
 */
app.get("/render", async (req, res) => {
  const url = String(req.query.url || "");
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Missing or invalid url param" });
  }
  const extraWaitMs = clamp(parseInt(String(req.query.wait || "0"), 10) || 0, 0, 15000);
  const selector = typeof req.query.selector === "string" ? req.query.selector : null;
  const mode = (String(req.query.mode || "fast").toLowerCase() === "full") ? "full" : "fast";
  const navTimeout = clamp(parseInt(String(req.query.timeout || "45000"), 10) || 45000, 10000, 90000);

  let browser;
  try {
    browser = await chromium.launch({
      // required on many hosts
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Chicago",
      javaScriptEnabled: true,
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
    });

    const page = await ctx.newPage();

    // Optional request routing: in "fast" mode, skip heavy assets to stabilize pages faster
    if (mode === "fast") {
      await page.route("**/*", (route) => {
        const req = route.request();
        const type = req.resourceType();
        if (type === "image" || type === "media" || type === "font") {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Useful debug logs (visible in Render logs)
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") {
        console.log(`[page:${t}]`, msg.text());
      }
    });
    page.on("pageerror", (err) => console.log("[pageerror]", String(err)));

    // Robust navigation with retries and multiple wait strategies
    const strategies = [
      { waitUntil: "domcontentloaded" },
      { waitUntil: "networkidle" }
    ];

    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      for (const strat of strategies) {
        try {
          await page.goto(url, { ...strat, timeout: navTimeout });
          // Optional selector wait
          if (selector) {
            await page.waitForSelector(selector, { timeout: Math.min(20000, navTimeout) });
          }
          // Network idle settle
          await page.waitForLoadState("networkidle", { timeout: Math.min(15000, navTimeout) }).catch(() => {});
          if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
          const html = await page.content();
          return res.status(200).type("text/html").send(html);
        } catch (e) {
          lastError = e;
          console.warn(`Nav attempt failed (attempt ${attempt}, ${strat.waitUntil}):`, String(e));
          // small pause before next try
          await page.waitForTimeout(600);
        }
      }
      // Try a soft reload before a second round
      try { await page.reload({ waitUntil: "domcontentloaded", timeout: navTimeout }); } catch {}
    }

    console.error("RENDER ERROR final:", String(lastError || "Unknown"));
    return res.status(504).json({ error: "Render timed out", detail: String(lastError || "") });
  } catch (e) {
    console.error("RENDER FATAL:", e);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`render-api listening on :${port}`));
