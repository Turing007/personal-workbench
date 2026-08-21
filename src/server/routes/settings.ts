import type { FastifyInstance } from 'fastify';
import { FileStoreError } from '../files/file-store.js';
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
  app.get('/api/settings/company-profile', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, options.service.getCompanyProfile()), reply),
  );

  app.put('/api/settings/company-profile', async (request, reply) =>
    safeRoute(
      () => sendSuccess(reply, options.service.updateCompanyProfile(parseCompanyProfileInput(request.body))),
      reply,
    ),
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
