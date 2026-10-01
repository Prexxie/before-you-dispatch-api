import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`WakaRoute API listening on port ${env.port}`);
});
