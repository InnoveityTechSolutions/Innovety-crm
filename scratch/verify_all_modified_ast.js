import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const babelParserPath = path.resolve('frontend/node_modules/@babel/parser/lib/index.js');
const babelTraversePath = path.resolve('frontend/node_modules/@babel/traverse/lib/index.js');

const parser = await import(pathToFileURL(babelParserPath).href);
const traverseModule = await import(pathToFileURL(babelTraversePath).href);
const traverse = traverseModule.default.default || traverseModule.default;

const standardGlobals = new Set([
  'console', 'window', 'document', 'navigator', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'Date', 'Math', 'Boolean', 'String', 'Number',
  'Object', 'Array', 'JSON', 'isNaN', 'parseFloat', 'parseInt', 'Promise',
  'fetch', 'sessionStorage', 'localStorage', 'alert', 'confirm', 'Intl',
  'Error', 'TypeError', 'ReferenceError', 'undefined', 'null', 'NaN', 'Infinity',
  'location', 'history', 'getComputedStyle', 'MutationObserver', 'Map', 'Set'
]);

const files = [
  'frontend/src/components/attendance/ClockInModal.jsx',
  'frontend/src/components/dashboard/EmployeeDashboard.jsx',
  'frontend/src/pages/Attendance.jsx',
  'frontend/src/components/leave/CompOffSessionCard.jsx'
];

let hasErrors = false;

for (const relPath of files) {
  const filePath = path.resolve(relPath);
  const code = fs.readFileSync(filePath, 'utf-8');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx']
    });

    let missingGlobals = new Map();

    traverse(ast, {
      Identifier(p) {
        if (
          !p.isReferencedIdentifier() ||
          p.parent.type === 'JSXAttribute' ||
          (p.parent.type === 'MemberExpression' && p.parent.property === p.node && !p.parent.computed)
        ) {
          return;
        }

        const name = p.node.name;
        if (standardGlobals.has(name)) return;

        const binding = p.scope.getBinding(name);
        if (!binding) {
          if (!missingGlobals.has(name)) {
            missingGlobals.set(name, []);
          }
          missingGlobals.get(name).push(p.node.loc?.start?.line);
        }
      }
    });

    if (missingGlobals.size > 0) {
      console.log(`⚠️ Unbound identifiers in ${relPath}:`);
      for (const [name, lines] of missingGlobals.entries()) {
        console.log(`  - ${name} at lines: ${lines.slice(0, 5).join(', ')}`);
      }
      hasErrors = true;
    } else {
      console.log(`✓ ZERO unbound identifiers in ${relPath}!`);
    }
  } catch (parseErr) {
    console.error(`❌ Parse error in ${relPath}:`, parseErr.message);
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log('\n🎉 ALL FILES PARSED AND SCOPES VERIFIED CLEANLY!');
}
