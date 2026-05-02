'use client';

import { Download, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';

import type { PatientDocument } from '@/lib/api/documents';

type Props = {
  doc: PatientDocument;
  /**
   * Blob URL the iframe should render. `null` while the PDF is still being
   * fetched — we show a spinner instead of a blank iframe.
   */
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
};

/**
 * Smooth document viewer overlay. ESC + backdrop click both close it; the
 * inner panel stops propagation so a click inside doesn't dismiss.
 *
 * The iframe receives a blob URL minted by the parent (which holds the
 * bearer-token fetch result) — so the download endpoint stays
 * authenticated even though the iframe itself can't pass headers.
 */
export function DocumentViewer({
  doc,
  blobUrl,
  loading,
  error,
  onClose,
  onDownload,
  downloading,
}: Props) {
  // ESC closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm cura-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Pré-visualização: ${doc.filename}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden cura-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 py-3 border-b border-black/[0.06] shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-black truncate">
              {doc.filename}
            </p>
            <p className="text-xs text-black/40">
              {(doc.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            onClick={onDownload}
            disabled={downloading || !blobUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-black/60 hover:text-[#b5471b] hover:bg-[#b5471b]/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Transferir"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Transferir
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-black/40 hover:text-black hover:bg-black/5 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 bg-stone-100">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-black/40 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              A carregar pré-visualização…
            </div>
          )}

          {!loading && error && (
            <div className="h-full flex items-center justify-center text-sm text-[#b5471b]">
              {error}
            </div>
          )}

          {!loading && !error && blobUrl && (
            <iframe
              key={blobUrl}
              src={blobUrl}
              title={doc.filename}
              className="w-full h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
