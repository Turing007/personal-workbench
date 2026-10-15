import type { CompanySnapshot } from '../../shared/documents.js';
import type { Readable } from 'node:stream';
import {
  derivePackagingPresets,
  type PackagingPreset,
  type PackagingSourceRow,
} from '../../shared/packaging-presets.js';
import type { AccessoryPrice } from '../../shared/accessory-prices.js';
import { BATTERY_MATRIX_DEFAULTS, type BatteryPriceMatrix } from '../../shared/battery-prices.js';
import { EMPTY_COMPANY_PROFILE, SettingsRepository } from '../db/settings-repository.js';
import { FileStore } from '../files/file-store.js';
import type { ContractTemplate } from '../../shared/contract.js';

export type CompanyProfileInput = Partial<Pick<CompanySnapshot, 'name' | 'phone' | 'address' | 'defaultIssuer'>>;

export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly fileStore?: FileStore,
    /** 全库包装记录，用于首次使用时统计出预设初值。 */
    private readonly packagingSource?: () => PackagingSourceRow[],
    /** 产品库现存分类（含产品数），包装管理「可以装哪些产品」的候选来源。 */
    private readonly productCategorySource?: () => Array<{ name: string; productCount: number }>,
  ) {}

  getPackagingPresets(): PackagingPreset[] {
    return this.settings.readPackagingPresets() ?? this.reseedPackagingPresets();
  }

  savePackagingPresets(value: unknown): PackagingPreset[] {
    return this.settings.savePackagingPresets(value);
  }

  /** 包装管理的分类候选：产品库现存分类 + 已在包装上关联过的分类（后者可能是手工输入的新分类）。 */
  getPackagingCategories(): Array<{ name: string; productCount: number }> {
    const fromProducts = this.productCategorySource?.() ?? [];
    const merged = new Map<string, number>();
    for (const entry of fromProducts) {
      const name = entry.name.trim();
      if (name) merged.set(name, Math.max(merged.get(name) ?? 0, Number(entry.productCount) || 0));
    }
    // 已关联但产品库里没有的分类也要出现在候选里，否则用户打开编辑就看不到自己之前勾过什么。
    for (const preset of this.getPackagingPresets()) {
      for (const category of preset.categories) {
        const name = category.trim();
        if (name && !merged.has(name)) merged.set(name, 0);
      }
    }
    return [...merged.entries()]
      .map(([name, productCount]) => ({ name, productCount }))
      .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
  }

  /** 电池价格矩阵（行=单节容量、列=节数）；从未维护过时给默认模板。 */
  getBatteryPriceMatrix(): BatteryPriceMatrix {
    return this.settings.readBatteryPriceMatrix() ?? BATTERY_MATRIX_DEFAULTS;
  }

  saveBatteryPriceMatrix(value: unknown): BatteryPriceMatrix {
    return this.settings.saveBatteryPriceMatrix(value);
  }

  /** 充电器价格清单（名称 + 单价）。 */
  getChargerPrices(): AccessoryPrice[] {
    return this.settings.readChargerPrices();
  }

  saveChargerPrices(value: unknown): AccessoryPrice[] {
    return this.settings.saveChargerPrices(value);
  }

  /** 类目配件：按产品分类共享（如电锤的钻头，同类目所有产品可用）。 */
  getCategoryAccessoryPrices(category: string): AccessoryPrice[] {
    return this.settings.readCategoryAccessoryPricesFor(category);
  }

  saveCategoryAccessoryPrices(category: string, value: unknown): AccessoryPrice[] {
    return this.settings.saveCategoryAccessoryPrices(category, value);
  }

  /** 按现有产品包装记录重算并覆盖，供设置页「从产品库重新统计」使用。 */
  reseedPackagingPresets(): PackagingPreset[] {
    return this.settings.savePackagingPresets(derivePackagingPresets(this.packagingSource?.() ?? []));
  }

  getCompanyProfile(): CompanySnapshot {
    return this.settings.getCompanyProfile();
  }

  updateCompanyProfile(input: CompanyProfileInput): CompanySnapshot {
    const current = this.settings.getCompanyProfile();
    return this.settings.saveCompanyProfile({
      ...current,
      ...input,
      logoRelativePath: current.logoRelativePath,
      wechatQrRelativePath: current.wechatQrRelativePath,
    });
  }

  getContractTemplate(): ContractTemplate {
    return this.settings.getContractTemplate();
  }

  saveContractTemplate(value: unknown): ContractTemplate {
    return this.settings.saveContractTemplate(value);
  }

  getTunnelUrl(): string {
    return this.settings.getTunnelUrl();
  }

  saveTunnelUrl(value: unknown): string {
    return this.settings.saveTunnelUrl(value);
  }

  async replaceCompanyLogo(
    stream: Readable,
    originalName: string,
    mimeType: string,
  ): Promise<CompanySnapshot> {
    if (!this.fileStore) throw new Error('附件存储尚未配置');

    const current = this.settings.getCompanyProfile();
    const stored = await this.fileStore.saveImage(stream, 'company-logo', originalName, mimeType);
    let saved = false;
    try {
      const profile = this.settings.saveCompanyProfile({
        ...current,
        logoRelativePath: stored.relativePath,
      });
      saved = true;

      if (current.logoRelativePath) {
        await this.deleteCompanyLogoFile(current.logoRelativePath);
      }
      return profile;
    } finally {
      if (!saved) await this.fileStore.deleteFile(stored.relativePath);
    }
  }

  async deleteCompanyLogo(): Promise<CompanySnapshot> {
    const current = this.settings.getCompanyProfile();
    const profile = this.settings.saveCompanyProfile({
      ...current,
      logoRelativePath: null,
    });
    if (current.logoRelativePath) {
      await this.deleteCompanyLogoFile(current.logoRelativePath);
    }
    return profile;
  }

  /** 微信二维码：图册封面用；上传/删除与 Logo 同一套机制。 */
  async replaceCompanyQr(
    stream: Readable,
    originalName: string,
    mimeType: string,
  ): Promise<CompanySnapshot> {
    if (!this.fileStore) throw new Error('附件存储尚未配置');

    const current = this.settings.getCompanyProfile();
    const stored = await this.fileStore.saveImage(stream, 'company-qr', originalName, mimeType);
    let saved = false;
    try {
      const profile = this.settings.saveCompanyProfile({
        ...current,
        wechatQrRelativePath: stored.relativePath,
      });
      saved = true;

      if (current.wechatQrRelativePath) {
        await this.deleteCompanyQrFile(current.wechatQrRelativePath);
      }
      return profile;
    } finally {
      if (!saved) await this.fileStore.deleteFile(stored.relativePath);
    }
  }

  async deleteCompanyQr(): Promise<CompanySnapshot> {
    const current = this.settings.getCompanyProfile();
    const profile = this.settings.saveCompanyProfile({
      ...current,
      wechatQrRelativePath: null,
    });
    if (current.wechatQrRelativePath) {
      await this.deleteCompanyQrFile(current.wechatQrRelativePath);
    }
    return profile;
  }

  private async deleteCompanyLogoFile(relativePath: string): Promise<void> {
    if (!relativePath.startsWith('company-logos/')) return;
    await this.fileStore?.deleteFile(relativePath);
  }

  private async deleteCompanyQrFile(relativePath: string): Promise<void> {
    if (!relativePath.startsWith('company-qrs/')) return;
    await this.fileStore?.deleteFile(relativePath);
  }
}

export { EMPTY_COMPANY_PROFILE };
