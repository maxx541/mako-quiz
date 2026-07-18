/**
 * 投影片的完整性檢查。
 *
 * 編輯器用它在每一頁旁邊標出問題；播放前也用同一份規則整份掃一次，
 * 免得上台才發現音樂題沒音檔。兩邊共用才不會有一邊漏檢查。
 */
export function slideProblems(s: any): string[] {
  const out: string[] = []
  if (!String(s.title || '').trim()) out.push('題目還沒有填寫')
  switch (s.type) {
    case 'soup':
      if (s.hints.filter((h: any) => h.text.trim()).length < 2) out.push('至少要有兩條提示')
      if (!s.accepted.some((a: string) => a.trim())) out.push('至少要填一個可接受的答案')
      break
    case 'reveal':
      if (!s.image) out.push('還沒有上傳要猜的圖片')
      if (s.options.filter((o: any) => o.text.trim()).length < 2) out.push('至少要有兩個選項有文字')
      if (!s.options.some((o: any) => o.correct)) out.push('還沒有標記正確答案')
      break
    case 'music':
      if (!s.audio) out.push('還沒有上傳音檔')
      if (s.options.filter((o: any) => o.text.trim() || o.image).length < 2) out.push('至少要有兩個選項有內容')
      if (!s.poll && !s.options.some((o: any) => o.correct)) out.push('還沒有標記正確答案')
      break
    case 'number':
      if (!Number.isFinite(Number(s.answer))) out.push('正確答案必須是數字')
      if (!(Number(s.tolerance) >= 0)) out.push('容許誤差必須是 0 或正數')
      break
    case 'scale':
      if (!(Number(s.max) > Number(s.min))) out.push('最大值要大於最小值')
      break
    case 'single':
    case 'truefalse':
    case 'multi': {
      // 有圖片的選項就算沒文字也算數
      const filled = s.options.filter((o: any) => o.text.trim() || o.image)
      if (filled.length < 2) out.push('至少要有兩個選項有內容')
      if (!s.poll) {
        const n = s.options.filter((o: any) => o.correct).length
        if (n === 0) out.push('還沒有標記正確答案（或把它切換成「投票」）')
        if (s.type !== 'multi' && n > 1) out.push('單選題只能有一個正確答案')
      }
      break
    }
    case 'match':
      // 一格只要有文字或有圖就算數 —— 純圖片的配對題（例：角色立繪 ↔ 名字）很常見
      if (
        s.pairs.filter((p: any) => (p.left.trim() || p.leftImage) && (p.right.trim() || p.rightImage)).length < 2
      ) {
        out.push('至少需要兩組完整的配對（每格要有文字或圖片）')
      }
      break
    case 'categorize': {
      if (s.categories.filter((c: any) => c.name.trim()).length < 2) out.push('至少需要兩個有名稱的分類')
      // 有文字或有圖都算填好了 —— 純圖片的分類題（例：把立繪分到所屬作品）很常見
      if (s.items.filter((i: any) => i.text.trim() || i.image).length < 2) out.push('至少需要兩個項目（要有文字或圖片）')
      if (s.items.some((i: any) => !s.categories.find((c: any) => c.id === i.categoryId))) out.push('有項目還沒選分類')
      // 空的分類玩起來很怪：畫面上有一欄永遠不會有東西
      const empty = s.categories.filter((c: any) => !s.items.some((i: any) => i.categoryId === c.id && i.text.trim()))
      if (empty.length) out.push(`「${empty.map((c: any) => c.name || '未命名').join('、')}」裡面沒有任何項目`)
      break
    }
    case 'order':
      // 有文字或有圖都算填好了 —— 純圖片的順序題（例：把 CG 依劇情排先後）很常見
      if (s.items.filter((i: any) => i.text.trim() || i.image).length < 2) out.push('至少需要兩個項目（要有文字或圖片）')
      break
    case 'type':
      if (!s.accepted.some((a: string) => a.trim())) out.push('至少要填一個可接受的答案')
      break
    case 'list':
      if (s.accepted.filter((a: string) => a.trim()).length < 2) out.push('複數答案至少要有兩個答案')
      break
  }
  return out
}

export type SlideIssue = { index: number; title: string; type: string; problems: string[] }

/** 整份簡報掃一遍，回傳有問題的頁 */
export function presentationProblems(pres: any): SlideIssue[] {
  return (pres?.slides || [])
    .map((s: any, i: number) => ({ index: i, title: s.title, type: s.type, problems: slideProblems(s) }))
    .filter((x: SlideIssue) => x.problems.length > 0)
}

/**
 * 播放前的確認：有缺漏就攔一下，但主持人堅持的話還是讓他播
 * （示範、彩排、或那一頁本來就不打算用，都不該被擋死）。
 *
 * @returns 要不要繼續播放
 */
export async function confirmPlay(pres: any): Promise<boolean> {
  const issues = presentationProblems(pres)
  if (!issues.length) return true

  const lines = issues
    .slice(0, 8)
    .map((x) => `第 ${x.index + 1} 頁「${x.title?.trim() || TYPE_META[x.type]?.label || '未命名'}」：${x.problems.join('、')}`)
  if (issues.length > 8) lines.push(`…另外還有 ${issues.length - 8} 頁有問題`)

  return confirmDialog({
    title: `有 ${issues.length} 頁還沒完成`,
    message: lines.join('\n') + '\n\n這些頁在活動中可能會開天窗。仍然要播放嗎？',
    okText: '仍然播放',
    cancelText: '回去修正',
    danger: true,
  })
}
