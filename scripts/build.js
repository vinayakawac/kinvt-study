// Copies src/ into build/chrome and build/firefox, swapping in the correct
// manifest.json for each target, then zips each folder for distribution.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");
const buildDir = path.join(root, "build");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry.startsWith("manifest.")) continue; // handled separately per target
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function buildTarget(name, manifestFile, extraSkip) {
  const targetDir = path.join(buildDir, name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  copyRecursive(srcDir, targetDir);
  fs.copyFileSync(path.join(srcDir, manifestFile), path.join(targetDir, "manifest.json"));
  if (extraSkip) {
    for (const rel of extraSkip) {
      const p = path.join(targetDir, rel);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  }
  console.log(`Built ${name} -> ${targetDir}`);
}

buildTarget("chrome", "manifest.chrome.json", ["vendor"]);
buildTarget("firefox", "manifest.firefox.json");

console.log("Done. Load build/chrome or build/firefox as an unpacked extension.");
