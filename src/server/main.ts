import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { FileStore } from './files/file-store.js';
import { createApp } from './app.js';

export async function startServer() {
  await Promise.all([
    mkdir(config.dataDirectory, { recursive: true }),
    mkdir(config.productImagesDirectory, { recursive: true }),
    mkdir(config.customerProductImagesDirectory, { recursive: true }),
    mkdir(config.paymentProofsDirectory, { recursive: true }),
    mkdir(config.orderContractsDirectory, { recursive: true }),
    mkdir(config.orderDetailImagesDirectory, { recursive: true }),
    mkdir(config.productAttachmentsDirectory, { recursive: true }),
    mkdir(config.customerProductAttachmentsDirectory, { recursive: true }),
    mkdir(config.orderItemRequirementsDirectory, { recursive: true }),
    mkdir(config.companyLogosDirectory, { recursive: true }),
    mkdir(config.quotationAssetsDirectory, { recursive: true }),
    mkdir(config.salesDocumentAssetsDirectory, { recursive: true }),
    mkdir(config.salesReceiptProofsDirectory, { recursive: true }),
    mkdir(config.financeInvoicesDirectory, { recursive: true }),
    mkdir(config.backupsDirectory, { recursive: true }),
  ]);

  const database = openDatabase(config.databasePath);
  migrateDatabase(database);
  const clientDirectory = resolve(config.projectDirectory, 'dist', 'client');
  let serveClient = false;
  try {
    serveClient = (await stat(resolve(clientDirectory, 'index.html'))).isFile();
  } catch {
    // In development Vite serves the client separately. Production startup
    // scripts verify the build output before launching this process.
  }
  const app = await createApp({
    database,
    databasePath: config.databasePath,
    dataDirectory: config.dataDirectory,
    filesDirectory: config.filesDirectory,
    backupsDirectory: config.backupsDirectory,
    ...(serveClient ? { clientDirectory } : {}),
    fileStore: new FileStore(config.filesDirectory, config.maxImageSize, config.maxContractSize),
    logger: true,
  });

  app.addHook('onClose', async () => closeDatabase(database));
  await app.listen({ host: config.host, port: config.port });
  return { app, database };
}

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await startServer();
}
