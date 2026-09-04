import { ArrowDown, ArrowUp, Building2, CalendarClock, Database, Download, ImageOff, Plus, RotateCcw, Save, ScrollText, Trash2, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CompanySnapshot } from '../../shared/documents';
import { CONTRACT_PLACEHOLDERS, cloneDefaultContractTemplate, type ContractTemplate } from '../../shared/contract';
import { getAutoBackupStatus, getServiceVersion, runAutoBackupNow, updateAutoBackupSettings, type AutoBackupStatus } from '../api';
import { formatDateTime } from '../../shared/formatters';

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

type SettingsSectionKey = 'company' | 'contract' | 'storage' | 'backup';

// 两级菜单：分组标题 → 菜单项，内容区一次只显示激活的板块。
const SETTINGS_MENU_GROUPS: Array<{ label: string; items: Array<{ key: SettingsSectionKey; label: string; icon: LucideIcon }> }> = [
  { label: '基础资料', items: [{ key: 'company', label: '公司资料', icon: Building2 }] },
  { label: '单据模板', items: [{ key: 'contract', label: '购销合同模板', icon: ScrollText }] },
  {
    label: '数据与备份',
    items: [
      { key: 'storage', label: '本机数据', icon: Database },
      { key: 'backup', label: '备份与恢复', icon: Download },
    ],
  },
];

export interface SettingsPageProps {
  onBackup?: () => Promise<void> | void;
  onRestore?: (file: File) => Promise<void> | void;
  loadCompanyProfile?: () => Promise<CompanySnapshot>;
  saveCompanyProfile?: (profile: CompanySnapshot) => Promise<CompanySnapshot>;
  uploadCompanyLogo?: (file: File) => Promise<CompanySnapshot>;
  deleteCompanyLogo?: () => Promise<CompanySnapshot>;
  onProfileChanged?: (profile: CompanySnapshot) => void;
}

export default function SettingsPage({
  onBackup,
  onRestore,
  loadCompanyProfile = defaultCompanyApi.load,
  saveCompanyProfile = defaultCompanyApi.save,
  uploadCompanyLogo = defaultCompanyApi.uploadLogo,
  deleteCompanyLogo = defaultCompanyApi.deleteLogo,
  onProfileChanged,
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
  const [serviceVersion, setServiceVersion] = useState<{ version: string; buildTime: string | null; mode: 'production' | 'development' }>();

  useEffect(() => {
    let active = true;
    void getServiceVersion().then((info) => {
      if (active) setServiceVersion({ version: info.version, buildTime: info.buildTime, mode: info.mode });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

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
          <div className="settings-logo-preview" style={{ height: 90, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', border: '1px solid #dbe3ea', borderRadius: 6, background: '#f8fafc' }}>{profile.logoRelativePath ? <img src={`/files/${profile.logoRelativePath}`} alt="公司 Logo" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 50%' }} /> : <ImageOff size={24} color="#94a3b8" />}</div>
          <div className="settings-logo-actions" style={{ display: 'flex', gap: 6 }}><label className="button button-secondary" title="上传公司 Logo" style={{ flex: 1, justifyContent: 'center' }}><Upload size={14} /><span>上传</span><input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = ''; }} hidden /></label>{profile.logoRelativePath && <button className="icon-button danger" type="button" title="删除公司 Logo" disabled={busy} onClick={() => { if (window.confirm('确定删除当前公司 Logo 吗？')) void removeLogo(); }}><Trash2 size={14} /></button>}</div>
        </div>
        <div className="form-grid form-grid-2 settings-profile-fields" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
          <label className="label">公司名称<input className="input" disabled={loading || busy} value={profile.name} onChange={(event) => setField('name', event.target.value)} /></label>
          <label className="label">联系电话<input className="input" disabled={loading || busy} value={profile.phone} onChange={(event) => setField('phone', event.target.value)} /></label>
          <label className="label">公司地址<input className="input" disabled={loading || busy} value={profile.address} onChange={(event) => setField('address', event.target.value)} /></label>
          <label className="label">默认开单人<input className="input" disabled={loading || busy} value={profile.defaultIssuer} onChange={(event) => setField('defaultIssuer', event.target.value)} /></label>
          <div className="settings-profile-actions" style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}><span role="status" className={message ? `notice notice-${messageType}` : undefined} style={{ marginRight: 'auto', color: messageType === 'error' ? '#b91c1c' : '#0f766e', fontSize: 12 }}>{message}</span><button className="button button-primary" type="button" disabled={loading || busy} onClick={() => void saveProfile()}><Save size={15} />{busy ? '处理中...' : '保存公司资料'}</button></div>
        </div>
      </div>
      </div>}
      {activeSection === 'contract' && <div className="settings-section card">
      <div className="settings-heading"><ScrollText size={18} /><strong>购销合同模板</strong></div>
      <p>订单详情里「生成购销合同」会按此模板输出 PDF 并归档到订单附件。条款中可使用下方占位符，生成时自动替换为订单数据；无法识别的占位符会原样保留。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '2px 0 12px' }}>
        {CONTRACT_PLACEHOLDERS.map((placeholder) => <code key={placeholder.key} title={placeholder.description} style={{ padding: '3px 8px', border: '1px solid #dbe3ea', borderRadius: 5, background: '#f8fafc', color: '#0f766e', fontSize: 11 }}>{`{${placeholder.key}}`}</code>)}
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
            <span role="status" className={templateMessage ? `notice notice-${templateMessageType}` : undefined} style={{ color: templateMessageType === 'error' ? '#b91c1c' : '#0f766e', fontSize: 12 }}>{templateMessage}</span>
            <button className="button button-secondary" type="button" disabled={templateLoading || templateBusy} onClick={resetTemplate}><RotateCcw size={15} />恢复默认</button>
            <button className="button button-primary" type="button" disabled={templateLoading || templateBusy} onClick={() => void saveTemplate()}><Save size={15} />{templateBusy ? '保存中...' : '保存合同模板'}</button>
          </div>
        </div>
      </div>
      </div>}
      {activeSection === 'storage' && <div className="settings-section card"><div className="settings-heading"><Database size={18} /><strong>本机数据</strong></div><p>数据和附件保存在本机，不连接云端。网页版服务只监听本机地址。</p><div className="setting-row"><span>服务地址</span><code>{window.location.origin}</code></div><div className="setting-row"><span>存储方式</span><span>SQLite + 本地附件目录</span></div></div>}
      {activeSection === 'backup' && <div style={{ display: 'grid', gap: 14 }}>
        <AutoBackupCard />
        <div className="settings-section card"><div className="settings-heading"><Download size={18} /><strong>手动备份与恢复</strong></div><p>备份包含订单、产品、箱唛、打印历史、报价单、销售单及相关附件。恢复前会自动保留当前数据备份。</p><p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{serviceVersion ? `当前服务版本 v${serviceVersion.version}${serviceVersion.mode === 'development' ? '（开发模式，源码即时生效）' : serviceVersion.buildTime ? `，构建于 ${formatDateTime(serviceVersion.buildTime)}` : ''}。若页面功能与预期不符，请关闭本程序后重新运行“启动个人工作台”。` : '正在读取服务版本...'}</p><div className="settings-actions"><button className="button button-primary" type="button" onClick={() => void onBackup?.()}><Download size={15} />创建备份</button><label className="button button-secondary"><RotateCcw size={15} />选择备份恢复<input type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onRestore?.(file); event.target.value = ''; }} hidden /></label></div></div>
      </div>}
      </div>
    </section>
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
      <div className="setting-row"><span>最近一次自动备份</span><span>{status.lastBackupAt ? formatDateTime(status.lastBackupAt) : '—'}</span></div>
      {status.lastResult === 'failed' && <div className="setting-row"><span>最近错误</span><span style={{ color: '#b91c1c' }}>{status.lastError ?? '未知错误'}</span></div>}
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
        <span role="status" style={{ color: messageType === 'error' ? '#b91c1c' : '#0f766e', fontSize: 12 }}>{message}</span>
      </div>
    </div>}
  </div>;
}
