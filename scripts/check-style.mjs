// Style gate for the rules in AGENTS.md:
//  - control flow (if/for/while/switch/try) nested at most --max-depth levels inside a function;
//  - no `as` casts (prefer `satisfies`, type guards, or better types), except `as const` and a cast whose
//    previous line carries a comment containing "parse boundary" (validated input from outside).
// Usage: node scripts/check-style.mjs [--max-depth=2] [--casts]   (--casts also lists the allowed casts)
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const maxDepth = Number(process.argv.find((a) => a.startsWith('--max-depth='))?.split('=')[1] ?? 2);
const listCasts = process.argv.includes('--casts');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) yield path;
  }
}

const NESTING = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.TryStatement,
]);
const FUNCTION = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
]);

let problems = 0;
let casts = 0;
for (const file of files('src')) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const report = (node, message) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    console.log(`${file}:${line + 1}: ${message}`);
  };
  const visit = (node, depth) => {
    if (FUNCTION.has(node.kind)) depth = 0;
    let next = depth;
    // `else if` continues a chain; it is not a deeper level.
    const elseIf = node.kind === ts.SyntaxKind.IfStatement && node.parent?.kind === ts.SyntaxKind.IfStatement
      && node.parent.elseStatement === node;
    if (NESTING.has(node.kind) && !elseIf) {
      next = depth + 1;
      if (next > maxDepth) {
        problems++;
        report(node, `nesting depth ${next} > ${maxDepth}`);
        return;
      }
    }
    if (elseIf) next = depth;
    if (node.kind === ts.SyntaxKind.AsExpression && node.type.getText(source) !== 'const') {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      const above = source.text.split('\n')[line - 1] ?? '';
      if (/parse boundary/i.test(above)) {
        casts++;
        if (listCasts) report(node, `allowed: as ${node.type.getText(source)}`);
      } else {
        problems++;
        report(node, `\`as ${node.type.getText(source)}\` cast: use satisfies, a type guard or a better type`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(source, 0);
}
console.log(`\n${problems} violation(s); ${casts} allowed parse-boundary cast(s)`);
process.exitCode = problems > 0 ? 1 : 0;
