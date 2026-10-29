import { Fragment } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/lib/i18n';

/** A translated sentence with `{name}` placeholders shown as code. */
function withCode(text: string, codes: Record<string, string>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const code = codes[part.slice(1, -1)];
    return code !== undefined && /^\{\w+\}$/.test(part) ? (
      <code key={i}>{code}</code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

/** Using an AI assistant (MCP, M16): where to point it. */
export async function Assistants({ mcpUrl, hasKey }: { mcpUrl: string; hasKey: boolean }) {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('An AI assistant')}</CardTitle>
        <CardDescription>
          {t(
            'Assistants such as Claude can read your numbers and answer with them, using the MCP standard. They can look, never change anything.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <ol className="grid list-decimal gap-1 pl-5">
          <li>
            {hasKey
              ? t('Use one of your keys above for the assistant.')
              : t('Make a key above for the assistant.')}
          </li>
          <li>
            {t('In the assistant, add a connector (an “MCP server”) with this address:')}{' '}
            <code className="break-all" data-testid="mcp-url">
              {mcpUrl}
            </code>
          </li>
          <li>
            {withCode(t('Set its header to {header} followed by the key.'), {
              header: 'Authorization: Bearer',
            })}
          </li>
        </ol>
        <p className="text-muted-foreground">
          {t(
            'The assistant sees the same numbers you do. What it says about them is its own work.',
          )}
        </p>
      </CardContent>
    </Card>
  );
}
