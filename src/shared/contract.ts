export interface ContractTemplate {
  title: string;
  clauses: string[];
}

export interface ContractPlaceholderDescriptor {
  key: string;
  description: string;
}

export const CONTRACT_PLACEHOLDER_PREFIX = '{';
export const CONTRACT_PLACEHOLDER_SUFFIX = '}';

export const CONTRACT_PLACEHOLDERS: readonly ContractPlaceholderDescriptor[] = [
  { key: '公司名', description: '我方公司名称（设置页公司资料）' },
  { key: '公司电话', description: '我方联系电话' },
  { key: '公司地址', description: '我方公司地址' },
  { key: '订单号', description: '当前订单号' },
  { key: '下单日期', description: '订单下单日期' },
  { key: '客户名', description: '订单客户名称' },
  { key: '联系人', description: '客户联系人' },
  { key: '联系电话', description: '客户联系电话' },
  { key: '收件人', description: '订单收件人' },
  { key: '收件地址', description: '订单收件地址' },
  { key: '产品小计', description: '产品金额小计' },
  { key: '运费', description: '订单运费' },
  { key: '总金额', description: '订单合计金额（¥ 格式）' },
  { key: '大写金额', description: '订单合计金额中文大写' },
  { key: '备注', description: '订单备注' },
  { key: '签订日期', description: '合同生成日期' },
  { key: '产品明细表', description: '在该位置插入产品明细表格' },
];

export const DEFAULT_CONTRACT_TEMPLATE: ContractTemplate = {
  title: '销售购销合同',
  clauses: [
    '甲乙双方本着平等自愿、诚实信用的原则，经友好协商，就甲方向乙方销售产品事宜达成如下协议。',
    '产品名称、规格、数量、单价及金额以本合同产品明细表为准，合计金额：{大写金额}（{总金额}）。',
    '交货方式：甲方按本合同约定的收件地址安排发货，运费合计 {运费}。乙方收件人：{收件人}，收件地址：{收件地址}。',
    '结算方式：以人民币结算，乙方应按双方约定的付款方式及时支付货款。',
    '质量标准：甲方保证所供产品符合双方确认的样品或质量要求；乙方应在收货后 7 日内完成验收，逾期未提出书面异议的视为验收合格。',
    '违约责任：任何一方违反本合同约定给对方造成损失的，应承担相应赔偿责任。',
    '争议解决：因履行本合同发生的争议，双方应友好协商解决；协商不成的，任何一方可向甲方所在地有管辖权的人民法院提起诉讼。',
    '本合同一式两份，甲乙双方各执一份，自双方签字（盖章）之日起生效。',
  ],
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeContractTemplate(value: unknown): ContractTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('合同模板数据无效');
  }
  const title = asTrimmedString((value as { title?: unknown }).title);
  if (!title) throw new Error('合同标题不能为空');
  if (title.length > 60) throw new Error('合同标题不能超过 60 个字符');
  const rawClauses = (value as { clauses?: unknown }).clauses;
  if (!Array.isArray(rawClauses)) throw new Error('合同条款必须是数组');
  if (rawClauses.length === 0) throw new Error('合同至少需要一条条款');
  if (rawClauses.length > 60) throw new Error('合同条款不能超过 60 条');
  const clauses = rawClauses.map((clause, index) => {
    const text = asTrimmedString(clause);
    if (!text) throw new Error(`第 ${index + 1} 条条款内容不能为空`);
    if (text.length > 20000) throw new Error(`第 ${index + 1} 条条款内容过长`);
    return text;
  });
  return { title, clauses };
}

export function cloneDefaultContractTemplate(): ContractTemplate {
  return {
    title: DEFAULT_CONTRACT_TEMPLATE.title,
    clauses: [...DEFAULT_CONTRACT_TEMPLATE.clauses],
  };
}
