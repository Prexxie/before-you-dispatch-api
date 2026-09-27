import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./config/env";
import routes from "./routes";

const app = express();

app.use(cors({ origin: env.corsOrigins }));
app.use(express.json());
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
