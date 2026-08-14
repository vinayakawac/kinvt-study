// Copies src/ into build/ for distribution. The extension uses a single
// unified manifest.json that works on Chrome/Edge (service_worker,
// sidePanel) and Firefox 121+ (sidebar_action, browser_specific_settings),
// so there's nothing to swap per browser anymore — just a straight copy.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");
const targetDir = path.join(root, "build");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(targetDir, { recursive: true, force: true });
copyRecursive(srcDir, targetDir);
console.log(`Built -> ${targetDir}`);
console.log("Load build/ as an unpacked extension in Chrome, Edge, or Firefox.");
