import { useEffect } from 'react';
import { Modal } from './Modal';
import type { MediaItem } from './MediaPicker';

interface Props {
  item: MediaItem;
  onClose: () => void;
  onRemove: () => void;
  onReplace: (file: File) => void;
}

// Full-size inspect before publishing. Reuses the existing object URL —
// opening the preview never touches the network or re-uploads anything.
export function Lightbox({ item, onClose, onRemove, onReplace }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title={item.filename || 'Media preview'} onClose={onClose}>
      <div className="lightbox-body">
        {item.mime.startsWith('video/') && item.previewUrl ? (
          <video src={item.previewUrl} controls playsInline preload="metadata" className="lightbox-media" />
        ) : item.mime.startsWith('image/') && item.previewUrl ? (
          <img src={item.previewUrl} alt={item.filename} className="lightbox-media" />
        ) : (
          <p className="hint">No preview available for this file.</p>
        )}
      </div>
      <div className="modal-actions lightbox-actions">
        <label className="btn btn-ghost btn-sm lightbox-replace">
          Replace
          <input
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onReplace(f);
            }}
          />
        </label>
        <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
          Remove
        </button>
      </div>
    </Modal>
  );
}
