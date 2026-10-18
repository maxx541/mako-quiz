import type { Aggregate } from '#shared/types/quiz'

const CHOICE_SLIDE_TYPES = ['single', 'multi', 'truefalse', 'reveal', 'music'] as const

export function isChoiceSlide<T extends { type: string }>(
  s: T | null | undefined,
): s is Extract<T, { type: (typeof CHOICE_SLIDE_TYPES)[number] }> {
  return !!s && (CHOICE_SLIDE_TYPES as readonly string[]).includes(s.type)
}

export function aggregateKind<K extends Aggregate['kind']>(
  r: Aggregate | null | undefined,
  kind: K,
): Extract<Aggregate, { kind: K }> | null {
  if (r?.kind === kind) return r as Extract<Aggregate, { kind: K }>
  return null
}
