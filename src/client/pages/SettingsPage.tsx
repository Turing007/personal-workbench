import { ArrowDown, ArrowUp, Building2, CalendarClock, Copy, Database, Download, ImageOff, KeyRound, Plus, RotateCcw, Save, ScrollText, Smartphone, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { CompanySnapshot } from '../../shared/documents';
import { CONTRACT_PLACEHOLDERS, cloneDefaultContractTemplate, type ContractTemplate } from '../../shared/contract';
import {
  changeOwnPassword,
  createManagedUser,
  getAutoBackupStatus,
  listUsers,
  runAutoBackupNow,
  updateAutoBackupSettings,
  updateManagedUser,
  type AuthUser,
  type AutoBackupStatus,
} from '../api';

const EMPTY_PROFILE: CompanySnapshot = { name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' };

interface ApiEnvelope<T> { ok?: boolean; data?: T; error?: { message?: string }; }

async function settingsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? '公司资料操作失败');
  return payload.data as T;
}

const defaultCompanyApi = {
  load: () => settingsRequest<CompanySnapshot>('/api/settings/company-profile'),
  save: (profile: CompanySnapshot) => settingsRequest<CompanySnapshot>('/api/settings/company-profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: profile.name, phone: profile.phone, address: profile.address, defaultIssuer: profile.defaultIssuer }),
  }),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return settingsRequest<CompanySnapshot>('/api/settings/company-profile/logo', { method: 'POST', body: form });
  },
  deleteLogo: () => settingsRequest<CompanySnapshot>('/api/settings/company-profile/logo', { method: 'DELETE' }),
};

const defaultTemplateApi = {
  load: () => settingsRequest<ContractTemplate>('/api/settings/contract-template'),
  save: (template: ContractTemplate) => settingsRequest<ContractTemplate>('/api/settings/contract-template', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: template.title, clauses: template.clauses }),
  }),
};

type SettingsSectionKey = 'company' | 'contract' | 'storage' | 'backup' | 'account' | 'mobile';

// 两级菜单：分组标题 → 菜单项，内容区一次只显示激活的板块。
const SETTINGS_MENU_GROUPS: Array<{ label: string; items: Array<{ key: SettingsSectionKey; label: string; icon: LucideIcon }> }> = [
  { label: '基础资料', items: [{ key: 'company', label: '公司资料', icon: Building2 }] },
  { label: '单据模板', items: [{ key: 'contract', label: '购销合同模板', icon: ScrollText }] },
  {
    label: '数据与备份',
    items: [
      { key: 'storage', label: '运行环境', icon: Database },
      { key: 'backup', label: '备份与恢复', icon: Download },
    ],
  },
  { label: '账号与安全', items: [{ key: 'account', label: '账号与安全', icon: Users }] },
  { label: '移动端', items: [{ key: 'mobile', label: '手机连接', icon: Smartphone }] },
];

export interface SettingsPageProps {
  onBackup?: () => Promise<void> | void;
  onRestore?: (file: File) => Promise<void> | void;
  loadCompanyProfile?: () => Promise<CompanySnapshot>;
  saveCompanyProfile?: (profile: CompanySnapshot) => Promise<CompanySnapshot>;
  uploadCompanyLogo?: (file: File) => Promise<CompanySnapshot>;
  deleteCompanyLogo?: () => Promise<CompanySnapshot>;
  onProfileChanged?: (profile: CompanySnapshot) => void;
  currentUser?: AuthUser | null;
}

export default function SettingsPage({
  onBackup,
  onRestore,
  loadCompanyProfile = defaultCompanyApi.load,
  saveCompanyProfile = defaultCompanyApi.save,
  uploadCompanyLogo = defaultCompanyApi.uploadLogo,
  deleteCompanyLogo = defaultCompanyApi.deleteLogo,
  onProfileChanged,
  currentUser,
}: SettingsPageProps) {
  const [profile, setProfile] = useState<CompanySnapshot>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [template, setTemplate] = useState<ContractTemplate>(() => cloneDefaultContractTemplate());
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');
  const [templateMessageType, setTemplateMessageType] = useState<'success' | 'error'>('success');
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>('company');

  const showMessage = (text: string, type: 'success' | 'error') => { setMessage(text); setMessageType(type); };
  const refreshProfile = async () => {
    const next = await loadCompanyProfile();
    setProfile(next);
    onProfileChanged?.(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadCompanyProfile().then((next) => {
      if (active) { setProfile(next); onProfileChanged?.(next); }
    }).catch((error) => {
      if (active) showMessage(error instanceof Error ? error.message : '公司资料加载失败', 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadCompanyProfile]);

  const setField = <K extends keyof CompanySnapshot>(field: K, value: CompanySnapshot[K]) => setProfile((current) => ({ ...current, [field]: value }));
  const saveProfile = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await saveCompanyProfile(profile);
      setProfile(next);
      onProfileChanged?.(next);
      await refreshProfile();
      showMessage('公司资料已保存', 'success');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '公司资料保存失败', 'error');
    } finally {
      setBusy(false);
    }
  };
  const uploadLogo = async (file: File) => {
    setBusy(true);
    setMessage('');
    try {
      const next = await uploadCompanyLogo(file);
      setProfile(next);
      onProfileChanged?.(next);
      await refreshProfile();
      showMessage('公司 Logo 已更新', 'success');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '公司 Logo 上传失败', 'error');
    } finally {
      setBusy(false);
    }
  };
  const removeLogo = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await deleteCompanyLogo();
      setProfile(next);
      onProfileChanged?.(next);
      await refreshProfile();
      showMessage('公司 Logo 已删除', 'success');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '公司 Logo 删除失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const showTemplateMessage = (text: string, type: 'success' | 'error') => { setTemplateMessage(text); setTemplateMessageType(type); };

  useEffect(() => {
    let active = true;
    void defaultTemplateApi.load().then((next) => {
      if (active) setTemplate(next);
    }).catch((error) => {
      if (active) showTemplateMessage(error instanceof Error ? error.message : '合同模板加载失败', 'error');
    }).finally(() => {
      if (active) setTemplateLoading(false);
    });
    return () => { active = false; };
  }, []);

  const updateClause = (index: number, value: string) =>
    setTemplate((current) => ({ ...current, clauses: current.clauses.map((clause, i) => (i === index ? value : clause)) }));
  const addClause = () => setTemplate((current) => ({ ...current, clauses: [...current.clauses, ''] }));
  const removeClause = (index: number) =>
    setTemplate((current) => ({ ...current, clauses: current.clauses.filter((_, i) => i !== index) }));
  const moveClause = (index: number, offset: -1 | 1) => setTemplate((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.clauses.length) return current;
    const clauses = [...current.clauses];
    [clauses[index], clauses[target]] = [clauses[target], clauses[index]];
    return { ...current, clauses };
  });

  const saveTemplate = async () => {
    if (!template.title.trim() || template.clauses.some((clause) => !clause.trim())) {
      showTemplateMessage('合同标题与每条条款内容都不能为空', 'error');
      return;
    }
    setTemplateBusy(true);
    setTemplateMessage('');
    try {
      const next = await defaultTemplateApi.save(template);
      setTemplate(next);
      showTemplateMessage('合同模板已保存，订单生成时立即生效', 'success');
    } catch (error) {
      showTemplateMessage(error instanceof Error ? error.message : '合同模板保存失败', 'error');
    } finally {
      setTemplateBusy(false);
    }
  };
  const resetTemplate = () => {
    if (!window.confirm('确定放弃当前编辑并恢复默认购销合同模板吗？（需点击保存才会写入）')) return;
    setTemplate(cloneDefaultContractTemplate());
    showTemplateMessage('已恢复默认模板，确认无误后请点击保存', 'success');
  };

  return <div className="page-shell">
    <section className="settings-layout">
      <nav className="settings-menu card" aria-label="设置分类导航">
        {SETTINGS_MENU_GROUPS.map((group) => (
          <div key={group.label} className="settings-menu-group">
            <div className="settings-menu-group-title">{group.label}</div>
            {group.items.map((item) => {
              const ItemIcon = item.icon;
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={active ? 'settings-menu-item is-active' : 'settings-menu-item'}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveSection(item.key)}
                >
                  <ItemIcon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="settings-content">
      {activeSection === 'company' && <div className="settings-section card">
      <div className="settings-heading"><Building2 size={18} /><strong>公司资料</strong></div>
      <p>这里的资料会作为新建报价单和销售开单的默认公司信息，保存后的历史单据仍使用各自快照。</p>
      <div className="settings-profile-layout" style={{ display: 'grid', gridTemplateColumns: '132px minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <div className="settings-logo-column" style={{ display: 'grid', gap: 8 }}>
          <div className="settings-logo-preview" style={{ height: 90, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', border: '1px solid #dbe3ea', borderRadius: 6, background: 'var(--tone-surface-frost)' }}>{profile.logoRelativePath ? <img src={`/files/${profile.logoRelativePath}`} alt="公司 Logo" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 50%' }} /> : <ImageOff size={24} color="var(--tone-text-faint)" />}</div>
          <div className="settings-logo-actions" style={{ display: 'flex', gap: 6 }}><label className="button button-secondary" title="上传公司 Logo" style={{ flex: 1, justifyContent: 'center' }}><Upload size={14} /><span>上传</span><input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = ''; }} hidden /></label>{profile.logoRelativePath && <button className="icon-button danger" type="button" title="删除公司 Logo" disabled={busy} onClick={() => { if (window.confirm('确定删除当前公司 Logo 吗？')) void removeLogo(); }}><Trash2 size={14} /></button>}</div>
        </div>
        <div className="form-grid form-grid-2 settings-profile-fields" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
          <label className="label">公司名称<input className="input" disabled={loading || busy} value={profile.name} onChange={(event) => setField('name', event.target.value)} /></label>
          <label className="label">联系电话<input className="input" disabled={loading || busy} value={profile.phone} onChange={(event) => setField('phone', event.target.value)} /></label>
          <label className="label">公司地址<input className="input" disabled={loading || busy} value={profile.address} onChange={(event) => setField('address', event.target.value)} /></label>
          <label className="label">默认开单人<input className="input" disabled={loading || busy} value={profile.defaultIssuer} onChange={(event) => setField('defaultIssuer', event.target.value)} /></label>
          <div className="settings-profile-actions" style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}><span role="status" className={message ? `notice notice-${messageType}` : undefined} style={{ marginRight: 'auto', color: messageType === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</span><button className="button button-primary" type="button" disabled={loading || busy} onClick={() => void saveProfile()}><Save size={15} />{busy ? '处理中...' : '保存公司资料'}</button></div>
        </div>
      </div>
      </div>}
      {activeSection === 'contract' && <div className="settings-section card">
      <div className="settings-heading"><ScrollText size={18} /><strong>购销合同模板</strong></div>
      <p>订单详情里「生成购销合同」会按此模板输出 PDF 并归档到订单附件。条款中可使用下方占位符，生成时自动替换为订单数据；无法识别的占位符会原样保留。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '2px 0 12px' }}>
        {CONTRACT_PLACEHOLDERS.map((placeholder) => <code key={placeholder.key} title={placeholder.description} style={{ padding: '3px 8px', border: '1px solid #dbe3ea', borderRadius: 5, background: 'var(--tone-surface-frost)', color: 'var(--tone-accent-text)', fontSize: 11 }}>{`{${placeholder.key}}`}</code>)}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="label" style={{ maxWidth: 360 }}>合同标题<input className="input" disabled={templateLoading || templateBusy} value={template.title} onChange={(event) => setTemplate((current) => ({ ...current, title: event.target.value }))} /></label>
        {template.clauses.map((clause, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'start' }}>
            <label className="label">{`第 ${index + 1} 条`}<textarea className="input" rows={3} disabled={templateLoading || templateBusy} value={clause} onChange={(event) => updateClause(index, event.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} /></label>
            <div style={{ display: 'flex', gap: 4, paddingTop: 24 }}>
              <button className="icon-button" type="button" title="上移" disabled={index === 0 || templateBusy} onClick={() => moveClause(index, -1)}><ArrowUp size={14} /></button>
              <button className="icon-button" type="button" title="下移" disabled={index === template.clauses.length - 1 || templateBusy} onClick={() => moveClause(index, 1)}><ArrowDown size={14} /></button>
              <button className="icon-button danger" type="button" title="删除条款" disabled={template.clauses.length <= 1 || templateBusy} onClick={() => removeClause(index)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <button className="button button-secondary" type="button" disabled={templateBusy || template.clauses.length >= 60} onClick={addClause}><Plus size={14} />添加条款</button>
          <div style={{ marginLeft: 'auto', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
            <span role="status" className={templateMessage ? `notice notice-${templateMessageType}` : undefined} style={{ color: templateMessageType === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{templateMessage}</span>
            <button className="button button-secondary" type="button" disabled={templateLoading || templateBusy} onClick={resetTemplate}><RotateCcw size={15} />恢复默认</button>
            <button className="button button-primary" type="button" disabled={templateLoading || templateBusy} onClick={() => void saveTemplate()}><Save size={15} />{templateBusy ? '保存中...' : '保存合同模板'}</button>
          </div>
        </div>
      </div>
      </div>}
      {activeSection === 'account' && <AccountSection currentUser={currentUser ?? null} />}
      {activeSection === 'mobile' && <MobileConnectCard />}
      {activeSection === 'storage' && <div className="settings-section card"><div className="settings-heading"><Database size={18} /><strong>运行环境</strong></div><p>数据保存在服务端（SQLite + 附件目录），所有设备登录后访问同一份数据。</p><div className="setting-row"><span>服务地址</span><code>{window.location.origin}</code></div><div className="setting-row"><span>存储方式</span><span>SQLite + 服务端附件目录</span></div></div>}
      {activeSection === 'backup' && <div style={{ display: 'grid', gap: 14 }}>
        <AutoBackupCard />
        <div className="settings-section card"><div className="settings-heading"><Download size={18} /><strong>手动备份与恢复</strong></div><p>备份包含订单、产品、箱唛、打印历史、报价单、销售单及相关附件。恢复前会自动保留当前数据备份。</p><div className="settings-actions"><button className="button button-primary" type="button" onClick={() => void onBackup?.()}><Download size={15} />创建备份</button><label className="button button-secondary"><RotateCcw size={15} />选择备份恢复<input type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onRestore?.(file); event.target.value = ''; }} hidden /></label></div></div>
      </div>}
      </div>
    </section>
  </div>;
}

/** 手机连接：展示服务地址与二维码，手机扫码或安装 App 后填入即可访问同一份数据。 */
function MobileConnectCard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const serverUrl = typeof window === 'undefined' ? '' : window.location.origin;

  useEffect(() => {
    if (!canvasRef.current || !serverUrl) return;
    QRCode.toCanvas(canvasRef.current, serverUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#171a20', light: '#ffffff' },
    }).catch(() => { /* 二维码生成失败时仅展示文字地址 */ });
  }, [serverUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 剪贴板不可用时忽略 */ }
  };

  return <div className="settings-section card">
    <div className="settings-heading"><Smartphone size={18} /><strong>手机连接</strong></div>
    <p>手机安装「个人工作台」App 后，在首屏填入下方地址即可登录使用；也可以用手机浏览器或相机扫码直接打开。</p>
    <div className="settings-mobile-layout">
      <canvas ref={canvasRef} className="settings-mobile-qrcode" aria-label="服务地址二维码" />
      <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <div className="setting-row" style={{ alignItems: 'center' }}>
          <span>服务地址</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{serverUrl}</code>
            <button className="icon-button" type="button" title="复制地址" onClick={() => void copy()}><Copy size={14} /></button>
          </div>
        </div>
        {copied && <span style={{ color: 'var(--tone-accent-text)', fontSize: 12 }}>已复制到剪贴板</span>}
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-text-secondary)', display: 'grid', gap: 6 }}>
          <li>手机与工作台服务器网络互通（同一局域网，或已部署到公网服务器）。</li>
          <li>安装 App 后在「连接工作台」页面点「扫描二维码」，对准上方二维码即可自动填入地址。</li>
          <li>使用管理员创建的账号登录，数据与电脑端实时一致。</li>
        </ol>
      </div>
    </div>
  </div>;
}

/** 账号与安全：修改自己的密码；管理员可管理账号（新建/停用/重置密码/调整角色）。 */function AccountSection({ currentUser }: { currentUser: AuthUser | null }) {
  const isAdmin = currentUser?.role === 'admin';
  return <div style={{ display: 'grid', gap: 14 }}>
    <PasswordCard />
    {isAdmin && <UserManagementCard currentUserId={currentUser!.id} />}
  </div>;
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      setMessageType('error');
      setMessage('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await changeOwnPassword({ currentPassword, newPassword });
      setMessageType('success');
      setMessage('密码已更新，其他设备需要重新登录');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setBusy(false);
    }
  };

  return <div className="settings-section card">
    <div className="settings-heading"><KeyRound size={18} /><strong>修改我的密码</strong></div>
    <p>修改成功后当前设备保持登录，其他已登录设备会被要求重新登录。</p>
    <div className="settings-account-form">
      <label className="label">当前密码<input className="input" type="password" autoComplete="off" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label className="label">新密码（至少 8 位）<input className="input" type="password" autoComplete="off" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
      <label className="label">确认新密码<input className="input" type="password" autoComplete="off" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      <div className="settings-actions">
        <button className="button button-primary" type="button" disabled={busy || !currentPassword || !newPassword} onClick={() => void submit()}>更新密码</button>
        {message && <span role="status" style={{ color: messageType === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</span>}
      </div>
    </div>
  </div>;
}

function UserManagementCard({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [newPassword, setNewPassword] = useState('');
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null);
  const [resetValue, setResetValue] = useState('');

  const show = (text: string, type: 'success' | 'error') => { setMessage(text); setMessageType(type); };

  const load = useCallback(async () => {
    try {
      const result = await listUsers();
      setUsers(result.users);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '账号列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createUser = async () => {
    setBusy(true);
    setMessage('');
    try {
      await createManagedUser({
        username: newUsername,
        password: newPassword,
        displayName: newDisplayName,
        role: newRole,
      });
      show(`账号“${newUsername}”已创建`, 'success');
      setNewUsername('');
      setNewDisplayName('');
      setNewRole('member');
      setNewPassword('');
      setCreating(false);
      await load();
    } catch (error) {
      show(error instanceof Error ? error.message : '账号创建失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (target: AuthUser) => {
    const verb = target.isActive ? '停用' : '启用';
    if (target.isActive && !window.confirm(`确定停用账号“${target.displayName || target.username}”吗？停用后该账号将无法登录。`)) return;
    setBusy(true);
    setMessage('');
    try {
      await updateManagedUser(target.id, { isActive: !target.isActive });
      show(`账号“${target.username}”已${verb}`, 'success');
      await load();
    } catch (error) {
      show(error instanceof Error ? error.message : `账号${verb}失败`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: AuthUser, role: 'admin' | 'member') => {
    setBusy(true);
    setMessage('');
    try {
      await updateManagedUser(target.id, { role });
      show(`账号“${target.username}”已设为${role === 'admin' ? '管理员' : '成员'}`, 'success');
      await load();
    } catch (error) {
      show(error instanceof Error ? error.message : '角色调整失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    setMessage('');
    try {
      await updateManagedUser(resetTarget.id, { password: resetValue });
      show(`账号“${resetTarget.username}”的密码已重置`, 'success');
      setResetTarget(null);
      setResetValue('');
    } catch (error) {
      show(error instanceof Error ? error.message : '密码重置失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return <div className="settings-section card">
    <div className="settings-heading"><Users size={18} /><strong>账号管理</strong></div>
    <p>所有成员共用同一套业务数据，账号用于登录安全与操作留痕。至少保留一名启用的管理员。</p>
    {loadError && <p className="notice notice-error">{loadError}</p>}
    {loading ? <p>加载中...</p> : (
      <div className="settings-account-list">
        {users.map((user) => (
          <div key={user.id} className={`settings-account-row${user.isActive ? '' : ' is-disabled'}`}>
            <div className="settings-account-info">
              <strong>{user.displayName || user.username}{user.id === currentUserId && <span className="settings-account-self">（我）</span>}</strong>
              <small>@{user.username} · {user.role === 'admin' ? '管理员' : '成员'} · {user.isActive ? '已启用' : '已停用'}</small>
            </div>
            <div className="settings-account-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setResetTarget(user); setResetValue(''); }}>重置密码</button>
              <button className="button button-secondary" type="button" disabled={busy || user.id === currentUserId} onClick={() => void changeRole(user, user.role === 'admin' ? 'member' : 'admin')}>
                {user.role === 'admin' ? '降为成员' : '设为管理员'}
              </button>
              <button className={user.isActive ? 'button button-danger' : 'button button-secondary'} type="button" disabled={busy || user.id === currentUserId} onClick={() => void toggleActive(user)}>
                {user.isActive ? '停用' : '启用'}
              </button>
            </div>
            {resetTarget?.id === user.id && (
              <div className="settings-account-reset">
                <input className="input" type="password" autoComplete="off" placeholder="新密码（至少 8 位）" value={resetValue} onChange={(event) => setResetValue(event.target.value)} />
                <button className="button button-primary" type="button" disabled={busy || resetValue.length < 8} onClick={() => void submitReset()}>确认重置</button>
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => setResetTarget(null)}>取消</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
    {creating ? (
      <div className="settings-account-form" style={{ marginTop: 12 }}>
        <label className="label">用户名（2-32 位字母、数字、下划线或中划线）<input className="input" value={newUsername} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(event) => setNewUsername(event.target.value)} /></label>
        <label className="label">显示名称<input className="input" value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} /></label>
        <label className="label">角色<select className="input" value={newRole} onChange={(event) => setNewRole(event.target.value === 'admin' ? 'admin' : 'member')}><option value="member">成员</option><option value="admin">管理员</option></select></label>
        <label className="label">初始密码（至少 8 位，可随时通过「重置密码」修改）<input className="input" type="password" autoComplete="off" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <div className="settings-actions">
          <button className="button button-primary" type="button" disabled={busy || !newUsername.trim() || newPassword.length < 8} onClick={() => void createUser()}>创建账号</button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setNewPassword(''); }}>取消</button>
        </div>
      </div>
    ) : (
      <div className="settings-actions" style={{ marginTop: 12 }}>
        <button className="button button-secondary" type="button" onClick={() => { setCreating(true); setNewPassword(''); }}><UserPlus size={15} />新建账号</button>
        {message && <span role="status" style={{ color: messageType === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</span>}
      </div>
    )}
  </div>;
}

/** 自动备份状态卡片：展示每日 03:00 自动备份的运行情况，支持修改保留份数/备份目录并立即执行一次。 */
function AutoBackupCard() {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [loadError, setLoadError] = useState(false);
  const [keepCountDraft, setKeepCountDraft] = useState('');
  const [directoryDraft, setDirectoryDraft] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getAutoBackupStatus();
      setStatus(next);
      setKeepCountDraft((current) => (settingsDirty ? current : String(next.keepCount)));
      setDirectoryDraft((current) => (settingsDirty ? current : next.directory));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // settingsDirty 变化不需要重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await runAutoBackupNow();
      setMessageType('success');
      setMessage(`自动备份已创建：${result.fileName}`);
      await load();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : '自动备份执行失败');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    setMessage('');
    try {
      const keep = Number(keepCountDraft);
      if (!Number.isInteger(keep) || keep < 1 || keep > 30) {
        throw new Error('保留份数必须是 1 到 30 之间的整数');
      }
      await updateAutoBackupSettings({ keepCount: keep, directory: directoryDraft.trim() });
      setMessageType('success');
      setMessage('自动备份设置已保存');
      setSettingsDirty(false);
      await load();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : '自动备份设置保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return <div className="settings-section card"><div className="settings-heading"><CalendarClock size={18} /><strong>自动备份</strong></div><p>无法获取自动备份状态（可能运行的是旧版本服务），重启工作台后可用。</p></div>;
  }

  return <div className="settings-section card">
    <div className="settings-heading"><CalendarClock size={18} /><strong>自动备份</strong></div>
    <p>每天凌晨 3:00 自动创建完整备份（含数据库和附件），启动时如果当天还没备份会立即补跑。超过保留份数的最旧自动备份会自动清理。</p>
    {!status ? <p>加载中...</p> : <div>
      <div className="setting-row"><span>今天是否已备份</span><span>{status.running ? '正在备份…' : status.todayDone ? '✅ 已完成' : '⏳ 待执行'}</span></div>
      <div className="setting-row"><span>最近一次自动备份</span><span>{status.lastBackupAt ? status.lastBackupAt.replace('T', ' ').slice(0, 19).replace('Z', '') : '—'}</span></div>
      {status.lastResult === 'failed' && <div className="setting-row"><span>最近错误</span><span style={{ color: 'var(--tone-danger-text)' }}>{status.lastError ?? '未知错误'}</span></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 10, alignItems: 'center', margin: '12px 0' }}>
        <label className="label" style={{ margin: 0 }}>保留份数（1-30）<input className="input" type="number" min={1} max={30} value={keepCountDraft} onChange={(event) => { setKeepCountDraft(event.target.value); setSettingsDirty(true); }} style={{ maxWidth: 120 }} /></label>
        <label className="label" style={{ margin: 0 }}>备份目录（留空 = 默认 backups 文件夹）<input className="input" type="text" placeholder="例如 D:\\个人工作台备份" value={directoryDraft} onChange={(event) => { setDirectoryDraft(event.target.value); setSettingsDirty(true); }} /></label>
      </div>
      {status.directory && <div className="setting-row"><span>当前自定义目录</span><code style={{ fontSize: 12 }}>{status.directory}</code></div>}
      {status.files.length > 0 && <div className="setting-row" style={{ alignItems: 'flex-start' }}><span>最近备份文件</span><div style={{ display: 'grid', gap: 4, textAlign: 'right' }}>
        {status.files.slice(0, 5).map((file) => <a key={file.fileName} href={`/api/backups/download/${encodeURIComponent(file.fileName)}`} style={{ fontSize: 12 }}>{file.fileName.slice('自动备份-个人工作台-'.length, -'.zip'.length)}（{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB）</a>)}
      </div></div>}
      <div className="settings-actions" style={{ marginTop: 10 }}>
        <button className="button button-primary" type="button" disabled={busy || status.running} onClick={() => void runNow()}>{busy || status.running ? '备份中…' : '立即备份一次'}</button>
        <button className="button button-secondary" type="button" disabled={busy || !settingsDirty} onClick={() => void saveSettings()}>保存设置</button>
        <span role="status" style={{ color: messageType === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</span>
      </div>
    </div>}
  </div>;
}
