/**
 * 家长奖励系统
 * 家长设置奖励目标和条件，孩子完成后领取
 * 使用 localStorage 存储（简单版本，不涉及数据模型变更）
 */

export interface Reward {
  id: string
  /** 奖励名称 */
  name: string
  /** 奖励描述 */
  description: string
  /** 奖励图标 */
  emoji: string
  /** 达成条件类型 */
  conditionType: 'training_count' | 'streak_days' | 'points' | 'manual'
  /** 达成条件数值 */
  conditionValue: number
  /** 是否已领取 */
  claimed: boolean
  /** 创建时间 */
  createdAt: number
  /** 领取时间 */
  claimedAt?: number
}

const REWARDS_KEY = 'fk.rewards'

/** 加载奖励列表 */
export function loadRewards(profileId: string): Reward[] {
  try {
    const key = `${REWARDS_KEY}.${profileId}`
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Reward[]) : []
  } catch {
    return []
  }
}

/** 保存奖励列表 */
export function saveRewards(profileId: string, rewards: Reward[]): void {
  try {
    const key = `${REWARDS_KEY}.${profileId}`
    localStorage.setItem(key, JSON.stringify(rewards))
  } catch {
    /* 忽略 */
  }
}

/** 添加奖励 */
export function addReward(profileId: string, reward: Omit<Reward, 'id' | 'claimed' | 'createdAt'>): Reward {
  const rewards = loadRewards(profileId)
  const newReward: Reward = {
    ...reward,
    id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    claimed: false,
    createdAt: Date.now(),
  }
  rewards.push(newReward)
  saveRewards(profileId, rewards)
  return newReward
}

/** 删除奖励 */
export function deleteReward(profileId: string, rewardId: string): void {
  const rewards = loadRewards(profileId).filter((r) => r.id !== rewardId)
  saveRewards(profileId, rewards)
}

/** 领取奖励 */
export function claimReward(profileId: string, rewardId: string): void {
  const rewards = loadRewards(profileId)
  const reward = rewards.find((r) => r.id === rewardId)
  if (reward && !reward.claimed) {
    reward.claimed = true
    reward.claimedAt = Date.now()
    saveRewards(profileId, rewards)
  }
}

/**
 * 检查奖励是否达成
 * @param reward 奖励
 * @param currentValue 当前值（训练次数/连续天数/积分）
 */
export function isRewardAchieved(reward: Reward, currentValue: number): boolean {
  return currentValue >= reward.conditionValue
}

/** 获取未领取的达成奖励 */
export function getUnclaimedAchievedRewards(
  profileId: string,
  currentValue: number,
): Reward[] {
  return loadRewards(profileId).filter(
    (r) => !r.claimed && isRewardAchieved(r, currentValue),
  )
}
