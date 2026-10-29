'use client';

import { FileSpreadsheet, Upload, X } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { msg } from '@bizr/i18n/translate';
import { useId, useRef, useState } from 'react';

import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const READABLE = ['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'txt'];

interface Chosen {
  file: File;
  problem?: string;
}

function check(file: File): string | undefined {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return msg('We can’t open PDF files yet. Export to Excel or CSV.');
  if (ext === 'numbers' || ext === 'ods')
    return msg('Please save this as Excel (.xlsx) or CSV first.');
  if (!READABLE.includes(ext)) return msg('We can read Excel (.xlsx) and CSV files.');
  if (file.size === 0) return msg('This file looks empty.');
  if (file.size > MAX_BYTES)
    return msg('This file is bigger than 25 MB. Try splitting it by year.');
  return undefined;
}

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function UploadForm({ slug }: { slug: string }) {
  const t = useT();
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (files: FileList | null) => {
    if (!files) return;
    setError(null);
    setChosen((current) => {
      const names = new Set(current.map((c) => c.file.name));
      const next = [...current];
      for (const file of Array.from(files)) {
        if (names.has(file.name)) continue;
        next.push({ file, problem: check(file) });
      }
      return next.slice(0, MAX_FILES);
    });
  };

  const good = chosen.filter((c) => !c.problem);

  const submit = () => {
    if (good.length === 0) return;
    const form = new FormData();
    for (const c of good) form.append('files', c.file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/w/${slug}/imports`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { runId?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // fall through to the generic message
      }
      if (xhr.status === 201 && body.runId) {
        router.push(`/w/${slug}/data/import/${body.runId}` as Route);
        return;
      }
      setProgress(null);
      setError(body.error ?? t('Something went wrong while uploading. Please try again.'));
    };
    xhr.onerror = () => {
      setProgress(null);
      setError(t('We couldn’t reach BizRetriever. Check your connection and try again.'));
    };
    setProgress(0);
    xhr.send(form);
  };

  return (
    <div className="grid gap-4">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          'grid cursor-pointer place-items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        )}
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden />
        <span className="max-w-md text-sm text-muted-foreground">
          {t(
            'Drop your spreadsheets here: sales, stock lists, supplier orders, expenses. Excel or CSV. Messy is fine.',
          )}
        </span>
        <span className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t('Choose files')}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt"
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {chosen.length > 0 ? (
        <ul className="grid gap-2" aria-label={t('Chosen files')}>
          {chosen.map((c) => (
            <li
              key={c.file.name}
              className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2 text-sm',
                c.problem && 'border-destructive/40 bg-destructive/5',
              )}
            >
              <FileSpreadsheet
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.file.name}</p>
                <p className={cn('text-xs text-muted-foreground', c.problem && 'text-destructive')}>
                  {c.problem ? t(c.problem) : size(c.file.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('Remove {name}', { name: c.file.name })}
                disabled={progress !== null}
                onClick={() => setChosen((all) => all.filter((x) => x !== c))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {progress !== null ? (
        <div className="grid gap-1" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress < 100
              ? t('Uploading… {progress}%', { progress })
              : t('Uploaded. Getting started…')}
          </p>
        </div>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div>
        <Button size="lg" onClick={submit} disabled={good.length === 0 || progress !== null}>
          {t('Make sense of my data')}
        </Button>
      </div>
    </div>
  );
}
