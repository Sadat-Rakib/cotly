import { useEffect } from 'react';
import { Modal } from './Modal';
import type { MediaItem } from './MediaPicker';

interface Props {
  item: MediaItem;
  onClose: () => void;
  onRemove: () => void;
  onReplace: (file: File) => void;
  // Optional multi-attachment navigation. When items has more than one entry,
  // prev/next controls and left/right arrow keys move between attachments.
  items?: MediaItem[];
  index?: number;
  onNavigate?: (nextIndex: number) => void;
}

// Full-size inspect before publishing. Reuses the existing object URL —
// opening the preview never touches the network or re-uploads anything.
export function Lightbox({ item, onClose, onRemove, onReplace, items, index, onNavigate }: Props) {
  const count = items?.length ?? 0;
  const canNavigate = count > 1 && typeof index === 'number' && !!onNavigate;

  useEffect(() => {
    if (!canNavigate || index === undefined || !onNavigate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onNavigate((index - 1 + count) % count);
      else if (e.key === 'ArrowRight') onNavigate((index + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canNavigate, index, count, onNavigate]);

  const title = canNavigate
    ? `${item.filename || 'Media preview'} (${(index ?? 0) + 1} of ${count})`
    : item.filename || 'Media preview';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="lightbox-body">
        {item.mime.startsWith('video/') && item.previewUrl ? (
          <video src={item.previewUrl} controls playsInline preload="metadata" className="lightbox-media" />
        ) : item.mime.startsWith('image/') && item.previewUrl ? (
          <img src={item.previewUrl} alt={item.filename} className="lightbox-media" />
        ) : (
          <p className="hint">No preview available for this file.</p>
        )}
        {canNavigate && index !== undefined && onNavigate && (
          <div className="lightbox-nav">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onNavigate((index - 1 + count) % count)}
              aria-label="Previous attachment"
            >
              Prev
            </button>
            <span className="hint lightbox-counter">{index + 1} / {count}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onNavigate((index + 1) % count)}
              aria-label="Next attachment"
            >
              Next
            </button>
          </div>
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
