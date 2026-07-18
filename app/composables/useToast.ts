export type Toast = { id: number; text: string; kind: '' | 'ok' | 'bad' }

const items = ref<Toast[]>([])
let seq = 0

export function useToasts() {
  return items
}

export function toast(text: string, kind: Toast['kind'] = '') {
  const id = ++seq
  items.value.push({ id, text, kind })
  setTimeout(() => {
    items.value = items.value.filter((t) => t.id !== id)
  }, 2800)
}
