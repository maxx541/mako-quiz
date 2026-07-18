# Makoquiz 文件站

這是 Makoquiz 的說明文件網站，使用 [Docusaurus](https://docusaurus.io/) 建置，
透過 GitHub Actions 自動部署到 GitHub Pages：

> **https://maxx541.github.io/mako-quiz/**

## 本機開發

```bash
cd website
npm install
npm start          # 開發伺服器，改檔即時更新
```

## 建置

```bash
npm run build      # 產生靜態檔到 website/build/
npm run serve      # 在本機預覽 build 出來的結果
```

## 部署

不用手動部署。推送到 `main` 分支且變動涉及 `website/**` 時，
`.github/workflows/deploy-docs.yml` 會自動建置並部署到 GitHub Pages。
也可以在 GitHub 的 Actions 分頁手動觸發（workflow_dispatch）。

## 內容結構

- `docs/` —— 文件內容（Markdown），順序在 `sidebars.js` 定義
- `src/pages/index.js` —— 首頁（hero + 特色 + 截圖牆）
- `src/components/HomepageFeatures/` —— 首頁特色區塊
- `static/img/screenshots/` —— 文件與首頁用的截圖
- `docusaurus.config.js` —— 站台設定（網址、導覽列、頁尾、語言）
