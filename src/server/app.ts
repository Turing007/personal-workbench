import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { MAX_CONTRACT_SIZE } from './config.js';
import { AuthService, SESSION_COOKIE } from './auth/auth-service.js';
import { UserRepository } from './auth/user-repository.js';
import { createRepositories, type DatabaseRepositories } from './db/repositories.js';
import { FileStore } from './files/file-store.js';
import { BackupService } from './backup/backup-service.js';
import { AutoBackupService } from './backup/auto-backup-service.js';
import { DocumentAssetManager } from './documents/document-assets.js';
import { QuotationRepository } from './db/quotation-repository.js';
import { SalesDocumentRepository } from './db/sales-document-repository.js';
import { SettingsRepository } from './db/settings-repository.js';
import { ApiError, sendFailure } from './routes/api-response.js';
import { AUTH_PUBLIC_PATHS, registerAuthRoutes } from './routes/auth.js';
import { registerCustomerProductRoutes } from './routes/customer-products.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProductRoutes } from './routes/products.js';
import { registerOrderRoutes, registerPaymentProofDeleteRoute } from './routes/orders.js';
import { CustomerRepository } from './db/customer-repository.js';
import { CustomerProductRepository } from './db/customer-product-repository.js';
import { registerLabelRoutes } from './routes/labels.js';
import { registerShippingRoutes } from './routes/shipping.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerDocumentCustomerRoutes } from './routes/document-customers.js';
import { registerQuotationRoutes } from './routes/quotations.js';
import { registerSalesDocumentRoutes } from './routes/sales-documents.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerCustomerRoutes } from './routes/customers.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { registerStockRoutes } from './routes/stock.js';
import { StockRepository } from './db/stock-repository.js';
import { StockPreparationService } from './services/stock-service.js';
import { FinanceService } from './services/finance-service.js';
import { OrderService } from './services/order-service.js';
import { DocumentCustomerService } from './services/document-customer-service.js';
import { QuotationService } from './services/quotation-service.js';
import { SalesDocumentService } from './services/sales-document-service.js';
import { SettingsService } from './services/settings-service.js';
import { CustomerService } from './services/customer-service.js';
import { CustomerProductService } from './services/customer-product-service.js';
import { QuotationCustomerProductSyncService } from './services/quotation-customer-product-sync-service.js';

export interface AppOptions {
  database: DatabaseSync;
  repositories?: DatabaseRepositories;
  fileStore?: FileStore;
  databasePath?: string;
  dataDirectory?: string;
  filesDirectory?: string;
  backupsDirectory?: string;
  clientDirectory?: string;
  logger?: boolean;
  /** 反向代理（如 Caddy）部署时置 true，使 Cookie 的 secure 属性跟随 X-Forwarded-Proto。 */
  trustProxy?: boolean;
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: options.trustProxy ?? false });
  const repositories = options.repositories ?? createRepositories(options.database);
  const authService = new AuthService(new UserRepository(options.database));

  await app.register(cookie);

  // 鉴权门：/api/* 与 /files/* 需要有效会话；静态资源与健康检查保持公开，
  // 登录页本身也依赖静态资源才能渲染。
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    const isApi = pathname.startsWith('/api/');
    const isFiles = pathname.startsWith('/files/');
    if (!isApi && !isFiles) return;
    if (isApi && AUTH_PUBLIC_PATHS.has(pathname)) return;
    const user = authService.resolveSession(request.cookies[SESSION_COOKIE]);
    if (!user) {
      return reply.status(401).send({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: '请先登录' },
      });
    }
    request.user = user;
  });

  await registerAuthRoutes(app, { service: authService });

  await app.register(multipart, {
    limits: {
      files: 50,
      fields: 12,
      parts: 80,
      fileSize: MAX_CONTRACT_SIZE,
    },
  });

  if (options.clientDirectory) {
    if (options.filesDirectory) {
      await app.register(fastifyStatic, {
        root: resolve(options.filesDirectory),
        prefix: '/files/',
        decorateReply: false,
      });
    }
    await app.register(fastifyStatic, {
      root: resolve(options.clientDirectory),
      prefix: '/',
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return sendFailure(reply, error);
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return sendFailure(reply, new ApiError(413, 'FILE_TOO_LARGE', '文件不能超过 20MB'));
    }
    if (code === 'FST_FILES_LIMIT') {
      return sendFailure(reply, new ApiError(413, 'FILES_LIMIT', '一次最多上传 50 张图片'));
    }
    if (code === 'FST_FIELDS_LIMIT') {
      return sendFailure(reply, new ApiError(413, 'FIELDS_LIMIT', '表单字段数量超出限制'));
    }
    if (code === 'FST_PARTS_LIMIT') {
      return sendFailure(reply, new ApiError(413, 'PARTS_LIMIT', '表单内容数量超出限制'));
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) {
      return sendFailure(reply, new ApiError(413, 'FILE_TOO_LARGE', '文件不能超过 20MB'));
    }
    // 未映射的异常必须留痕，否则线上只剩一句“服务器处理请求失败”无从排查。
    app.log.error(error);
    return sendFailure(reply, new ApiError(500, 'INTERNAL_ERROR', '服务器处理请求失败'));
  });

  await registerHealthRoutes(app);
  await registerProductRoutes(app, { repositories, fileStore: options.fileStore });
  const customerRepository = new CustomerRepository(options.database);
  const customerProductRepository = new CustomerProductRepository(options.database);
  await registerCustomerProductRoutes(app, {
    service: new CustomerProductService(
      customerProductRepository,
      customerRepository,
      (systemProductId) => Boolean(repositories.getProduct(systemProductId)),
    ),
    fileStore: options.fileStore,
  });
  await registerCustomerRoutes(app, {
    service: new CustomerService(customerRepository),
  });
  const settingsRepository = new SettingsRepository(options.database);
  const orderOptions = {
    repositories,
    customerRepository,
    customerProductRepository,
    fileStore: options.fileStore,
    settingsRepository,
  };
  const orderService = new OrderService(orderOptions);
  await registerOrderRoutes(app, { ...orderOptions, service: orderService });
  await registerPaymentProofDeleteRoute(app, orderOptions);
  await registerFinanceRoutes(app, {
    service: new FinanceService({ database: options.database, fileStore: options.fileStore }),
    fileStore: options.fileStore,
  });
  await registerLabelRoutes(app, { repositories });
  await registerShippingRoutes(app, { repositories });
  await registerStockRoutes(app, {
    service: new StockPreparationService(new StockRepository(options.database)),
  });

  const quotationRepository = new QuotationRepository(options.database);
  const salesDocumentRepository = new SalesDocumentRepository(options.database);
  const documentAssetManager = options.fileStore
    ? new DocumentAssetManager(options.fileStore, (productId, relativePath, customerProductId) => {
      // 客户产品行：允许客户产品自己的图片，或其关联系统产品的图片
      if (customerProductId != null) {
        return Boolean(options.database.prepare(
          `SELECT 1 FROM customer_products
            WHERE id = ?
              AND (image_relative_path = ?
                OR (system_product_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM product_images WHERE product_id = system_product_id AND relative_path = ?)))`,
        ).get(customerProductId, relativePath, relativePath));
      }
      if (productId == null) return false;
      return Boolean(options.database.prepare(
        'SELECT 1 FROM product_images WHERE product_id = ? AND relative_path = ?',
      ).get(productId, relativePath));
    })
    : undefined;
  const assetManager = documentAssetManager && options.fileStore
    ? {
      prepareItemImages: (...args: Parameters<DocumentAssetManager['prepareItemImages']>) => documentAssetManager.prepareItemImages(...args),
      prepareCompanyLogo: (...args: Parameters<DocumentAssetManager['prepareCompanyLogo']>) => documentAssetManager.prepareCompanyLogo(...args),
      commit: (...args: Parameters<DocumentAssetManager['commit']>) => documentAssetManager.commit(...args),
      rollback: (...args: Parameters<DocumentAssetManager['rollback']>) => documentAssetManager.rollback(...args),
      deleteFile: (relativePath: string) => options.fileStore!.deleteFile(relativePath),
    }
    : undefined;
  const quotationService = new QuotationService({
    database: options.database,
    repository: quotationRepository,
    settingsRepository,
    customerRepository,
    customerProductRepository,
    assetManager,
  });
  const salesDocumentService = new SalesDocumentService({
    database: options.database,
    repository: salesDocumentRepository,
    quotationRepository,
    customerRepository,
    customerProductRepository,
    settingsRepository,
    assetManager,
    sourceFileReader: options.fileStore,
    receiptFileStore: options.fileStore,
    orderService,
  });

  await registerSettingsRoutes(app, {
    service: new SettingsService(settingsRepository, options.fileStore),
  });
  await registerDocumentCustomerRoutes(app, {
    service: new DocumentCustomerService(options.database),
  });
  await registerQuotationRoutes(app, {
    service: quotationService,
    fileStore: options.fileStore,
    customerProductSyncService: new QuotationCustomerProductSyncService(options.database, {
      quotationRepository,
      customerRepository,
      customerProductRepository,
    }),
    copyQuotationToSales: (quotationId) => salesDocumentService.createFromQuotation(quotationId),
  });
  await registerSalesDocumentRoutes(app, {
    service: salesDocumentService,
    fileStore: options.fileStore,
  });

  if (options.databasePath && options.dataDirectory && options.backupsDirectory) {
    const backupService = new BackupService({
      database: options.database,
      databasePath: options.databasePath,
      dataDirectory: options.dataDirectory,
      backupsDirectory: options.backupsDirectory,
    });
    // 每日自动备份：启动即补跑当天缺失的备份，之后每天 03:00（本机时间）触发。
    // 目录/保留数等设置持久化在 settings 表，重启后依然生效。
    const autoBackupService = new AutoBackupService({
      database: options.database,
      backupService,
      backupsDirectory: options.backupsDirectory,
      loadSettings: () => settingsRepository.getAutoBackupSettings(),
      saveSettings: (settings) => settingsRepository.saveAutoBackupSettings(settings),
    });
    void autoBackupService.start().catch((error) => {
      app.log.error(error, '自动备份初始化失败');
    });
    app.addHook('onClose', async () => autoBackupService.stop());
    await registerBackupRoutes(app, { service: backupService, backupsDirectory: options.backupsDirectory, autoBackupService });
  }

  if (options.clientDirectory) {
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0];
      if (pathname.startsWith('/api/')) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export const buildApp = createApp;
