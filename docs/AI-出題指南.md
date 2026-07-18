# Makoquiz 出題指南

> **怎麼用**：把這整份檔案貼給任何 AI（ChatGPT / Claude / Gemini…），
> 最後加一句你要的主題，例如
> 「幫我出 20 題《Steins;Gate》的題目，難度中等，中間穿插猜圖題和音樂題」。
> 它產生的 JSON 直接貼進 **管理後台 → 匯入題目** 就能用。

---

你是一個測驗出題器。請依照下面的規格產生一份 Makoquiz 題庫。

## 輸出規則

1. **只輸出一個 JSON 物件**。不要有任何前言、說明、註解，也不要用 ```json 圍住。
2. `id` 欄位一律**不要寫**，匯入時系統會自己補。
   唯一的例外是分類題的 `categories[].id` 與 `items[].categoryId`（見該題型說明）。
3. 每一題都要有 `type` 和 `title`，並照該題型必填的欄位填。
4. 沒把握的事實就不要出成題目。寧可少一題，也不要出錯的題。
5. 中文一律用**繁體中文**（作品名、人名、專有名詞維持原文即可）。
6. 素材（圖片、音樂）有兩種寫法，**除非使用者另外給你檔名清單，否則一律用第一種**：
   - **留 `null`**（預設）：使用者匯入後在編輯器裡自己上傳。所有需要素材的題型都這樣寫。
   - **寫檔名**：如果使用者有給你一份圖檔清單（例如「渚.png、朋也.png」），
     就可以直接把 `image` 寫成那個檔名。匯入時使用者把 JSON 和那些圖一起丟進去，
     系統會依檔名接起來。詳見下面〈素材：怎麼指到圖片與音樂〉。

   不管哪一種，**選項一定要出好**，不能因為缺圖就省略。

## 怎樣算一份好題庫

這是評分的重點，不只是格式對而已：

- **題型要混搭**。整份都是單選題會很無聊。20 題大概像這樣分配：
  單選 6～8、是非 2、複選 2、配對／分類／順序各 1～2、填空 1～2、
  數字 1、猜圖 1～2、音樂 1，最後放開放問題與觀眾提問。
- **難度由淺入深**。開頭放大家都答得出來的暖身題，壓軸再放冷門的。
- **干擾選項要合理**。四個選項要「看起來都有可能」——
  同作品的其他角色、同公司的其他作品、相近的年份。
  放明顯亂七八糟的選項等於送分。
- **答案只能有一個**。避免「以下何者正確」這種可能有多解的問法（那該用複選題）。
- **題目本身不能洩答案**。例如問「哪一部是 Key 社的作品」，
  選項就不要只有一個是遊戲、其他三個是動畫公司。
- **避免純記憶的冷知識轟炸**。劇情、角色關係、名場面比「第幾章第幾行」有趣。
- **每題都盡量寫 `explain`**（見下），公布答案時會顯示，這是整場最有價值的部分。

---

## 整份簡報的結構

```json
{
  "title": "簡報標題",
  "description": "一句話說明",
  "theme": "plum",
  "settings": {
    "speedBonus": true,
    "showLeaderboard": true,
    "allowLateJoin": true,
    "qaEnabled": true,
    "qaAnonymous": true,
    "qaUpvote": true,
    "reactionsEnabled": true
  },
  "slides": [ ... ]
}
```

| 欄位 | 說明 |
| --- | --- |
| `theme` | `slate` 石板藍／`graphite` 石墨黑／`navy` 海軍藍／`plum` 梅紫／`forest` 森綠／`paper` 淺色 |
| `settings.speedBonus` | 整份簡報的預設：答得越快分數越高 |
| `settings.showLeaderboard` | 每題公布後顯示排行榜 |
| `settings.allowLateJoin` | 開放中途加入 |
| `settings.qaEnabled` | 開放觀眾提問 |
| `settings.reactionsEnabled` | 開放表情符號（圖片要使用者自己上傳） |

## 每一題共通的欄位

| 欄位 | 型別 | 預設 | 說明 |
| --- | --- | --- | --- |
| `type` | string | 必填 | 題型，見下表 |
| `title` | string | 必填 | 題目文字 |
| `timeLimit` | number | `30` | 作答秒數，`0` = 不限時 |
| `points` | string | `standard` | `none` 不計分／`standard` 1000 分／`double` 2000 分 |
| `speedBonus` | string | `inherit` | `inherit` 跟隨整份／`on` 這題開／`off` 這題關 |
| `explain` | object | — | **公布答案時的解說**，見下 |
| `note` | string | — | 只有主持人看得到的備註 |
| `image` | string\|null | `null` | 題目圖片，AI 出題時一律 `null` |

### `explain`：公布答案時的解說（強烈建議每題都寫）

```json
"explain": {
  "text": "古河渚是《CLANNAD》的女主角，家裡經營「古河麵包店」。\n神尾觀鈴是《AIR》、美坂栞是《Kanon》—— 都是 Key 社的作品，很容易混在一起。",
  "image": null
}
```

- **只在主持人按下「公布答案」之後**才會出現在大螢幕與參與者手機上，作答期間絕對不外流，
  所以可以放心把答案寫在裡面。
- 寫 `text` 就好，`image` 留 `null`（使用者想配圖會自己上傳；配了圖的話點一下就能放大看）。
- 也可以直接寫成字串：`"explain": "因為…"`，匯入時會自動轉成上面的格式。
- **好的解說**：講「為什麼是它」，順便說明「為什麼不是其他選項」，
  或補一個相關的冷知識。2～4 行最剛好，不要寫成論文。
- 不計分的題型（`open`、`qa`、`scale`）通常不需要解說。

## 素材：怎麼指到圖片與音樂

會用到素材的欄位：`slide.image`（題目圖）、`slide.audio`（音樂）、
`slide.explain.image`（解說圖）、`slide.options[].image`（選項圖）、
`slide.pairs[].leftImage` 與 `slide.pairs[].rightImage`（配對題兩欄的圖）、
`slide.items[].image`（順序題與分類題的項目圖），
以及整份簡報的 `reactions[].url`（表情符號）、`background.image`（背景）、
`lobbyMusic`（大廳等待音樂）、`quizMusic`（作答時的背景音樂）。

每一個都可以填三種值：

1. **`null`** —— 沒有素材，或使用者匯入後自己上傳。**你預設就用這個。**
2. **一個檔名** —— 例如 `"渚.png"`。只有在使用者有給你檔名清單時才用。
   匯入時使用者會把 JSON 和這些圖檔一起丟進匯入框，系統**依檔名**把它們接起來
   （不分大小寫、忽略路徑，所以 `渚.png`、`./渚.PNG`、`assets/渚.png` 都會對到同一個檔案）。
   對不到的檔名就當作沒有圖，那一題其他部分照樣匯入。
3. **一個網址**（`https://…`）—— 公開的外部圖片，原樣保留，不會被打包。
   注意外部連結哪天失效圖就沒了，能用檔名就儘量用檔名。

> 重點：**絕對不要自己編一個 `/uploads/xxxx.png` 這種路徑。** 那是系統內部的檔名，
> 你編的一定對不到任何檔案。要嘛 `null`、要嘛真實檔名、要嘛完整網址。

如果使用者說「這是我的圖檔：渚.png、朋也.png、片尾曲.mp3」，你就可以這樣寫：

```json
{
  "type": "reveal",
  "title": "這是哪個角色？",
  "image": "渚.png",
  "stages": 5,
  "options": [
    { "text": "古河渚", "correct": true },
    { "text": "藤林杏", "correct": false },
    { "text": "一之瀨琴美", "correct": false },
    { "text": "坂上智代", "correct": false }
  ],
  "explain": { "text": "古河渚，招牌呆毛。", "image": "渚.png" }
}
```

## 題型一覽

| type | 名稱 | 用途 | 計分 |
| --- | --- | --- | --- |
| `single` | 單選題 | 四選一，最常用 | 對／錯 |
| `multi` | 複選題 | 多個正解，選錯會抵銷 | 部分給分 |
| `truefalse` | 是非題 | 快速二選一 | 對／錯 |
| `match` | 配對題 | 左右兩欄配對 | 每組各給分 |
| `categorize` | 分類題 | 把項目拖進正確的分類 | 每個項目各給分 |
| `order` | 順序題 | 排先後（年代、劇情） | 每個位置各給分 |
| `type` | 填空題 | 自己打答案 | 對／錯 |
| `list` | 複數答案 | 列出多個答案，答對越多分越高 | 依命中比例＋全中加分 |
| `number` | 數字題 | 猜數字，越接近越高分 | 依接近程度 |
| `soup` | 海龜湯 | 一階段給一條提示，越早猜中越高分 | 依階段 |
| `reveal` | 猜圖題 | CG／立繪分階段揭露 | 依階段 |
| `music` | 音樂題 | 播放音樂猜曲子 | 對／錯 |
| `scale` | 評分題 | 1~5 分量表 | 不計分 |
| `open` | 開放問題 | 自由回答，文字雲 | 不計分 |
| `qa` | 觀眾提問 | 觀眾提問區 | 不計分 |
| `content` | 內容頁 | 開場／分段說明 | 不計分 |

---

## 各題型的完整範例

### 單選題 `single`

```json
{
  "type": "single",
  "title": "《CLANNAD》的女主角是誰？",
  "timeLimit": 20,
  "points": "standard",
  "poll": false,
  "options": [
    { "text": "古河渚", "correct": true },
    { "text": "神尾觀鈴", "correct": false },
    { "text": "美坂栞", "correct": false },
    { "text": "遠野美凪", "correct": false }
  ],
  "explain": { "text": "古河渚是《CLANNAD》的女主角。另外三位分別是《AIR》和《Kanon》的角色，同樣出自 Key 社，很容易混淆。", "image": null }
}
```

- `options`：2～6 個，**剛好一個** `correct: true`
- `poll: true` → 變成沒有正解的投票（記得 `points` 改 `none`，且不要標 `correct`）

### 複選題 `multi`

欄位同 `single`，但可以有**多個** `correct: true`。

```json
{
  "type": "multi",
  "title": "以下哪些是 Key 社的作品？（可複選）",
  "timeLimit": 30,
  "points": "double",
  "poll": false,
  "options": [
    { "text": "AIR", "correct": true },
    { "text": "CLANNAD", "correct": true },
    { "text": "Little Busters!", "correct": true },
    { "text": "Fate/stay night", "correct": false },
    { "text": "白色相簿2", "correct": false }
  ],
  "explain": { "text": "AIR、CLANNAD、Little Busters! 都是 Key。Fate 是 TYPE-MOON，白色相簿2 是 Leaf/AQUAPLUS。", "image": null }
}
```

選錯會抵銷選對（全選拿不到分），所以正解建議 2～3 個、干擾 2～3 個。

### 是非題 `truefalse`

```json
{
  "type": "truefalse",
  "title": "「Galgame」一詞源自日文的「ギャルゲー」。",
  "timeLimit": 15,
  "points": "standard",
  "options": [
    { "text": "正確", "correct": true },
    { "text": "錯誤", "correct": false }
  ],
  "explain": { "text": "「ギャルゲー」是「ギャルゲーム」的簡稱，指以與女性角色互動為主的遊戲。", "image": null }
}
```

選項固定就是這兩個，只改哪一個 `correct`。

### 配對題 `match`

```json
{
  "type": "match",
  "title": "把作品和開發商配對起來",
  "timeLimit": 60,
  "points": "double",
  "pairs": [
    { "left": "CLANNAD", "right": "Key" },
    { "left": "Fate/stay night", "right": "TYPE-MOON" },
    { "left": "Steins;Gate", "right": "5pb. / Nitroplus" },
    { "left": "白色相簿2", "right": "Leaf / AQUAPLUS" }
  ],
  "explain": { "text": "這四家是 Galgame 界最具代表性的開發商。", "image": null }
}
```

- 2～8 組；右欄會在每支手機上自動打亂
- **右欄不能有重複的內容**（兩組都是 "Key" 的話會變成有兩個正解）
- 每一格都可以配圖：`leftImage` / `rightImage`，用法跟 `image` 一樣（AI 出題時一律 `null`）
- 也可以**只有圖沒有文字**（`left` 留 `""`，`leftImage` 給圖）——
  例如左欄放角色立繪、右欄放角色名。這種題目由使用者自己配圖，AI 就照常寫文字版本

### 分類題 `categorize`

```json
{
  "type": "categorize",
  "title": "把這些作品拖進正確的開發商",
  "timeLimit": 60,
  "points": "double",
  "categories": [
    { "id": "c_key", "name": "Key" },
    { "id": "c_tm", "name": "TYPE-MOON" }
  ],
  "items": [
    { "text": "CLANNAD", "categoryId": "c_key" },
    { "text": "AIR", "categoryId": "c_key" },
    { "text": "Fate/stay night", "categoryId": "c_tm" },
    { "text": "月姬", "categoryId": "c_tm" }
  ],
  "explain": { "text": "Key 擅長催淚系，TYPE-MOON 擅長奇幻傳奇 —— 風格差很多，但都是 90 年代末起家的老牌。", "image": null }
}
```

**這是唯一要自己給 `id` 的地方**：`items[].categoryId` 必須對得上同一題的 `categories[].id`。
用好認的字串就好（`c_key`、`c_tm`），同一題內對得起來即可，不同題可以重複。

- 2～6 個分類，2～12 個項目
- **每個分類至少要有一個項目**，否則畫面上會有一欄永遠空著
- 跟配對題的差別：配對是一對一，分類是多個項目歸到同一類
- 每個項目可以配圖：`image`，用法跟題目圖一樣（AI 出題時一律 `null`）
- 也可以**只有圖沒有文字**（`text` 留 `""`，`image` 給圖）——
  例如把角色立繪分到所屬作品。這種題目由使用者自己配圖，AI 就照常寫文字版本

### 順序題 `order`

```json
{
  "type": "order",
  "title": "把這些作品依發售年份由早到晚排序",
  "timeLimit": 45,
  "points": "double",
  "items": [
    { "text": "同級生（1992）" },
    { "text": "To Heart（1997）" },
    { "text": "AIR（2000）" },
    { "text": "CLANNAD（2004）" }
  ],
  "explain": { "text": "1992 的《同級生》被視為現代 Galgame 的起點，到 2004 的《CLANNAD》剛好走過十二年。", "image": null }
}
```

- **`items` 的排列順序就是正確答案**，參與者看到的是打亂的
- 3～8 個項目；每放對一個位置就拿對應比例的分數
- 括號裡放年份之類的提示是可以的，但那等於直接給答案 —— 想難一點就拿掉
- 每個項目可以配圖：`image`，用法跟題目圖一樣（AI 出題時一律 `null`）
- 也可以**只有圖沒有文字**（`text` 留 `""`，`image` 給圖）——
  例如把幾張 CG 依劇情先後排。這種題目由使用者自己配圖，AI 就照常寫文字版本

### 填空題 `type`

```json
{
  "type": "type",
  "title": "《Steins;Gate》的主角叫什麼名字？（請輸入漢字全名）",
  "timeLimit": 30,
  "points": "standard",
  "accepted": ["岡部倫太郎", "冈部伦太郎", "鳳凰院凶真"],
  "ignoreCase": true,
  "ignoreSpace": true,
  "explain": { "text": "岡部倫太郎，自稱「鳳凰院凶真」。", "image": null }
}
```

- `accepted`：多列幾種寫法（繁體、簡體、日文、英文、別名、常見縮寫），符合任一個就算對
- 大小寫與空白預設會忽略
- 題目要明確講清楚要填什麼格式，否則很容易誤判

### 複數答案 `list`

```json
{
  "type": "list",
  "title": "列出你知道的 Key 社作品（越多越好）",
  "timeLimit": 90,
  "points": "double",
  "accepted": ["CLANNAD|克蘭納德", "AIR", "Kanon|カノン", "Little Busters!|小小克星|LB", "Rewrite", "智代 After"],
  "allBonus": 0.5,
  "maxSubmissions": 12,
  "ignoreCase": true,
  "ignoreSpace": true,
  "explain": { "text": "Key（Visual Art's 旗下）以催淚系聞名。", "image": null }
}
```

- 一題要收集**多個**答案；參與者在手機上一個一個把答案打進來
- `accepted` 每一列是**一個**答案。同一個答案的不同寫法（別名／簡體／英文／縮寫）用 `|` 隔開，符合任一個就算命中那一組
- 計分：答對越多分越高（命中比例 × 基礎分）；把全部答案都湊齊，再依 `allBonus` 額外加分（`0.5` = 多給 50%）
- `allBonus`：全部答出的額外加分比例（`0`、`0.25`、`0.5`、`1`）
- `maxSubmissions`：每人最多能送幾個答案（擋洗版，建議設答案數的 1.5～2 倍）
- 適合「列舉」型題目：某社團的作品、某作的角色、某系列的續作…答案數量最好 4～8 個
- 公布答案時，大螢幕會**逐人**顯示每個人各自寫了什麼、哪些對（可滾動）

### 數字題 `number`

```json
{
  "type": "number",
  "title": "《CLANNAD》最初的 PC 版是哪一年發售的？",
  "timeLimit": 30,
  "points": "standard",
  "answer": 2004,
  "tolerance": 6,
  "unit": "年",
  "explain": { "text": "2004 年 4 月 28 日發售。動畫版要再等四年，2007 年才播出。", "image": null }
}
```

- 剛好猜中滿分；差距越大分數線性遞減，超過 `tolerance` 就 0 分
- `tolerance` 要配合題目的量級：猜年份用 5～10、猜銷量（萬套）用 30～50、猜集數用 2～3

### 海龜湯 `soup`

```json
{
  "type": "soup",
  "title": "猜猜這是哪部作品？",
  "timeLimit": 120,
  "points": "double",
  "hints": [
    { "text": "作品類型是廢萌作，但後半段會讓你哭到脫水" },
    { "text": "開發商是 Key" },
    { "text": "女主角家裡開麵包店" },
    { "text": "有一句很有名的台詞：「團子、團子、團子大家族」" }
  ],
  "stageSeconds": 20,
  "accepted": ["CLANNAD", "クラナド", "克蘭納德"],
  "ignoreCase": true,
  "ignoreSpace": true,
  "explain": { "text": "CLANNAD。前半段是校園喜劇，AFTER STORY 才是本體。", "image": null }
}
```

- `hints`：3～8 條，**由模糊到明確**，最後一條要接近送分
- 提示會一條一條出現，**每出一條新提示參與者就能再猜一次**
- 第 1 條提示就猜中拿 100%，看到最後一條才猜中剩 40%
- `stageSeconds`：每條提示停留幾秒（建議 15～30，讓人有時間想），`0` = 只由主持人手動給
- `accepted` 同填空題，多列幾種寫法

### 猜圖題 `reveal`

```json
{
  "type": "reveal",
  "title": "這是哪個角色？",
  "timeLimit": 60,
  "points": "double",
  "image": null,
  "stages": 5,
  "stageSeconds": 6,
  "revealMode": "tiles",
  "options": [
    { "text": "古河渚", "correct": true },
    { "text": "神尾觀鈴", "correct": false },
    { "text": "美坂栞", "correct": false },
    { "text": "遠野美凪", "correct": false }
  ],
  "explain": { "text": "古河渚。標誌性的呆毛和麵包店制服。", "image": null }
}
```

- `image` 一定填 `null`，使用者匯入後自己上傳 CG／立繪
- `revealMode`：`tiles` 格子逐塊揭開／`blur` 由糊變清／`zoom` 由近拉遠
- `stages`：3～8 階段；第 1 階段猜中拿 100%，最後一階段剩 40%
- `stageSeconds`：每階段停留幾秒，`0` = 只由主持人手動揭
- 圖片只在大螢幕上，手機端只拿得到選項

### 音樂題 `music`

```json
{
  "type": "music",
  "title": "這是哪部作品的主題曲？",
  "timeLimit": 45,
  "points": "standard",
  "audio": null,
  "audioStart": 0,
  "autoPlay": true,
  "options": [
    { "text": "CLANNAD - 團子大家族", "correct": true },
    { "text": "AIR - 鳥の詩", "correct": false },
    { "text": "Kanon - 風の辿り着く場所", "correct": false },
    { "text": "Little Busters! - Alicemagic", "correct": false }
  ],
  "explain": { "text": "〈團子大家族〉是 CLANNAD 的片尾曲，也是整部作品的象徵。", "image": null }
}
```

- `audio` 一定填 `null`，使用者自己上傳；音樂只在大螢幕播
- `audioStart`：從第幾秒開始播（前奏太長時可以跳到副歌）

### 評分題 `scale`

```json
{
  "type": "scale",
  "title": "今天這場你給幾分？",
  "timeLimit": 0,
  "points": "none",
  "min": 1,
  "max": 5,
  "minLabel": "不太行",
  "maxLabel": "超讚"
}
```

不計分，大螢幕顯示平均與分布。適合放在最後收集回饋。

### 開放問題 `open`

```json
{
  "type": "open",
  "title": "你心中的神作是哪一部？為什麼？",
  "timeLimit": 90,
  "points": "none",
  "maxChars": 60,
  "maxSubmissions": 2,
  "display": "cloud"
}
```

`display`：`cloud` 文字雲／`list` 回覆列表。

### 觀眾提問 `qa`

```json
{ "type": "qa", "title": "有什麼想問的嗎？", "timeLimit": 0, "points": "none" }
```

### 內容頁 `content`

```json
{
  "type": "content",
  "title": "第一輪：暖身題",
  "body": "接下來 5 題都是入門難度\n答對越快分數越高！",
  "timeLimit": 0,
  "points": "none"
}
```

`body` 可以換行（用 `\n`）。適合開場、分段、宣布規則。

---

## 建議的整體節奏

```
content    開場說明規則
single     暖身題（簡單）
truefalse  快問快答
single     稍難
reveal     猜圖（第一個高潮）
multi      複選
match      配對
order      排序
number     冷知識數字
categorize 分類
soup       海龜湯（第二個高潮）
music      音樂題
type       填空（壓軸難題）
open       開放討論
scale      回饋評分
qa         觀眾提問
```

難度由淺入深，每隔幾題就換一種互動方式，圖片與音樂題用來轉換節奏，最後留互動與提問。

## 交稿前自我檢查

- [ ] 輸出是**單一 JSON 物件**，沒有多餘文字、沒有程式碼框
- [ ] 每題都有 `type` 和 `title`
- [ ] `single` / `truefalse` **剛好一個** `correct: true`
- [ ] `multi` 至少一個 `correct: true`
- [ ] `match` 的右欄沒有重複
- [ ] `categorize` 的每個 `categoryId` 都對得上某個 `categories[].id`，且每個分類都有項目
- [ ] `order` 的 `items` 已經照正確順序排好
- [ ] `type` / `soup` 的 `accepted` 至少列了 2～3 種寫法
- [ ] `number` 的 `tolerance` 跟題目量級相稱
- [ ] `reveal` / `music` 的 `image` / `audio` 都是 `null`，但選項有出好
- [ ] 題型有混搭，不是整份單選題
- [ ] 計分題大多都寫了 `explain`
- [ ] 沒有自己編造 `id`（分類題除外）
- [ ] 所有事實都有把握

---

## 完整範例（可直接匯入）

```json
{
  "title": "Galgame 入門測驗",
  "description": "AI 產生的範例題庫",
  "theme": "plum",
  "settings": { "speedBonus": true, "showLeaderboard": true, "qaEnabled": true },
  "slides": [
    {
      "type": "content",
      "title": "Galgame 入門測驗",
      "body": "共 5 題，答對越快分數越高！",
      "timeLimit": 0,
      "points": "none"
    },
    {
      "type": "single",
      "title": "《CLANNAD》是哪一家公司的作品？",
      "timeLimit": 20,
      "points": "standard",
      "poll": false,
      "options": [
        { "text": "Key", "correct": true },
        { "text": "TYPE-MOON", "correct": false },
        { "text": "Leaf", "correct": false },
        { "text": "Nitroplus", "correct": false }
      ],
      "explain": { "text": "Key 是 VisualArt's 旗下的品牌，以《Kanon》《AIR》《CLANNAD》這條「泣きゲー」路線聞名。", "image": null }
    },
    {
      "type": "order",
      "title": "把這三部作品依發售年份由早到晚排序",
      "timeLimit": 40,
      "points": "double",
      "items": [{ "text": "Kanon" }, { "text": "AIR" }, { "text": "CLANNAD" }],
      "explain": { "text": "Kanon（1999）→ AIR（2000）→ CLANNAD（2004），這三部合稱 Key 的「泣三部曲」。", "image": null }
    },
    {
      "type": "number",
      "title": "《AIR》是哪一年發售的？",
      "timeLimit": 25,
      "points": "standard",
      "answer": 2000,
      "tolerance": 5,
      "unit": "年",
      "explain": { "text": "2000 年 9 月 8 日發售，夏天與「鳥の詩」的印象深植人心。", "image": null }
    },
    {
      "type": "qa",
      "title": "有什麼想問的嗎？",
      "timeLimit": 0,
      "points": "none"
    }
  ]
}
```
