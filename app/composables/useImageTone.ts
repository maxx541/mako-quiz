/**
 * 分析一張背景圖，算出「要壓多暗、要糊多少」才不會蓋掉題目。
 *
 * 判斷依據有兩個：
 *  - 亮度：越亮的圖，白字越看不清楚 → 遮罩要更濃
 *  - 忙碌程度：細節越多（相鄰像素差異大）→ 要更糊，讓背景退到後面
 *
 * 純前端用 canvas 取樣，不需要伺服器裝影像處理套件。
 */
export type Tone = { luminance: number; busyness: number; dim: number; blur: number }

export async function analyzeImage(url: string): Promise<Tone> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()

  // 縮到小尺寸取樣就夠了，快很多
  const W = 64
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W)) || 64
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)

  const lum: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 709 相對亮度
    lum.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255)
  }

  const luminance = lum.reduce((a, b) => a + b, 0) / lum.length

  // 忙碌程度：跟右邊、下面的鄰居差多少
  let diff = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (x + 1 < W) {
        diff += Math.abs(lum[i] - lum[i + 1])
        n++
      }
      if (y + 1 < H) {
        diff += Math.abs(lum[i] - lum[i + W])
        n++
      }
    }
  }
  const busyness = n ? diff / n : 0

  // 亮圖要壓更暗；忙碌的圖也要壓一點，不然文字邊緣會被雜訊吃掉
  const dim = Math.round(Math.min(85, Math.max(35, 30 + luminance * 55 + busyness * 60)))
  // 細節越多糊越多
  const blur = Math.round(Math.min(16, Math.max(2, 2 + busyness * 90)))

  return { luminance, busyness, dim, blur }
}
