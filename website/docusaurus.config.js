// @ts-check
// Docusaurus 設定檔。此檔在 Node.js 執行，請勿使用瀏覽器 API 或 JSX。
// 參考：https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

const organizationName = 'maxx541';
const projectName = 'mako-quiz';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Makoquiz',
  tagline: '即時搶答互動簡報平台 — 主持人出題，觀眾掃 QR 用手機搶答',
  favicon: 'img/favicon.png',

  future: {
    v4: true, // 提升與未來 Docusaurus v4 的相容性
  },

  // GitHub Pages 網址：https://maxx541.github.io/mako-quiz/
  url: `https://${organizationName}.github.io`,
  baseUrl: `/${projectName}/`,

  organizationName, // GitHub 帳號
  projectName, // repo 名稱
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // 全站語言：繁體中文
  i18n: {
    defaultLocale: 'zh-Hant',
    locales: ['zh-Hant'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: `https://github.com/${organizationName}/${projectName}/tree/main/website/`,
        },
        // 這是純文件站，不需要部落格
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          lastmod: 'date',
          changefreq: 'weekly',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/screenshots/04-host-question.png',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Makoquiz',
        logo: {
          alt: 'Makoquiz Logo',
          src: 'img/logo.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: '文件',
          },
          {
            href: `https://github.com/${organizationName}/${projectName}`,
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: '文件',
            items: [
              {label: '快速開始', to: '/docs/intro'},
              {label: '辦一場活動', to: '/docs/hosting-an-event'},
              {label: '題型', to: '/docs/question-types'},
              {label: '讓 AI 幫你出題', to: '/docs/ai-authoring'},
            ],
          },
          {
            title: '進階',
            items: [
              {label: '題庫市集', to: '/docs/gallery'},
              {label: '接上 Supabase', to: '/docs/supabase'},
              {label: '環境變數', to: '/docs/configuration'},
              {label: '架構', to: '/docs/architecture'},
            ],
          },
          {
            title: '專案',
            items: [
              {
                label: 'GitHub',
                href: `https://github.com/${organizationName}/${projectName}`,
              },
              {
                label: '問題回報',
                href: `https://github.com/${organizationName}/${projectName}/issues`,
              },
              {
                label: '授權 (Apache-2.0)',
                href: `https://github.com/${organizationName}/${projectName}/blob/main/LICENSE`,
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Makoquiz. 以 Apache-2.0 授權，使用 Docusaurus 建置。`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'powershell', 'json', 'sql'],
      },
    }),
};

export default config;
