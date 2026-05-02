'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Download, Eye, FileText, Loader2 } from 'lucide-react';
import {
  deleteDocument,
  downloadDocument,
  listDocuments,
  uploadDocument,
  type PatientDocument,
} from '@/lib/api/documents';

import { DocumentViewer } from './document-viewer';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function DocumentsPanel({
  patientId,
  token,
  initialDocuments,
}: {
  patientId: string;
  token: string;
  initialDocuments: PatientDocument[];
}) {
  const [documents, setDocuments] = useState<PatientDocument[]>(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Document being previewed in the modal, plus its bearer-fetched blob URL.
  // We mint the URL once per open and revoke it on close so memory stays clean.
  const [viewing, setViewing] = useState<PatientDocument | null>(null);
  const [viewBlobUrl, setViewBlobUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  // Always revoke the blob URL when it changes or the panel unmounts.
  useEffect(() => {
    return () => {
      if (viewBlobUrl) URL.revokeObjectURL(viewBlobUrl);
    };
  }, [viewBlobUrl]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const { document } = await uploadDocument(patientId, file, token);
      setDocuments((prev) => [document, ...prev]);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDownload = async (doc: PatientDocument) => {
    setDownloading(doc.id);
    try {
      const { blob, filename } = await downloadDocument(doc.id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed.');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteDocument(id, token);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError('Could not delete document.');
    }
  };

  const handleView = async (doc: PatientDocument) => {
    setViewing(doc);
    setViewLoading(true);
    setViewError(null);
    setViewBlobUrl(null);

    try {
      const { blob } = await downloadDocument(doc.id, token);
      setViewBlobUrl(URL.createObjectURL(blob));
    } catch {
      setViewError('Não foi possível carregar a pré-visualização.');
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    setViewing(null);
    setViewError(null);
    if (viewBlobUrl) {
      URL.revokeObjectURL(viewBlobUrl);
      setViewBlobUrl(null);
    }
  };

  // Only formats browsers can render natively in an iframe get the Eye button.
  const isPreviewable = (doc: PatientDocument) =>
    doc.content_type === 'application/pdf' ||
    doc.content_type.startsWith('image/') ||
    doc.content_type === 'text/plain';

  return (
    <div className="flex flex-col gap-4">
      {/* Upload button */}
      <div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: 'rgba(181,71,27,0.07)',
            color: '#b5471b',
            border: '1px solid rgba(181,71,27,0.15)',
          }}
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      </div>

      {error && <p className="text-xs text-[#b5471b]">{error}</p>}

      {/* Document list */}
      {documents.length === 0 ? (
        <p className="text-xs text-black/30 italic">No documents uploaded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{
                background: 'rgba(0,0,0,0.02)',
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <FileText className="w-4 h-4 shrink-0 text-black/30" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-black truncate">
                  {doc.filename}
                </p>
                <p className="text-xs text-black/35">
                  {formatSize(doc.size)} · {formatDate(doc.inserted_at)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isPreviewable(doc) && (
                  <button
                    onClick={() => handleView(doc)}
                    className="p-1.5 text-black/30 hover:text-[#b5471b] transition-colors"
                    aria-label="Ver"
                    title="Ver"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloading === doc.id}
                  className="p-1.5 text-black/30 hover:text-[#b5471b] transition-colors disabled:opacity-40"
                  aria-label="Transferir"
                  title="Transferir"
                >
                  {downloading === doc.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="p-1.5 text-black/30 hover:text-[#b5471b] transition-colors"
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <DocumentViewer
          doc={viewing}
          blobUrl={viewBlobUrl}
          loading={viewLoading}
          error={viewError}
          onClose={closeView}
          onDownload={() => handleDownload(viewing)}
          downloading={downloading === viewing.id}
        />
      )}
    </div>
  );
}
