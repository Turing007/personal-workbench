import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { FileStore } from '../../src/server/files/file-store';

const allTemporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-'));
  allTemporaryDirectories.push(directory);
  return directory;
}

function getColumnNames(database: DatabaseSync, tableName: string): string[] {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => String(row.name));
}

function getSetting(database: DatabaseSync, key: string): string | undefined {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? String(row.value) : undefined;
}

function createLegacyVersionFiveDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE customer_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      packaging_json TEXT NOT NULL DEFAULT '[]',
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      ordered_at TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      recipient_name TEXT NOT NULL DEFAULT '',
      recipient_info TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      tracking_no TEXT NOT NULL DEFAULT '',
      payment_note TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'label_pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      customer_product_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      packaging_name TEXT NOT NULL DEFAULT '',
      pack_count INTEGER NOT NULL CHECK (pack_count > 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      remark TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO settings (key, value, updated_at)
    VALUES ('schema_version', '5', '2026-08-11T00:00:00.000Z');
  `);
  return database;
}

function insertLegacyCustomerProduct(database: DatabaseSync, name: string): number {
  return Number(database
    .prepare(
      `INSERT INTO customer_products (name, sku, specification, created_at, updated_at)
       VALUES (?, 'OLD-001', '20V', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    )
    .run(name).lastInsertRowid);
}

function insertLegacyOrderWithItem(
  database: DatabaseSync,
  customerProductId: number,
  productName: string,
): number {
  const orderId = Number(database
    .prepare(
      `INSERT INTO orders (order_no, ordered_at, recipient_name, recipient_info, created_at, updated_at)
       VALUES ('LEGACY-001', '2026-08-11', '张三', '张三 13800000000 浙江省宁波市',
         '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    )
    .run().lastInsertRowid);
  database
    .prepare(
      `INSERT INTO order_items
        (order_id, customer_product_id, name, sku, specification, pack_count, quantity, created_at, updated_at)
       VALUES (?, ?, ?, 'OLD-001', '20V', 24, 48, '2026-08-11T00:00:00.000Z',
         '2026-08-11T00:00:00.000Z')`,
    )
    .run(orderId, customerProductId, productName);
  return orderId;
}

function insertCustomer(database: DatabaseSync, name: string): number {
  return Number(database
    .prepare(
      `INSERT INTO customers (name, created_at, updated_at)
       VALUES (?, '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    )
    .run(name).lastInsertRowid);
}

function insertCustomerProduct(
  database: DatabaseSync,
  customerId: number,
  name: string,
  specification: string,
): number {
  return Number(database
    .prepare(
      `INSERT INTO customer_products
        (customer_id, name, specification, created_at, updated_at)
       VALUES (?, ?, ?, '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    )
    .run(customerId, name, specification).lastInsertRowid);
}

function createLegacyParameterTables(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      purchase_price REAL,
      supplier TEXT NOT NULL DEFAULT '',
      colors_json TEXT NOT NULL DEFAULT '[]',
      battery_plugs_json TEXT NOT NULL DEFAULT '[]',
      accessories TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_id INTEGER NOT NULL,
      product_id INTEGER,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      image_relative_path TEXT,
      image_original_name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sales_document_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_document_id INTEGER NOT NULL,
      product_id INTEGER,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      product_code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      image_relative_path TEXT,
      image_original_name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

afterEach(async () => {
  await Promise.all(
    allTemporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SQLite database foundation', () => {
  it('creates customer scoped products and document snapshot columns', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);

    expect(getSetting(database, 'schema_version')).toBe('25');
    expect(getSetting(database, 'customer_products_v6_initialized')).toBe('1');
    expect(getColumnNames(database, 'customers')).toEqual(expect.arrayContaining([
      'id',
      'name',
      'contact_name',
      'contact_phone',
      'shipping_info',
      'invoice_title',
      'tax_no',
      'is_active',
      'created_at',
      'updated_at',
    ]));
    expect(getColumnNames(database, 'customer_products')).toEqual(expect.arrayContaining([
      'customer_id',
      'system_product_id',
      'pack_count',
      'latest_quote_cents',
      'final_price_cents',
      'source_quotation_id',
      'image_relative_path',
      'remark',
      'last_synced_at',
    ]));
    expect(getColumnNames(database, 'customer_products')).toContain('freight_per_box_cents');
    expect(getColumnNames(database, 'order_items')).toContain('freight_per_box_cents');
    expect(getColumnNames(database, 'orders')).toEqual(expect.arrayContaining([
      'customer_id',
      'customer_name',
      'customer_contact_name',
      'customer_contact_phone',
      'customer_shipping_info',
      'settlement_type',
      'amount_cents',
      'label_printed_at',
    ]));
    expect(getColumnNames(database, 'order_items')).toEqual(expect.arrayContaining([
      'customer_product_id',
      'unit_price_cents',
      'amount_cents',
    ]));
    expect(getColumnNames(database, 'quotations')).toEqual(expect.arrayContaining([
      'customer_id',
      'customer_products_synced_at',
    ]));
    expect(getColumnNames(database, 'quotation_items')).toEqual(expect.arrayContaining([
      'customer_product_id',
      'pack_count',
    ]));
    expect(getColumnNames(database, 'sales_documents')).toContain('customer_id');
    expect(getColumnNames(database, 'sales_document_items')).toEqual(expect.arrayContaining([
      'customer_product_id',
      'pack_count',
    ]));

    const customerIdColumn = database
      .prepare("PRAGMA table_info(customer_products)")
      .all()
      .find((row) => row.name === 'customer_id');
    expect(customerIdColumn?.notnull).toBe(1);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('clears legacy customer products once and preserves historical order item snapshots', () => {
    const database = createLegacyVersionFiveDatabase();
    const customerProductId = insertLegacyCustomerProduct(database, '旧客户电钻');
    const orderId = insertLegacyOrderWithItem(database, customerProductId, '旧客户电钻');

    migrateDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM customer_products').get()?.count).toBe(0);
    expect(database.prepare('SELECT name, sku, specification, pack_count, quantity, customer_product_id FROM order_items WHERE order_id = ?').get(orderId))
      .toMatchObject({
        name: '旧客户电钻',
        sku: 'OLD-001',
        specification: '20V',
        pack_count: 24,
        quantity: 48,
        customer_product_id: null,
      });
    expect(database.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count).toBe(1);
    expect(database.prepare('SELECT status, label_printed_at FROM orders WHERE id = ?').get(orderId)).toMatchObject({ status: 'pending_stock' });
    expect(getSetting(database, 'customer_products_v6_initialized')).toBe('1');
    expect(getSetting(database, 'schema_version')).toBe('25');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database
      .prepare('PRAGMA foreign_key_list(order_items)')
      .all()
      .find((row) => row.from === 'customer_product_id')?.table).toBe('customer_products');

    expect(() => database
      .prepare(
        `INSERT INTO customer_products (name, created_at, updated_at)
         VALUES ('缺少客户', '2026-08-11', '2026-08-11')`,
      )
      .run()).toThrow('customer_products.customer_id is required');

    const customerId = insertCustomer(database, '张三');
    const migratedProductId = insertCustomerProduct(database, customerId, '迁移后电钻', '20V');
    expect(() => database
      .prepare('UPDATE customer_products SET customer_id = NULL WHERE id = ?')
      .run(migratedProductId)).toThrow('customer_products.customer_id is required');

    database.close();
  });

  it('customers invoice fields default to an empty string and persist values', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);
    const inserted = database.prepare(
      `INSERT INTO customers (name, created_at, updated_at)
       VALUES ('开票客户', '2026-09-04', '2026-09-04')
       RETURNING invoice_title, tax_no`,
    ).get() as { invoice_title: string; tax_no: string };
    expect(inserted).toEqual({ invoice_title: '', tax_no: '' });

    database.prepare('UPDATE customers SET invoice_title = ?, tax_no = ? WHERE name = ?')
      .run('开票抬头', '91530100MA1A2B3C4D', '开票客户');
    const row = database.prepare('SELECT invoice_title, tax_no FROM customers WHERE name = ?')
      .get('开票客户') as { invoice_title: string; tax_no: string };
    expect(row).toEqual({ invoice_title: '开票抬头', tax_no: '91530100MA1A2B3C4D' });
    database.close();
  });

  it('orders settlement_type defaults to corporate and rejects unknown values', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);
    const inserted = database.prepare(
      `INSERT INTO orders (order_no, ordered_at, recipient_name, amount_cents, created_at, updated_at)
       VALUES ('ST-001', '2026-09-04', '张三', 10000, '2026-09-04', '2026-09-04')
       RETURNING settlement_type`,
    ).get() as { settlement_type: string };
    expect(inserted.settlement_type).toBe('corporate');

    database.prepare('UPDATE orders SET settlement_type = ? WHERE order_no = ?')
      .run('personal', 'ST-001');
    expect(database.prepare('SELECT settlement_type FROM orders WHERE order_no = ?')
      .get('ST-001') as { settlement_type: string }).toEqual({ settlement_type: 'personal' });

    expect(() => database.prepare(
      `INSERT INTO orders (order_no, ordered_at, recipient_name, amount_cents, settlement_type, created_at, updated_at)
       VALUES ('ST-002', '2026-09-04', '张三', 10000, 'unknown', '2026-09-04', '2026-09-04')`,
    ).run()).toThrow(/CHECK constraint failed/i);
    database.close();
  });

  it('runs version six migration repeatedly without clearing new customer products', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);
    const customerId = insertCustomer(database, '张三');
    insertCustomerProduct(database, customerId, '电钻', '20V');

    migrateDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM customer_products').get()?.count).toBe(1);
    expect(getSetting(database, 'schema_version')).toBe('25');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('rejects version six data with a missing initialization marker without clearing products or order links', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);
    const customerId = insertCustomer(database, '张三');
    const customerProductId = insertCustomerProduct(database, customerId, '电钻', '20V');
    const orderId = Number(database
      .prepare(
        `INSERT INTO orders
          (order_no, ordered_at, customer_id, customer_name, recipient_name, recipient_info, created_at, updated_at)
         VALUES ('V6-ORDER-001', '2026-08-11', ?, '张三', '张三', '张三 13800000000',
          '2026-08-11', '2026-08-11')`,
      )
      .run(customerId).lastInsertRowid);
    const orderItemId = Number(database
      .prepare(
        `INSERT INTO order_items
          (order_id, customer_product_id, name, sku, specification, pack_count, quantity, created_at, updated_at)
         VALUES (?, ?, '电钻', 'ZS-001', '20V', 24, 48, '2026-08-11', '2026-08-11')`,
      )
      .run(orderId, customerProductId).lastInsertRowid);

    database.prepare("DELETE FROM settings WHERE key = 'customer_products_v6_initialized'").run();
    const schemaVersionBefore = getSetting(database, 'schema_version');
    const markerBefore = getSetting(database, 'customer_products_v6_initialized');

    expect(() => migrateDatabase(database)).toThrow(/version 6 customer product structure conflicts with migration metadata/i);
    expect(database.prepare('SELECT customer_id, name, specification FROM customer_products WHERE id = ?').get(customerProductId))
      .toMatchObject({ customer_id: customerId, name: '电钻', specification: '20V' });
    expect(database.prepare('SELECT customer_product_id FROM order_items WHERE id = ?').get(orderItemId)?.customer_product_id)
      .toBe(customerProductId);
    expect(getSetting(database, 'schema_version')).toBe(schemaVersionBefore);
    expect(getSetting(database, 'customer_products_v6_initialized')).toBe(markerBefore);
    database.close();
  });

  it('treats an existing customer_id column with only null values as version six structure evidence', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE customer_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        specification TEXT NOT NULL DEFAULT '',
        packaging_json TEXT NOT NULL DEFAULT '[]',
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO customer_products
        (customer_id, name, sku, specification, created_at, updated_at)
      VALUES (NULL, '待恢复产品', 'RECOVER-001', '20V', '2026-08-11', '2026-08-11');
      INSERT INTO settings (key, value, updated_at)
      VALUES ('schema_version', '5', '2026-08-11');
    `);

    expect(() => migrateDatabase(database)).toThrow(/version 6 customer product structure conflicts with migration metadata/i);
    expect(database.prepare('SELECT customer_id, name, sku FROM customer_products').all()).toEqual([
      { customer_id: null, name: '待恢复产品', sku: 'RECOVER-001' },
    ]);
    expect(getSetting(database, 'schema_version')).toBe('5');
    expect(getSetting(database, 'customer_products_v6_initialized')).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'").get()).toBeUndefined();
    database.close();
  });

  it('rejects a future schema version before making any structural change', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO settings (key, value, updated_at)
      VALUES ('schema_version', ' 26 ', '2026-08-11');
    `);
    const schemaBefore = database
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all();

    expect(() => migrateDatabase(database)).toThrow('Unsupported database schema version 26; this application supports up to version 25');

    expect(database
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all()).toEqual(schemaBefore);
    expect(getSetting(database, 'schema_version')).toBe(' 26 ');
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()).toBeUndefined();
    database.close();
  });

  it('rejects a non-empty non-decimal schema version before making any structural change', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO settings (key, value, updated_at)
      VALUES ('schema_version', 'damaged', '2026-08-11');
    `);

    expect(() => migrateDatabase(database)).toThrow(
      "Invalid database schema version 'damaged'; expected a non-negative decimal integer",
    );
    expect(getSetting(database, 'schema_version')).toBe('damaged');
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()).toBeUndefined();
    database.close();
  });

  it('rejects migration inside an outer transaction even when the caller catches and commits', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('BEGIN');

    try {
      expect(() => migrateDatabase(database)).toThrow('Database migration cannot run inside an active transaction');
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }

    expect(database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()).toEqual([]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customers'").get()).toBeUndefined();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_products'").get()).toBeUndefined();
    database.close();
  });

  it('enforces customer product uniqueness for system and temporary products', () => {
    const database = new DatabaseSync(':memory:');
    migrateDatabase(database);
    const customerId = insertCustomer(database, '张三');
    const otherCustomerId = insertCustomer(database, '李四');
    const productId = Number(database
      .prepare(
        `INSERT INTO products (name, created_at, updated_at)
         VALUES ('系统电钻', '2026-08-11', '2026-08-11')`,
      )
      .run().lastInsertRowid);
    const insertSystemProduct = database.prepare(
      `INSERT INTO customer_products
        (customer_id, system_product_id, name, specification, created_at, updated_at)
       VALUES (?, ?, '系统电钻', '20V', '2026-08-11', '2026-08-11')`,
    );

    insertSystemProduct.run(customerId, productId);
    expect(() => insertSystemProduct.run(customerId, productId)).toThrow();
    expect(() => insertSystemProduct.run(otherCustomerId, productId)).not.toThrow();

    insertCustomerProduct(database, customerId, '临时电钻', '20V');
    expect(() => insertCustomerProduct(database, customerId, ' 临时电钻 ', ' 20v ')).toThrow();
    expect(() => insertCustomerProduct(database, customerId, '临时电钻', '18V')).not.toThrow();
    expect(() => insertCustomerProduct(database, otherCustomerId, '临时电钻', '20V')).not.toThrow();
    database.close();
  });

  it('creates the complete schema with WAL, foreign keys, and a unique order number', async () => {
    const directory = await makeTemporaryDirectory();
    const databasePath = join(directory, 'workbench.sqlite');
    const database = openDatabase(databasePath);

    migrateDatabase(database);

    const tableNames = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));

    expect(tableNames).toEqual([
      'carton_label_items',
      'carton_labels',
      'customer_product_attachments',
      'customer_products',
      'customers',
      'document_number_sequences',
      'finance_invoice_files',
      'finance_invoices',
      'finance_receipts',
      'order_contracts',
      'order_detail_images',
      'order_finance',
      'order_item_box_sizes',
      'order_item_requirement_attachments',
      'order_items',
      'order_number_sequences',
      'order_source_types',
      'orders',
      'payment_proofs',
      'print_histories',
      'print_history_labels',
      'product_attachments',
      'product_images',
      'product_packaging',
      'product_packaging_images',
      'product_purchase_quotes',
      'products',
      'quotation_custom_fields',
      'quotation_items',
      'quotations',
      'sales_document_items',
      'sales_documents',
      'sales_receipt_files',
      'sales_receipts',
      'sessions',
      'settings',
      'shipment_batch_orders',
      'shipment_batches',
      'shipments',
      'users',
    ]);

    expect(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(database.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(database.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get()?.value).toBe('25');
    expect(getColumnNames(database, 'product_packaging')).toEqual(expect.arrayContaining([
      'inner_size',
      'inner_weight',
      'outer_size',
    ]));
    expect(getColumnNames(database, 'orders')).toContain('shipping_cents');
    expect(database.prepare('SELECT name FROM order_source_types WHERE is_active = 1 ORDER BY id').all().map((row) => row.name)).toEqual(['微信', '1688']);

    for (const tableName of ['products', 'quotation_items', 'sales_document_items']) {
      expect(getColumnNames(database, tableName)).toContain('parameters');
    }

    const productDefault = database
      .prepare("INSERT INTO products (name, created_at, updated_at) VALUES ('默认参数产品', '2026-08-08', '2026-08-08') RETURNING parameters")
      .get() as { parameters: string };
    expect(productDefault.parameters).toBe('');

    migrateDatabase(database);
    expect(database.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get()?.value).toBe('25');

    const indexNames = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(indexNames).toEqual(expect.arrayContaining([
      'idx_quotation_custom_fields_quotation',
      'idx_quotation_items_product',
      'idx_quotation_items_quotation',
      'idx_quotations_status_updated',
      'idx_sales_document_items_document',
      'idx_sales_document_items_product',
      'idx_sales_documents_payment_status',
      'idx_sales_documents_source_quotation',
      'idx_sales_documents_status_updated',
      'idx_sales_receipt_files_receipt',
      'idx_sales_receipts_document',
    ]));

    expect(() => database.prepare("INSERT INTO document_number_sequences (document_type, sequence_date, last_value) VALUES ('invalid', '2026-08-08', 1)").run()).toThrow();
    expect(() => database.prepare("INSERT INTO quotations (number, status, quotation_date, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('BJ20260808001', 'invalid', '2026-08-08', '{}', '{}', '2026-08-08', '2026-08-08')").run()).toThrow();
    expect(() => database.prepare("INSERT INTO quotations (number, status, quotation_date, tax_rate_bps, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('BJ20260808001', 'draft', '2026-08-08', 10001, '{}', '{}', '2026-08-08', '2026-08-08')").run()).toThrow();

    const quotationId = Number(database
      .prepare("INSERT INTO quotations (number, status, quotation_date, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('BJ20260808001', 'draft', '2026-08-08', '{}', '{}', '2026-08-08', '2026-08-08')")
      .run().lastInsertRowid);
    const productId = Number(database
      .prepare("INSERT INTO products (name, created_at, updated_at) VALUES ('测试产品', '2026-08-08', '2026-08-08')")
      .run().lastInsertRowid);
    const quotationItemId = Number(database
      .prepare("INSERT INTO quotation_items (quotation_id, product_id, name, quantity, created_at, updated_at) VALUES (?, ?, '测试产品', 1, '2026-08-08', '2026-08-08')")
      .run(quotationId, productId).lastInsertRowid);
    database.prepare("INSERT INTO quotation_custom_fields (quotation_id, placement, label) VALUES (?, 'header', '联系人')").run(quotationId);
    const salesId = Number(database
      .prepare("INSERT INTO sales_documents (number, source_quotation_id, document_status, document_date, company_snapshot_json, display_config_json, created_at, updated_at) VALUES ('XS20260808001', ?, 'draft', '2026-08-08', '{}', '{}', '2026-08-08', '2026-08-08')")
      .run(quotationId).lastInsertRowid);
    const salesItemId = Number(database
      .prepare("INSERT INTO sales_document_items (sales_document_id, product_id, name, quantity, created_at, updated_at) VALUES (?, ?, '测试产品', 1, '2026-08-08', '2026-08-08')")
      .run(salesId, productId).lastInsertRowid);
    const receiptId = Number(database
      .prepare("INSERT INTO sales_receipts (sales_document_id, received_at, amount_cents, created_at, updated_at) VALUES (?, '2026-08-08', 100, '2026-08-08', '2026-08-08')")
      .run(salesId).lastInsertRowid);
    database.prepare("INSERT INTO sales_receipt_files (receipt_id, relative_path, original_name, mime_type, size_bytes, created_at) VALUES (?, 'sales-receipt-proofs/test.png', 'test.png', 'image/png', 1, '2026-08-08')").run(receiptId);

    database.prepare('DELETE FROM quotations WHERE id = ?').run(quotationId);
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotation_items WHERE id = ?').get(quotationItemId)?.count).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotation_custom_fields WHERE quotation_id = ?').get(quotationId)?.count).toBe(0);
    expect(database.prepare('SELECT source_quotation_id FROM sales_documents WHERE id = ?').get(salesId)?.source_quotation_id).toBeNull();
    expect(database.prepare('SELECT product_id FROM quotation_items WHERE id = ?').get(quotationItemId)?.product_id).toBeUndefined();
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_document_items WHERE id = ?').get(salesItemId)?.count).toBe(1);
    database.prepare('DELETE FROM sales_documents WHERE id = ?').run(salesId);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_document_items WHERE id = ?').get(salesItemId)?.count).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_receipts WHERE id = ?').get(receiptId)?.count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM sales_receipt_files WHERE receipt_id = ?").get(receiptId)?.count).toBe(0);

    database
      .prepare(
        `INSERT INTO orders
          (order_no, ordered_at, source_type, source_name, recipient_name, recipient_info, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'ORD-001',
        '2026-08-08T00:00:00.000Z',
        '微信',
        '测试客户',
        '张三',
        '张三 13800000000',
        100,
        'label_pending',
        '2026-08-08T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z',
      );

    expect(() =>
      database
        .prepare(
          `INSERT INTO orders
            (order_no, ordered_at, source_type, source_name, recipient_name, recipient_info, amount, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'ORD-001',
          '2026-08-08T00:00:00.000Z',
          '微信',
          '另一个客户',
          '李四',
          '李四 13900000000',
          200,
          'label_pending',
          '2026-08-08T00:00:00.000Z',
          '2026-08-08T00:00:00.000Z',
        ),
    ).toThrow();

    database.close();
  });

  it('upgrades legacy document tables and preserves parameter values on repeated migration', () => {
    const database = new DatabaseSync(':memory:');
    createLegacyParameterTables(database);

    const productId = Number(
      database
        .prepare("INSERT INTO products (name, sku, created_at, updated_at) VALUES ('旧产品', 'OLD-001', '2026-08-08', '2026-08-08')")
        .run().lastInsertRowid,
    );
    const quotationItemId = Number(
      database
        .prepare("INSERT INTO quotation_items (quotation_id, product_id, name, quantity, created_at, updated_at) VALUES (1, ?, '旧产品', 1, '2026-08-08', '2026-08-08')")
        .run(productId).lastInsertRowid,
    );
    const salesItemId = Number(
      database
        .prepare("INSERT INTO sales_document_items (sales_document_id, product_id, name, quantity, created_at, updated_at) VALUES (1, ?, '旧产品', 1, '2026-08-08', '2026-08-08')")
        .run(productId).lastInsertRowid,
    );

    migrateDatabase(database);

    for (const tableName of ['products', 'quotation_items', 'sales_document_items']) {
      expect(getColumnNames(database, tableName)).toContain('parameters');
    }
    expect(database.prepare('SELECT parameters FROM products WHERE id = ?').get(productId)?.parameters).toBe('');
    expect(database.prepare('SELECT parameters FROM quotation_items WHERE id = ?').get(quotationItemId)?.parameters).toBe('');
    expect(database.prepare('SELECT parameters FROM sales_document_items WHERE id = ?').get(salesItemId)?.parameters).toBe('');

    database.prepare("UPDATE products SET parameters = '扭矩：35N·m' WHERE id = ?").run(productId);
    database.prepare("UPDATE quotation_items SET parameters = '报价快照' WHERE id = ?").run(quotationItemId);
    database.prepare("UPDATE sales_document_items SET parameters = '销售快照' WHERE id = ?").run(salesItemId);

    migrateDatabase(database);

    expect(database.prepare('SELECT parameters FROM products WHERE id = ?').get(productId)?.parameters).toBe('扭矩：35N·m');
    expect(database.prepare('SELECT parameters FROM quotation_items WHERE id = ?').get(quotationItemId)?.parameters).toBe('报价快照');
    expect(database.prepare('SELECT parameters FROM sales_document_items WHERE id = ?').get(salesItemId)?.parameters).toBe('销售快照');
    database.close();
  });

  it('upgrades legacy packaging columns and derives an outer size without losing old dimensions', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        specification TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        purchase_price REAL,
        supplier TEXT NOT NULL DEFAULT '',
        colors_json TEXT NOT NULL DEFAULT '[]',
        battery_plugs_json TEXT NOT NULL DEFAULT '[]',
        accessories TEXT NOT NULL DEFAULT '',
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE product_packaging (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        outer_length REAL NOT NULL DEFAULT 0,
        outer_width REAL NOT NULL DEFAULT 0,
        outer_height REAL NOT NULL DEFAULT 0,
        outer_weight REAL NOT NULL DEFAULT 0,
        pack_count INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO products (name, created_at, updated_at) VALUES ('旧产品', '2026-08-08', '2026-08-08');
      INSERT INTO product_packaging (product_id, name, outer_length, outer_width, outer_height, pack_count, created_at, updated_at)
      VALUES (1, '彩盒包装', 35, 28, 20, 24, '2026-08-08', '2026-08-08');
    `);

    migrateDatabase(database);

    expect(getColumnNames(database, 'product_packaging')).toEqual(expect.arrayContaining([
      'inner_size',
      'inner_weight',
      'outer_size',
    ]));
    expect(database.prepare('SELECT outer_size FROM product_packaging WHERE id = 1').get()?.outer_size).toBe('35×28×20');

    migrateDatabase(database);
    expect(database.prepare('SELECT outer_size FROM product_packaging WHERE id = 1').get()?.outer_size).toBe('35×28×20');
    database.close();
  });

  it('rolls back schema changes when a migration write fails', () => {
    const database = new DatabaseSync(':memory:');
    createLegacyParameterTables(database);
    database.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TRIGGER fail_schema_version_insert
      BEFORE INSERT ON settings
      BEGIN
        SELECT RAISE(ABORT, 'forced migration failure');
      END;
    `);

    expect(() => migrateDatabase(database)).toThrow('forced migration failure');
    expect(getColumnNames(database, 'products')).not.toContain('parameters');
    expect(getColumnNames(database, 'quotation_items')).not.toContain('parameters');
    expect(getColumnNames(database, 'sales_document_items')).not.toContain('parameters');
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quotations'").get()).toBeUndefined();
    database.close();
  });

  it('rolls back every write made inside a failed transaction', async () => {
    const directory = await makeTemporaryDirectory();
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);

    expect(() =>
      withTransaction(database, (transactionDatabase) => {
        transactionDatabase
          .prepare(
            `INSERT INTO products
              (name, sku, specification, category, purchase_price, supplier, colors_json, battery_plugs_json, accessories, remark, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            '测试产品',
            'SKU-001',
            '标准',
            '',
            null,
            '',
            '[]',
            '[]',
            '',
            '',
            '2026-08-08T00:00:00.000Z',
            '2026-08-08T00:00:00.000Z',
          );
        throw new Error('force rollback');
      }),
    ).toThrow('force rollback');

    expect(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count).toBe(0);
    database.close();
  });

  it('product_images 的分类与备注列追加在表尾，历史图片默认归为产品图', async () => {
    // 备份恢复按位置复制（INSERT INTO main.t SELECT * FROM backup.t），
    // 因此新列只能在表尾，插到中间会让旧备份的列错位。
    const directory = await makeTemporaryDirectory();
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);

    expect(getColumnNames(database, 'product_images').slice(-2)).toEqual(['category', 'note']);
    expect(getSetting(database, 'schema_version')).toBe('25');

    database.prepare("INSERT INTO products (name, created_at, updated_at) VALUES ('临时代理产品', '2026-01-01', '2026-01-01')").run();
    database
      .prepare("INSERT INTO product_images (product_id, relative_path, original_name, mime_type, size_bytes, created_at) VALUES (1, 'product-images/legacy.png', '旧图.png', 'image/png', 5, '2026-01-01')")
      .run();
    expect(database.prepare('SELECT category, note FROM product_images WHERE relative_path = ?').get('product-images/legacy.png'))
      .toEqual({ category: 'product', note: '' });

    database.close();
  });

  it('旧库升级后同样把分类列补在表尾', () => {
    const database = createLegacyVersionFiveDatabase();
    migrateDatabase(database);

    expect(getColumnNames(database, 'product_images').slice(-2)).toEqual(['category', 'note']);
    expect(database.prepare("PRAGMA table_info(product_images)").all().filter((row) => row.name === 'category' || row.name === 'note').map((row) => row.notnull))
      .toEqual([1, 1]);
    database.close();
  });
});

describe('attachment file store', () => {
  it('stores allowed images below the configured directory with a generated safe name', async () => {
    const directory = await makeTemporaryDirectory();
    const store = new FileStore(join(directory, 'files'));

    const stored = await store.saveImage(
      Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47])]),
      'product',
      '产品图.png',
      'image/png',
    );

    expect(stored.relativePath).toMatch(/^product-images\/[0-9a-f-]+\.png$/);
    expect(stored.originalName).toBe('产品图.png');
    expect(stored.mimeType).toBe('image/png');
    expect(stored.size).toBe(4);
    expect(await readFile(store.resolvePublicPath(stored.relativePath))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    await store.deleteFile(stored.relativePath);
    await expect(stat(store.resolvePublicPath(stored.relativePath))).rejects.toThrow();
  });

  it('rejects unsupported MIME types and files larger than 10MB', async () => {
    const directory = await makeTemporaryDirectory();
    const store = new FileStore(join(directory, 'files'));

    await expect(
      store.saveImage(Readable.from([Buffer.from('not an image')]), 'payment', 'proof.gif', 'image/gif'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });

    const tooLarge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x01);
    await expect(
      store.saveImage(Readable.from([tooLarge]), 'payment', 'proof.png', 'image/png'),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
  });

  it('rejects absolute paths, traversal, and paths outside the two attachment directories', async () => {
    const directory = await makeTemporaryDirectory();
    const store = new FileStore(join(directory, 'files'));

    for (const unsafePath of [
      '../outside.png',
      'product-images/../payment-proofs/proof.png',
      'product-images/../../outside.png',
      'C:\\outside.png',
      '/outside.png',
      'other/proof.png',
    ]) {
      expect(() => store.resolvePublicPath(unsafePath)).toThrow();
      await expect(store.deleteFile(unsafePath)).rejects.toThrow();
    }
  });
});
