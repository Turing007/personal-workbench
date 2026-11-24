import { downloadShipmentPdf, getOrderShipments } from '../../api';
import { saveFileOrDownload } from '../../file-save';
import type { OrderDraft } from '../OrderForm';

/** 按订单下载最近一次发货清单；多次发货的完整记录仍在订单详情里。 */
export async function downloadLatestOrderShippingList(order: OrderDraft): Promise<string> {
  if (!order.id) throw new Error('订单不存在');
  const shipments = await getOrderShipments(order.id);
  if (!shipments.length) throw new Error('该订单还没有确认发货，确认后可生成发货清单');
  const latest = [...shipments].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt) || b.id - a.id)[0]!;
  const blob = await downloadShipmentPdf(latest.id);
  const fileName = `${latest.shipmentNo || order.orderNo}-发货清单.pdf`;
  await saveFileOrDownload(blob, fileName);
  return fileName;
}
