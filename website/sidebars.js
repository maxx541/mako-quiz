// @ts-check
// 文件側邊欄。手動編排，讓分類與順序符合閱讀動線。

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    {
      type: 'category',
      label: '入門',
      collapsed: false,
      items: ['intro', 'getting-started', 'hosting-an-event'],
    },
    {
      type: 'category',
      label: '功能',
      collapsed: false,
      items: ['question-types', 'ai-authoring', 'features', 'gallery'],
    },
    {
      type: 'category',
      label: '部署與進階',
      collapsed: false,
      items: ['configuration', 'supabase', 'architecture', 'testing'],
    },
  ],
};

export default sidebars;
