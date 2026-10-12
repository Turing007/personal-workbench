import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import { migratePackagingColumns } from './packaging.js';
import { sortByImageLeadNumber } from '../../shared/product-image-order.js';
import { mergeAccessoryPrices, normalizeAccessoryPrices, parseLegacyAccessoriesText } from '../../shared/accessory-prices.js';
import { buildBatteryMatrixSeed } from '../../shared/battery-prices.js';

/** 当前数据库结构版本：新增迁移时同步提升，preflight 校验与写入共用同一个值。 */
const CURRENT_SCHEMA_VERSION = 33;

const schemaSql = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  parameters TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  purchase_price REAL,
  supplier TEXT NOT NULL DEFAULT '',
  colors_json TEXT NOT NULL DEFAULT '[]',
  battery_plugs_json TEXT NOT NULL DEFAULT '[]',
  accessories TEXT NOT NULL DEFAULT '',
  accessory_prices TEXT NOT NULL DEFAULT '[]',
  accessory_prices_customized INTEGER NOT NULL DEFAULT 0,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_packaging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  inner_size TEXT NOT NULL DEFAULT '',
  inner_weight REAL NOT NULL DEFAULT 0,
  outer_size TEXT NOT NULL DEFAULT '',
  outer_length REAL NOT NULL DEFAULT 0,
  outer_width REAL NOT NULL DEFAULT 0,
  outer_height REAL NOT NULL DEFAULT 0,
  outer_weight REAL NOT NULL DEFAULT 0,
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  purchase_price REAL CHECK (purchase_price IS NULL OR purchase_price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_packaging_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packaging_id INTEGER NOT NULL REFERENCES product_packaging(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_purchase_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  shipping_info TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  system_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  specification TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  latest_quote_cents INTEGER CHECK (latest_quote_cents IS NULL OR latest_quote_cents >= 0),
  final_price_cents INTEGER CHECK (final_price_cents IS NULL OR final_price_cents >= 0),
  cost_price_cents INTEGER CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0),
  freight_per_box_cents INTEGER CHECK (freight_per_box_cents IS NULL OR freight_per_box_cents >= 0),
  packaging_json TEXT NOT NULL DEFAULT '[]',
  source_quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
  image_relative_path TEXT,
  remark TEXT NOT NULL DEFAULT '',
  label_requirement TEXT NOT NULL DEFAULT '',
  instruction_requirement TEXT NOT NULL DEFAULT '',
  packaging_requirement TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_product_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_product_id INTEGER NOT NULL REFERENCES customer_products(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  category TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_contact_name TEXT NOT NULL DEFAULT '',
  customer_contact_phone TEXT NOT NULL DEFAULT '',
  customer_shipping_info TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL UNIQUE,
  ordered_at TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_info TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tracking_no TEXT NOT NULL DEFAULT '',
  payment_note TEXT NOT NULL DEFAULT '',
  order_detail TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_stock',
  label_printed_at TEXT,
  source_sales_document_id INTEGER REFERENCES sales_documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_number_sequences (
  sequence_date TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL CHECK (last_value > 0)
);

CREATE TABLE IF NOT EXISTS order_source_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_product_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  packaging_name TEXT NOT NULL DEFAULT '',
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  freight_per_box_cents INTEGER NOT NULL DEFAULT 0 CHECK (freight_per_box_cents >= 0),
  remark TEXT NOT NULL DEFAULT '',
  label_requirement TEXT NOT NULL DEFAULT '',
  instruction_requirement TEXT NOT NULL DEFAULT '',
  packaging_requirement TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_item_box_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  packaging_name TEXT NOT NULL DEFAULT '',
  outer_length REAL NOT NULL DEFAULT 0,
  outer_width REAL NOT NULL DEFAULT 0,
  outer_height REAL NOT NULL DEFAULT 0,
  outer_weight REAL NOT NULL DEFAULT 0,
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_item_requirement_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS carton_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  box_no INTEGER NOT NULL CHECK (box_no > 0),
  total_boxes INTEGER NOT NULL CHECK (total_boxes > 0),
  manual_edited INTEGER NOT NULL DEFAULT 0 CHECK (manual_edited IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (order_id, box_no)
);

CREATE TABLE IF NOT EXISTS carton_label_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carton_label_id INTEGER NOT NULL REFERENCES carton_labels(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  box_count INTEGER NOT NULL DEFAULT 1 CHECK (box_count > 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  remark TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  note TEXT NOT NULL DEFAULT '',
  payment_date TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  payment_method TEXT NOT NULL DEFAULT '',
  payer_name TEXT NOT NULL DEFAULT '',
  transaction_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'void')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  receivable_cents INTEGER NOT NULL CHECK (receivable_cents >= 0),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  outstanding_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid')),
  proof_status TEXT NOT NULL CHECK (proof_status IN ('none', 'pending', 'approved', 'rejected')),
  invoice_status TEXT NOT NULL CHECK (invoice_status IN ('not_requested', 'incomplete', 'pending_issue', 'issued', 'sent', 'void')),
  invoice_requested_at TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_proof_id INTEGER REFERENCES payment_proofs(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT '',
  payee_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'pending_issue', 'issued', 'sent', 'void')),
  invoice_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  tax_no TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL DEFAULT '',
  recipient_address TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  invoice_code TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  sent_at TEXT,
  voided_at TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_invoice_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  category TEXT NOT NULL DEFAULT 'other',
  source_customer_product_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_detail_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  printed_at TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'print',
  order_count INTEGER NOT NULL DEFAULT 0,
  label_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_history_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_history_id INTEGER NOT NULL REFERENCES print_histories(id) ON DELETE CASCADE,
  label_id INTEGER REFERENCES carton_labels(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  order_no TEXT NOT NULL DEFAULT '',
  box_no INTEGER NOT NULL CHECK (box_no > 0),
  total_boxes INTEGER NOT NULL CHECK (total_boxes > 0),
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  tracking_no TEXT NOT NULL,
  shipped_at TEXT NOT NULL,
  total_boxes INTEGER NOT NULL CHECK (total_boxes > 0),
  recipient_info TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS shipment_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS shipment_batch_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES shipment_batches(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  tracking_no TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (batch_id, order_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_number_sequences (
  document_type TEXT NOT NULL CHECK (document_type IN ('quotation', 'sales')),
  sequence_date TEXT NOT NULL,
  last_value INTEGER NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (document_type, sequence_date)
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'won', 'expired')),
  quotation_date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  valid_until TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  price_type TEXT NOT NULL DEFAULT 'ex_tax' CHECK (price_type IN ('ex_tax', 'tax_included', 'tax_included_with_freight')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  customer_products_synced_at TEXT,
  company_snapshot_json TEXT NOT NULL,
  display_config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  customer_product_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL,
  is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1)),
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  parameters TEXT NOT NULL DEFAULT '',
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  tiered_prices_json TEXT,
  remark TEXT NOT NULL DEFAULT '',
  image_relative_path TEXT,
  image_original_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotation_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  placement TEXT NOT NULL CHECK (placement IN ('header', 'footer')),
  label TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

CREATE TABLE IF NOT EXISTS sales_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  source_quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
  document_status TEXT NOT NULL CHECK (document_status IN ('draft', 'issued', 'void')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  document_date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  purchase_order_no TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  outstanding_cents INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_cents >= 0),
  company_snapshot_json TEXT NOT NULL,
  display_config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_document_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  customer_product_id INTEGER REFERENCES customer_products(id) ON DELETE SET NULL,
  is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1)),
  product_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  parameters TEXT NOT NULL DEFAULT '',
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  remark TEXT NOT NULL DEFAULT '',
  image_relative_path TEXT,
  image_original_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  payment_method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_receipt_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES sales_receipts(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_name_sku_spec ON products(name, sku, specification);
CREATE INDEX IF NOT EXISTS idx_product_packaging_product ON product_packaging(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_packaging_images_packaging ON product_packaging_images(packaging_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_product_attachments_product ON product_attachments(product_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_product_purchase_quotes_product ON product_purchase_quotes(product_id, is_default DESC, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_customer_product_attachments_product ON customer_product_attachments(customer_product_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_source_types_active ON order_source_types(is_active, id);
CREATE INDEX IF NOT EXISTS idx_order_source_types_name ON order_source_types(name);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_item_requirement_attachments_item ON order_item_requirement_attachments(order_item_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_carton_labels_order ON carton_labels(order_id, box_no);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_order ON payment_proofs(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_finance_payment_status ON order_finance(payment_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_finance_proof_status ON order_finance(proof_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_finance_invoice_status ON order_finance(invoice_status, updated_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_receipts_proof
  ON finance_receipts(payment_proof_id)
  WHERE payment_proof_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_receipts_order ON finance_receipts(order_id, received_at, id);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_order ON finance_invoices(order_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_status ON finance_invoices(status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_finance_invoice_files_invoice ON finance_invoice_files(invoice_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_order_contracts_order ON order_contracts(order_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_detail_images_order ON order_detail_images(order_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_print_history_labels_history ON print_history_labels(print_history_id);
CREATE INDEX IF NOT EXISTS idx_print_history_labels_order ON print_history_labels(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id, shipped_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_orders_batch ON shipment_batch_orders(batch_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quotations_status_updated ON quotations(status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_product ON quotation_items(product_id);
CREATE INDEX IF NOT EXISTS idx_quotation_custom_fields_quotation ON quotation_custom_fields(quotation_id, placement, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_sales_documents_status_updated ON sales_documents(document_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_documents_payment_status ON sales_documents(payment_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_documents_source_quotation ON sales_documents(source_quotation_id);
CREATE INDEX IF NOT EXISTS idx_sales_document_items_document ON sales_document_items(sales_document_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_sales_document_items_product ON sales_document_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipts_document ON sales_receipts(sales_document_id, received_at, id);
CREATE INDEX IF NOT EXISTS idx_sales_receipt_files_receipt ON sales_receipt_files(receipt_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`;

type MigratedTable =
  | 'customers'
  | 'products'
  | 'product_images'
  | 'customer_products'
  | 'customer_product_attachments'
  | 'orders'
  | 'order_items'
  | 'order_item_requirement_attachments'
  | 'order_contracts'
  | 'quotations'
  | 'quotation_items'
  | 'sales_documents'
  | 'sales_document_items'
  | 'payment_proofs'
  | 'finance_receipts';

interface MigrationPreflight {
  schemaVersion: number;
  versionSixInitialized: boolean;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) !== undefined;
}

function preflightMigration(database: DatabaseSync): MigrationPreflight {
  let schemaVersionValue: string | undefined;
  let versionSixInitialized = false;
  if (tableExists(database, 'settings')) {
    const settingsColumns = database
      .prepare('PRAGMA table_info(settings)')
      .all()
      .map((row: { name?: unknown }) => String(row.name));
    if (!settingsColumns.includes('key') || !settingsColumns.includes('value')) {
      throw new Error('Cannot inspect database schema version because the settings table is incompatible');
    }

    const schemaVersionRow = database
      .prepare("SELECT value FROM settings WHERE key = 'schema_version'")
      .get();
    schemaVersionValue = schemaVersionRow ? String(schemaVersionRow.value) : undefined;
    const initializedRow = database
      .prepare("SELECT value FROM settings WHERE key = 'customer_products_v6_initialized'")
      .get();
    versionSixInitialized = initializedRow !== undefined && String(initializedRow.value) === '1';
  }

  const normalizedSchemaVersion = schemaVersionValue?.trim() ?? '';
  if (normalizedSchemaVersion !== '' && !/^\d+$/.test(normalizedSchemaVersion)) {
    throw new Error(
      `Invalid database schema version '${schemaVersionValue}'; expected a non-negative decimal integer`,
    );
  }
  const parsedSchemaVersion = normalizedSchemaVersion === '' ? 0 : Number(normalizedSchemaVersion);
  if (parsedSchemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported database schema version ${parsedSchemaVersion}; this application supports up to version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  const customerProductsExists = tableExists(database, 'customer_products');
  const customerIdColumnExisted = customerProductsExists
    && database
      .prepare('PRAGMA table_info(customer_products)')
      .all()
      .some((row: { name?: unknown }) => String(row.name) === 'customer_id');
  // customer_id 列存在说明 v6 结构已应用；元数据版本低于 6 时重跑 v6 迁移会清空
  // customer_products，必须停止迁移保护数据。版本 7 及以上同样视为已初始化。
  if (
    customerIdColumnExisted
    && (parsedSchemaVersion < 6 || !versionSixInitialized)
  ) {
    throw new Error(
      'Version 6 customer product structure conflicts with migration metadata; migration stopped to preserve existing data',
    );
  }

  return {
    schemaVersion: parsedSchemaVersion,
    versionSixInitialized,
  };
}

function columnNames(database: DatabaseSync, table: MigratedTable): string[] {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row: { name?: unknown }) => String(row.name));
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: MigratedTable,
  column: string,
  definition: string,
): boolean {
  if (columnNames(database, table).includes(column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function upsertSetting(database: DatabaseSync, key: string, value: string, now: string): void {
  database
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now);
}

function migrateVersionSix(database: DatabaseSync, now: string, preflight: MigrationPreflight): void {

  const productImagesSortOrderAdded = addColumnIfMissing(database, 'product_images', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  if (productImagesSortOrderAdded) {
    database.exec(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY id) - 1 AS position
        FROM product_images
      )
      UPDATE product_images
      SET sort_order = (SELECT position FROM ranked WHERE ranked.id = product_images.id);
    `);
  }

  const customerProductColumns: Array<[string, string]> = [
    ['customer_id', 'INTEGER REFERENCES customers(id) ON DELETE RESTRICT'],
    ['system_product_id', 'INTEGER REFERENCES products(id) ON DELETE SET NULL'],
    ['pack_count', 'INTEGER CHECK (pack_count IS NULL OR pack_count > 0)'],
    ['latest_quote_cents', 'INTEGER CHECK (latest_quote_cents IS NULL OR latest_quote_cents >= 0)'],
    ['final_price_cents', 'INTEGER CHECK (final_price_cents IS NULL OR final_price_cents >= 0)'],
    ['cost_price_cents', 'INTEGER CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0)'],
    ['packaging_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['source_quotation_id', 'INTEGER REFERENCES quotations(id) ON DELETE SET NULL'],
    ['image_relative_path', 'TEXT'],
    ['last_synced_at', 'TEXT'],
  ];
  for (const [name, definition] of customerProductColumns) {
    addColumnIfMissing(database, 'customer_products', name, definition);
  }

  if (preflight.schemaVersion < 6 && !preflight.versionSixInitialized) {
    addColumnIfMissing(
      database,
      'order_items',
      'customer_product_id',
      'INTEGER REFERENCES customer_products(id) ON DELETE SET NULL',
    );
    database.exec('UPDATE order_items SET customer_product_id = NULL');
    database.exec('DELETE FROM customer_products');
  }

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS customer_products_require_customer_insert
    BEFORE INSERT ON customer_products
    WHEN NEW.customer_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'customer_products.customer_id is required');
    END;

    CREATE TRIGGER IF NOT EXISTS customer_products_require_customer_update
    BEFORE UPDATE ON customer_products
    WHEN NEW.customer_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'customer_products.customer_id is required');
    END;
  `);

  const cartonLabelItemColumns = database
    .prepare('PRAGMA table_info(carton_label_items)')
    .all()
    .map((row: { name?: unknown }) => String(row.name));
  if (!cartonLabelItemColumns.includes('remark')) {
    database.exec("ALTER TABLE carton_label_items ADD COLUMN remark TEXT NOT NULL DEFAULT ''");
  }
  if (!cartonLabelItemColumns.includes('total_count')) {
    database.exec("ALTER TABLE carton_label_items ADD COLUMN total_count INTEGER NOT NULL DEFAULT 1");
  }

  const orderAmountCentsAdded = addColumnIfMissing(
    database,
    'orders',
    'amount_cents',
    'INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0)',
  );
  const documentColumns: Array<[MigratedTable, string, string]> = [
    ['orders', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL'],
    ['orders', 'customer_name', "TEXT NOT NULL DEFAULT ''"],
    ['orders', 'customer_contact_name', "TEXT NOT NULL DEFAULT ''"],
    ['orders', 'customer_contact_phone', "TEXT NOT NULL DEFAULT ''"],
    ['orders', 'customer_shipping_info', "TEXT NOT NULL DEFAULT ''"],
    ['orders', 'order_detail', "TEXT NOT NULL DEFAULT ''"],
    ['order_items', 'unit_price_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0)'],
    ['order_items', 'amount_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0)'],
    ['quotations', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL'],
    ['quotations', 'customer_products_synced_at', 'TEXT'],
    ['quotation_items', 'customer_product_id', 'INTEGER REFERENCES customer_products(id) ON DELETE SET NULL'],
    ['quotation_items', 'pack_count', 'INTEGER CHECK (pack_count IS NULL OR pack_count > 0)'],
    ['sales_documents', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL'],
    ['sales_document_items', 'customer_product_id', 'INTEGER REFERENCES customer_products(id) ON DELETE SET NULL'],
    ['sales_document_items', 'pack_count', 'INTEGER CHECK (pack_count IS NULL OR pack_count > 0)'],
  ];
  for (const [table, name, definition] of documentColumns) {
    addColumnIfMissing(database, table, name, definition);
  }

  if (orderAmountCentsAdded) {
    database.exec('UPDATE orders SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER)');
  }

  database.exec(`
    DROP INDEX IF EXISTS idx_customer_products_name_sku_spec;
    CREATE INDEX IF NOT EXISTS idx_customers_active_name
      ON customers(is_active, name, id);
    CREATE INDEX IF NOT EXISTS idx_customer_products_customer_updated
      ON customer_products(customer_id, updated_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_products_system
      ON customer_products(customer_id, system_product_id)
      WHERE system_product_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_products_temporary
      ON customer_products(customer_id, lower(trim(name)), lower(trim(specification)))
      WHERE system_product_id IS NULL;
  `);

  upsertSetting(database, 'customer_products_v6_initialized', '1', now);
  upsertSetting(database, 'schema_version', '6', now);
}

function migrateVersionSeven(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'products', 'status', "TEXT NOT NULL DEFAULT 'active'");
  upsertSetting(database, 'schema_version', '7', now);
}

function migrateVersionEight(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'orders', 'shipping_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0)');
  upsertSetting(database, 'schema_version', '8', now);
}

function migrateVersionNine(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'customer_products', 'remark', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'customer_products', 'label_requirement', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'customer_products', 'instruction_requirement', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'customer_products', 'packaging_requirement', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'customer_product_attachments', 'category', "TEXT NOT NULL DEFAULT 'other'");
  database.exec(`
    CREATE TABLE IF NOT EXISTS customer_product_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_product_id INTEGER NOT NULL REFERENCES customer_products(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      category TEXT NOT NULL DEFAULT 'other',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customer_product_attachments_product
      ON customer_product_attachments(customer_product_id, created_at, id);
  `);
  upsertSetting(database, 'schema_version', '9', now);
}

function migrateVersionTen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'order_items', 'label_requirement', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'order_items', 'instruction_requirement', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'order_items', 'packaging_requirement', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    CREATE TABLE IF NOT EXISTS order_item_requirement_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'other',
      relative_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_item_requirement_attachments_item
      ON order_item_requirement_attachments(order_item_id, created_at, id);
  `);
  upsertSetting(database, 'schema_version', '10', now);
}

function migrateVersionEleven(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'order_contracts', 'category', "TEXT NOT NULL DEFAULT 'other'");
  addColumnIfMissing(database, 'order_contracts', 'source_customer_product_id', 'INTEGER REFERENCES customer_products(id) ON DELETE SET NULL');
  upsertSetting(database, 'schema_version', '11', now);
}

function migrateVersionTwelve(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'orders', 'label_printed_at', 'TEXT');
  database.exec(`
    UPDATE orders
    SET status = 'pending_stock'
    WHERE status = 'label_pending';

    UPDATE orders
    SET label_printed_at = (
      SELECT MAX(ph.printed_at)
      FROM print_histories ph
      JOIN print_history_labels phl ON phl.print_history_id = ph.id
      WHERE phl.order_id = orders.id
    )
    WHERE label_printed_at IS NULL;
  `);
  upsertSetting(database, 'schema_version', '12', now);
}

function migrateVersionThirteen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'customer_products', 'freight_per_box_cents', 'INTEGER CHECK (freight_per_box_cents IS NULL OR freight_per_box_cents >= 0)');
  addColumnIfMissing(database, 'order_items', 'freight_per_box_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK (freight_per_box_cents >= 0)');
  upsertSetting(database, 'schema_version', '13', now);
}

function migrateVersionFourteen(database: DatabaseSync, now: string): void {
  const paymentProofColumns: Array<[string, string]> = [
    ['payment_date', 'TEXT'],
    ['amount_cents', 'INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0)'],
    ['payment_method', "TEXT NOT NULL DEFAULT ''"],
    ['payer_name', "TEXT NOT NULL DEFAULT ''"],
    ['transaction_no', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'void'))"],
    ['review_note', "TEXT NOT NULL DEFAULT ''"],
    ['reviewed_at', 'TEXT'],
  ];
  for (const [name, definition] of paymentProofColumns) {
    addColumnIfMissing(database, 'payment_proofs', name, definition);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS order_finance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      receivable_cents INTEGER NOT NULL CHECK (receivable_cents >= 0),
      received_cents INTEGER NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
      outstanding_cents INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid')),
      proof_status TEXT NOT NULL CHECK (proof_status IN ('none', 'pending', 'approved', 'rejected')),
      invoice_status TEXT NOT NULL CHECK (invoice_status IN ('not_requested', 'incomplete', 'pending_issue', 'issued', 'sent', 'void')),
      invoice_requested_at TEXT,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_proof_id INTEGER REFERENCES payment_proofs(id) ON DELETE SET NULL,
      received_at TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      payment_method TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'pending_issue', 'issued', 'sent', 'void')),
      invoice_type TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', tax_no TEXT NOT NULL DEFAULT '',
      recipient_email TEXT NOT NULL DEFAULT '', recipient_address TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
      tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
      tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
      invoice_code TEXT NOT NULL DEFAULT '', invoice_no TEXT NOT NULL DEFAULT '',
      issued_at TEXT, sent_at TEXT, voided_at TEXT, remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_invoice_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0), created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_finance_payment_status ON order_finance(payment_status, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_order_finance_proof_status ON order_finance(proof_status, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_order_finance_invoice_status ON order_finance(invoice_status, updated_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_receipts_proof ON finance_receipts(payment_proof_id) WHERE payment_proof_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_finance_receipts_order ON finance_receipts(order_id, received_at, id);
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_order ON finance_invoices(order_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_status ON finance_invoices(status, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_invoice_files_invoice ON finance_invoice_files(invoice_id, created_at, id);
  `);
  database.exec(`
    UPDATE payment_proofs SET status = 'pending' WHERE status IS NULL OR trim(status) = '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_order_transaction
      ON payment_proofs(order_id, transaction_no)
      WHERE trim(transaction_no) <> '' AND status <> 'void';
  `);
  database.prepare(`
    INSERT OR IGNORE INTO order_finance
      (order_id, receivable_cents, received_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at)
    SELECT id, amount_cents, 0, amount_cents, 'unpaid',
      CASE WHEN EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = orders.id) THEN 'pending' ELSE 'none' END,
      'not_requested', ?, ?
    FROM orders
  `).run(now, now);
  database.prepare(`
    UPDATE order_finance
    SET proof_status = CASE
      WHEN EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = order_finance.order_id AND p.status = 'pending') THEN 'pending'
      WHEN EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = order_finance.order_id AND p.status = 'rejected') THEN 'rejected'
      WHEN EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = order_finance.order_id AND p.status = 'approved') THEN 'approved'
      ELSE 'none' END,
      updated_at = ?
  `).run(now);
  upsertSetting(database, 'schema_version', '14', now);
}

function migrateVersionFifteen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'orders', 'source_sales_document_id', 'INTEGER REFERENCES sales_documents(id) ON DELETE SET NULL');
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_source_sales_document_id
      ON orders(source_sales_document_id)
      WHERE source_sales_document_id IS NOT NULL;
  `);
  upsertSetting(database, 'schema_version', '15', now);
}

function migrateVersionSixteen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'quotation_items', 'tiered_prices_json', 'TEXT');
  upsertSetting(database, 'schema_version', '16', now);
}

function migrateVersionSeventeen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'finance_receipts', 'payee_name', "TEXT NOT NULL DEFAULT ''");
  upsertSetting(database, 'schema_version', '17', now);
}

function migrateVersionEighteen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'quotations', 'price_type', "TEXT NOT NULL DEFAULT 'ex_tax'");
  upsertSetting(database, 'schema_version', '18', now);
}

function migrateVersionNineteen(database: DatabaseSync, now: string): void {
  addColumnIfMissing(database, 'customers', 'invoice_title', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, 'customers', 'tax_no', "TEXT NOT NULL DEFAULT ''");
  upsertSetting(database, 'schema_version', '19', now);
}

function migrateVersionTwenty(database: DatabaseSync, now: string): void {
  // 对公/对私结算方式：对公开票、对私免开票；历史订单默认对公（此前全部订单都跟踪发票）。
  // 必须经 ALTER 追加到表尾，不能写进 schemaSql 中段，否则备份按位置复制会列错位。
  addColumnIfMissing(database, 'orders', 'settlement_type', "TEXT NOT NULL DEFAULT 'corporate' CHECK (settlement_type IN ('corporate', 'personal'))");
  upsertSetting(database, 'schema_version', '20', now);
}

function migrateVersionTwentyOne(database: DatabaseSync, now: string): void {
  // 备货模块：客户产品报给供应商的产品名称（与客户产品名称可以不同，空串时备货表回退系统产品名）。
  // 必须经 ALTER 追加到表尾，不能写进 schemaSql 中段，否则备份按位置复制会列错位。
  addColumnIfMissing(database, 'customer_products', 'supplier_product_name', "TEXT NOT NULL DEFAULT ''");
  upsertSetting(database, 'schema_version', '21', now);
}

function migrateVersionTwentyTwo(database: DatabaseSync, now: string): void {
  // 登录鉴权：users/sessions 表已在 schemaSql 建好；这里只给 orders 追加创建人留痕列。
  // created_by 必须经 ALTER 追加到表尾，不能写进 schemaSql 中段，否则备份按位置复制会列错位。
  addColumnIfMissing(database, 'orders', 'created_by', "TEXT NOT NULL DEFAULT ''");
  upsertSetting(database, 'schema_version', '22', now);
}

function migrateVersionTwentyThree(database: DatabaseSync, now: string): void {
  // 产品图片分类（尺寸图/包装图/客拍图…）与备注，用于按产品归档图片资料、后续复用。
  // 两列必须经 ALTER 追加到表尾，不能写进 schemaSql 中段，否则备份按位置复制会列错位。
  addColumnIfMissing(database, 'product_images', 'category', "TEXT NOT NULL DEFAULT 'product'");
  addColumnIfMissing(database, 'product_images', 'note', "TEXT NOT NULL DEFAULT ''");
  upsertSetting(database, 'schema_version', '23', now);
}

function migrateVersionTwentyFour(database: DatabaseSync, now: string): void {
  // 多档采购报价：把每个产品已有的 supplier + purchase_price 落成一条默认报价。
  // 只在该产品还没有任何报价时补，重复执行不会产生重复行。
  database.exec(
    `INSERT INTO product_purchase_quotes
        (product_id, supplier, variant, price, is_default, sort_order, created_at, updated_at)
      SELECT p.id, COALESCE(p.supplier, ''), '', COALESCE(p.purchase_price, 0), 1, 0, '${now}', '${now}'
      FROM products p
      WHERE p.purchase_price IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM product_purchase_quotes q WHERE q.product_id = p.id)`,
  );
  upsertSetting(database, 'schema_version', String(CURRENT_SCHEMA_VERSION), now);
}

/**
 * 一次性按文件名前导编号重排产品图片顺序。
 * 只在首次执行：之后用户可以自由拖动，不能被每次启动覆盖回去，所以用独立标记位守着。
 */
function migrateVersionTwentySix(database: DatabaseSync, now: string): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS product_videos (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
       relative_path TEXT NOT NULL UNIQUE,
       original_name TEXT NOT NULL,
       mime_type TEXT NOT NULL,
       size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
       created_at TEXT NOT NULL
     )`,
  );
  upsertSetting(database, 'schema_version', '26', now);
}

/** 产品图册（在线链接版）：一本图册 = 名称 + 随机 token + 有序选品；停用即链接失效。 */
function migrateVersionTwentySeven(database: DatabaseSync, now: string): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS catalogs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       token TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 1,
       view_count INTEGER NOT NULL DEFAULT 0,
       last_viewed_at TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
  database.exec(
    `CREATE TABLE IF NOT EXISTS catalog_items (
       catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
       product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
       sort_order INTEGER NOT NULL,
       PRIMARY KEY (catalog_id, product_id)
     )`,
  );
  database.exec('CREATE INDEX IF NOT EXISTS idx_catalog_items_order ON catalog_items (catalog_id, sort_order)');
  upsertSetting(database, 'schema_version', '27', now);
}

/**
 * 旧「配件」文本框按行拆进各分类的类目配件表（原文保留不动）。
 * 供 v30 一次性播种与测试使用：同名跨产品去重、保留先出现的条目。
 */
export function buildCategoryAccessorySeed(database: DatabaseSync): Record<string, ReturnType<typeof parseLegacyAccessoriesText>> {
  const rows = database
    .prepare("SELECT category, accessories FROM products WHERE length(trim(accessories)) > 0 AND length(trim(category)) > 0")
    .all() as Array<{ category: string; accessories: string }>;
  const map: Record<string, ReturnType<typeof parseLegacyAccessoriesText>> = {};
  for (const row of rows) {
    const category = String(row.category).trim().slice(0, 40);
    if (!category) continue;
    const parsed = parseLegacyAccessoriesText(String(row.accessories ?? ''));
    if (!parsed.length) continue;
    map[category] = mergeAccessoryPrices(map[category] ?? [], parsed);
  }
  for (const [category, items] of Object.entries(map)) map[category] = normalizeAccessoryPrices(items);
  return map;
}

/**
 * 售价计算器改矩阵口径后，方案需要回显采购价/包材/运费/税/充电器等参数：
 * product_price_plans 加 params_json 存参数快照；旧方案为空 '{}'，只按明细回显。
 */
function migrateVersionThirtyThree(database: DatabaseSync, now: string): void {
  const columns = database.prepare('PRAGMA table_info(product_price_plans)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'params_json')) {
    database.exec("ALTER TABLE product_price_plans ADD COLUMN params_json TEXT NOT NULL DEFAULT '{}'");
  }
  upsertSetting(database, 'schema_version', '33', now);
}

/**
 * 配件价格改为「按产品独立」：products 增加「已固化」标记，区分
 * 「没改过（详情/计算器继续沿用类目默认）」与「改过、哪怕删成空」两种状态。
 */
function migrateVersionThirtyTwo(database: DatabaseSync, now: string): void {
  const columns = database.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'accessory_prices_customized')) {
    database.exec('ALTER TABLE products ADD COLUMN accessory_prices_customized INTEGER NOT NULL DEFAULT 0');
  }
  upsertSetting(database, 'schema_version', '32', now);
}

/**
 * 电池/充电器价格独立成模块：从旧的「全局配件」清单一次性播种——
 * 「5 节 1300」这类电池条目进矩阵，名字带「充电」的进充电器清单；旧键原样保留。
 */
function migrateVersionThirtyOne(database: DatabaseSync, now: string): void {
  const legacyRow = database.prepare("SELECT value FROM settings WHERE key = 'accessory_prices'").get() as { value?: string } | undefined;
  let legacy: ReturnType<typeof normalizeAccessoryPrices> = [];
  try {
    legacy = legacyRow?.value ? normalizeAccessoryPrices(JSON.parse(legacyRow.value)) : [];
  } catch {
    legacy = [];
  }
  const batteryRow = database.prepare("SELECT value FROM settings WHERE key = 'battery_price_matrix'").get();
  if (batteryRow === undefined) {
    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run('battery_price_matrix', JSON.stringify(buildBatteryMatrixSeed(legacy)), now);
  }
  const chargerRow = database.prepare("SELECT value FROM settings WHERE key = 'charger_prices'").get();
  if (chargerRow === undefined) {
    const chargers = legacy.filter((item) => item.name.includes('充电'));
    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run('charger_prices', JSON.stringify(chargers), now);
  }
  upsertSetting(database, 'schema_version', '31', now);
}

/** 配件两层化：全局清单存设置不动；类目配件首次（键不存在）时从旧配件文本播种。 */
function migrateVersionThirty(database: DatabaseSync, now: string): void {
  const existing = database.prepare("SELECT value FROM settings WHERE key = 'category_accessory_prices'").get();
  if (existing === undefined) {
    const seed = buildCategoryAccessorySeed(database);
    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run('category_accessory_prices', JSON.stringify(seed), now);
  }
  upsertSetting(database, 'schema_version', '30', now);
}

/** 售价计算器：产品「配件与价格」（JSON 列，同颜色/插脚存法）+ 算价方案两张表。 */
function migrateVersionTwentyNine(database: DatabaseSync, now: string): void {
  const columns = database.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'accessory_prices')) {
    database.exec("ALTER TABLE products ADD COLUMN accessory_prices TEXT NOT NULL DEFAULT '[]'");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_price_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      markup_percent REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      target_price REAL,
      created_at TEXT NOT NULL
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_product_price_plans_product ON product_price_plans (product_id, created_at, id)');
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_price_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES product_price_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_product_price_plan_items_plan ON product_price_plan_items (plan_id, sort_order, id)');
  upsertSetting(database, 'schema_version', '29', now);
}

/** 图册选品的「加入时间」：在线图册的「新品」分区靠它判断哪些是起算日之后新加的。 */
function migrateVersionTwentyEight(database: DatabaseSync, now: string): void {
  const columns = database.prepare('PRAGMA table_info(catalog_items)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'created_at')) {
    database.exec('ALTER TABLE catalog_items ADD COLUMN created_at TEXT');
  }
  // 存量条目按所属图册的创建时间回填：老图册不会整本被当成新品。
  database.exec(
    `UPDATE catalog_items SET created_at = COALESCE(
       (SELECT c.created_at FROM catalogs c WHERE c.id = catalog_items.catalog_id), '${now}'
     ) WHERE created_at IS NULL`,
  );
  upsertSetting(database, 'schema_version', '28', now);
}

function migrateVersionTwentyFive(database: DatabaseSync, now: string): void {
  const done = database
    .prepare("SELECT value FROM settings WHERE key = 'product_images_ordered_by_filename_v25'")
    .get();
  if (done !== undefined) return;

  const rows = database
    .prepare('SELECT id, product_id, original_name, sort_order FROM product_images')
    .all() as Array<{ id: number; product_id: number; original_name: string; sort_order: number }>;
  const byProduct = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byProduct.get(row.product_id);
    if (list) list.push(row);
    else byProduct.set(row.product_id, [row]);
  }

  const update = database.prepare('UPDATE product_images SET sort_order = ? WHERE id = ?');
  for (const list of byProduct.values()) {
    const ordered = sortByImageLeadNumber(list.map((row) => ({ name: row.original_name, row }))).map((entry) => entry.row);
    ordered.forEach((row, index) => {
      if (row.sort_order !== index) update.run(index, row.id);
    });
  }
  upsertSetting(database, 'product_images_ordered_by_filename_v25', now, now);
  upsertSetting(database, 'schema_version', String(CURRENT_SCHEMA_VERSION), now);
}

export function migrateDatabase(database: DatabaseSync): void {
  if (database.isTransaction) {
    throw new Error('Database migration cannot run inside an active transaction');
  }

  const preflight = preflightMigration(database);
  database.exec('PRAGMA foreign_keys = ON;');

  withTransaction(database, (transactionDatabase: DatabaseSync) => {
    transactionDatabase.exec(schemaSql);

    for (const tableName of ['products', 'quotation_items', 'sales_document_items']) {
      const columns = transactionDatabase
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map((row: { name?: unknown }) => String(row.name));

      if (!columns.includes('parameters')) {
        transactionDatabase.exec(
          `ALTER TABLE ${tableName} ADD COLUMN parameters TEXT NOT NULL DEFAULT ''`,
        );
      }
    }

    // Older databases may predate the accessories field even though the current
    // products schema declares it. Keep those databases readable and writable.
    addColumnIfMissing(transactionDatabase, 'products', 'accessories', "TEXT NOT NULL DEFAULT ''");

    migratePackagingColumns(transactionDatabase);

    const now = new Date().toISOString();
    migrateVersionSix(transactionDatabase, now, preflight);
    migrateVersionSeven(transactionDatabase, now);
    migrateVersionEight(transactionDatabase, now);
    migrateVersionNine(transactionDatabase, now);
    migrateVersionTen(transactionDatabase, now);
    migrateVersionEleven(transactionDatabase, now);
    migrateVersionTwelve(transactionDatabase, now);
    migrateVersionThirteen(transactionDatabase, now);
    migrateVersionFourteen(transactionDatabase, now);
    migrateVersionFifteen(transactionDatabase, now);
    migrateVersionSixteen(transactionDatabase, now);
    migrateVersionSeventeen(transactionDatabase, now);
    migrateVersionEighteen(transactionDatabase, now);
    migrateVersionNineteen(transactionDatabase, now);
    migrateVersionTwenty(transactionDatabase, now);
    migrateVersionTwentyOne(transactionDatabase, now);
    migrateVersionTwentyTwo(transactionDatabase, now);
    migrateVersionTwentyThree(transactionDatabase, now);
    migrateVersionTwentyFour(transactionDatabase, now);
    migrateVersionTwentyFive(transactionDatabase, now);
    migrateVersionTwentySix(transactionDatabase, now);
    migrateVersionTwentySeven(transactionDatabase, now);
    migrateVersionTwentyEight(transactionDatabase, now);
    migrateVersionTwentyNine(transactionDatabase, now);
    migrateVersionThirty(transactionDatabase, now);
    migrateVersionThirtyOne(transactionDatabase, now);
    migrateVersionThirtyTwo(transactionDatabase, now);
    migrateVersionThirtyThree(transactionDatabase, now);
    transactionDatabase
      .prepare(
        `INSERT INTO order_source_types (name, is_active, created_at, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run('微信', now, now);
    transactionDatabase
      .prepare(
        `INSERT INTO order_source_types (name, is_active, created_at, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run('1688', now, now);
    transactionDatabase.exec(
      `INSERT INTO order_source_types (name, is_active, created_at, updated_at)
       SELECT DISTINCT TRIM(source_type), 0, '${now}', '${now}'
       FROM orders
       WHERE TRIM(source_type) <> ''
         AND NOT EXISTS (
           SELECT 1 FROM order_source_types existing WHERE existing.name = TRIM(orders.source_type)
         )`,
    );

    const foreignKeyViolations = transactionDatabase.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(`Foreign key check failed after migration: ${JSON.stringify(foreignKeyViolations)}`);
    }
  });
}

export const schema = schemaSql;
