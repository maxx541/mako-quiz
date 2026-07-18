/**
 * 圖片放大檢視。
 *
 * 解說圖在主持端只佔右側那一欄（最高 34vh）、手機端更小，
 * 遇到對照表、劇情截圖這種資訊量大的圖，在那個尺寸根本看不清楚，
 * 所以要能點開來看原始大小。
 */
const src = ref<string | null>(null)

export function useZoomState() {
  return src
}

export function openZoom(url: string) {
  src.value = url
}

export function closeZoom() {
  src.value = null
}
