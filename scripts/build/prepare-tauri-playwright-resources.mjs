import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const resourcesRoot = path.join(repoRoot, "src-tauri", "resources", "node_modules")

function resolvePackageDir(specifier, searchPaths) {
  const packageJsonPath = require.resolve(`${specifier}/package.json`, {
    paths: searchPaths,
  })
  return path.dirname(fs.realpathSync(packageJsonPath))
}

function copyPackage(specifier, sourceDir) {
  const targetDir = path.join(resourcesRoot, specifier)
  fs.rmSync(targetDir, { force: true, recursive: true })
  fs.cpSync(sourceDir, targetDir, { dereference: true, recursive: true })
  console.log(`Vendored ${specifier} -> ${targetDir}`)
}

fs.mkdirSync(resourcesRoot, { recursive: true })

// Vendor patchright (+ its patchright-core) — the stealth fork is now the only
// browser lib. The top-level `playwright` dep was dropped; patchright ships its
// own self-contained core, so nothing here needs playwright anymore.
const patchrightDir = resolvePackageDir("patchright", [repoRoot])
const patchrightCoreDir = resolvePackageDir("patchright-core", [patchrightDir, repoRoot])

copyPackage("patchright", patchrightDir)
copyPackage("patchright-core", patchrightCoreDir)
