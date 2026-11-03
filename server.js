// Generic HTTP API server (main process). Pure Node — no Electron imports,
// so it is requireable and testable from plain Node (see tests/run-tests.js).
const http = require("http");

/**
 * @param {object} cfg   { port, token, host }
 * @param {Function} handler  async ({ method, path, query, body }) => { status, body }
 * @param {Function} [onStatus] (status) => void   { running, port, host, error }
 */
function createApiServer(cfg, handler, onStatus) {
  let srv = null;
  let currentToken = cfg.token;

  function updateToken(t) { currentToken = t; }

  function start() {
    stop();
    srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 5e6) req.destroy(); // 5 MB request cap
      });
      req.on("end", async () => {
        try {
          const url = new URL(req.url, "http://localhost");

          // Token auth (only enforced when a token is configured)
          if (currentToken) {
            const auth = req.headers.authorization || "";
            if (auth !== "Bearer " + currentToken) {
              res.writeHead(401, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "unauthorized" }));
            }
          }

          let jsonBody = {};
          if (body) {
            try { jsonBody = JSON.parse(body); }
            catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ error: "invalid JSON body" }));
            }
          }

          const request = {
            method: req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            body: jsonBody,
          };
          const result = await handler(request);
          res.writeHead(result.status || 200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result.body ?? result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    srv.on("error", (err) => {
      onStatus && onStatus({
        running: false,
        error: err.code === "EADDRINUSE" ? "port " + cfg.port + " already in use" : err.message,
      });
    });

    srv.listen(cfg.port, cfg.host, () => {
      const port = srv.address().port;
      onStatus && onStatus({ running: true, port, host: cfg.host });
    });
  }

  function stop() {
    if (srv) { try { srv.close(); } catch {} srv = null; }
  }

  return { start, stop, updateToken };
}

module.exports = { createApiServer };
