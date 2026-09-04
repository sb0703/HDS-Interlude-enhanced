const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.env.HDS_ROOT || '/opt/hds-interlude'
const appDir = path.join(root, '.local-hdsi/koishi-app')
const yaml = require(path.join(appDir, 'node_modules/js-yaml'))

function hashSecret(value) {
  if (typeof value !== 'string' || !value) return '(empty)'
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function tokenFrom(object) {
  if (!object || typeof object !== 'object') return ''
  for (const [key, value] of Object.entries(object)) {
    if (/^(access_?token|token)$/i.test(key) && typeof value === 'string') return value
  }
  return ''
}

function walk(value, visitor, currentPath = []) {
  if (!value || typeof value !== 'object') return
  visitor(value, currentPath)
  for (const [key, child] of Object.entries(value)) {
    walk(child, visitor, currentPath.concat(key))
  }
}

function inspectNapCat(label, filename) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
  let found = 0
  walk(config, (object, objectPath) => {
    const token = tokenFrom(object)
    const hasServerShape = 'port' in object && ('enable' in object || 'enabled' in object)
    if (!token && !hasServerShape) return
    found += 1
    const safe = {
      source: label,
      path: objectPath.join('.'),
      enable: object.enable ?? object.enabled ?? null,
      host: object.host ?? null,
      port: object.port ?? null,
      tokenSha256Prefix: hashSecret(token),
    }
    console.log(JSON.stringify(safe))
  })
  if (!found) console.log(JSON.stringify({ source: label, error: 'no server configuration found' }))
}

function inspectKoishi(filename) {
  const config = yaml.load(fs.readFileSync(filename, 'utf8'))
  walk(config, (object, objectPath) => {
    if (!object.selfId || !object.endpoint) return
    console.log(JSON.stringify({
      source: 'koishi',
      path: objectPath.join('.'),
      selfId: String(object.selfId),
      endpoint: String(object.endpoint),
      tokenSha256Prefix: hashSecret(tokenFrom(object)),
    }))
  })
}

const bot1Id = requiredEnvironment('HDS_BOT_1_QQ')
const bot2Id = requiredEnvironment('HDS_BOT_2_QQ')
inspectNapCat('napcat-1', path.join(root, `napcat/data/instance-1/config/onebot11_${bot1Id}.json`))
inspectNapCat('napcat-2', path.join(root, `napcat/data/instance-2/config/onebot11_${bot2Id}.json`))
inspectKoishi(path.join(appDir, 'koishi.yml'))
