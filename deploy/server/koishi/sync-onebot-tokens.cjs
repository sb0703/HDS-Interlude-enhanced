const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.env.HDS_ROOT || '/opt/hds-interlude'
const appDir = path.join(root, '.local-hdsi/koishi-app')
const yaml = require(path.join(appDir, 'node_modules/js-yaml'))
const koishiFile = path.join(appDir, 'koishi.yml')

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const mappings = [
  {
    selfId: requiredEnvironment('HDS_BOT_1_QQ'),
    dataDirectory: 'instance-1',
  },
  {
    selfId: requiredEnvironment('HDS_BOT_2_QQ'),
    dataDirectory: 'instance-2',
  },
].map(mapping => ({ ...mapping, napcatFile: path.join(root, `napcat/data/${mapping.dataDirectory}/config/onebot11_${mapping.selfId}.json`) }))

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function readNapCatToken(filename) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const server = config?.network?.websocketServers?.find((item) => item?.enable && item?.port === 3001)
  if (!server || typeof server.token !== 'string' || !server.token) {
    throw new Error(`No enabled WebSocket server token found in ${filename}`)
  }
  return server.token
}

function replaceTokenAfterSelfId(source, selfId, token) {
  const escapedId = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^([ \\t]+)selfId:[^\\r\\n]*${escapedId}[^\\r\\n]*\\r?\\n)([\\s\\S]{0,400}?)(^\\2token:[ \\t]*)[^\\r\\n]*`, 'm')
  let replaced = false
  const result = source.replace(pattern, (match, selfIdLine, indent, between, tokenPrefix) => {
    replaced = true
    const quoted = `'${token.replace(/'/g, "''")}'`
    return `${selfIdLine}${between}${tokenPrefix}${quoted}`
  })
  if (!replaced) throw new Error(`Koishi adapter token for ${selfId} was not found`)
  return result
}

let source = fs.readFileSync(koishiFile, 'utf8')
const backupFile = `${koishiFile}.pre-token-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(koishiFile, backupFile, fs.constants.COPYFILE_EXCL)
fs.chmodSync(backupFile, 0o600)

for (const mapping of mappings) {
  const token = readNapCatToken(mapping.napcatFile)
  source = replaceTokenAfterSelfId(source, mapping.selfId, token)
  console.log(`${mapping.selfId} tokenSha256Prefix=${hashSecret(token)}`)
}

yaml.load(source)
const temporaryFile = `${koishiFile}.tmp-${process.pid}`
fs.writeFileSync(temporaryFile, source, { mode: 0o600, flag: 'wx' })
fs.renameSync(temporaryFile, koishiFile)
fs.chmodSync(koishiFile, 0o600)
console.log(`backup=${path.basename(backupFile)}`)
