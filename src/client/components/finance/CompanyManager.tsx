import { Building2, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Modal from '../Modal';
import { createCompany, deleteCompany, updateCompany } from '../../api';
import { buildCompanyInvoiceInfoText, companyDisplayName, formatInvoiceCategories, normalizeInvoiceCategories, type Company, type CompanySaveInput } from '../../../shared/companies';
import { copyText } from '../../copy-text';
import { errorText } from './finance-format';

export interface CompanyManagerProps {
  open: boolean;
  companies: Company[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const emptyForm: CompanySaveInput = {
  fullName: '',
  taxNo: '',
  bankName: '',
  bankAccount: '',
  address: '',
  phone: '',
  contactName: '',
  remark: '',
  invoiceCategories: [],
  isActive: true,
};

function companyForm(company: Company): CompanySaveInput {
  const name = companyDisplayName(company);
  return {
    shortName: name,
    fullName: name,
    taxNo: company.taxNo,
    bankName: company.bankName,
    bankAccount: company.bankAccount,
    address: company.address,
    phone: company.phone,
    contactName: company.contactName,
    remark: company.remark,
    invoiceCategories: company.invoiceCategories,
    isActive: company.isActive,
  };
}

export default function CompanyManager({ open, companies, onClose, onChanged, onNotify }: CompanyManagerProps) {
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const [form, setForm] = useState<CompanySaveInput>(emptyForm);
  /** 可开票类目单独保存输入框原文，避免边输入分隔符边被解析回数组导致光标跳动。 */
  const [categoriesText, setCategoriesText] = useState('');
  const [busy, setBusy] = useState(false);

  const beginCreate = () => {
    setEditing('new');
    setForm(emptyForm);
    setCategoriesText('');
  };
  const beginEdit = (company: Company) => {
    setEditing(company);
    setForm(companyForm(company));
    setCategoriesText(formatInvoiceCategories(company.invoiceCategories));
  };
  const updateField = <K extends keyof CompanySaveInput>(key: K, value: CompanySaveInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    if (busy) return;
    const name = form.fullName?.trim() ?? '';
    if (!name) {
      onNotify?.('请填写公司名称', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload: CompanySaveInput = { ...form, shortName: name, fullName: name, invoiceCategories: normalizeInvoiceCategories(categoriesText) };
      if (editing && editing !== 'new') await updateCompany(editing.id, payload);
      else await createCompany(payload);
      await onChanged();
      setEditing(null);
      onNotify?.(editing === 'new' ? '公司已新增' : '公司档案已保存', 'success');
    } catch (error) {
      onNotify?.(errorText(error, '公司档案保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const copyInvoiceInfo = async (source: CompanySaveInput, label?: string) => {
    const name = companyDisplayName(source);
    if (!name) {
      onNotify?.('请先填写公司名称', 'error');
      return;
    }
    const copied = await copyText(buildCompanyInvoiceInfoText(source));
    onNotify?.(
      copied ? `已复制${label ? `「${label}」` : ''}开票信息，可直接发给客户` : '复制失败，请手动选择文字复制',
      copied ? 'success' : 'error',
    );
  };
  const remove = async (company: Company) => {
    if (busy || !window.confirm(`确定删除公司“${companyDisplayName(company)}”吗？已被订单引用的公司不能删除，只能停用。`)) return;
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
        <div className="company-form-head"><strong>{editing === 'new' ? '新增公司' : `编辑 ${companyDisplayName(editing)}`}</strong><button className="button button-ghost" type="button" onClick={() => setEditing(null)}>收起</button></div>
        <div className="company-form-grid">
          <label className="company-form-wide">公司名称<input aria-label="公司名称" value={form.fullName ?? ''} onChange={(event) => updateField('fullName', event.target.value)} placeholder="开票抬头使用的公司全称" /></label>
          <label>税号<input value={form.taxNo} onChange={(event) => updateField('taxNo', event.target.value)} placeholder="纳税人识别号" /></label>
          <label>开户行<input value={form.bankName} onChange={(event) => updateField('bankName', event.target.value)} /></label>
          <label>银行账号<input value={form.bankAccount} onChange={(event) => updateField('bankAccount', event.target.value)} /></label>
          <label>联系电话<input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
          <label className="company-form-wide">联系人<input value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} /></label>
          <label className="company-form-wide">注册地址<input value={form.address} onChange={(event) => updateField('address', event.target.value)} /></label>
          <label className="company-form-wide">备注<input value={form.remark} onChange={(event) => updateField('remark', event.target.value)} placeholder="如：对公账户、财务联系人等" /></label>
          <label className="company-form-wide">可开票类目<input value={categoriesText} onChange={(event) => setCategoriesText(event.target.value)} placeholder="多个类目用顿号或逗号分隔，如：电动工具、配件、电池" /></label>
          <label className="company-form-check"><input type="checkbox" checked={form.isActive !== false} onChange={(event) => updateField('isActive', event.target.checked)} />启用（停用后不出现在新订单下拉，但历史记录保留）</label>
        </div>
        <div className="company-form-actions"><button className="button button-ghost" type="button" disabled={busy || !(form.fullName ?? '').trim()} onClick={() => void copyInvoiceInfo({ ...form, invoiceCategories: normalizeInvoiceCategories(categoriesText) }, form.fullName)}><Copy size={14} />复制开票信息</button><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="button button-primary" type="button" disabled={busy || !(form.fullName ?? '').trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存公司'}</button></div>
      </section>}

      {companies.length ? <div className="company-list">
        <div className="company-list-head"><span>公司名称</span><span>可开票类目</span><span>状态</span><span>操作</span></div>
        {companies.map((company) => <div className={`company-row${company.isActive ? '' : ' is-inactive'}`} key={company.id}>
          <div className="company-name"><Building2 size={15} /><strong>{companyDisplayName(company)}</strong></div>
          <div><span className={(company.invoiceCategories?.length ?? 0) > 0 ? 'company-category-line' : 'company-category-empty'} title={company.invoiceCategories?.join('、')}>{company.invoiceCategories?.length ? company.invoiceCategories.join('、') : '未填写'}</span></div>
          <div><span className={company.isActive ? 'badge badge-success' : 'badge badge-neutral'}>{company.isActive ? '启用' : '已停用'}</span></div>
          <div className="company-row-actions">
            <button className="icon-button" type="button" title="复制开票信息（可直接发给客户）" disabled={busy} onClick={() => void copyInvoiceInfo(companyForm(company), companyDisplayName(company))}><Copy size={14} /></button>
            <button className="icon-button" type="button" title="编辑公司" disabled={busy} onClick={() => beginEdit(company)}><Pencil size={14} /></button>
            <button className="icon-button danger" type="button" title="删除公司（被引用时不可删除）" disabled={busy} onClick={() => void remove(company)}><Trash2 size={14} /></button>
          </div>
        </div>)}
      </div> : <div className="table-state">还没有公司档案。先新增一个公司，再到订单里选择它。</div>}
    </div>
  </Modal>;
}
