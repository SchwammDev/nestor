import fs from 'node:fs'
import { load as loadYaml } from 'js-yaml'

export interface Config {
  port: number
  authToken: string
  systemPrompt: string
  provider: { baseUrl: string; apiKey: string; model: string }
}

interface RawProviderConfig {
  base_url?: string
  api_key?: string
  model?: string
}

interface RawConfig {
  port?: number
  auth_token?: string
  system_prompt?: string
  provider?: RawProviderConfig
}

const DEFAULT_CONFIG_PATH = '/etc/nestor/config.yaml'
const DEFAULT_PORT = 8790
const DEFAULT_SYSTEM_PROMPT = 'You are Nestor, a personal assistant.'

export function loadConfig(path?: string): Config {
  const configPath = resolveConfigPath(path)
  const raw = parseYamlFile(configPath)

  return {
    port: raw.port ?? DEFAULT_PORT,
    authToken: requireString(raw.auth_token, 'auth_token', configPath),
    systemPrompt: raw.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
    provider: {
      baseUrl: requireString(raw.provider?.base_url, 'provider.base_url', configPath),
      apiKey: requireString(raw.provider?.api_key, 'provider.api_key', configPath),
      model: requireString(raw.provider?.model, 'provider.model', configPath),
    },
  }
}

function resolveConfigPath(explicitPath?: string): string {
  return explicitPath ?? process.env.NESTOR_CONFIG ?? DEFAULT_CONFIG_PATH
}

function parseYamlFile(configPath: string): RawConfig {
  const fileContents = fs.readFileSync(configPath, 'utf8')
  return (loadYaml(fileContents) ?? {}) as RawConfig
}

function requireString(value: string | undefined, dottedKey: string, configPath: string): string {
  if (!value) {
    throw new Error(`Missing required config key "${dottedKey}" in ${configPath}`)
  }
  return value
}
