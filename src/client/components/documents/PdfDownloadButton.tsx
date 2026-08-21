import { Download, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

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
    let url: string | undefined;
    try {
      const blob = await download();
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${number || 'document'}.pdf`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      if (url) URL.revokeObjectURL(url);
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
