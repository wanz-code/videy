// api/proxy.js
// Streams remote media through Vercel to bypass CORS and set a download header.
// WARNING: Do not use to infringe copyrights. For personal/authorized content only.

/** @type {import('@vercel/node').VercelApiHandler} */
module.exports = async (req, res) => {
  try {
    const u = (req.query.url || "").toString();
    if (!u) return res.status(400).json({ ok: false, error: "Missing ?url=" });

    let filename = (req.query.filename || "").toString().trim();
    const referer = (req.query.referer || "").toString().trim();

    const fileURL = new URL(u);
    if (!filename) {
      const last = fileURL.pathname.split("/").filter(Boolean).pop() || "video";
      filename = last.split("?")[0];
    }

    const upstream = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        ...(referer ? { "Referer": referer } : {}),
        ...(referer ? { "Origin": new URL(referer).origin } : {}),
      }
    });

    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: `Upstream error ${upstream.status}` });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuf = await upstream.arrayBuffer();
    res.status(200).send(Buffer.from(arrayBuf));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
