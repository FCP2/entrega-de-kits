const fs = require('node:fs');
const path = require('node:path');

const vendor = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(vendor, { recursive: true });
for (const file of ['sweetalert2.all.min.js', 'sweetalert2.min.css']) {
  fs.copyFileSync(
    require.resolve(`sweetalert2/dist/${file}`),
    path.join(vendor, file)
  );
}
fs.copyFileSync(
  require.resolve('bootstrap/dist/css/bootstrap.min.css'),
  path.join(vendor, 'bootstrap.min.css')
);
fs.copyFileSync(
  require.resolve('html5-qrcode/html5-qrcode.min.js'),
  path.join(vendor, 'html5-qrcode.min.js')
);
console.log('Bootstrap, SweetAlert2 y lector QR preparados para publicación.');
