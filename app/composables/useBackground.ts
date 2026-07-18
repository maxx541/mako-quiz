/**
 * 把簡報的背景設定換算成可以直接綁在畫面上的樣式。
 * 主持人大螢幕與參與者手機共用，手機再多壓一點暗（小螢幕字更需要對比）。
 */
export function backgroundLayers(bg: any, opts: { extraDim?: number } = {}) {
  if (!bg?.image) return null
  const dim = Math.min(92, Math.max(0, Number(bg.dim ?? 55) + (opts.extraDim || 0)))
  const blur = Math.max(0, Number(bg.blur ?? 6))
  return {
    image: { backgroundImage: `url("${bg.image}")`, filter: blur ? `blur(${blur}px)` : 'none' },
    scrim: { background: `rgba(3, 7, 18, ${dim / 100})` },
  }
}
