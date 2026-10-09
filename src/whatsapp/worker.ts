import { createWhatsAppWorker } from "./queue.js";

const worker = createWhatsAppWorker();

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

console.log("WhatsApp worker started");
