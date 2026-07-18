---
title: 安裝與啟動
description: 第一次使用、Windows 一鍵啟動、跨平台啟動與常用參數。
---

# 安裝與啟動

## 需求

**Node.js 22.12 以上**（Nuxt 4 的需求；[nodejs.org](https://nodejs.org) 下載 LTS 版，一路下一步）。

## 第一次使用

裝好 Node.js 後，在專案資料夾開一次終端機：

```bash
npm install
```

之後就再也不用碰終端機了（Windows 使用者）。

## Windows：一鍵啟動

**雙擊 `啟動.bat`。** 它會自己做完這些事：

1. 檢查相依套件（第一次會自動 `npm install`）
2. 原始碼有改過才重新建置（沒改就跳過，幾秒就開好）
3. 開一條 cloudflared 臨時通道，拿到一個對外網址（**第一次會自動下載 cloudflared，約 50 MB，只下載這一次**）
4. 帶著那個網址啟動伺服器（QR code 才會指向它）
5. 自動開瀏覽器到後台

畫面會長這樣：

```text
==> 建置產物是最新的，跳過 build
==> 建立 cloudflared 暫時通道
==> 啟動伺服器

  Makoquiz 已啟動
  後台   http://localhost:3000/admin
  對外   https://bit-funky-alto-grams.trycloudflare.com
         QR code 會自動指向這個網址
```

:::warning 臨時通道的網址每次啟動都不一樣
所以不能事先把網址發給參加者 —— 開起來之後再公布，或直接讓他們掃 QR。
:::

常用參數（在 `啟動.bat` 後面加）：

| 參數 | 作用 |
| --- | --- |
| `-Port 3100` | 換埠號，預設 3000 |
| `-NoTunnel` | 不開通道，QR 只指向區網 IP（同一個 wifi 才連得到） |
| `-Rebuild` | 強制重新建置 |
| `-NoOpen` | 不要自動開瀏覽器 |

## 跨平台：一般啟動（給開發用）

```bash
npm run dev          # 開發模式（含 HMR）
npm run build && npm start
```

| 入口 | 網址 |
| --- | --- |
| 參與者 | `http://localhost:3000/` |
| 管理後台 | `http://localhost:3000/admin` |
| 題庫市集 | `http://localhost:3000/gallery` |
| 手機（同網段） | 用啟動時顯示的區網 IP；QR Code 會自動指向它 |

後台預設密碼 `admin123`，用環境變數修改：

```powershell
$env:NUXT_HOST_PASSWORD="你的密碼"; $env:PORT="3000"; npm run dev
```

:::tip
第一次啟動會自動建立一份涵蓋全部題型的示範簡報。所有環境變數見[環境變數](./configuration)。
:::
