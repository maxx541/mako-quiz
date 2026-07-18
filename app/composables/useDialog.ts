/**
 * 取代瀏覽器原生的 prompt() / confirm()。
 *
 * 原生對話框在 Edge / Chrome 是可以被使用者或政策關掉的（「不要再顯示對話框」、
 * 部分擴充功能、iframe sandbox），一旦被擋，prompt() 直接回傳 null，
 * 按鈕看起來就像壞掉一樣完全沒反應。自己畫就不會有這個問題，也才能做中文與樣式。
 */
export type DialogSpec = {
  title: string
  message?: string
  kind?: 'confirm' | 'prompt'
  danger?: boolean
  okText?: string
  cancelText?: string
  placeholder?: string
  defaultValue?: string
}

type Pending = DialogSpec & { id: number; resolve: (v: string | boolean | null) => void }

const current = ref<Pending | null>(null)
let seq = 0

export function useDialogState() {
  return current
}

/** 回傳 true / false */
export function confirmDialog(spec: Omit<DialogSpec, 'kind'>): Promise<boolean> {
  return new Promise((resolve) => {
    current.value = { ...spec, kind: 'confirm', id: ++seq, resolve: (v) => resolve(v === true) }
  })
}

/** 回傳輸入的字串，取消則回 null */
export function promptDialog(spec: Omit<DialogSpec, 'kind'>): Promise<string | null> {
  return new Promise((resolve) => {
    current.value = { ...spec, kind: 'prompt', id: ++seq, resolve: (v) => resolve(typeof v === 'string' ? v : null) }
  })
}

export function closeDialog(value: string | boolean | null) {
  const d = current.value
  current.value = null
  d?.resolve(value)
}
