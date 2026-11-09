import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Modal from '../Modal';
import { createCompany, deleteCompany, updateCompany } from '../../api';
import type { Company, CompanySaveInput } from '../../../shared/companies';
import { errorText } from './finance-format';

export interface CompanyManagerProps {
  open: boolean;
  companies: Company[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const emptyForm: CompanySaveInput = {
  shortName: '',
  fullName: '',
  taxNo: '',
  bankName: '',
  bankAccount: '',
  address: '',
  phone: '',
  contactName: '',
  remark: '',
  isActive: true,
};

function companyForm(company: Company): CompanySaveInput {
  return {
    shortName: company.shortName,
    fullName: company.fullName,
    taxNo: company.taxNo,
    bankName: company.bankName,
    bankAccount: company.bankAccount,
    address: company.address,
    phone: company.phone,
    contactName: company.contactName,
    remark: company.remark,
    isActive: company.isActive,
  };
}

export default function CompanyManager({ open, companies, onClose, onChanged, onNotify }: CompanyManagerProps) {
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const [form, setForm] = useState<CompanySaveInput>(emptyForm);
  const [busy, setBusy] = useState(false);

  const beginCreate = () => {
    setEditing('new');
    setForm(emptyForm);
  };
  const beginEdit = (company: Company) => {
    setEditing(company);
    setForm(companyForm(company));
  };
  const updateField = <K extends keyof CompanySaveInput>(key: K, value: CompanySaveInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    if (busy) return;
    if (!form.shortName.trim()) {
      onNotify?.('请填写公司简称', 'error');
      return;
    }
    setBusy(true);
    try {
      if (editing && editing !== 'new') await updateCompany(editing.id, form);
      else await createCompany(form);
      await onChanged();
      setEditing(null);
      onNotify?.(editing === 'new' ? '公司已新增' : '公司档案已保存', 'success');
    } catch (error) {
      onNotify?.(errorText(error, '公司档案保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (company: Company) => {
    if (busy || !window.confirm(`确定删除公司“${company.shortName}”吗？已被订单引用的公司不能删除，只能停用。`)) return;
    setBusy(true);
    try {
      await deleteCompany(company.id);
      await onChanged();
      if (editing !== 'new' && editing?.id === company.id) setEditing(null);
      onNotify?.('公司已删除', 'success');
    } catch (error) {
      onNotify?.(errorText(error, '公司删除失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return <Modal open={open} title="公司档案" onClose={onClose} width={820} variant="drawer" className="company-manager-drawer">
    <div className="company-manager">
      <div className="company-manager-toolbar">
        <div>
          <strong>收款 / 开票公司</strong>
          <span>订单、水单和发票都按这里维护的公司归档；被引用的公司只能停用，不能删除。</span>
        </div>
        <button className="button button-primary" type="button" onClick={beginCreate}><Plus size={14} />新增公司</button>
      </div>

      {editing && <section className="company-form-panel">
        <div className="company-form-head"><strong>{editing === 'new' ? '新增公司' : `编辑 ${editing.shortName}`}</strong><button className="button button-ghost" type="button" onClick={() => setEditing(null)}>收起</button></div>
        <div className="company-form-grid">
          <label>公司简称<input aria-label="公司简称" value={form.shortName} onChange={(event) => updateField('shortName', event.target.value)} placeholder="如：宁波公司" /></label>
          <label>公司全称<input value={form.fullName} onChange={(event) => updateField('fullName', event.target.value)} placeholder="开票抬头使用的全称" /></label>
          <label>税号<input value={form.taxNo} onChange={(event) => updateField('taxNo', event.target.value)} placeholder="纳税人识别号" /></label>
          <label>开户行<input value={form.bankName} onChange={(event) => updateField('bankName', event.target.value)} /></label>
          <label>银行账号<input value={form.bankAccount} onChange={(event) => updateField('bankAccount', event.target.value)} /></label>
          <label>联系电话<input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
          <label>联系人<input value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} /></label>
          <label className="company-form-wide">注册地址<input value={form.address} onChange={(event) => updateField('address', event.target.value)} /></label>
          <label className="company-form-wide">备注<input value={form.remark} onChange={(event) => updateField('remark', event.target.value)} placeholder="如：对公账户、财务联系人等" /></label>
          <label className="company-form-check"><input type="checkbox" checked={form.isActive !== false} onChange={(event) => updateField('isActive', event.target.checked)} />启用（停用后不出现在新订单下拉，但历史记录保留）</label>
        </div>
        <div className="company-form-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="button button-primary" type="button" disabled={busy || !form.shortName.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存公司'}</button></div>
      </section>}

      {companies.length ? <div className="company-list">
        <div className="company-list-head"><span>公司简称</span><span>全称 / 税号</span><span>开户行 / 账号</span><span>状态</span><span>操作</span></div>
        {companies.map((company) => <div className={`company-row${company.isActive ? '' : ' is-inactive'}`} key={company.id}>
          <div className="company-name"><Building2 size={15} /><strong>{company.shortName}</strong></div>
          <div><span>{company.fullName || '未填写全称'}</span><small>{company.taxNo || '未填写税号'}</small></div>
          <div><span>{company.bankName || '未填写开户行'}</span><small>{company.bankAccount || '未填写账号'}</small></div>
          <div><span className={company.isActive ? 'badge badge-success' : 'badge badge-neutral'}>{company.isActive ? '启用' : '已停用'}</span></div>
          <div className="company-row-actions">
            <button className="icon-button" type="button" title="编辑公司" disabled={busy} onClick={() => beginEdit(company)}><Pencil size={14} /></button>
            <button className="icon-button danger" type="button" title="删除公司（被引用时不可删除）" disabled={busy} onClick={() => void remove(company)}><Trash2 size={14} /></button>
          </div>
        </div>)}
      </div> : <div className="table-state">还没有公司档案。先新增一个公司，再到订单里选择它。</div>}
    </div>
  </Modal>;
}
