import type { FastifyInstance } from 'fastify';
import { networkInterfaces } from 'node:os';
import { FileStoreError } from '../files/file-store.js';
import { normalizeContractTemplate } from '../../shared/contract.js';
import { PACKAGING_PRESET_LIMIT } from '../../shared/packaging-presets.js';
import { config } from '../config.js';
import type { CompanyProfileInput, SettingsService } from '../services/settings-service.js';
import {
  ApiError,
  asRecord,
  mapDatabaseError,
  optionalText,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { imageFileOptions } from './multipart-limits.js';

/** 收集本机局域网 IPv4 地址并拼成工作台访问地址，供「手机连接」二维码使用。
 *  家庭路由器多为 192.168.x.x，排在前；172.x 常见于 WSL/虚拟网卡，排后。 */
function collectLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (item.address.startsWith('169.254.')) continue;
      addresses.push(`http://${item.address}:${config.port}`);
    }
  }
  return addresses.sort((a, b) => rank(a) - rank(b));

  function rank(url: string): number {
    if (url.includes('//192.168.')) return 0;
    if (url.includes('//10.')) return 1;
    return 2;
  }
}

interface SettingsRouteOptions {
  service: SettingsService;
}

function parseCompanyProfileInput(value: unknown): CompanyProfileInput {
  const body = asRecord(value);
  const input: CompanyProfileInput = {};
  if ('name' in body) input.name = optionalText(body.name, 'name', '公司名称');
  if ('phone' in body) input.phone = optionalText(body.phone, 'phone', '联系电话');
  if ('address' in body) input.address = optionalText(body.address, 'address', '公司地址');
  if ('defaultIssuer' in body) input.defaultIssuer = optionalText(body.defaultIssuer, 'defaultIssuer', '默认开单人');
  return input;
}

function parseContractTemplateInput(value: unknown): unknown {
  // 这里只做校验并把错误翻译成 400；真正归一化在仓储层统一执行。
  try {
    normalizeContractTemplate(value);
  } catch (error) {
    throw new ApiError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : '合同模板数据无效');
  }
  return value;
}

function mapSettingsError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && error.message === '附件存储尚未配置') {
    return new ApiError(503, 'FILE_STORE_UNAVAILABLE', error.message);
  }
  if (error instanceof FileStoreError) {
    switch (error.code) {
      case 'UNSUPPORTED_IMAGE_TYPE':
        return new ApiError(415, error.code, error.message, 'file');
      case 'IMAGE_TOO_LARGE':
        return new ApiError(413, error.code, error.message, 'file');
      case 'INVALID_FILE_NAME':
      case 'INVALID_FILE_PATH':
        return new ApiError(400, error.code, error.message, 'file');
      default:
        return new ApiError(500, error.code, error.message);
    }
  }
  return mapDatabaseError(error);
}

async function safeRoute<T>(
  handler: () => Promise<T> | T,
  reply: Parameters<typeof sendFailure>[0],
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, mapSettingsError(error));
  }
}

export async function registerSettingsRoutes(app: FastifyInstance, options: SettingsRouteOptions): Promise<void> {
  app.get('/api/settings/network-addresses', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, {
      addresses: collectLanAddresses(),
      tunnelUrl: options.service.getTunnelUrl(),
    }), reply),
  );

  // 隧道地址由用户填写（如 Cloudflare Tunnel / ngrok 的公网地址），供手机在流量网络下访问。
  app.put('/api/settings/network-addresses', async (request, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const raw = typeof body.tunnelUrl === 'string' ? body.tunnelUrl.trim().replace(/\/+$/, '') : '';
      if (raw && !/^https?:\/\/[^\s/]+/i.test(raw)) {
        throw new ApiError(400, 'VALIDATION_ERROR', '隧道地址需以 http:// 或 https:// 开头', 'tunnelUrl');
      }
      const tunnelUrl = options.service.saveTunnelUrl(raw);
      return sendSuccess(reply, { addresses: collectLanAddresses(), tunnelUrl });
    }, reply),
  );

  app.get('/api/settings/company-profile', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, options.service.getCompanyProfile()), reply),
  );

  app.put('/api/settings/company-profile', async (request, reply) =>
    safeRoute(
      () => sendSuccess(reply, options.service.updateCompanyProfile(parseCompanyProfileInput(request.body))),
      reply,
    ),
  );

  app.get('/api/settings/contract-template', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, options.service.getContractTemplate()), reply),
  );

  app.put('/api/settings/contract-template', async (request, reply) =>
    safeRoute(
      () => sendSuccess(reply, options.service.saveContractTemplate(parseContractTemplateInput(request.body))),
      reply,
    ),
  );

  app.get('/api/settings/packaging-presets', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, { items: options.service.getPackagingPresets() }), reply),
  );

  app.put('/api/settings/packaging-presets', async (request, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      if (!Array.isArray(body.items)) throw new ApiError(400, 'VALIDATION_ERROR', '包装预设数据格式不正确', 'items');
      if (body.items.length > PACKAGING_PRESET_LIMIT) {
        throw new ApiError(400, 'PRESET_LIMIT', `包装预设最多 ${PACKAGING_PRESET_LIMIT} 条，请先删除再添加`, 'items');
      }
      return sendSuccess(reply, { items: options.service.savePackagingPresets(body.items) });
    }, reply),
  );

  app.post('/api/settings/packaging-presets/reseed', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, { items: options.service.reseedPackagingPresets() }), reply),
  );

  app.post('/api/settings/company-profile/logo', async (request, reply) =>
    safeRoute(async () => {
      const file = await request.file(imageFileOptions);
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择公司 Logo', 'file');
      const profile = await options.service.replaceCompanyLogo(file.file, file.filename, file.mimetype);
      return sendSuccess(reply, profile, 201);
    }, reply),
  );

  app.delete('/api/settings/company-profile/logo', async (_request, reply) =>
    safeRoute(async () => sendSuccess(reply, await options.service.deleteCompanyLogo()), reply),
  );
}

export const settingsRoutes = registerSettingsRoutes;
