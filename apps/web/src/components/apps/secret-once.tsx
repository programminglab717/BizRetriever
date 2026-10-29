'use client';

import { useState } from 'react';

import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';

/** A key or secret shown once, with a copy button. */
export function SecretOnce({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3" data-testid="secret-once">
      <p className="font-medium">{label}</p>
      <code className="break-all rounded bg-muted px-2 py-1 text-xs" data-testid="secret-value">
        {value}
      </code>
      <p className="text-muted-foreground">
        {t('Copy it now and keep it somewhere safe. We won’t show it again.')}
      </p>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
    </div>
  );
}
