import type { CompanySnapshot } from '../../shared/documents.js';
import type { Readable } from 'node:stream';
import {
  derivePackagingPresets,
  type PackagingPreset,
  type PackagingSourceRow,
} from '../../shared/packaging-presets.js';
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
  ) {}

  getPackagingPresets(): PackagingPreset[] {
    return this.settings.readPackagingPresets() ?? this.reseedPackagingPresets();
  }

  savePackagingPresets(value: unknown): PackagingPreset[] {
    return this.settings.savePackagingPresets(value);
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
