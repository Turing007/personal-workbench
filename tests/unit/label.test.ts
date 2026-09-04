import { describe, expect, it, vi } from 'vitest';
import { LabelService } from '../../src/server/services/label-service';

type Detail = {
  id: number;
  status?: string;
  order_no: string;
  recipient_name: string;
  order_detail: string;
  items: Array<Record<string, unknown>>;
  labels: Array<Record<string, unknown>>;
};

function makeRepository(detail: Detail) {
  let nextId = 100;
  return {
    getOrderDetail: () => detail,
    saveCartonLabels: (_orderId: number, labels: Array<Record<string, unknown>>) => {
      detail.labels = labels.map((label, index) => ({
        id: nextId++,
        box_no: Number(label.boxNo ?? index + 1),
        total_boxes: labels.length,
        manual_edited: label.manualEdited ? 1 : 0,
        items: (label.items as Array<Record<string, unknown>>).map((item, itemIndex) => ({
          id: itemIndex + 1,
          order_item_id: item.orderItemId,
          name: item.name,
          sku: item.sku,
          specification: item.specification,
          packCount: item.packCount,
          totalCount: item.totalCount,
          boxCount: item.boxCount,
          remark: item.remark,
        })),
      }));
    },
  };
}

function label(id: number, name: string, sku: string, quantity: number, packSize: number) {
  return {
    id,
    box_no: id,
    total_boxes: 2,
    manual_edited: 0,
    items: [{
      id: id * 10,
      order_item_id: id,
      name,
      sku,
      specification: '标准',
      packCount: packSize,
      totalCount: quantity,
      boxCount: 1,
      remark: '',
    }],
  };
}

function printRepository(details: Detail[]) {
  const history: Array<Record<string, unknown>> = [];
  return {
    getOrderDetail: (orderId: number) => details.find((detail) => detail.id === orderId),
    recordPrintHistory: vi.fn((input: { actionType: string; orderIds: number[]; labels: unknown[] }) => {
      history.push(input as unknown as Record<string, unknown>);
      return 1;
    }),
    history,
  };
}

describe('箱唛手动合箱', () => {
  it('按不同产品保留多行，并分别显示当前数量、箱数和总数', () => {
    const detail: Detail = {
      id: 1,
      order_no: 'SO20260815001',
      recipient_name: '张三',
      order_detail: '',
      items: [
        { id: 1, name: '产品A', sku: 'A', specification: '标准', quantity: 2 },
        { id: 2, name: '产品B', sku: 'B', specification: '标准', quantity: 1 },
      ],
      labels: [label(1, '产品A', 'A', 2, 3), label(2, '产品B', 'B', 1, 3)],
    };
    const repositories = makeRepository(detail);
    const service = new LabelService({ repositories: repositories as never });

    const result = service.mergeLabels(1, [1, 2]);

    expect(result).toHaveLength(1);
    expect(result?.[0]?.items.map((item) => [item.name, item.quantity, item.boxCount, item.totalQuantity])).toEqual([
      ['产品A', 2, 1, 2],
      ['产品B', 1, 1, 1],
    ]);
    expect(result?.[0]?.items[0]?.packSize).toBe(3);
    expect(result?.[0]?.items[1]?.packSize).toBe(3);
  });

  it('可再次合并已经包含多产品行的尾数箱', () => {
    const detail: Detail = {
      id: 1,
      order_no: 'SO20260815002',
      recipient_name: '李四',
      order_detail: '',
      items: [
        { id: 1, name: '产品A', sku: 'A', specification: '标准', quantity: 2 },
        { id: 2, name: '产品B', sku: 'B', specification: '标准', quantity: 1 },
        { id: 3, name: '产品C', sku: 'C', specification: '标准', quantity: 1 },
      ],
      labels: [label(1, '产品A', 'A', 2, 3), label(2, '产品B', 'B', 1, 3), label(3, '产品C', 'C', 1, 3)],
    };
    const repositories = makeRepository(detail);
    const service = new LabelService({ repositories: repositories as never });

    const first = service.mergeLabels(1, [1, 2]);
    const mixedId = Number(first?.[0]?.id);
    const result = service.mergeLabels(1, [mixedId, 101]);

    expect(result).toHaveLength(2);
    expect(result?.flatMap((entry) => entry.items.map((item) => item.name))).toEqual(['产品A', '产品B', '产品C']);
    expect(result?.flatMap((entry) => entry.items.map((item) => item.quantity))).toEqual([2, 1, 1]);
  });

  it('合并中间箱时会重新编号，避免与前面未合并箱号重复', () => {
    const detail: Detail = {
      id: 1,
      order_no: 'SO20260815003',
      recipient_name: '王五',
      order_detail: '',
      items: [1, 2, 3, 4, 5].map((id) => ({ id, name: '产品A', sku: 'A', specification: '标准', quantity: 2 })),
      labels: [1, 2, 3, 4, 5].map((id) => label(id, '产品A', 'A', 2, 3)),
    };
    const repositories = makeRepository(detail);
    const service = new LabelService({ repositories: repositories as never });

    const result = service.mergeLabels(1, [4, 5]);

    expect(result?.map((entry) => entry.boxNo)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(result?.map((entry) => entry.boxNo)).size).toBe(5);
  });
});

describe('箱唛打印状态', () => {
  function printDetail(id: number, status: string): Detail {
    return {
      id,
      status,
      order_no: `SO-${id}`,
      recipient_name: '收件人',
      order_detail: '',
      items: [{ id: 1, name: '产品', sku: 'SKU', specification: '标准', quantity: 1 }],
      labels: [label(id, '产品', 'SKU', 1, 1)],
    };
  }

  it('首次打印只记录历史，不改变订单状态', () => {
    const detail = printDetail(1, 'pending_stock');
    const repositories = printRepository([detail]);
    const transition = vi.fn();
    const service = new LabelService({ repositories: repositories as never, orderService: { transition } as never });

    service.recordPrintHistory({ orderIds: [1], labels: [{ orderId: 1, id: 1 }], actionType: 'print' });

    expect(transition).not.toHaveBeenCalled();
    expect(repositories.history[0]).toMatchObject({ actionType: 'print', orderIds: [1] });
    expect(detail.status).toBe('pending_stock');
  });

  it('后续状态重打只记录普通打印，不重复推进状态', () => {
    const detail = printDetail(1, 'pending_stock');
    const repositories = printRepository([detail]);
    const transition = vi.fn();
    const service = new LabelService({ repositories: repositories as never, orderService: { transition } as never });

    service.recordPrintHistory({ orderIds: [1], labels: [{ orderId: 1, id: 1 }], actionType: 'first-print' });

    expect(transition).not.toHaveBeenCalled();
    expect(repositories.history[0]).toMatchObject({ actionType: 'first-print', orderIds: [1] });
  });

  it('混合订单只记录实际提交的有效箱唛，不推进任何订单状态', () => {
    const pending = printDetail(1, 'pending_stock');
    const later = printDetail(2, 'pending_packing');
    const repositories = printRepository([pending, later]);
    const transition = vi.fn();
    const service = new LabelService({ repositories: repositories as never, orderService: { transition } as never });

    service.recordPrintHistory({ orderIds: [1, 2], labels: [{ orderId: 2, id: 2 }] });

    expect(transition).not.toHaveBeenCalled();
    expect(repositories.history[0]).toMatchObject({ actionType: 'print', orderIds: [2] });
  });

  it('箱唛 id 过期时降级为按提交内容记录，不阻断打印状态更新', () => {
    const detail = printDetail(1, 'pending_stock');
    const repositories = printRepository([detail]);
    const service = new LabelService({ repositories: repositories as never });

    service.recordPrintHistory({
      orderIds: [1],
      labels: [{
        orderId: 1,
        id: 999,
        orderNo: 'SO-1',
        recipientName: '收件人',
        cartonNo: 2,
        totalCartons: 3,
        lines: [{ name: '产品', sku: 'SKU', packCount: 1, totalCount: 1 }],
      }],
    });

    const recorded = repositories.history[0] as { labels: Array<{ labelId: number | null; boxNo: number; totalBoxes: number; snapshot: Record<string, unknown> }> };
    expect(recorded.labels).toHaveLength(1);
    expect(recorded.labels[0].labelId).toBeNull();
    expect(recorded.labels[0].boxNo).toBe(2);
    expect(recorded.labels[0].totalBoxes).toBe(3);
    expect(recorded.labels[0].snapshot).toMatchObject({ cartonNo: 2, totalCartons: 3 });
  });

  it('拒绝非法打印动作类型', () => {
    const detail = printDetail(1, 'label_pending');
    const repositories = printRepository([detail]);
    const service = new LabelService({ repositories: repositories as never });

    expect(() => service.recordPrintHistory({ orderIds: [1], labels: [{ orderId: 1, id: 1 }], actionType: 'preview' })).toThrow('打印动作类型无效');
  });
});
