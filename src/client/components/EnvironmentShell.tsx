import { useEffect, useState, type ReactNode } from 'react';
import { getServiceVersion } from '../api';
import type { WorkbenchEnvironment } from '../../shared/environment';

/**
 * 测试实例的外壳：判定来自服务端 /health 的 environment 字段。
 *
 * 本机实例和线上只差一个端口，手机上根本看不见，认错的代价是拿错库录数据，
 * 所以测试端在最上面常驻一条横条。高度通过 --env-banner-h 表达：
 * 线上该变量为 0px，所有全高容器（app-content / sidebar / products-page / auth-screen）
 * 都写 calc(100vh - var(--env-banner-h))，两种环境下布局完全一致。
 */
export default function EnvironmentShell({ children }: { children: ReactNode }) {
  const [environment, setEnvironment] = useState<WorkbenchEnvironment | null>(null);

  useEffect(() => {
    let cancelled = false;
    // /health 不需要登录，未登录的登录页也能拿到，所以横条在登录前就可见。
    getServiceVersion()
      .then((info) => { if (!cancelled) setEnvironment(info.environment); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const isTest = environment === 'test';

  // 弹窗与浮层都是 createPortal 到 body 的，挂在 shell 上的变量它们读不到，
  // 所以标志放到 :root 上，全站（含 portal）共用同一个 --env-banner-h。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('env-test', isTest);
    return () => root.classList.remove('env-test');
  }, [isTest]);

  return (
    <div className={isTest ? 'environment-shell is-test' : 'environment-shell'}>
      {isTest && <div className="environment-banner" role="status">测试环境 · 本机数据，改动不会同步到线上</div>}
      {children}
    </div>
  );
}
