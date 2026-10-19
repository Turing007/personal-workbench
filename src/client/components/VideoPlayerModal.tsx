import { Download } from 'lucide-react';
import { useState } from 'react';
import Modal from './Modal';
import { saveFileOrDownload } from '../file-save';

export interface VideoPlayerModalProps {
  open: boolean;
  title?: string;
  src?: string;
  onClose: () => void;
}

/**
 * 页内视频播放器：不跳页、支持拖动进度（/files 静态服务支持 Range）。
 * 下载与导出文件走同一条通道：App 内分块交给原生落盘，浏览器走 blob 下载。
 */
export default function VideoPlayerModal({ open, title = '视频播放', src, onClose }: VideoPlayerModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');

  const download = async () => {
    if (!src || downloading) return;
    setDownloading(true);
    setMessage('');
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('视频读取失败');
      const blob = await response.blob();
      const fileName = (title?.trim() || '产品视频').replace(/[\\/:*?"<>|]+/g, '_');
      await saveFileOrDownload(blob, /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.mp4`);
      setMessage('已开始下载视频');
    } catch {
      setMessage('视频下载失败，请在新标签打开后保存');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal open={open} title={title} width={860} onClose={onClose}>
      {src
        ? <video className="video-player" src={src} controls playsInline preload="metadata" />
        : <div className="product-images-empty">视频文件缺失</div>}
      <div className="video-player-actions">
        <button className="button button-secondary" type="button" disabled={!src || downloading} onClick={() => void download()}>
          <Download size={14} />{downloading ? '准备中...' : '下载视频'}
        </button>
        {!!message && <span className="video-player-message" role="status">{message}</span>}
      </div>
      <div className="video-player-hint">
        播放不了？<a href={src} target="_blank" rel="noreferrer">在新标签打开视频</a>
      </div>
    </Modal>
  );
}
