import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const babelParserPath = path.resolve('frontend/node_modules/@babel/parser/lib/index.js');
const babelTraversePath = path.resolve('frontend/node_modules/@babel/traverse/lib/index.js');

const parser = await import(pathToFileURL(babelParserPath).href);
const traverseModule = await import(pathToFileURL(babelTraversePath).href);
const traverse = traverseModule.default.default || traverseModule.default;

const filePath = path.resolve('frontend/src/pages/Attendance.jsx');
const code = fs.readFileSync(filePath, 'utf-8');

const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

const standardGlobals = new Set([
  'console', 'window', 'document', 'navigator', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'Date', 'Math', 'Boolean', 'String', 'Number',
  'Object', 'Array', 'JSON', 'isNaN', 'parseFloat', 'parseInt', 'Promise',
  'fetch', 'sessionStorage', 'localStorage', 'alert', 'confirm', 'Intl',
  'Error', 'TypeError', 'ReferenceError', 'undefined', 'null', 'NaN', 'Infinity',
  'location', 'history'
]);

let missingGlobals = new Map();

traverse(ast, {
  Identifier(path) {
    // Only check references, not property keys or declarations
    if (
      !path.isReferencedIdentifier() ||
      path.parent.type === 'JSXAttribute' ||
      path.parent.type === 'MemberExpression' && path.parent.property === path.node && !path.parent.computed
    ) {
      return;
    }

    const name = path.node.name;
    if (standardGlobals.has(name)) return;

    const binding = path.scope.getBinding(name);
    if (!binding) {
      if (!missingGlobals.has(name)) {
        missingGlobals.set(name, []);
      }
      missingGlobals.get(name).push(path.node.loc?.start?.line);
    }
  }
});

if (missingGlobals.size > 0) {
  console.log('Unbound identifiers in Attendance.jsx:');
  for (const [name, lines] of missingGlobals.entries()) {
    console.log(`  - ${name} at lines: ${lines.slice(0, 5).join(', ')}`);
  }
} else {
  console.log('✓ Zero unbound identifiers found in Attendance.jsx! All variables are properly declared.');
}
