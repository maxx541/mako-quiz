import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: '掃碼即玩，零安裝',
    description: (
      <>
        觀眾不用下載 App、不用註冊，掃 QR Code 填個暱稱就開始搶答。
        主持人只要一台能開網頁的電腦與投影幕。
      </>
    ),
  },
  {
    title: '15 種題型',
    description: (
      <>
        單選、複選、是非、配對、分類拖曳、順序、填空、數字、海龜湯、
        猜圖、音樂、評分、開放問題、觀眾提問、內容頁 —— 圖片與音檔都能放。
      </>
    ),
  },
  {
    title: '讓 AI 幫你出題',
    description: (
      <>
        一鍵複製出題指南貼給 ChatGPT / Claude，說一句主題，
        把它產生的 JSON 貼回匯入框就是一份完整題庫（含解說）。
      </>
    ),
  },
  {
    title: '題庫市集',
    description: (
      <>
        逛別人做的題庫、下載回來變成自己的、把自己的上架分享。
        可接 Supabase 雲端與朋友共用，不設定就是本機市集。
      </>
    ),
  },
  {
    title: '一鍵啟動（Windows）',
    description: (
      <>
        雙擊 <code>啟動.bat</code>，自動安裝、建置、開一條 cloudflared
        對外通道並產生指向它的 QR Code，開瀏覽器就能辦活動。
      </>
    ),
  },
  {
    title: '防作弊設計',
    description: (
      <>
        送到手機的題目不含正解、圖片與音檔不下發、所有批改在伺服器端完成，
        分數等主持人公布答案後才入帳。
      </>
    ),
  },
];

function Feature({title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
