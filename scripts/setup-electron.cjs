// Node 26 can leave extract-zip incomplete without an error. Use the verified archive and Linux unzip.
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')
const { writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const root = dirname(require.resolve('electron/package.json'))
const local = createRequire(join(root, 'package.json'))
const { downloadArtifact } = local('@electron/get')
downloadArtifact({
  version: local('./package.json').version,
  artifactName: 'electron',
  platform: 'linux',
  arch: process.arch,
  checksums: local('./checksums.json'),
})
  .then((file) => {
    execFileSync('unzip', ['-oq', file, '-d', join(root, 'dist')])
    writeFileSync(join(root, 'path.txt'), 'electron')
    console.log('Electron Linux binary ready')
  })
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
