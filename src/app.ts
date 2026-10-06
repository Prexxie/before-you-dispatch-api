import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import routes from "./routes";

const app = express();

// credentials: true so the browser sends/keeps the vendor session cookie on
// cross-origin calls (a raw API origin, without the web app's /api proxy).
app.use(cors({ origin: env.corsOrigins, credentials: true }));
// One line per request: time, method, path, status, duration. Customer and
// rider links carry secret tokens, so UUIDs in the path are replaced with
// ":token", and neither query strings nor request bodies are ever logged.
// /health is skipped (hosting platforms poll it constantly).
const UUID_IN_PATH =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0].replace(UUID_IN_PATH, ":token");
    if (path === "/health") return;
    console.log(
      `${new Date().toISOString()} ${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`,
    );
  });
  next();
});

// Token links are credentials: keep browsers and proxies from caching the
// responses behind them.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(routes);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

export default app;
