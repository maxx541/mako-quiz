<script setup lang="ts">
/**
 * 全站唯一的說明。
 *
 * 之前每一頁都散著自己的小字提示（市集的來源、上架的注意事項、後台在幹嘛…），
 * 加起來很吵、又永遠講不完整。集中成一份，右上角一顆按鈕點開就好 ——
 * 想知道的人自己看，不想看的人不會被一堆灰字擋住。
 */
const open = ref(false)
const tab = ref('start')

const TABS = [
  ['start', '開始'],
  ['make', '出題'],
  ['play', '播放'],
  ['gallery', '題庫市集'],
  ['io', '匯入匯出'],
]

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <button class="btn btn-sm btn-ghost help-btn" title="說明" @click="open = true">
    <AppIcon name="info" :size="14" /> 說明
  </button>

  <Teleport to="body">
    <div v-if="open" class="help-mask" @mousedown.self="open = false">
      <div class="help-box" role="dialog" aria-label="說明">
        <header class="help-head">
          <img src="/icon.png" alt="" class="help-icon" />
          <h2>Makoquiz 說明</h2>
          <div class="spacer" />
          <button class="btn btn-sm" @click="open = false">關閉</button>
        </header>

        <nav class="help-tabs">
          <button v-for="[k, l] in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
        </nav>

        <div class="help-body">
          <!-- ---------------- 開始 ---------------- -->
          <template v-if="tab === 'start'">
            <h3>這是什麼</h3>
            <p>
              主持人在大螢幕出題，參與者用手機掃 QR Code 加入搶答，答對越快分數越高。
              參與者<b>不用註冊</b>，填個暱稱就能玩。
            </p>

            <h3>怎麼開起來</h3>
            <p>雙擊資料夾裡的 <code>啟動.bat</code>。它會自己建置、開一條對外通道、啟動伺服器並打開後台。</p>
            <ul>
              <li><b>對外網址每次啟動都不一樣</b>，所以不能事先發給參加者 —— 開起來之後再公布，或直接讓他們掃 QR</li>
              <li>只想在同一個 wifi 裡玩：<code>啟動.bat -NoTunnel</code></li>
              <li>換埠號：<code>啟動.bat -Port 3100</code></li>
            </ul>

            <h3>三個畫面</h3>
            <ul>
              <li><b>後台</b>（這裡）—— 管理你的簡報</li>
              <li><b>大螢幕</b> —— 按「播放」開啟，投影出去給大家看</li>
              <li><b>手機</b> —— 參與者掃 QR 進來的地方</li>
            </ul>
          </template>

          <!-- ---------------- 出題 ---------------- -->
          <template v-else-if="tab === 'make'">
            <h3>建立簡報</h3>
            <p>後台右上角 <b>新增簡報</b> → 取個名字 → 進編輯器。左邊是投影片列表、中間出題、右邊設定。</p>
            <ul>
              <li><b>會自動存</b>，右上角顯示「已儲存」就是存好了</li>
              <li>左欄的投影片可以<b>直接拖曳排順序</b></li>
              <li>標「<b>待完成</b>」= 這一頁還缺東西（沒填題目、沒標正解、音樂題沒音檔…）</li>
            </ul>

            <h3>讓 AI 幫你出題（最快）</h3>
            <p>
              後台 → <b>匯入題目</b> → <b>複製出題指南</b> → 貼給 ChatGPT / Claude，
              再說一句「幫我出 15 題 Galgame 主題」，把它給的 JSON 貼回匯入框就好。
            </p>

            <h3>圖片與音樂</h3>
            <ul>
              <li>可以<b>上傳</b>（單張圖 5 MB、單一音檔 15 MB），也可以<b>貼網址</b></li>
              <li>貼網址的檔案在<b>別人的伺服器</b>上，對方哪天砍掉你的題目就開天窗 —— 正式活動建議上傳</li>
              <li>但<b>音樂題貼網址很划算</b>：上架市集時整包上限 50 MB，幾首 MP3 就吃掉一大半，網址不佔額度</li>
              <li>要貼<b>檔案本身</b>的連結（<code>.png</code>、<code>.mp3</code> 那種），不是 YouTube 那種網頁網址</li>
              <li>
                <b>配對題</b>左右兩欄、<b>順序題</b>與<b>分類題</b>的每個項目也都可以放圖，
                而且可以<b>只放圖不放字</b>（例如左邊立繪配右邊角色名、把 CG 依劇情先後排、把立繪分到所屬作品）。
                圖一律完整顯示不裁切；項目多的時候會自動縮小、大螢幕自動排成兩欄
              </li>
            </ul>

            <h3>編排的兩個小技巧</h3>
            <ul>
              <li><b>上下鍵</b>可以直接切換上一張／下一張投影片（正在打字時不會被搶走）</li>
              <li>投影片縮圖可以<b>拖曳</b>調整前後順序</li>
              <li>選項左邊的<b>握把</b>可以拖曳換順序 —— 正確答案的標記會跟著那個選項一起走，不用重標</li>
            </ul>

            <h3>封面</h3>
            <p>
              在 <b>整份簡報 → 封面</b> 指定。列表、題庫市集、還有<b>大廳等人的時候</b>都是用這一張。
              沒指定的話自動抓<b>第一張有配圖的題目</b>（不會拿解說圖，那常常直接畫著答案）。
            </p>

            <h3>背景音樂（兩種，各播各的）</h3>
            <p>都在 <b>整份簡報</b> 裡設定，也<b>都只在主持人的大螢幕播</b>，網址不會下發到手機。</p>
            <ul>
              <li><b>大廳音樂</b> —— 等人加入時，主持人按播放鍵才會響；開始出題就自動收掉</li>
              <li>
                <b>作答音樂</b> —— 開始出題後整場循環的背景音樂。走到<b>音樂題會自動讓路</b>
                （不會兩首一起響），離開那頁再自己接回去；頒獎畫面也會停
              </li>
              <li>作答音樂可以調<b>音量</b>，建議 30–40%，太大聲會蓋掉主持人講話</li>
              <li>播放中隨時可以按大螢幕下方控制列的音符鍵關掉；關掉後換頁也不會又響起來</li>
            </ul>

            <h3>解說</h3>
            <p>
              每題可以附一段解說（文字＋圖），<b>只在公布答案後才出現</b>，作答期間不會傳到手機 ——
              可以放心把答案寫在裡面。
            </p>

            <h3>猜圖題</h3>
            <p>
              上傳一張 CG，大螢幕會分階段慢慢揭開，越早猜中分數越高。格子模式可以自己排
              <b>每一階段要揭開哪幾塊</b>（想先露眼睛、最後才露臉就這樣排）。圖只在大螢幕，手機拿不到。
            </p>
          </template>

          <!-- ---------------- 播放 ---------------- -->
          <template v-else-if="tab === 'play'">
            <h3>開始之前</h3>
            <p>
              編輯器右上角 <b>預覽</b> 可以先開一場假的，左邊大螢幕、右邊手機，直接按下去試。
              按 <b>播放</b> 時會先掃一遍有沒有缺漏，有的話會列出來問你要不要繼續。
            </p>

            <h3>大螢幕的操作</h3>
            <table class="kv">
              <tr><td><code>空白</code> / <code>→</code></td><td>下一步（開始 → 公布答案 → 排行榜 → 下一題）</td></tr>
              <tr><td><code>←</code></td><td>上一步</td></tr>
              <tr><td><code>F</code></td><td>全螢幕</td></tr>
              <tr><td><code>Q</code></td><td>提問面板</td></tr>
              <tr><td>下方小圓點</td><td>跳到任一題</td></tr>
            </table>

            <h3>按鈕音效</h3>
            <p>
              控制列的按鈕可以有音效。音檔放在專案的 <code>data/sounds/</code> 資料夾，檔名固定：
              <code>advance</code>（主要按鈕）、<code>reveal</code>（公布答案）、<code>back</code>（上一步）、
              <code>stage</code>（下一階段）、<code>addtime</code>、<code>leaderboard</code>，
              副檔名 mp3 / ogg / wav / m4a / flac 都可以。
            </p>
            <ul>
              <li><b>放進去、重新整理就生效</b>，不用重新 build 也不用重開伺服器</li>
              <li><b>沒放的檔案就是沒聲音</b> —— 不想要某顆按鈕出聲，把檔案刪掉即可</li>
              <li>資料夾裡有一份 <code>讀我.txt</code> 寫著完整對照表</li>
            </ul>

            <h3>參與者怎麼加入</h3>
            <p>掃大螢幕的 QR，或開對外網址、輸入 6 位數房號。大廳可以<b>上傳頭像</b>（開打之後就不給換）。答題中 QR 會縮在右上角，晚到的人隨時掃得進來。</p>

            <h3>什麼時候會公布答案</h3>
            <ul>
              <li><b>全員答完就自動公布</b>，不用等你按</li>
              <li><b>海龜湯與猜圖題例外</b> —— 那兩種是分階段的，「都答了」不等於「都答完了」，要你按</li>
              <li><b>時間到只會鎖定作答，不會自動公布</b> —— 留給你講評的空間，`+15 秒` 可以加時重開</li>
            </ul>

            <h3>結束</h3>
            <p>右上角 <b>結束</b> → 最終排名（逐名揭曉，點畫面可跳過）→ 可以<b>下載排行榜圖片</b>（直式 JPG，適合丟群組）。</p>
          </template>

          <!-- ---------------- 市集 ---------------- -->
          <template v-else-if="tab === 'gallery'">
            <h3>題庫市集是什麼</h3>
            <p>大家共用的題庫區。逛別人做的、下載回來變成自己的、也可以把自己的上架分享。</p>

            <h3>下載</h3>
            <p>
              按 <b>下載到我的簡報</b> 就會變成你的簡報並跳進編輯器，之後<b>隨你改</b>。
              圖片音樂都會一起下載並存成你自己的檔案 —— 下載完就跟市集沒關係了，斷網也能照常辦活動。
            </p>

            <h3>上架</h3>
            <p>右上角 <b>上架我的題庫</b> → 填製作者名稱 → 挑一份簡報。整包（含圖片與音樂）上限 <b>50 MB</b>。</p>

            <h3>想拿掉自己上架的東西？</h3>
            <p>跟市集管理員說一聲。<b>刪除一律由管理員處理</b>。</p>

            <h3>檢舉</h3>
            <p>卡片右下角的驚嘆號。累積三次會自動隱藏，等管理員來看。</p>

            <h3>市集後台（管理員）</h3>
            <p>
              可以列出全部（含被隱藏的）、看檢舉理由、隱藏／放回、刪除。
              <b>只有設定了雲端管理金鑰的那台電腦</b>看得到這顆按鈕 ——
              主持人密碼是每個人自己設的，不能拿來當管理員憑證。
            </p>

            <h3>沒有連雲端的話</h3>
            <p>市集會退回<b>本機模式</b>，只有你自己上架的東西，其他功能一切正常。頁面上會標「來源：本機」。</p>
          </template>

          <!-- ---------------- 匯入匯出 ---------------- -->
          <template v-else>
            <h3>匯出</h3>
            <p>簡報卡片上的下載鈕。有圖片或音樂就打包成 <code>.zip</code>，沒有就給乾淨的 <code>.json</code>。</p>
            <p class="tip">
              為什麼要打包：上傳的檔案存成隨機檔名，那個名字<b>只在你這台機器有意義</b>。
              單獨把 JSON 寄給別人，對方打開會是一片空白。zip 裡的 JSON 會改用
              <code>assets/q02-題目.png</code> 這種邏輯名稱，換一台機器也還原得回來。
            </p>

            <h3>匯入</h3>
            <p>後台 → <b>匯入題目</b>。三種都吃，貼上或拖進去當下就會告訴你有幾題、缺什麼：</p>
            <ul>
              <li><b>整包 .zip</b> —— 連圖片音樂一起還原</li>
              <li><b>JSON ＋ 圖片</b> —— 貼上 JSON，再把圖一起拖進來，<b>依檔名對應</b></li>
              <li><b>純文字 JSON</b> —— 沒有素材的直接貼</li>
            </ul>
            <p>缺的 id、重複的 id、分類題的對應，匯入時都會自動修好（AI 產的 JSON 幾乎都沒有 id）。</p>

            <h3>搬到另一台電腦</h3>
            <p>匯出成 zip → 在新機器匯入。或是上架到市集，再從那台下載。</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.help-mask {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(15, 23, 42, 0.6);
  display: grid;
  place-items: center;
  padding: 20px;
}

.help-box {
  background: var(--card, #fff);
  color: var(--ink);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-3);
  width: 100%;
  max-width: 660px;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.help-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  flex: none;
}

.help-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  object-fit: cover;
}

.help-head h2 {
  font-size: 16px;
  font-weight: 800;
}

.spacer {
  flex: 1;
}

.help-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  flex: none;
  flex-wrap: wrap;
}

.help-tabs button {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  padding: 7px 12px;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.help-tabs button.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.help-body {
  padding: 6px 22px 22px;
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.75;
}

.help-body h3 {
  font-size: 14px;
  font-weight: 800;
  margin: 18px 0 4px;
}

.help-body h3:first-child {
  margin-top: 10px;
}

.help-body p {
  color: var(--ink-3, #475569);
  margin-bottom: 4px;
}

.help-body ul {
  margin: 2px 0 4px;
  padding-left: 18px;
  color: var(--ink-3, #475569);
}

.help-body li {
  margin: 2px 0;
}

.help-body code {
  background: var(--line-2, #f1f5f9);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.help-body b {
  color: var(--ink);
}

/* 「為什麼要這樣」的補充，跟操作步驟區隔開 */
.tip {
  background: var(--line-2, #f1f5f9);
  border-radius: var(--r);
  padding: 10px 12px;
  font-size: 12.5px;
  margin-top: 6px;
}

.kv {
  border-collapse: collapse;
  margin: 4px 0;
}

.kv td {
  padding: 3px 14px 3px 0;
  color: var(--ink-3, #475569);
  vertical-align: top;
}

.kv td:first-child {
  white-space: nowrap;
}
</style>
