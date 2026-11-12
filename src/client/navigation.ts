import {
  Archive,
  BookOpen,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  HandCoins,
  LayoutDashboard,
  PackageCheck,
  PackageOpen,
  ReceiptText,
  Settings,
  ShoppingBag,
  WalletCards,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type NavigationKey = 'dashboard' | 'orders' | 'stock' | 'finance' | 'water-slips' | 'quotations' | 'sales-documents' | 'products' | 'product-catalog' | 'customer-products' | 'library' | 'shipping' | 'settings';

export interface NavigationItem {
  key: NavigationKey;
  label: string;
  /** 底部栏空间紧张时使用的短名，侧边栏仍用 label。 */
  shortLabel: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/* 按业务流程排序：报价 → 开单 → 订单 → 备货 → 发货 → 收款，其后是资料库与设置 */
export const navigationItems: NavigationItem[] = [
  { key: 'dashboard', label: '工作台', shortLabel: '工作台', icon: LayoutDashboard },
  { key: 'quotations', label: '报价单', shortLabel: '报价', icon: ReceiptText },
  { key: 'sales-documents', label: '销售单', shortLabel: '销售', icon: FileSpreadsheet },
  { key: 'orders', label: '订单', shortLabel: '订单', icon: ClipboardList },
  { key: 'stock', label: '备货', shortLabel: '备货', icon: PackageOpen },
  { key: 'shipping', label: '发货', shortLabel: '发货', icon: PackageCheck },
  { key: 'finance', label: '财务', shortLabel: '财务', icon: WalletCards },
  { key: 'water-slips', label: '水单', shortLabel: '水单', icon: HandCoins },
  { key: 'products', label: '产品库', shortLabel: '产品', icon: Boxes },
  { key: 'product-catalog', label: '产品图册', shortLabel: '图册', icon: BookOpen },
  { key: 'customer-products', label: '客户', shortLabel: '客户', icon: ShoppingBag },
  { key: 'library', label: '资料库', shortLabel: '资料', icon: Archive },
  { key: 'settings', label: '设置', shortLabel: '设置', icon: Settings },
];

export const navigationKeys: NavigationKey[] = navigationItems.map((item) => item.key);

const itemByKey = new Map(navigationItems.map((item) => [item.key, item]));

export function navigationItem(key: NavigationKey): NavigationItem {
  const item = itemByKey.get(key);
  if (!item) throw new Error(`未知导航模块：${key}`);
  return item;
}
