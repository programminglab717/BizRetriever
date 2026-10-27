import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Using an AI assistant (MCP, M16): where to point it. */
export function Assistants({ mcpUrl, hasKey }: { mcpUrl: string; hasKey: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>An AI assistant</CardTitle>
        <CardDescription>
          Assistants such as Claude can read your numbers and answer with them, using the MCP
          standard. They can look, never change anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <ol className="grid list-decimal gap-1 pl-5">
          <li>{hasKey ? 'Use one of your keys above' : 'Make a key above'} for the assistant.</li>
          <li>
            In the assistant, add a connector (an “MCP server”) with this address:{' '}
            <code className="break-all" data-testid="mcp-url">
              {mcpUrl}
            </code>
          </li>
          <li>
            Set its header to <code>Authorization: Bearer</code> followed by the key.
          </li>
        </ol>
        <p className="text-muted-foreground">
          The assistant sees the same numbers you do. What it says about them is its own work.
        </p>
      </CardContent>
    </Card>
  );
}
