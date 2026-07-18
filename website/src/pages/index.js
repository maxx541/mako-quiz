import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import HomepageFeatures from '@site/src/components/HomepageFeatures';
import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          Makoquiz
        </Heading>
        <p className={styles.heroSubtitle}>即時搶答互動簡報平台</p>
        <p className={styles.heroTagline}>
          主持人在大螢幕出題，觀眾用手機掃 QR Code 加入作答，答對越快分數越高，
          並可即時提問。內建 15 種題型、題庫市集，還能讓 AI 幫你出題。
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            快速開始 →
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            style={{color: '#fff', borderColor: '#fff'}}
            href="https://github.com/maxx541/mako-quiz">
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

const SHOTS = [
  ['03-host-lobby.png', '大廳等待', '房號 + QR，掃描即加入'],
  ['05-player-answering.png', '手機作答', '不用註冊，填暱稱就進來'],
  ['06-reveal.png', '公布答案', '即時長條圖動畫'],
  ['07-leaderboard.png', '排行榜', '答對越快分數越高'],
  ['10-podium.png', '頒獎台', '金銀銅逐名揭曉'],
  ['09-reactions.png', '表情符號', '匿名浮出、自動淡出'],
  ['08-word-cloud.png', '文字雲', '開放問題即時彙整'],
  ['11-categorize.png', '分類題', '手指拖曳，觸控也能玩'],
  ['12-gallery.png', '題庫市集', '下載、上架、共用題庫'],
];

function Showcase() {
  const heroShot = useBaseUrl('/img/screenshots/04-host-question.png');
  return (
    <section className={styles.showcase}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          畫面一覽
        </Heading>
        <img
          className={styles.showcaseHero}
          src={heroShot}
          alt="主持人大螢幕出題"
        />
        <div className={styles.grid}>
          {SHOTS.map(([file, title, desc]) => (
            <div className={styles.card} key={file}>
              <img
                src={useBaseUrl(`/img/screenshots/${file}`)}
                alt={title}
                loading="lazy"
              />
              <p>
                <b>{title}</b>：{desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Makoquiz — 即時搶答互動簡報平台。主持人出題，觀眾掃 QR 用手機搶答，內建 15 種題型與題庫市集。">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <Showcase />
      </main>
    </Layout>
  );
}
