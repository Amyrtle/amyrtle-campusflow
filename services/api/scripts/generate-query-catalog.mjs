import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const source = ts.createSourceFile(
  'app.ts',
  await readFile(resolve(root, 'services/api/src/app.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const constants = new Map();
function collect(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
  )
    constants.set(node.name.text, node.initializer.text);
  ts.forEachChild(node, collect);
}
collect(source);
function strings(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isIdentifier(node) && constants.has(node.text)) return [constants.get(node.text)];
  if (ts.isConditionalExpression(node))
    return [...strings(node.whenTrue), ...strings(node.whenFalse)];
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans)
      values = values.flatMap((prefix) =>
        strings(span.expression).map((value) => prefix + value + span.literal.text),
      );
    return values;
  }
  throw new Error(`SQL must be statically enumerable: ${node.getText(source)}`);
}
const statements = new Set();
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'query'
  )
    for (const sql of strings(node.arguments[0])) statements.add(sql.trim());
  ts.forEachChild(node, visit);
}
visit(source);
const entries = [...statements]
  .map((sql) => ({
    id: createHash('sha256').update(sql).digest('hex'),
    sql,
    parameters: Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))),
    returnsRows: /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql),
  }))
  .sort((a, b) => a.id.localeCompare(b.id));
await writeFile(
  resolve(root, 'services/api/src/query-catalog.ts'),
  `// Generated from app.ts by scripts/generate-query-catalog.mjs. Do not edit.\nexport const queryIds = new Set(${JSON.stringify(
    entries.map((item) => item.id),
    null,
    2,
  )});\n`,
);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const inserts = entries
  .map((item) => `(${quote(item.id)},${quote(item.sql)},${item.parameters},${item.returnsRows})`)
  .join(',\n');
const template = await readFile(resolve(root, 'cloudbase/deployment/query-rpc.sql'), 'utf8');
await writeFile(
  resolve(root, 'cloudbase/migrations/20261026000001_query_catalog.sql'),
  `-- Generated fixed query allowlist. Never accept SQL text from clients.\n${template.replace('-- QUERY_CATALOG_VALUES', `INSERT INTO campusflow_internal.query_catalog(id,statement,parameter_count,returns_rows) VALUES\n${inserts}\nON CONFLICT(id) DO UPDATE SET statement=EXCLUDED.statement,parameter_count=EXCLUDED.parameter_count,returns_rows=EXCLUDED.returns_rows;`)}`,
);
console.log(`Generated ${entries.length} fixed server queries.`);
