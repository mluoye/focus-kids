/**
 * 错误提示映射工具
 * 将技术错误转换为小朋友能理解的友好提示
 */

interface ErrorMapping {
  /** 匹配的错误代码或状态码 */
  match: (code?: string, status?: number) => boolean
  /** 儿童友好提示 */
  kidMessage: string
  /** 家长友好提示（更具体） */
  parentMessage: string
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    match: (_code, status) => status === 0 || status === undefined,
    kidMessage: '网络小精灵睡着了，等一下再试试吧 🌙',
    parentMessage: '网络连接失败，请检查网络设置',
  },
  {
    match: (code) => code === 'OFFLINE',
    kidMessage: '现在离线啦，你的练习会保存好的，联网后会自动同步 📴',
    parentMessage: '当前处于离线模式，数据已保存在本地',
  },
  {
    match: (code) => code === 'INVALID_CREDENTIALS',
    kidMessage: 'PIN 码不对哦，再想想看 🔑',
    parentMessage: '账号或密码错误',
  },
  {
    match: (code) => code === 'INVALID_PIN',
    kidMessage: 'PIN 码不对哦，再想想看 🔑',
    parentMessage: 'PIN 码错误',
  },
  {
    match: (code) => code === 'WEAK_PASSWORD',
    kidMessage: '密码太简单啦，要长一点才行 🔒',
    parentMessage: '密码至少 6 位，且不能与当前密码相同',
  },
  {
    match: (code) => code === 'USERNAME_TAKEN',
    kidMessage: '这个名字已经被别的小朋友用啦，换一个吧 👶',
    parentMessage: '用户名已被占用',
  },
  {
    match: (code) => code === 'RATE_LIMITED',
    kidMessage: '点得太快啦，休息一下再试 🐢',
    parentMessage: '操作过于频繁，请稍后重试',
  },
  {
    match: (code) => code === 'TTS_NOT_ENABLED',
    kidMessage: '这个声音还没有被打开呢 🔇',
    parentMessage: '该朗读来源未启用',
  },
  {
    match: (code) => code === 'TTS_NOT_CONFIGURED',
    kidMessage: '声音小助手还没有准备好 🔧',
    parentMessage: '朗读服务未配置',
  },
  {
    match: (code) => code === 'AI_NOT_READY',
    kidMessage: 'AI 小老师还没有准备好，等一会儿再来 🤖',
    parentMessage: 'AI 功能未启用或未配置',
  },
  {
    match: (code) => code === 'TOO_MANY_ITEMS',
    kidMessage: '一次太多了，分批来吧 📚',
    parentMessage: '单次同步数据量超过限制',
  },
  {
    match: (code) => code === 'INVALID_JSON',
    kidMessage: '数据有点奇怪，刷新一下试试 🔄',
    parentMessage: '请求数据格式错误',
  },
  {
    match: (_code, status) => status === 401,
    kidMessage: '登录过期啦，重新登录一下 🔐',
    parentMessage: '会话已过期，请重新登录',
  },
  {
    match: (_code, status) => status === 403,
    kidMessage: '这个只有爸爸妈妈才能操作哦 👨‍👩‍👧',
    parentMessage: '权限不足，需要家长身份',
  },
  {
    match: (_code, status) => status === 404,
    kidMessage: '找不到这个东西啦 🤔',
    parentMessage: '资源不存在',
  },
  {
    match: (_code, status) => status === 429,
    kidMessage: '太快啦，等一分钟再试 ⏱️',
    parentMessage: '请求过于频繁',
  },
  {
    match: (_code, status) => status === 500 || status === 502 || status === 503,
    kidMessage: '服务器小休息了，等一下再试 😴',
    parentMessage: '服务器错误，请稍后重试',
  },
]

/**
 * 获取儿童友好的错误提示
 * @param code 错误代码
 * @param status HTTP 状态码
 * @returns 儿童友好提示
 */
export function getKidFriendlyError(code?: string, status?: number): string {
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.match(code, status)) {
      return mapping.kidMessage
    }
  }
  return '哎呀，出了个小问题，再试试吧 😅'
}

/**
 * 获取家长友好的错误提示（更具体）
 * @param code 错误代码
 * @param status HTTP 状态码
 * @param originalMessage 原始错误消息
 * @returns 家长友好提示
 */
export function getParentFriendlyError(code?: string, status?: number, originalMessage?: string): string {
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.match(code, status)) {
      return mapping.parentMessage
    }
  }
  return originalMessage ?? '操作失败，请重试'
}
