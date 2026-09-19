import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_TIMEOUT_MESSAGE, request } from '../../src/client/api';

const REQUEST_MS = 30_000;
const UPLOAD_MS = 100_000;

/** 模拟“发出去就没了回音”的链路：只有 signal abort 时才拒绝，和真实 fetch 行为一致。 */
function stubHangingFetch(captured: { signal?: AbortSignal | null }) {
  vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    captured.signal = init?.signal ?? null;
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })));
}

function response(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('API 请求的超时兜底', () => {
  const captured: { signal?: AbortSignal | null } = {};

  beforeEach(() => {
    captured.signal = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('普通请求挂死时按超时 reject，并 abort 掉底层 fetch', async () => {
    stubHangingFetch(captured);
    const pending = request('/api/orders');
    // 先挂上断言再推进虚拟时钟：否则 rejection 会早于 handler 一拍，被 Node 报成 unhandled。
    const assertion = expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT', message: NETWORK_TIMEOUT_MESSAGE });
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    await assertion;
    expect(captured.signal?.aborted).toBe(true);
  });

  it('附件上传用更宽的预算：30 秒不算失败，100 秒才放弃', async () => {
    stubHangingFetch(captured);
    let settled = false;
    const form = new FormData();
    form.append('file', new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' }));
    const pending = request('/api/orders/1/contracts', { method: 'POST', body: form });
    void pending.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(UPLOAD_MS - REQUEST_MS);
    await expect(pending).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
  });

  it('加超时不改正常响应：envelope 里的 data 照常取出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: true, data: { id: 7 } })));
    await expect(request('/api/orders/7')).resolves.toEqual({ id: 7 });
  });

  it('加超时不改错误响应：服务端的文案仍然原样抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, error: { code: 'VALIDATION_ERROR', message: '订单号已存在' } }, 409)));
    await expect(request('/api/orders')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '订单号已存在' });
  });
});
