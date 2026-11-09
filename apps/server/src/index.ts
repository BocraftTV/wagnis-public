import { ConfigError, loadConfig } from "./config.js";
import { buildApp, productionLogger } from "./app.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : "invalid configuration");
  process.exit(1);
}

const { app } = await buildApp({ config, logger: productionLogger });
await app.listen({ port: config.port, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
