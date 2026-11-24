import { downloadOrderShippingListPreview } from '../../api';
import { saveFileOrDownload } from '../../file-save';

/** 按当前填写的本次数量生成发货清单，随包打印；不产生发货记录，确认发货前也能打。 */
export async function downloadOrderShippingList(
  order: { id?: string | number; orderNo: string },
  items: Array<{ orderItemId: number; quantity: number }>,
  trackingNo: string,
): Promise<string> {
  if (!order.id) throw new Error('订单不存在');
  const blob = await downloadOrderShippingListPreview(order.id, { trackingNo, items });
  const fileName = `${order.orderNo}-发货清单.pdf`;
  await saveFileOrDownload(blob, fileName);
  return fileName;
}
