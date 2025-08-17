// api/videy.js
// Vercel Serverless Function: extract direct video URL(s) from a Videy page
// Works for https://videy.co/* (and mirrors) by scanning the HTML for mp4/m3u8 links.
// Returns both the raw URL (if accessible) and a /api/proxy URL to bypass CORS.
// Note: Respect copyright and only download content you own rights to.

/** @type {import('@vercel/node').VercelApiHandler} */
module.exports = async (req, res) => {
  try {
    const u = (req.query.url || req.body?.url || "").toString().trim();
    if (!u) {
      return res.status(400).json({ ok: false, error: "Missing ?url=" });
    }

    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid URL" });
    }

    // Allow common videy domains (relax if you use mirrors)
    const host = parsed.hostname.toLowerCase();
    const allowed = ["videy.co", "www.videy.co", "co.videy.app", "videy.app"];
    if (!allowed.some(h => host.endsWith(h))) {
      // You can choose to enforce:
      // return res.status(400).json({ ok: false, error: "URL must be a videy link" });
    }

    const pageResp = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!pageResp.ok) {
      return res.status(502).json({ ok: false, error: `Fetch failed: ${pageResp.status}` });
    }

    const html = await pageResp.text();

    // Heuristics: find direct media links (mp4/m3u8) in HTML/JS
    const links = new Set();
    const re = /(https?:\/\/[^"'\\s]+?\.(?:mp4|m3u8))(?:\?[^"'\\s]*)?/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const urlFound = m[0];
      if (urlFound.includes("blob:")) continue;
      links.add(urlFound);
    }

    // <video/src> or <source src="...">
    const reTag = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
    while ((m = reTag.exec(html)) !== null) {
      const src = m[1];
      if (/^https?:\/\//i.test(src) && (/\.(mp4|m3u8)(\?|$)/i.test(src))) {
        links.add(src);
      }
    }

    // JSON-ish: "file": "https://...mp4"
    const reJson = /["'](?:file|src|url)["']\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    while ((m = reJson.exec(html)) !== null) {
      links.add(m[1]);
    }

    if (!links.size) {
      return res.status(404).json({ ok: false, error: "No media URLs (mp4/m3u8) found on page." });
    }

    const all = Array.from(links);
    const mp4s = all.filter(x => /\.mp4(\?|$)/i.test(x));
    const m3u8s = all.filter(x => /\.m3u8(\?|$)/i.test(x));

    const pick = mp4s[0] || m3u8s[0];
    const type = /\.mp4/i.test(pick) ? "mp4" : "m3u8";

    // Try to read filename & size from HEAD (may be blocked by some CDNs)
    let filename = null;
    let sizeBytes = null;
    try {
      const headResp = await fetch(pick, {
        method: "HEAD",
        headers: {
          "Referer": u,
          "Origin": parsed.origin,
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (headResp.ok) {
        const disp = headResp.headers.get("content-disposition") || "";
        const len = headResp.headers.get("content-length");
        if (len) sizeBytes = parseInt(len, 10);
        const fnameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(disp || "");
        if (fnameMatch) filename = decodeURIComponent(fnameMatch[1] || fnameMatch[2]);
        if (!filename) {
          const urlPath = new URL(pick).pathname.split("/").filter(Boolean).pop() || "video";
          filename = urlPath.split("?")[0];
        }
      }
    } catch {}

    const proxyBase = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const proxyUrl = `${proxyBase}/api/proxy?url=${encodeURIComponent(pick)}&referer=${encodeURIComponent(u)}${filename ? `&filename=${encodeURIComponent(filename)}` : ""}`;

    return res.status(200).json({
      ok: true,
      type,
      pageUrl: u,
      rawUrl: pick,
      proxyUrl,
      filename,
      sizeBytes,
      found: { mp4: mp4s, m3u8: m3u8s }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
