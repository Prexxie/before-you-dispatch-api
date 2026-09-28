import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import routes from "./routes";

const app = express();

// credentials: true so the browser sends/keeps the vendor session cookie on
// cross-origin calls (a raw API origin, without the web app's /api proxy).
app.use(cors({ origin: env.corsOrigins, credentials: true }));
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
