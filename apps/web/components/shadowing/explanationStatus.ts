import type { ShadowingGetVideo200SentencesItemExplanationStatus } from '@/lib/api/generated/schemas'

export const explanationStatusLabel: Readonly<
  Record<ShadowingGetVideo200SentencesItemExplanationStatus, string>
> = {
  pending: '生成中',
  regenerating: '重新生成中',
  ready: '已生成',
  failed: '生成失败'
}

export const explanationStatusBadgeVariant: Readonly<
  Record<ShadowingGetVideo200SentencesItemExplanationStatus, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  pending: 'secondary',
  regenerating: 'secondary',
  ready: 'outline',
  failed: 'destructive'
}
