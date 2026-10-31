import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../shared/constants'
import { migrate } from './store'
import { ttsFingerprint } from './tts-config'

describe('SCHEMA 12 -> 13 -> 14 -> 15：朗读来源拆分与未知厂商默认音色', () => {
  it('provider=edge 的旧数据：enabled 含 edge，指纹按新算法重算且保持已试听', () => {
    const state = migrate({
      schemaVersion: 12,
      settings: {
        tts: {
          provider: 'edge',
          voice: 'zh-CN-YunxiNeural',
          openai: { baseUrl: '', model: '', voice: 'alloy', apiKey: '' },
        },
      },
    })
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(state.settings.tts.enabled).toEqual(['native', 'edge'])
    // 旧 priority 字段保留一版供旧客户端回读
    expect(state.settings.tts.priority).toEqual(['native', 'edge'])
    expect(state.settings.tts.verified.edge?.fingerprint).toBe(ttsFingerprint(state.settings.tts, 'edge'))
    expect(state.settings.tts.lastFailure).toBeNull()
  })

  it('provider=openai 的旧数据：配置一个不丢，openai 已试听，且写入每个孩子的 ttsPrefs', () => {
    const state = migrate({
      schemaVersion: 12,
      profiles: [{ id: 'kid1', name: '小明', avatar: '🦊', pinHash: 'x', createdAt: 1, points: 0, badges: [] }],
      settings: {
        tts: {
          provider: 'openai',
          voice: 'zh-CN-XiaoxiaoNeural',
          openai: {
            baseUrl: 'https://api.siliconflow.cn/v1',
            model: 'FunAudioLLM/CosyVoice2-0.5B',
            voice: 'anna',
            apiKey: 'sk-x',
          },
        },
      },
    })
    expect(state.settings.tts.enabled).toEqual(['native', 'openai'])
    expect(state.settings.tts.openai.apiKey).toBe('sk-x')
    expect(state.settings.tts.openai.model).toBe('FunAudioLLM/CosyVoice2-0.5B')
    expect(state.settings.tts.verified.openai?.fingerprint).toBe(ttsFingerprint(state.settings.tts, 'openai'))
    expect(state.settings.tts.verified.edge).toBeUndefined()
    const prefs = state.profiles[0].ttsPrefs
    expect(prefs?.order).toEqual(['native', 'openai'])
    expect(prefs?.voice.edge).toBe('zh-CN-XiaoxiaoNeural')
    expect(prefs?.voice.openai).toBe('anna')
  })

  it('更旧的数据（没有 tts 块）迁移后拿到默认启用集，且没有任何验证记录', () => {
    const state = migrate({ schemaVersion: 8 })
    expect(state.settings.tts.enabled).toEqual(['native', 'edge'])
    expect(state.settings.tts.verified).toEqual({})
    expect(state.settings.tts.lastFailure).toBeNull()
  })

  it('已经是 13 的数据：priority 复制为 enabled 与各孩子 order', () => {
    const state = migrate({
      schemaVersion: 13,
      profiles: [{ id: 'kid1', name: '小明', avatar: '🦊', pinHash: 'x', createdAt: 1, points: 0, badges: [] }],
      settings: { tts: { priority: ['openai', 'edge'], provider: 'openai' } },
    })
    expect(state.settings.tts.enabled).toEqual(['openai', 'edge'])
    expect(state.profiles[0].ttsPrefs?.order).toEqual(['openai', 'edge'])
  })

  it('已经是 14 的数据只做清洗：非法来源剔除、重复项合并', () => {
    const state = migrate({
      schemaVersion: 14,
      settings: { tts: { enabled: ['openai', 'bogus', 'edge', 'openai'] } },
    })
    expect(state.settings.tts.enabled).toEqual(['openai', 'edge'])
  })

  it('验证记录缺指纹时丢弃，避免「空指纹」被当成已验证', () => {
    const state = migrate({
      schemaVersion: 13,
      settings: { tts: { verified: { edge: { at: 1, fingerprint: '' } } } },
    })
    expect(state.settings.tts.verified).toEqual({})
  })

  it('13→14 按新指纹算法重算：改音色不影响验证（指纹不再绑音色）', () => {
    const state = migrate({
      schemaVersion: 13,
      settings: {
        tts: {
          priority: ['native', 'edge'],
          voice: 'zh-CN-YunxiNeural',
          // 旧指纹是「含 voice」算法算出来的，升级后必须换成新算法，否则全员被迫重新试听
          verified: { edge: { at: 1, fingerprint: 'legacy-old-algo' } },
        },
      },
    })
    expect(state.settings.tts.verified.edge?.fingerprint).toBe(ttsFingerprint(state.settings.tts, 'edge'))
    expect(state.settings.tts.verified.edge?.fingerprint).not.toBe('legacy-old-algo')
  })

  it('14→15：openai.defaultVoice 缺失补空串，已有值保留（未知厂商默认音色）', () => {
    const state = migrate({
      schemaVersion: 14,
      settings: {
        tts: {
          openai: {
            baseUrl: 'https://api.my-vendor.com/v1',
            model: 'my-tts',
            voice: 'alloy',
            apiKey: 'sk-x',
          },
        },
      },
    })
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    expect(state.settings.tts.openai.defaultVoice).toBe('')
    // 已有值透传
    const state2 = migrate({
      schemaVersion: 14,
      settings: { tts: { openai: { defaultVoice: 'my-voice-01', voice: 'alloy' } } },
    })
    expect(state2.settings.tts.openai.defaultVoice).toBe('my-voice-01')
  })
})
