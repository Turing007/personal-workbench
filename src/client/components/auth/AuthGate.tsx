import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import {
  AUTH_REQUIRED_EVENT,
  fetchCurrentUser,
  getAuthStatus,
  login as loginRequest,
  setupFirstAdmin,
  logout as logoutRequest,
  type AuthUser,
} from '../../api';

type AuthGateState = 'loading' | 'setup' | 'login' | 'ready';

export interface AuthGateRenderProps {
  user: AuthUser;
  onLogout: () => void;
}

interface AuthGateProps {
  children: (props: AuthGateRenderProps) => ReactNode;
}

/**
 * 会话门卫：启动时探测当前会话，未登录显示登录页，
 * 系统还没有任何账号时进入管理员初始化流程。
 * 任意接口返回 401 时自动切回登录页，重新登录后页面整体重载。
 */
export default function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthGateState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 任意接口返回 401/AUTH_REQUIRED 时广播该事件；仅在已就绪时响应，
    // 避免启动阶段的首个 401（探测 /api/auth/me）抢先覆盖 setup 状态。
    const onAuthRequired = () => {
      setUser(null);
      setState((current) => (current === 'ready' ? 'login' : current));
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    (async () => {
      try {
        const { user: current } = await fetchCurrentUser();
        if (!cancelled) {
          setUser(current);
          setState('ready');
        }
      } catch {
        try {
          const status = await getAuthStatus();
          if (!cancelled) setState(status.initialized ? 'login' : 'setup');
        } catch {
          if (!cancelled) setState('login');
        }
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, []);

  const handleSubmit = useCallback(async (values: { username: string; password: string; displayName?: string }, mode: AuthGateState) => {
    setSubmitting(true);
    setFormError('');
    try {
      const result = mode === 'setup' ? await setupFirstAdmin(values) : await loginRequest(values);
      setUser(result.user);
      setState('ready');
    } catch (error) {
      setFormError((error as { message?: string }).message ?? '操作失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // 会话已失效时同样按退出处理。
    }
    setUser(null);
    setState('login');
  }, []);

  if (state === 'ready' && user) return <>{children({ user, onLogout: handleLogout })}</>;
  if (state === 'loading') {
    return (
      <div className="auth-screen" aria-busy="true">
        <div className="auth-brand auth-brand-loading">
          <span className="auth-brand-mark">工</span>
          <span className="auth-brand-name">个人工作台</span>
        </div>
      </div>
    );
  }
  return (
    <AuthForm
      mode={state === 'setup' ? 'setup' : 'login'}
      error={formError}
      submitting={submitting}
      onSubmit={handleSubmit}
    />
  );
}

interface AuthFormProps {
  mode: 'setup' | 'login';
  error: string;
  submitting: boolean;
  onSubmit: (values: { username: string; password: string; displayName?: string }, mode: AuthGateState) => void;
}

function AuthForm({ mode, error, submitting, onSubmit }: AuthFormProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isSetup = mode === 'setup';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (isSetup && password !== confirmPassword) {
      return;
    }
    onSubmit(
      isSetup ? { username, password, displayName } : { username, password },
      mode,
    );
  };

  const confirmPasswordMismatch = isSetup && confirmPassword.length > 0 && confirmPassword !== password;
  const submitDisabled = submitting
    || !username.trim()
    || !password
    || (isSetup && (confirmPasswordMismatch || !confirmPassword));

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit} aria-label={isSetup ? '初始化管理员账号' : '登录'}>
        <div className="auth-brand">
          <span className="auth-brand-mark">工</span>
          <div>
            <h1 className="auth-title">{isSetup ? '初始化管理员' : '登录工作台'}</h1>
            <p className="auth-subtitle">{isSetup ? '创建第一个账号，它将自动成为管理员' : '订单、报价、发货与财务，一应俱全'}</p>
          </div>
        </div>

        {error && <p className="auth-error" role="alert">{error}</p>}

        <div className="auth-field">
          <label htmlFor="auth-username">用户名</label>
          <input
            id="auth-username"
            className="auth-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="字母、数字或下划线"
            required
          />
        </div>

        {isSetup && (
          <div className="auth-field">
            <label htmlFor="auth-display-name">显示名称<span className="auth-optional">（可选）</span></label>
            <input
              id="auth-display-name"
              className="auth-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              placeholder="例如：高先生"
            />
          </div>
        )}

        <div className="auth-field">
          <label htmlFor="auth-password">密码</label>
          <input
            id="auth-password"
            className="auth-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            placeholder={isSetup ? '至少 8 位' : undefined}
            required
          />
        </div>

        {isSetup && (
          <>
            <div className="auth-field">
              <label htmlFor="auth-confirm-password">确认密码</label>
              <input
                id="auth-confirm-password"
                className={`auth-input${confirmPasswordMismatch ? ' is-invalid' : ''}`}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="off"
                required
              />
              {confirmPasswordMismatch && <p className="auth-field-error">两次输入的密码不一致</p>}
            </div>
            <p className="auth-hint"><ShieldCheck size={14} /> 密码会加密存储，用于保护订单与财务数据</p>
          </>
        )}

        <button className="auth-submit" type="submit" disabled={submitDisabled}>
          <LogIn size={17} />
          {submitting ? '请稍候…' : isSetup ? '创建管理员并进入' : '登录'}
        </button>
      </form>
    </div>
  );
}
