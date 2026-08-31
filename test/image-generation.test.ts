import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OpenAICompatibleImageGenerator } from '../src/narrator'
import { characterAppearanceFromProfile, narrativeImageAttachable, normalizeNarrativeImageGeneration } from '../src/service'

const imageConfig = {
  enabled: true,
  mode: 'openai-images' as const,
  endpoint: 'https://images.example.com/v1/images/generations',
  apiKey: 'independent-image-key',
  model: 'image-model-a',
  size: '1024x1024',
  quality: 'standard',
  timeout: 12_000,
  maxPromptCharacters: 200,
  extraHeaders: '{"x-image-route":"independent"}',
  extraBody: '{"style":"natural"}',
  characterReference: { enabled: true, source: 'https://cdn.example.com/character.jpg\nhttps://cdn.example.com/character-body.jpg', model: 'qwen-image-edit' },
}

test('image generation uses its own endpoint, key, model and payload', async () => {
  const calls: any[] = []
  const generator = new OpenAICompatibleImageGenerator({
    http: {
      post: async (...args: any[]) => {
        calls.push(args)
        return { data: [{ url: 'https://cdn.example.com/image.png', revised_prompt: 'a refined prompt' }] }
      },
    },
  } as any, imageConfig)

  const image = await generator.generate('a rainy convenience store at night')
  assert.deepEqual(image, { url: 'https://cdn.example.com/image.png', revisedPrompt: 'a refined prompt' })
  assert.equal(calls[0][0], imageConfig.endpoint)
  assert.equal(calls[0][1].model, imageConfig.model)
  assert.equal(calls[0][1].style, 'natural')
  assert.equal(calls[0][2].headers.authorization, 'Bearer independent-image-key')
  assert.equal(calls[0][2].headers['x-image-route'], 'independent')
})

test('DashScope Qwen Image uses its native multimodal request and response shape', async () => {
  const calls: any[] = []
  const generator = new OpenAICompatibleImageGenerator({
    http: {
      post: async (...args: any[]) => {
        calls.push(args)
        return { output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.example.com/image.png' }] } }] } }
      },
    },
  } as any, {
    ...imageConfig,
    mode: 'dashscope-qwen-image' as const,
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    model: 'qwen-image-3.0',
    extraBody: '{"parameters":{"prompt_extend":true}}',
  })

  assert.deepEqual(await generator.generate('a rainy convenience store at night'), { url: 'https://dashscope-result.example.com/image.png' })
  assert.equal(calls[0][1].input.messages[0].content[0].text, 'a rainy convenience store at night')
  assert.equal(calls[0][1].parameters.size, '1024*1024')
  assert.equal(calls[0][1].parameters.n, 1)
  assert.equal(calls[0][1].parameters.prompt_extend, true)
})

test('DashScope character reference uses the edit model and image input only when requested', async () => {
  const calls: any[] = []
  const generator = new OpenAICompatibleImageGenerator({
    http: { post: async (...args: any[]) => {
      calls.push(args)
      return { output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.example.com/portrait.png' }] } }] } }
    } },
  } as any, { ...imageConfig, mode: 'dashscope-qwen-image' as const, model: 'qwen-image-3.0' })
  await generator.generate('在办公室的自然抓拍。', { subject: 'protagonist', characterAppearance: '黑色短发，身材修长，轮廓分明。' })
  assert.equal(calls[0][1].model, 'qwen-image-edit')
  assert.equal(calls[0][1].input.messages[0].content[0].image, 'https://cdn.example.com/character.jpg')
  assert.equal(calls[0][1].input.messages[0].content[1].image, 'https://cdn.example.com/character-body.jpg')
  assert.match(calls[0][1].input.messages[0].content[2].text, /图1是主角唯一的人物身份基准/)
  assert.match(calls[0][1].input.messages[0].content[2].text, /图2仅补充同一主角/)
  assert.match(calls[0][1].input.messages[0].content[2].text, /黑色短发，身材修长/)
})

test('DashScope skips protagonist references for other people and non-person images', async () => {
  const calls: any[] = []
  const generator = new OpenAICompatibleImageGenerator({
    http: { post: async (...args: any[]) => {
      calls.push(args)
      return { output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.example.com/plain.png' }] } }] } }
    } },
  } as any, { ...imageConfig, mode: 'dashscope-qwen-image' as const, model: 'qwen-image-3.0' })

  await generator.generate('主角的朋友站在车站。', { subject: 'other-person' })
  await generator.generate('窗外的雨夜街道。', { subject: 'non-person' })

  for (const call of calls) {
    assert.equal(call[1].model, 'qwen-image-3.0')
    assert.deepEqual(call[1].input.messages[0].content, [{ text: call[1].input.messages[0].content[0].text }])
  }
})

test('portrait traits are sourced from the canonical character-profile appearance section', () => {
  const profile = '年龄：47岁\n职业：工程咨询\n\n二、外貌与身体特征\n黑色短发，肩背宽阔，体型结实。\n\n三、日常习惯\n早起。'
  assert.match(characterAppearanceFromProfile(profile), /黑色短发，肩背宽阔/)
  assert.doesNotMatch(characterAppearanceFromProfile(profile), /年龄：47岁/)
})

test('image generation rejects unsafe provider result URLs', async () => {
  const generator = new OpenAICompatibleImageGenerator({
    http: { post: async () => ({ data: [{ url: 'http://127.0.0.1/private.png' }] }) },
  } as any, imageConfig)
  await assert.rejects(generator.generate('test'), /没有返回可投递的图片/)
})

test('narrative image delivery accepts only one bounded structured prompt', () => {
  assert.deepEqual(normalizeNarrativeImageGeneration({ prompt: '年会现场的自然抓拍，暖色室内灯光。', subject: 'non-person' }), {
    prompt: '年会现场的自然抓拍，暖色室内灯光。', subject: 'non-person',
  })
  assert.equal(normalizeNarrativeImageGeneration({ prompt: '   ' }), undefined)
  assert.equal(normalizeNarrativeImageGeneration('生成图片'), undefined)
  assert.equal(normalizeNarrativeImageGeneration({ prompt: '主角在办公室。' }), undefined)
  assert.equal(normalizeNarrativeImageGeneration({ prompt: '主角在办公室。', subject: 'unknown' }), undefined)
  assert.deepEqual(normalizeNarrativeImageGeneration({ prompt: '主角在办公室。', subject: 'protagonist' }), {
    prompt: '主角在办公室。', subject: 'protagonist',
  })
  assert.deepEqual(normalizeNarrativeImageGeneration({ prompt: '主角的朋友在办公室。', subject: 'other-person' }), {
    prompt: '主角的朋友在办公室。', subject: 'other-person',
  })
})

test('DashScope character reference reads semicolon-separated quoted local paths into data URIs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hdsi-reference-'))
  try {
    const facePath = join(directory, 'face.png')
    const bodyPath = join(directory, 'body.png')
    writeFileSync(facePath, Buffer.from('face-pixels'))
    writeFileSync(bodyPath, Buffer.from('body-pixels'))
    const calls: any[] = []
    const generator = new OpenAICompatibleImageGenerator({
      http: { post: async (...args: any[]) => {
        calls.push(args)
        return { output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.example.com/portrait.png' }] } }] } }
      } },
    } as any, {
      ...imageConfig,
      mode: 'dashscope-qwen-image' as const,
      model: 'qwen-image-3.0',
      characterReference: { enabled: true, source: `"${facePath}";'${bodyPath}'`, model: 'qwen-image-edit' },
    })
    await generator.generate('在办公室的自然抓拍。', { subject: 'protagonist' })
    const content = calls[0][1].input.messages[0].content
    assert.equal(content[0].image, `data:image/png;base64,${Buffer.from('face-pixels').toString('base64')}`)
    assert.equal(content[1].image, `data:image/png;base64,${Buffer.from('body-pixels').toString('base64')}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('narrative images attach only to messages that will actually be delivered', () => {
  const immediateReply = { seen: true, reply: { mode: 'immediate' as const, content: '图来了。' } }
  const silentReply = { seen: true, reply: { mode: 'none' as const } }
  assert.equal(narrativeImageAttachable(true, immediateReply, []), true)
  assert.equal(narrativeImageAttachable(true, silentReply, []), false)
  assert.equal(narrativeImageAttachable(true, undefined, [{ mode: 'immediate' }]), true)
  assert.equal(narrativeImageAttachable(true, undefined, [{ mode: 'delayed' }]), false)
  assert.equal(narrativeImageAttachable(true, undefined, []), false)
  assert.equal(narrativeImageAttachable(false, immediateReply, [{ mode: 'immediate' }]), false)
})

test('character reference read failures name the offending local path', async () => {
  const generator = new OpenAICompatibleImageGenerator({
    http: { post: async () => ({}) },
  } as any, {
    ...imageConfig,
    mode: 'dashscope-qwen-image' as const,
    model: 'qwen-image-3.0',
    characterReference: { enabled: true, source: 'C:/definitely-missing/face.png', model: 'qwen-image-edit' },
  })
  await assert.rejects(generator.generate('测试。', { subject: 'protagonist' }), /无法读取角色参考图：C:\/definitely-missing\/face\.png/)
})
