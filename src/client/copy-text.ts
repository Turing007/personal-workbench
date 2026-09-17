/**
 * 复制文本到剪贴板，返回是否成功。
 *
 * navigator.clipboard 只在安全上下文（https / localhost）下存在；本应用默认监听 0.0.0.0，
 * 手机通过 http://局域网IP:端口 访问时属于非安全上下文，navigator.clipboard 为 undefined，
 * 直接调用会抛错。此处退回到 textarea + execCommand('copy') 兜底，保证局域网 http 访问也能复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 文档失焦或用户拒绝授权时异步接口会失败，继续走兜底方案。
    }
  }
  return copyTextFallback(text);
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // 移出可视区但保持可选中；字号 16px 避免 iOS 聚焦时自动放大页面。
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.fontSize = '16px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  if (selection && previousRange) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }
  return copied;
}
