import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CustomerSaveInput } from '../../shared/customers.js';
import {
  CustomerNameExistsError,
  CustomerService,
  CustomerValidationError,
} from '../services/customer-service.js';
import { ApiError, asRecord, mapDatabaseError, parseId, sendFailure, sendSuccess } from './api-response.js';

export interface CustomerRouteOptions {
  service: CustomerService;
}

function customerError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof CustomerNameExistsError) {
    return new ApiError(409, 'CUSTOMER_NAME_EXISTS', error.message, error.field);
  }
  if (error instanceof CustomerValidationError) {
    return new ApiError(400, 'VALIDATION_ERROR', error.message, error.field);
  }
  return mapDatabaseError(error);
}

async function safeRoute<T>(handler: () => T | Promise<T>, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, customerError(error));
  }
}

function parseCustomerInput(value: unknown): CustomerSaveInput {
  const body = asRecord(value);
  if (body.confirmDuplicateName !== undefined && typeof body.confirmDuplicateName !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', '同名确认必须是布尔值', 'confirmDuplicateName');
  }
  return {
    name: body.name as string,
    contactName: body.contactName as string,
    contactPhone: body.contactPhone as string,
    shippingInfo: body.shippingInfo as string,
    confirmDuplicateName: body.confirmDuplicateName as boolean | undefined,
  };
}

function parseIsActive(value: unknown): boolean {
  const body = asRecord(value);
  if (typeof body.isActive !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', '启停状态必须是布尔值', 'isActive');
  }
  return body.isActive;
}

function optionalQueryText(query: Record<string, unknown>, field: string): string | undefined {
  const value = query[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} 必须是单个文本参数`, field);
  }
  return value;
}

export async function registerCustomerRoutes(app: FastifyInstance, options: CustomerRouteOptions): Promise<void> {
  app.get('/api/customers', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, unknown>;
    const search = optionalQueryText(query, 'q');
    const includeInactive = optionalQueryText(query, 'includeInactive');
    return sendSuccess(reply, {
      items: options.service.list({
        search,
        includeInactive: includeInactive === '1' || includeInactive === 'true',
      }),
    });
  }, reply));

  app.get('/api/customers/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(() => {
    const customer = options.service.get(parseId(request.params.id));
    if (!customer) throw new ApiError(404, 'NOT_FOUND', '客户不存在');
    return sendSuccess(reply, customer);
  }, reply));

  app.post('/api/customers', async (request, reply) => safeRoute(() => (
    sendSuccess(reply, options.service.create(parseCustomerInput(request.body)), 201)
  ), reply));

  app.put('/api/customers/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(() => {
    const customer = options.service.update(parseId(request.params.id), parseCustomerInput(request.body));
    if (!customer) throw new ApiError(404, 'NOT_FOUND', '客户不存在');
    return sendSuccess(reply, customer);
  }, reply));

  app.patch('/api/customers/:id/status', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(() => {
    const customer = options.service.setActive(parseId(request.params.id), parseIsActive(request.body));
    if (!customer) throw new ApiError(404, 'NOT_FOUND', '客户不存在');
    return sendSuccess(reply, customer);
  }, reply));

  app.delete('/api/customers/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(() => {
    const result = options.service.remove(parseId(request.params.id));
    if (!result) throw new ApiError(404, 'NOT_FOUND', '客户不存在');
    return sendSuccess(reply, result);
  }, reply));
}

export const customerRoutes = registerCustomerRoutes;
