const LEGAL_ENTITY_WORDS = new Set([
  'PVT', 'PRIVATE',
  'LTD', 'LIMITED',
  'LLP',
  'INC', 'INCORPORATED',
  'LLC',
  'GMBH',
  'PLC'
]);

/**
 * Generates a clean, readable short-form company prefix.
 *
 * Rules:
 * 1. Normalize name, replace symbols, split to uppercase tokens.
 * 2. Filter out legal entity words (PVT, LTD, INC, etc.).
 * 3. Keep meaningful words (Innovation, Corporation, Technologies, etc.).
 * 4. Generate short readable prefix:
 *    - MRF Innovation -> MRFI
 *    - MRF Corporation -> MRFC
 *    - MRF Technologies -> MRFT
 *    - InnovEity Technologies -> INNT
 *    - ABC Solutions -> ABCS
 * 5. Handle collisions deterministically by extending using characters from distinguishing words.
 */
function generateCompanyPrefix(companyName, existingPrefixes = new Set()) {
  if (!companyName || typeof companyName !== 'string') {
    return 'AST';
  }

  // 1. Normalize and extract words
  const rawWords = companyName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (rawWords.length === 0) return 'AST';

  // 2. Filter legal entity words
  let meaningfulWords = rawWords.filter(w => !LEGAL_ENTITY_WORDS.has(w));
  if (meaningfulWords.length === 0) {
    meaningfulWords = rawWords;
  }

  // 3. Base prefix generation
  let base = '';
  if (meaningfulWords.length === 1) {
    const w = meaningfulWords[0];
    base = w.length <= 4 ? w : w.slice(0, 4);
  } else if (meaningfulWords.length === 2) {
    const [first, second] = meaningfulWords;
    // Check if first word is an acronym or short word (<= 3 chars, or <= 4 if all alpha)
    if (first.length <= 3) {
      base = first + second[0];
    } else {
      // E.g. InnovEity Technologies -> INNT (first 3 chars of first word + first char of second word)
      base = first.slice(0, 3) + second[0];
    }
  } else {
    // 3 or more words
    const first = meaningfulWords[0];
    if (first.length <= 3) {
      // e.g. MRF Global Solutions -> MRFGS
      base = first + meaningfulWords.slice(1).map(w => w[0]).join('');
    } else {
      // Acronym of each word
      base = meaningfulWords.map(w => w[0]).join('');
      if (base.length < 4) {
        base = first.slice(0, 4 - base.length + 1) + meaningfulWords.slice(1).map(w => w[0]).join('');
      }
    }
  }

  // Ensure minimum length of 3
  if (base.length < 3) {
    const padSource = meaningfulWords.join('');
    base = padSource.slice(0, Math.min(3, padSource.length)).padEnd(3, 'X');
  }

  // Check uniqueness
  if (!existingPrefixes.has(base)) {
    return base;
  }

  // 4. Deterministic Collision Resolution
  // Extend using additional characters from distinguishing word(s)
  // Distinguishing word is usually the 2nd word (or last meaningful word)
  const distWord = meaningfulWords.length > 1 
    ? meaningfulWords[meaningfulWords.length - 1] 
    : meaningfulWords[0];

  // Try extending base with subsequent letters of distinguishing word
  for (let i = 1; i < distWord.length; i++) {
    const candidate = base + distWord[i];
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  // Try extending with letters from first word
  const firstWord = meaningfulWords[0];
  for (let i = 1; i < firstWord.length; i++) {
    const candidate = base + firstWord[i];
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: append deterministic letters A-Z, AA-ZZ
  for (let charCode = 65; charCode <= 90; charCode++) {
    const candidate = base + String.fromCharCode(charCode);
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  let counter = 1;
  while (existingPrefixes.has(`${base}${counter}`)) {
    counter++;
  }
  return `${base}${counter}`;
}

// Test against all user examples
const testCases = [
  { name: 'MRF Innovation', expected: 'MRFI' },
  { name: 'MRF Corporation', expected: 'MRFC' },
  { name: 'MRF Technologies', expected: 'MRFT' },
  { name: 'InnovEity Technologies', expected: 'INNT' },
  { name: 'ABC Solutions', expected: 'ABCS' },
  { name: 'MRF Innovation Pvt Ltd', expected: 'MRFI' },
  { name: 'MRF Corporation Limited', expected: 'MRFC' },
  { name: 'Acme Solutions Inc.', expected: 'ACMS' }
];

console.log('=== Testing Base Algorithm Against User Examples ===');
let allPassed = true;
for (const tc of testCases) {
  const actual = generateCompanyPrefix(tc.name);
  const match = actual === tc.expected;
  if (!match) allPassed = false;
  console.log(`${match ? '✔' : '❌'} "${tc.name}" => "${actual}" (Expected: "${tc.expected}")`);
}

console.log('\n=== Testing Collision Handling ===');
const prefixes = new Set(['MRFI']);
console.log('Existing prefixes:', Array.from(prefixes));
const coll1 = generateCompanyPrefix('MRF Infrastructure', prefixes);
console.log('Collision 1 ("MRF Infrastructure" vs "MRFI"):', coll1);
prefixes.add(coll1);

const coll2 = generateCompanyPrefix('MRF Information', prefixes);
console.log('Collision 2 ("MRF Information" vs ["MRFI", coll1]):', coll2);
prefixes.add(coll2);

console.log('Updated prefixes set:', Array.from(prefixes));
