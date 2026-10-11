import { Download, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { saveFileOrDownload } from '../../file-save';

export interface PdfDownloadButtonProps {
  number: string;
  download: () => Promise<Blob>;
  onError: (message: string) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'PDF 导出失败，请稍后重试';
}

export default function PdfDownloadButton({
  number,
  download,
  onError,
  className = 'icon-button',
  disabled = false,
  label,
}: PdfDownloadButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      const blob = await download();
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(blob, `${number || 'document'}.pdf`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      title="导出 PDF"
      aria-label="导出 PDF"
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={() => { void handleDownload(); }}
    >
      {loading ? <LoaderCircle size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
      {label && <span>{loading ? '正在导出' : label}</span>}
    </button>
  );
}
