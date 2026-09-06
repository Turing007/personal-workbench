import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { loginWithPassword, setupAccessPassword } from '../api';

const MIN_PASSWORD_LENGTH = 6;

export interface LoginGateProps {
  /** setup = 首次创建访问密码；login = 已设置密码后的登录界面。 */
  mode: 'setup' | 'login';
  onUnlocked: () => void;
}

/** 全屏登录门：会话失效或首次设置访问密码时覆盖整个应用。 */
export default function LoginGate({ mode, onUnlocked }: LoginGateProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'setup') await setupAccessPassword(password);
      else await loginWithPassword(password);
      onUnlocked();
    } catch (cause) {
      setError((cause as { message?: string }).message ?? '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-gate">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-card-icon" aria-hidden>
          <KeyRound size={26} />
        </div>
        <h1>{mode === 'setup' ? '创建访问密码' : '个人工作台'}</h1>
        <p>{mode === 'setup' ? '首次使用，请设置一个访问密码来保护订单、客户与财务数据。' : '请输入访问密码继续'}</p>
        <label className="label">
          访问密码
          <input
            className="input"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {mode === 'setup' && (
          <label className="label">
            确认密码
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={busy || !password}>
          {mode === 'setup' ? <ShieldCheck size={15} /> : <LogIn size={15} />}
          {busy ? '验证中...' : mode === 'setup' ? '创建并进入' : '进入工作台'}
        </button>
      </form>
    </div>
  );
}
