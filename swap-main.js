const fs = require('fs');
const packageJson = require('./package.json');
packageJson.main = './dist/extension.js';
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
