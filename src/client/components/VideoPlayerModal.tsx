import Modal from './Modal';

export interface VideoPlayerModalProps {
  open: boolean;
  title?: string;
  src?: string;
  onClose: () => void;
}

/** 页内视频播放器：不跳页、支持拖动进度（/files 静态服务支持 Range）。 */
export default function VideoPlayerModal({ open, title = '视频播放', src, onClose }: VideoPlayerModalProps) {
  return (
    <Modal open={open} title={title} width={860} onClose={onClose}>
      {src
        ? <video className="video-player" src={src} controls playsInline preload="metadata" />
        : <div className="product-images-empty">视频文件缺失</div>}
      <div className="video-player-hint">
        播放不了？<a href={src} target="_blank" rel="noreferrer">在新标签打开视频</a>
      </div>
    </Modal>
  );
}
