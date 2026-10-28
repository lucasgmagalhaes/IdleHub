// Serves bench/fixtures and collects the stats game pages POST to /stats.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };

export async function startFixtureServer(root) {
  /** Latest report per tab id. */
  const latest = new Map();
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/stats") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const report = JSON.parse(body);
        latest.set(report.tab, report);
      } catch {}
      res.writeHead(204).end();
      return;
    }
    const path = normalize(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    try {
      const data = await readFile(join(root, path || "index.html"));
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    /** Copy of the latest report of every tab. */
    snapshot: () => new Map([...latest].map(([tab, report]) => [tab, { ...report }])),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
