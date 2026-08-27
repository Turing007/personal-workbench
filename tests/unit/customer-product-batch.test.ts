import { describe, expect, it } from 'vitest';
import { parseBatchLines } from '../../src/client/customer-product-batch';

describe('批量清单解析', () => {
  it('按行解析"品名，规格，SKU"，支持制表符与中英文逗号分隔', () => {
    expect(parseBatchLines('迷你风扇-白色, USB款, WS-01\n迷你风扇-黑色\tUSB款\tWS-02\n迷你音箱，Pro款')).toEqual([
      { name: '迷你风扇-白色', specification: 'USB款', sku: 'WS-01' },
      { name: '迷你风扇-黑色', specification: 'USB款', sku: 'WS-02' },
      { name: '迷你音箱', specification: 'Pro款', sku: '' },
    ]);
  });

  it('规格和 SKU 可省略，跳过空行与只有分隔符的行', () => {
    expect(parseBatchLines('\n  \n风扇A\n, , \n 风扇B ,')).toEqual([
      { name: '风扇A', specification: '', sku: '' },
      { name: '风扇B', specification: '', sku: '' },
    ]);
  });

  it('按"品名+规格"（不区分大小写）去重，保留首次出现的写法', () => {
    expect(parseBatchLines('Fan-01, A\nfan-01, A\nFan-01, B')).toEqual([
      { name: 'Fan-01', specification: 'A', sku: '' },
      { name: 'Fan-01', specification: 'B', sku: '' },
    ]);
    expect(parseBatchLines('风扇, 标准款\n风扇, 标准款')).toEqual([
      { name: '风扇', specification: '标准款', sku: '' },
    ]);
  });

  it('空输入返回空数组', () => {
    expect(parseBatchLines('')).toEqual([]);
    expect(parseBatchLines('\n \n\t\n')).toEqual([]);
  });
});
