import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const testDirectory = resolve('test')
const testFiles = readdirSync(testDirectory)
  .filter(name => name.endsWith('.test.ts'))
  .sort()
  .map(name => resolve(testDirectory, name))

if (!testFiles.length) {
  console.error('No test/*.test.ts files were found.')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...testFiles], {
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
