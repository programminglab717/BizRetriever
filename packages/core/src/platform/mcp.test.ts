import { describe, expect, it } from 'vitest';

import type { MemberWorkspace } from '../workspaces/service';
import { handleMcpMessage } from './mcp';

const member = { workspace: { name: 'Fernwood' }, role: 'viewer' } as unknown as MemberWorkspace;
const call = (body: unknown) => handleMcpMessage(body, { member });

describe('MCP server', () => {
  it('agrees a protocol version and says it has tools', async () => {
    const r = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
    });
    expect(r).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'bizretriever' },
      },
    });
    const newer = await call({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01' },
    });
    expect(newer).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
  });

  it('lists read-only tools with JSON Schema inputs', async () => {
    const r = await call({ jsonrpc: '2.0', id: 'a', method: 'tools/list' });
    const tools = (r as { result: { tools: { name: string; inputSchema: { type: string } }[] } })
      .result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      'get_business',
      'list_measures',
      'run_query',
      'ask_question',
      'list_insights',
      'get_dashboard',
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t).toMatchObject({ annotations: { readOnlyHint: true, destructiveHint: false } });
    }
  });

  it('answers notifications with nothing, and refuses what it doesn’t know', async () => {
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await call({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).toMatchObject({
      error: { code: -32601 },
    });
    expect(await call({ hello: 'world' })).toMatchObject({ id: null, error: { code: -32600 } });
    expect(
      await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'drop_all' } }),
    ).toMatchObject({ error: { code: -32602 } });
  });

  it('reports bad tool arguments as a tool error the assistant can read', async () => {
    const r = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'run_query', arguments: { metrics: [], sql: 'select 1' } },
    });
    expect(r).toMatchObject({ result: { isError: true } });
  });
});
