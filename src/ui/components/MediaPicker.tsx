import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api, putWithProgress } from '../api';

export interface MediaItem {
  previewUrl: string; // object URL; also the stable key. '' for pre-existing media without a URL.
  mediaId: string; // empty until confirmed
  r2Key?: string; // storage key returned by upload-url; required by /api/media/confirm
  filename: string;
  mime: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  error?: string;
}

type SetItems = Dispatch<SetStateAction<MediaItem[]>>;

interface Props {
  items: MediaItem[];
  setItems: SetItems;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MediaPicker({ items, setItems }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadOne = async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const key = previewUrl;
    setItems((prev) => [
      ...prev,
      { previewUrl: key, mediaId: '', filename: file.name, mime: file.type || 'application/octet-stream', size: file.size, status: 'uploading', progress: 0 },
    ]);
    try {
      const { mediaId, uploadUrl, r2Key } = await api<{ mediaId: string; uploadUrl: string; r2Key?: string }>('/api/media/upload-url', {
        method: 'POST',
        body: { filename: file.name, mime: file.type, size: file.size },
      });
      await putWithProgress(uploadUrl, file, (pct) => {
        setItems((prev) => prev.map((i) => (i.previewUrl === key ? { ...i, progress: pct } : i)));
      });
      await api('/api/media/confirm', {
        method: 'POST',
        body: { mediaId, size: file.size, mime: file.type, filename: file.name, r2Key },
      });
      setItems((prev) => prev.map((i) => (i.previewUrl === key ? { ...i, mediaId, r2Key, status: 'ready', progress: 100 } : i)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setItems((prev) => prev.map((i) => (i.previewUrl === key ? { ...i, status: 'error', error: msg } : i)));
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) void uploadOne(file);
  };

  const remove = (item: MediaItem) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((i) => i.previewUrl !== item.previewUrl));
  };

  // Order matters (carousel posts) — buttons only, mobile-friendly.
  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx] as MediaItem;
      next[idx] = next[j] as MediaItem;
      next[j] = tmp;
      return next;
    });
  };

  return (
    <div className="mediapicker">
      <div
        className={`dropzone${dragOver ? ' dropzone-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      >
        Drag images or video here, or click to browse
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {items.length > 0 && (
        <div className="media-grid">
          {items.map((item, idx) => (
            <div key={item.previewUrl || item.filename} className={`media-item media-${item.status}`}>
              <span className="media-order" aria-label={`Position ${idx + 1}`}>{idx + 1}</span>
              <div className="thumb">
                {item.previewUrl && item.mime.startsWith('image/')
                  ? <img src={item.previewUrl} alt={item.filename} />
                  : <span className="thumb-file">{item.mime.startsWith('video/') ? 'video' : 'file'}</span>}
              </div>
              <div className="media-meta">
                <span className="media-name" title={item.filename}>{item.filename}</span>
                <span className="media-size">{fmtSize(item.size)}</span>
                {item.status === 'uploading' && (
                  <div className="progress" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="progress-bar" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === 'error' && <span className="error-text">{item.error}</span>}
              </div>
              {items.length > 1 && (
                <div className="media-reorder">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move ${item.filename} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    aria-label={`Move ${item.filename} down`}
                  >
                    ↓
                  </button>
                </div>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(item)} aria-label={`Remove ${item.filename}`}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
