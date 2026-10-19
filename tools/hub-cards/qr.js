// Prints a QR code as rows of 0/1 for the given text (one row per line).
// Usage: node qr.js "https://example.com"
// Uses the vendored qrcode-generator (MIT, Kazuhiko Arase) so the job needs no npm install.
const path = require('path');
const qrcode = require(path.join(__dirname, 'vendor', 'qrcode-generator.js'));

const text = process.argv[2];
if (!text) {
  console.error('usage: node qr.js <text>');
  process.exit(2);
}
const qr = qrcode(0, 'M');
qr.addData(text);
qr.make();
const n = qr.getModuleCount();
const rows = [];
for (let r = 0; r < n; r++) {
  let row = '';
  for (let c = 0; c < n; c++) row += qr.isDark(r, c) ? '1' : '0';
  rows.push(row);
}
process.stdout.write(rows.join('\n') + '\n');
