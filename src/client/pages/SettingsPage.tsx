import { Building2, Database, Download, ImageOff, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CompanySnapshot } from '../../shared/documents';

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

  return <div className="page-shell"><section className="settings-grid">
    <div className="settings-section card" style={{ gridColumn: '1 / -1' }}>
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
    </div>
    <div className="settings-section card"><div className="settings-heading"><Database size={18} /><strong>本机数据</strong></div><p>数据和附件保存在本机，不连接云端。网页版服务只监听本机地址。</p><div className="setting-row"><span>服务地址</span><code>{window.location.origin}</code></div><div className="setting-row"><span>存储方式</span><span>SQLite + 本地附件目录</span></div></div>
    <div className="settings-section card"><div className="settings-heading"><Download size={18} /><strong>备份与恢复</strong></div><p>备份包含订单、产品、箱唛、打印历史、报价单、销售单及相关附件。恢复前会自动保留当前数据备份。</p><div className="settings-actions"><button className="button button-primary" type="button" onClick={() => void onBackup?.()}><Download size={15} />创建备份</button><label className="button button-secondary"><RotateCcw size={15} />选择备份恢复<input type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onRestore?.(file); event.target.value = ''; }} hidden /></label></div></div>
  </section></div>;
}
