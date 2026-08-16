import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, type Config } from '../../src/config.js'

function writeConfig(dir: string, yamlText: string): string {
  const configPath = path.join(dir, 'config.yaml')
  fs.writeFileSync(configPath, yamlText)
  return configPath
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectMissingRequiredKeyError(action: () => void, dottedKey: string, configPath: string): void {
  expect(action).toThrowError(new RegExp(`${escapeForRegExp(dottedKey)}.*${escapeForRegExp(configPath)}`))
}

function assertDefaultsApplied(config: Config): void {
  expect(config.port).toBe(8790)
  expect(config.systemPrompt).toBe('You are Nestor, a personal assistant.')
}

function withEnvVar(name: string, value: string, action: () => void): void {
  const original = process.env[name]
  process.env[name] = value
  try {
    action()
  } finally {
    if (original === undefined) delete process.env[name]
    else process.env[name] = original
  }
}

const completeConfigYaml = `
port: 9000
auth_token: "secret-token"
system_prompt: "You are a pirate."
aqueduct:
  base_url: https://aqueduct.example.com
  api_key: "aqueduct-key"
  model: qwen-3.6-35b
`

const expectedCompleteConfig: Config = {
  port: 9000,
  authToken: 'secret-token',
  systemPrompt: 'You are a pirate.',
  aqueduct: {
    baseUrl: 'https://aqueduct.example.com',
    apiKey: 'aqueduct-key',
    model: 'qwen-3.6-35b',
  },
}

const configYamlWithoutPortOrPrompt = `
auth_token: "secret-token"
aqueduct:
  base_url: https://aqueduct.example.com
  api_key: "aqueduct-key"
  model: qwen-3.6-35b
`

const configYamlWithEmptyAuthToken = `
auth_token: ""
aqueduct:
  base_url: https://aqueduct.example.com
  api_key: "aqueduct-key"
  model: qwen-3.6-35b
`

describe('loadConfig', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestor-config-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads a complete config file with snake_case keys mapped to the typed shape', () => {
    const configPath = writeConfig(tempDir, completeConfigYaml)

    const config = loadConfig(configPath)

    expect(config).toEqual(expectedCompleteConfig)
  })

  it('falls back to the default port and system prompt when they are omitted', () => {
    const configPath = writeConfig(tempDir, configYamlWithoutPortOrPrompt)

    const config = loadConfig(configPath)

    assertDefaultsApplied(config)
  })

  it.each([
    {
      dottedKey: 'auth_token',
      yamlText: `
aqueduct:
  base_url: https://aqueduct.example.com
  api_key: "aqueduct-key"
  model: qwen-3.6-35b
`,
    },
    {
      dottedKey: 'aqueduct.base_url',
      yamlText: `
auth_token: "secret-token"
aqueduct:
  api_key: "aqueduct-key"
  model: qwen-3.6-35b
`,
    },
    {
      dottedKey: 'aqueduct.api_key',
      yamlText: `
auth_token: "secret-token"
aqueduct:
  base_url: https://aqueduct.example.com
  model: qwen-3.6-35b
`,
    },
    {
      dottedKey: 'aqueduct.model',
      yamlText: `
auth_token: "secret-token"
aqueduct:
  base_url: https://aqueduct.example.com
  api_key: "aqueduct-key"
`,
    },
  ])('a missing $dottedKey is reported with its dotted path and the config file path', ({ dottedKey, yamlText }) => {
    const configPath = writeConfig(tempDir, yamlText)

    expectMissingRequiredKeyError(() => loadConfig(configPath), dottedKey, configPath)
  })

  it('an empty required value is treated the same as a missing one', () => {
    const configPath = writeConfig(tempDir, configYamlWithEmptyAuthToken)

    expectMissingRequiredKeyError(() => loadConfig(configPath), 'auth_token', configPath)
  })

  it('reads the path from NESTOR_CONFIG when no argument is given', () => {
    const configPath = writeConfig(tempDir, completeConfigYaml)

    withEnvVar('NESTOR_CONFIG', configPath, () => {
      expect(loadConfig()).toEqual(expectedCompleteConfig)
    })
  })
})
