import type { ProductRecord } from './components/ProductEditor';

function temporaryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Creates an editable product draft without reusing persisted IDs or files. */
export function cloneProductForNew(product: ProductRecord): ProductRecord {
  return {
    ...product,
    id: temporaryId('product-copy'),
    sku: '',
    status: 'active',
    colors: [...product.colors],
    batteryPlugs: [...product.batteryPlugs],
    images: [],
    attachments: [],
    packaging: product.packaging.map((item) => ({
      ...item,
      id: temporaryId('pack-copy'),
      images: [],
    })),
  };
}
