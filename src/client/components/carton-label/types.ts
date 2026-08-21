export interface LabelLine {
  id: string;
  sku: string;
  name: string;
  specification: string;
  packSize: number;
  quantity: number;
  boxCount?: number;
  totalQuantity?: number;
  remark?: string;
  orderItemId?: number | null;
}

export interface CartonLabel {
  id: string;
  orderId: string;
  orderNo: string;
  recipientName: string;
  cartonNo: number;
  totalCartons: number;
  lines: LabelLine[];
  isTail?: boolean;
  printedAt?: string;
  manuallyEdited?: boolean;
  remark?: string;
  productRemark?: string;
  orderRemark?: string;
}
