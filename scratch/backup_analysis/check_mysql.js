const fs = require('fs');
const path = require('path');
const mysql = require('../../backend/node_modules/mysql2/promise').catch?.(() => null) || null;

console.log('Checking mysql2 availability...');
try {
  require('../../backend/node_modules/mysql2');
  console.log('mysql2 is available.');
} catch (e) {
  console.log('mysql2 not found directly, checking dependencies.');
}
