import type { DatabaseSync } from 'node:sqlite';

export interface PackagingInputLike {
  name?: unknown;
  innerSize?: unknown;
  innerWeight?: unknown;
  outerSize?: unknown;
  outerLength?: unknown;
  outerWidth?: unknown;
  outerHeight?: unknown;
  outerWeight?: unknown;
  packCount?: unknown;
  purchasePrice?: unknown;
  id?: unknown;
  sortOrder?: unknown;
  images?: unknown;
  imageIds?: unknown;
}

export interface PackagingImageRecord {
  id: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt?: string;
}

export interface NormalizedPackaging {
  name: string;
  innerSize: string;
  innerWeight: number;
  outerSize: string;
  outerLength: number;
  outerWidth: number;
  outerHeight: number;
  outerWeight: number;
  packCount: number;
  purchasePrice: number | null;
}

const SIZE_NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finiteOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function parseSizeText(value: string): [number, number, number] | undefined {
  const numbers = value.match(SIZE_NUMBER_PATTERN)?.map(Number).filter(Number.isFinite) ?? [];
  if (numbers.length < 3) return undefined;
  return [numbers[0]!, numbers[1]!, numbers[2]!];
}

export function formatLegacyOuterSize(length: unknown, width: unknown, height: unknown): string {
  const values = [finiteOrZero(length), finiteOrZero(width), finiteOrZero(height)];
  if (!values.some((value) => value !== 0)) return '';
  return values.map(formatNumber).join('×');
}

export function normalizePackagingItem(
  input: PackagingInputLike,
  fallbackPackCount = 1,
): NormalizedPackaging {
  const legacyLength = finiteOrZero(input.outerLength);
  const legacyWidth = finiteOrZero(input.outerWidth);
  const legacyHeight = finiteOrZero(input.outerHeight);
  const explicitOuterSize = text(input.outerSize);
  const parsedOuterSize = parseSizeText(explicitOuterSize);
  const outerSize = explicitOuterSize || formatLegacyOuterSize(legacyLength, legacyWidth, legacyHeight);
  const packCountValue = Number(input.packCount ?? fallbackPackCount);

  return {
    name: text(input.name),
    innerSize: text(input.innerSize),
    innerWeight: finiteOrZero(input.innerWeight),
    outerSize,
    outerLength: parsedOuterSize?.[0] ?? legacyLength,
    outerWidth: parsedOuterSize?.[1] ?? legacyWidth,
    outerHeight: parsedOuterSize?.[2] ?? legacyHeight,
    outerWeight: finiteOrZero(input.outerWeight),
    packCount: Number.isFinite(packCountValue) ? Math.trunc(packCountValue) : Math.trunc(fallbackPackCount),
    purchasePrice: finiteOrNull(input.purchasePrice),
  };
}

export function mapPackagingRecord(value: PackagingInputLike): NormalizedPackaging & {
  id?: number;
  sortOrder?: number;
  images: PackagingImageRecord[];
  imageIds?: number[];
} {
  const normalized = normalizePackagingItem(value);
  const rawImages = typeof value.images === 'string'
    ? (() => { try { return JSON.parse(value.images) as unknown; } catch { return []; } })()
    : value.images;
  const record: NormalizedPackaging & { id?: number; sortOrder?: number; images: PackagingImageRecord[]; imageIds?: number[] } = {
    ...normalized,
    images: Array.isArray(rawImages)
      ? rawImages.map((raw) => {
        const image = raw as Record<string, unknown>;
        return {
          id: Number(image.id),
          relativePath: String(image.relativePath ?? image.relative_path ?? ''),
          originalName: String(image.originalName ?? image.original_name ?? '包装图片'),
          mimeType: String(image.mimeType ?? image.mime_type ?? ''),
          size: Number(image.size ?? image.size_bytes ?? 0),
          createdAt: image.createdAt == null && image.created_at == null ? undefined : String(image.createdAt ?? image.created_at),
        };
      }).filter((image) => image.relativePath)
      : [],
  };
  if (Array.isArray(value.imageIds)) record.imageIds = value.imageIds.map(Number).filter(Number.isSafeInteger);
  if (value.id !== undefined && value.id !== null) record.id = Number(value.id);
  if (value.sortOrder !== undefined && value.sortOrder !== null) record.sortOrder = Number(value.sortOrder);
  return record;
}

export function migratePackagingColumns(database: DatabaseSync): void {
  const columns = database
    .prepare('PRAGMA table_info(product_packaging)')
    .all()
    .map((row: { name?: unknown }) => String(row.name));

  const additions: Array<[string, string]> = [
    ['inner_size', "TEXT NOT NULL DEFAULT ''"],
    ['inner_weight', 'REAL NOT NULL DEFAULT 0'],
    ['outer_size', "TEXT NOT NULL DEFAULT ''"],
    ['purchase_price', 'REAL'],
  ];
  for (const [name, definition] of additions) {
    if (!columns.includes(name)) {
      database.exec(`ALTER TABLE product_packaging ADD COLUMN ${name} ${definition}`);
    }
  }

  const rows = database
    .prepare('SELECT id, outer_length, outer_width, outer_height, outer_size FROM product_packaging')
    .all() as Array<Record<string, unknown>>;
  const update = database.prepare('UPDATE product_packaging SET outer_size = ? WHERE id = ?');
  for (const row of rows) {
    if (text(row.outer_size)) continue;
    const outerSize = formatLegacyOuterSize(row.outer_length, row.outer_width, row.outer_height);
    if (outerSize) update.run(outerSize, Number(row.id));
  }
}
