import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Viewers (M13, ADR-062) can look, ask, download and leave notes, and change nothing. Every server
 * action under a business either starts with `requireEditor` or is listed here with what makes it
 * fine for a viewer; every route that changes something checks `canChange`. A new action that does
 * neither fails this test. (The core services refuse viewers too; this keeps the two in step.)
 */

const VIEWER_ALLOWED: Record<string, string> = {
  askAction: 'asking is what viewers are for',
  feedbackAction: 'their own thumbs up or down on an answer',
  markSeen: 'drops the "New" badge only',
  saveEmailPrefs: 'their own email settings',
  loadRecords: 'reads',
  openRecord: 'reads',
  findRecords: 'reads',
  checkUndo: 'reads what an undo would do; the undo itself is guarded',
  loadNotesAction: 'reads',
  addNoteAction: 'viewers can leave notes',
  removeNoteAction: 'their own notes only (the owner any), checked in the service',
  doneAction: 'the person it was handed to; anyone else must be able to change things (service)',
  createReportAction: 'a report emailed to themselves only',
  listReportsAction: 'reads their own reports',
  updateReportAction: 'their own reports only, checked in the service',
  inviteMember: 'owner only, checked in the service',
  cancelInvite: 'owner only, checked in the service',
  removePerson: 'owner only, checked in the service',
  changePersonRole: 'owner only, checked in the service',
  deleteBusiness: 'owner only, checked in the action and the service',
};

/** Routes that change something although they answer GET. */
const CHANGING_GET = new Set(['api/w/[slug]/connect/shopify/route.ts']);

const appDir = join(__dirname, '..', 'app');

function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, match);
    return match(name) ? [path] : [];
  });
}

function actions() {
  return files(join(appDir, 'w', '[slug]'), (n) => /actions\.ts$/.test(n)).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return source
      .split(/^(?=export async function )/m)
      .slice(1)
      .map((body) => ({
        file: relative(appDir, file),
        name: /^export async function (\w+)/.exec(body)![1]!,
        body,
      }));
  });
}

describe('viewers can’t change anything', () => {
  const all = actions();

  it('finds the server actions', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(all.map((a) => [`${a.file} ${a.name}`, a] as const))(
    '%s is guarded or allowed for viewers',
    (_, a) => {
      if (a.name in VIEWER_ALLOWED) return;
      expect(a.body, `${a.name} must start with requireEditor(slug)`).toMatch(
        /await requireEditor\(slug\)/,
      );
    },
  );

  it('lists only actions that exist', () => {
    const names = new Set(all.map((a) => a.name));
    expect(Object.keys(VIEWER_ALLOWED).filter((n) => !names.has(n))).toEqual([]);
  });

  it('checks canChange in every business route that changes something', () => {
    const routes = files(join(appDir, 'api', 'w', '[slug]'), (n) => n === 'route.ts');
    const changing = routes.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /export async function (POST|PUT|PATCH|DELETE)\b/.test(source) ||
        CHANGING_GET.has(relative(appDir, file))
      );
    });
    expect(changing.length).toBeGreaterThanOrEqual(2);
    for (const file of changing)
      expect(readFileSync(file, 'utf8'), relative(appDir, file)).toMatch(
        /canChange\(member\.role\)/,
      );
  });
});

describe('the public API and MCP server only read (M16, ADR-066)', () => {
  const routes = [
    ...files(join(appDir, 'api', 'v1'), (n) => n === 'route.ts'),
    join(appDir, 'api', 'mcp', 'route.ts'),
  ].filter((f) => !f.includes('openapi.json'));

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });

  it.each(routes.map((f) => [relative(appDir, f), f] as const))(
    '%s needs a key and offers no way to change anything',
    (_, file) => {
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/withApiKey\(request,/);
      expect(source).not.toMatch(/export (async function|const) (PUT|PATCH)\b/);
      expect(source).not.toMatch(/requireWorkspace|getSession/);
    },
  );
});
