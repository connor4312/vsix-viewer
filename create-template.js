const pug = require('pug');
const fs = require('fs');

const js = pug.compileFileClient('src/webview.pug', { name: 'template', compileDebug: false });
fs.writeFileSync('out/webview-raw.js', js + '\n\nmodule.exports = template;');
