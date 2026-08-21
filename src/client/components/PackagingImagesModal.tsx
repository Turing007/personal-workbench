import { Save } from 'lucide-react';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import Modal from './Modal';

export interface PackagingImagesModalProps {
  open: boolean;
  packagingName?: string;
  value: ImageAttachment[];
  onChange: (value: ImageAttachment[]) => void;
  onClose: () => void;
}

export default function PackagingImagesModal({ open, packagingName = '包装', value, onChange, onClose }: PackagingImagesModalProps) {
  return (
    <Modal open={open} title={`${packagingName} · 包装图片`} onClose={onClose} width={600} footer={<button type="button" className="button button-primary" onClick={onClose}><Save size={14} />完成</button>}>
      <ImagePasteUpload label="包装图片" value={value} onChange={onChange} multiple />
    </Modal>
  );
}
