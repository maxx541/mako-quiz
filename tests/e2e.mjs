/**
 * 端對端測試：模擬一位主持人 + 兩位參與者跑完整場活動，
 * 驗證每種題型的批改、計分、排行榜與觀眾提問。
 *
 * 用法：先啟動伺服器，再執行
 *   node tests/e2e.mjs            （預設連 http://localhost:3123）
 *   BASE=http://localhost:3000 node tests/e2e.mjs
 */
import { io } from 'socket.io-client';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const BASE = process.env.BASE || 'http://localhost:3123';
const PASSWORD = process.env.HOST_PASSWORD || 'admin123';

let pass = 0;
let fail = 0;

const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log('   \x1b[32m✓\x1b[0m ' + label);
  } else {
    fail++;
    console.log('   \x1b[31m✗ ' + label + '\x1b[0m');
  }
};
const step = (s) => console.log('\n\x1b[36m▸ ' + s + '\x1b[0m');

/* ---------- HTTP ---------- */

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}`);
  return data;
}

/* ---------- Socket ---------- */

const emit = (sock, ev, payload) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ack timeout: ' + ev)), 8000);
    sock.emit(ev, payload, (res) => {
      clearTimeout(t);
      if (res?.error) reject(new Error(ev + ': ' + res.error));
      else resolve(res);
    });
  });

const connect = () =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

/** 建立一個會追蹤最新 view、可以等待特定狀態的觀察器 */
function tracker(sock, event) {
  const state = { view: null, waiters: [] };
  sock.on(event, (v) => {
    state.view = v;
    for (const w of [...state.waiters]) {
      if (w.pred(v)) {
        state.waiters.splice(state.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(v);
      }
    }
  });
  return {
    get view() {
      return state.view;
    },
    set(v) {
      state.view = v;
    },
    wait(pred, label = 'state') {
      if (state.view && pred(state.view)) return Promise.resolve(state.view);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => {
          state.waiters.splice(state.waiters.indexOf(w), 1);
          reject(new Error(`等待逾時：${label}（目前 state=${state.view?.state} index=${state.view?.index}）`));
        }, 9000);
        state.waiters.push(w);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 主流程 ---------- */

async function main() {
  step('主持人登入與讀取簡報');
  const { token } = await req('/api/auth/login', { method: 'POST', body: { password: PASSWORD } });
  ok(!!token, '登入成功並取得 token');

  let bad = null;
  try {
    await req('/api/auth/login', { method: 'POST', body: { password: 'wrong-password' } });
  } catch (e) {
    bad = e;
  }
  ok(!!bad, '錯誤密碼會被擋下');

  let unauth = null;
  try {
    await req('/api/presentations');
  } catch (e) {
    unauth = e;
  }
  ok(!!unauth, '沒有 token 無法讀取簡報清單');

  const list = await req('/api/presentations', { token });
  // 只認種子產生的示範簡報 —— 測試會改動它的設定，絕對不能跑到使用者自己的簡報上
  const demo = list.find((p) => p.title.includes('知識大挑戰（示範）'));
  ok(!!demo, demo ? `找到示範簡報「${demo.title}」（${demo.slideCount} 頁）` : '找不到示範簡報（清掉 data/presentations.json 讓它重新產生）');
  if (!demo) throw new Error('找不到示範簡報，測試不會去動使用者自己的簡報');

  step('建立場次');
  const host = await connect();
  const hv = tracker(host, 'host:sync');
  const opened = await emit(host, 'host:open', { presentationId: demo.id, token, origin: BASE });
  hv.set(opened.view);
  const code = opened.code;
  ok(/^\d{6}$/.test(code), `房間代碼為 6 位數字：${code}`);
  ok(!!opened.qr && opened.qr.startsWith('data:image/'), 'QR Code 產生成功');
  ok(hv.view.state === 'lobby', '初始狀態為大廳');

  const exists = await req(`/api/sessions/${code}/exists`);
  ok(exists.ok === true, '參與者可以用代碼查到房間');

  step('參與者加入');
  const p1 = await connect();
  const p2 = await connect();
  const v1 = tracker(p1, 'player:sync');
  const v2 = tracker(p2, 'player:sync');
  const j1 = await emit(p1, 'player:join', { code, name: '小明' });
  const j2 = await emit(p2, 'player:join', { code, name: '小華' });
  v1.set(j1.view);
  v2.set(j2.view);
  ok(!!j1.view.me.id && !!j2.view.me.id, '兩位參與者都成功加入');
  await hv.wait((v) => v.playerCount === 2, '兩人加入');
  ok(hv.view.playerCount === 2, '主持端看到 2 位參與者');

  const act = (action, payload) => emit(host, 'host:action', { action, payload });
  const answer = (p, slideId, value) => emit(p, 'player:answer', { slideId, value });

  // 全員答完會自動公布；沒答完就時間到的話只鎖定，等主持人按。
  // 主持端與參與者是不同連線，訊息到達沒有先後保證 —— 三邊都要等到才檢查。
  const waitResults = async () => {
    await act('reveal');
    await hv.wait((v) => v.state === 'results', '主持端公布答案');
    await v1.wait((v) => v.state === 'results', '小明收到結果');
    await v2.wait((v) => v.state === 'results', '小華收到結果');
  };

  /* ---- Kahoot 式的 session 身分：不用帳號，靠 token 認人 ---- */
  step('參與者 session 身分');
  ok(!!j1.token && j1.token !== j2.token, '每位參與者拿到自己的 session token');
  ok(j1.resumed === false, '第一次加入不算重連');
  ok(!JSON.stringify(j1.view).includes(j1.token), '⭐ token 只給本人，不會出現在畫面資料裡');

  // 重新整理 / 斷線回來 → 帶著 token 拿回原本的身分
  const p1b = await connect();
  const again = await emit(p1b, 'player:join', { code, token: j1.token });
  ok(again.resumed === true && again.name === '小明', '⭐ 帶著 session token 重連可以拿回原本的身分');
  p1b.close();

  // 冒充：別人的 player id（排行榜上看得到）不能拿來當 token
  const spy = await connect();
  const fake = await emit(spy, 'player:join', { code, name: '冒充者', token: j1.view.me.id });
  ok(fake.resumed === false && fake.name === '冒充者', '⭐ 拿別人的 player id 當 token 無法冒充，只會變成新玩家');
  await act('kick', { playerId: fake.view.me.id });
  spy.close();
  await hv.wait((v) => v.playerCount === 2, '移除冒充者');
  ok(hv.view.playerCount === 2, '主持人可以把參與者移出房間');

  // 被踢掉之後，原本的 token 就失效了
  const spy2 = await connect();
  const revoked = await emit(spy2, 'player:join', { code, name: '冒充者', token: fake.token });
  ok(revoked.resumed === false, '⭐ 被踢出後原本的 token 立刻失效');
  await act('kick', { playerId: revoked.view.me.id });
  spy2.close();
  await hv.wait((v) => v.playerCount === 2, '房間回到 2 人');

  // 重複暱稱要自動改名
  const p3 = await connect();
  const dup = await emit(p3, 'player:join', { code, name: '小明' });
  ok(dup.name !== '小明', `重複暱稱自動改名為「${dup.name}」`);
  await act('kick', { playerId: dup.view.me.id });
  p3.close();
  await hv.wait((v) => v.playerCount === 2, '清理測試玩家');

  await emit(p1, 'player:join', { code, token: j1.token }); // 把 socket 綁回 p1

  /* ---------- 逐頁測試 ---------- */

  step('第 1 頁：內容頁');
  await act('advance');
  await hv.wait((v) => v.state === 'live' && v.index === 0, '進入第一頁');
  ok(hv.view.slide.type === 'content', '第一頁是內容頁');
  await v1.wait((v) => v.state === 'live', '參與者收到同步');
  ok(v1.view.slide.type === 'content', '參與者也看到內容頁');

  step('第 2 頁：單選題');
  await act('advance');
  await hv.wait((v) => v.index === 1 && v.state === 'live', '進入單選題');
  const s2 = hv.view.slide;
  ok(s2.type === 'single', '題型為單選題');

  await v1.wait((v) => v.index === 1 && v.state === 'live');
  const leaked = JSON.stringify(v1.view.slide).includes('"correct"');
  ok(!leaked, '⭐ 參與者收到的題目不含正確答案（防作弊）');

  const right2 = s2.options.find((o) => o.correct).id;
  const wrong2 = s2.options.find((o) => !o.correct).id;

  // 先只讓小明答 —— 還有人沒答完，這段空窗期絕對不能外流任何答案
  await answer(p1, s2.id, right2);
  await sleep(700);
  ok(hv.view.state === 'live', '還有人沒作答，畫面停在題目上');
  ok(hv.view.answeredCount === 1, '主持端看到 1 人已作答');
  ok(v1.view.solution === null, '還沒公布時參與者拿不到正確答案');
  ok(v1.view.explain === null, '⭐ 還沒公布時解說也不能外流（裡面就寫著答案）');
  ok(!JSON.stringify(v1.view).includes('古河麵包店'), '⭐ 整包資料裡都找不到解說內容');
  ok(v1.view.myAnswer.correct === null, '⭐ 公布前不外流對錯');

  // 最後一個人也答完 → 不等主持人，直接公布
  await answer(p2, s2.id, wrong2);
  await hv.wait((v) => v.state === 'results', '全員答完自動公布');
  await v1.wait((v) => v.state === 'results');
  await v2.wait((v) => v.state === 'results');
  ok(hv.view.state === 'results', '⭐ 全員答完就自動公布，不用等主持人按');
  ok(hv.view.answeredCount === 2, '主持端看到 2 人已作答');
  ok(v1.view.myAnswer.correct === true && v1.view.myAnswer.points > 0, `小明答對得 ${v1.view.myAnswer.points} 分`);
  ok(v2.view.myAnswer.correct === false && v2.view.myAnswer.points === 0, '小華答錯得 0 分');
  ok(v1.view.solution?.optionIds[0] === right2, '公布後參與者才收到正確答案');

  const dupAns = await emit(p1, 'player:answer', { slideId: s2.id, value: wrong2 }).catch((e) => e);
  ok(dupAns instanceof Error, '不能重複作答');

  // 答案解說：公布後才會出現
  ok(!!hv.view.explain?.text, '⭐ 公布後主持端拿到解說');
  ok(!!v1.view.explain?.text, '⭐ 公布後參與者也拿到解說');
  ok(v1.view.explain.text.includes('古河麵包店'), '解說內容正確');

  step('第 3 頁：是非題');
  const s3 = await gotoType("truefalse");
  ok(s3.type === 'truefalse', '題型為是非題');
  await answer(p1, s3.id, s3.options.find((o) => o.correct).id);
  await answer(p2, s3.id, s3.options.find((o) => !o.correct).id);
  await waitResults();
  ok(v1.view.myAnswer.correct && !v2.view.myAnswer.correct, '是非題批改正確');

  step('第 4 頁：複選題（部分給分）');
  const s4 = await gotoType("multi");
  ok(s4.type === 'multi', '題型為複選題');
  const corrects = s4.options.filter((o) => o.correct).map((o) => o.id);
  ok(corrects.length === 3, '這題有 3 個正確答案');
  await answer(p1, s4.id, corrects); // 全對
  await answer(p2, s4.id, corrects.slice(0, 2)); // 只選 2 個 → 2/3
  await waitResults();
  ok(v1.view.myAnswer.correct === true, '全選對 → 判定正確');
  ok(v2.view.myAnswer.correct === false && Math.abs(v2.view.myAnswer.ratio - 2 / 3) < 0.01, '⭐ 少選一個 → 部分給分 2/3');
  ok(v2.view.myAnswer.points > 0 && v2.view.myAnswer.points < v1.view.myAnswer.points, '部分正確拿到部分分數');
  ok(hv.view.slide.points === 'double' && v1.view.myAnswer.points > 1000, '雙倍分數題得分高於 1000');

  step('第 5 頁：配對題');
  const s5 = await gotoType("match");
  ok(s5.type === 'match', '題型為配對題');
  await v1.wait((v) => v.index === 4 && v.state === 'live');
  const pv1 = v1.view.slide;
  ok(pv1.lefts.length === s5.pairs.length && pv1.rights.length === s5.pairs.length, '參與者收到左右兩欄');

  // 右欄 token 不可以跟左欄的 id 相同，否則比對 id 就能看出正解
  const idLeak = pv1.rights.some((r) => pv1.lefts.some((l) => l.id === r.id));
  ok(!idLeak, '⭐ 右欄用匿名 token，無法靠比對 id 作弊');
  ok(new Set(v2.view.slide.rights.map((r) => r.text)).size === s5.pairs.length, '每位參與者拿到自己的亂序右欄');

  // 像真人一樣：依文字找出正確的右欄項目
  const pairUp = (pview) => {
    const map = {};
    for (const left of pview.lefts) {
      const pair = s5.pairs.find((p) => p.id === left.id);
      map[left.id] = pview.rights.find((r) => r.text === pair.right).id;
    }
    return map;
  };
  const correctMap = pairUp(pv1);
  const wrongMap = (() => {
    const m = pairUp(v2.view.slide);
    const keys = Object.keys(m);
    const vals = keys.map((k) => m[k]);
    return Object.fromEntries(keys.map((k, i) => [k, vals[(i + 1) % vals.length]])); // 整組錯開
  })();
  await answer(p1, s5.id, correctMap);
  await answer(p2, s5.id, wrongMap);
  await waitResults();
  ok(v1.view.myAnswer.correct === true, '全部配對正確');
  ok(v2.view.myAnswer.ratio === 0 && v2.view.myAnswer.points === 0, '全部配錯得 0 分');
  ok(hv.view.results.kind === 'pairs' && hv.view.results.perfect === 1, '主持端統計：1 人全對');

  step('第 6 頁：順序題');
  const s6 = await gotoType("order");
  ok(s6.type === 'order', '題型為順序題');
  const order = s6.items.map((i) => i.id);
  await answer(p1, s6.id, order);
  await answer(p2, s6.id, [...order].reverse());
  await waitResults();
  ok(v1.view.myAnswer.correct === true, '順序全對');
  // 5 個項目反轉後，正中間那個仍在正確位置 → 1/5
  ok(Math.abs(v2.view.myAnswer.ratio - 0.2) < 0.01, '⭐ 反轉順序 → 只有中間一個對，得分比例 1/5');

  step('第 7 頁：填空題');
  const s7 = await gotoType("type");
  ok(s7.type === 'type', '題型為填空題');
  await answer(p1, s7.id, '  ' + s7.accepted[0] + ' '); // 前後空白應被忽略
  await answer(p2, s7.id, '完全錯的答案');
  await waitResults();
  ok(v1.view.myAnswer.correct === true, '⭐ 前後空白會被忽略，仍判定正確');
  ok(v2.view.myAnswer.correct === false, '錯誤答案判定錯誤');
  ok(hv.view.results.correctCount === 1, '主持端統計：1 人答對');
  // 輸入型題目公布時要逐人列出（可滾動）
  ok(hv.view.results.people?.length === 2, '⭐ 公布時逐人列出每個人的回答（可滾動）');
  ok(hv.view.results.people.some((p) => p.name === '小明' && p.correct === true), '逐人清單標出誰答對');

  step('複數答案（答對越多分越高，全部答出額外加分）');
  {
    const s = await gotoType('list');
    ok(s.type === 'list', '題型為複數答案');
    ok(v1.view.slide.total === 6, `⭐ 只告訴參與者要湊幾個（${v1.view.slide.total}），不外洩答案`);
    ok(!JSON.stringify(v1.view.slide).includes('CLANNAD'), '⭐ 作答期間拿不到任何答案');
    ok(hv.view.answeredCount === 0, '一開始 0 人作答');

    // 小明一個一個把答案送進去，全部六組都答出來
    await answer(p1, s.id, 'CLANNAD');
    const dup = await emit(p1, 'player:answer', { slideId: s.id, value: 'clannad' }).catch((e) => e);
    ok(dup instanceof Error && /寫過/.test(dup.message), '⭐ 同一個答案不能重複送（忽略大小寫也算重複）');
    for (const a of ['AIR', 'Kanon', 'Little Busters!', 'Rewrite', '智代 After']) await answer(p1, s.id, a);
    await v1.wait((v) => v.myAnswer && v.myAnswer.value.length === 6);
    ok(v1.view.myAnswer.value.length === 6, '送出的答案累積成一份清單');
    ok(v1.view.myAnswer.correct === null && v1.view.myAnswer.points === null, '⭐ 公布前不透露對錯與分數');

    // 小華只答對兩組（一個用別名、一個忽略大小寫），第三個亂寫
    await answer(p2, s.id, '克蘭納德'); // 別名命中第 1 組
    await answer(p2, s.id, 'air'); // 忽略大小寫命中第 2 組
    await answer(p2, s.id, '亂寫的一個');
    await v2.wait((v) => v.myAnswer && v.myAnswer.value.length === 3);

    await waitResults();

    const a1 = v1.view.myAnswer;
    ok(a1.hits === 6 && a1.correct === true, '⭐ 小明六組全中');
    ok(a1.points === 3000, `⭐ 全部答出額外加分：2000×(1+0.5) = ${a1.points}`);
    ok(a1.points > 2000, '全中分數超過基礎分（有額外加分）');

    const a2 = v2.view.myAnswer;
    ok(a2.hits === 2 && a2.correct === false, `小華命中 2 組（${a2.hits}）`);
    ok(JSON.stringify(a2.marks) === JSON.stringify([true, true, false]), '⭐ 逐一標出他寫的哪些對：對、對、錯');
    ok(a2.points === Math.round(2000 * (2 / 6)), `⭐ 答對越多分越高（命中比例計分）：${a2.points} 分`);
    ok(a2.groupHit[0] === true && a2.groupHit[1] === true && a2.groupHit[2] === false, '⭐ 標出他漏了哪幾組');

    ok(hv.view.results.kind === 'list' && hv.view.results.groupTotal === 6, '主持端統計 kind=list、共 6 組');
    ok(hv.view.results.perfect === 1, '⭐ 1 人全部答出');
    ok(hv.view.results.rows[0].count === 2, '⭐ 第一組兩個人都答到（含用別名的）');
    ok(hv.view.results.people.length === 2, '⭐ 逐人清單有兩個人（公布時可滾動顯示）');
    const mingRow = hv.view.results.people.find((x) => x.name === '小明');
    ok(mingRow.hits === 6 && mingRow.items.length === 6, '逐人清單：小明送 6 個、全中');
    ok(v1.view.solution.answers.length === 6, '公布後才送出 6 組正解');
    ok(v1.view.solution.answers[0].alts.includes('克蘭納德'), '正解帶著別名');
  }

  step('第 8 頁：開放問題');
  const s8 = await gotoType("open");
  ok(s8.type === 'open', '題型為開放問題');
  await answer(p1, s8.id, 'CLANNAD 人生');
  await answer(p2, s8.id, 'CLANNAD 神作');
  await answer(p1, s8.id, 'Steins;Gate 也很棒'); // 這題允許 2 則
  await sleep(200);
  const over = await emit(p1, 'player:answer', { slideId: s8.id, value: '第三則' }).catch((e) => e);
  ok(over instanceof Error, '⭐ 超過提交次數上限會被擋下');
  ok(hv.view.results.total === 3, '主持端收到 3 則回覆');
  ok(hv.view.results.words.some((w) => w.text === 'CLANNAD' && w.count === 2), '⭐ 文字雲正確統計 CLANNAD 出現 2 次');
  await waitResults();

  step('第 9 頁：觀眾提問');
  await gotoType('qa');
  ok(hv.view.slide.type === 'qa', '題型為觀眾提問');
  await emit(p1, 'player:qa:ask', { text: '請問第二季什麼時候出？' });
  await emit(p2, 'player:qa:ask', { text: '有推薦入門作品嗎？' });
  await hv.wait((v) => v.qa.length === 2, '收到兩則提問');
  ok(hv.view.qa.length === 2, '主持端收到 2 則提問');
  ok(hv.view.qa[0].author === '匿名', '匿名模式下不顯示提問者姓名');

  const qid = hv.view.qa[1].id;
  await emit(p1, 'player:qa:vote', { id: qid });
  await emit(p2, 'player:qa:vote', { id: qid });
  await hv.wait((v) => v.qa[0].votes === 2, '按讚');
  ok(hv.view.qa[0].id === qid && hv.view.qa[0].votes === 2, '⭐ 按讚數多的問題自動排到最前面');

  await emit(p1, 'player:qa:vote', { id: qid }); // 再按一次 = 取消
  await hv.wait((v) => v.qa.find((q) => q.id === qid).votes === 1, '取消按讚');
  ok(true, '重複按讚等於取消');

  await act('qa:update', { id: qid, patch: { answered: true } });
  await hv.wait((v) => v.qa.some((q) => q.answered), '標記已回答');
  ok(hv.view.qa.some((q) => q.answered), '主持人可以標記問題為已回答');

  /* ---------- 數字題 ---------- */
  step('數字題（依接近程度給分）');
  {
    const s = await gotoType('number');
    ok(s.type === 'number', '題型為數字題');
    ok(!JSON.stringify(v1.view.slide).includes(String(s.answer)), '⭐ 參與者拿不到正確答案');
    await answer(p1, s.id, s.answer); // 剛好猜中
    await answer(p2, s.id, s.answer + s.tolerance / 2); // 差一半
    await waitResults();
    ok(v1.view.myAnswer.correct === true && v1.view.myAnswer.ratio === 1, '猜中拿滿分');
    ok(
      Math.abs(v2.view.myAnswer.ratio - 0.5) < 0.01,
      `⭐ 差容許誤差的一半 → 拿 50% 分數（實得 ratio ${v2.view.myAnswer.ratio.toFixed(2)}）`
    );
    ok(v2.view.myAnswer.points > 0 && v2.view.myAnswer.points < v1.view.myAnswer.points, '接近但沒中也有分');
    ok(hv.view.results.kind === 'number' && hv.view.results.exact === 1, '主持端統計：1 人剛好猜中');
    ok(hv.view.results.closest[0].name === '小明', '最接近排行第一是小明');
    ok(v1.view.solution.answer === s.answer, '公布後參與者才拿到正確答案');
  }

  /* ---------- 猜圖題 ---------- */
  step('猜圖題（越早階段猜中越高分）');
  {
    const s = await gotoType('reveal');
    ok(s.type === 'reveal', '題型為猜圖題');
    ok(v1.view.slide.image === null, '⭐ 參與者拿不到原圖（圖只在大螢幕上）');
    ok(hv.view.stage === 0, '一開始在第 1 階段');
    ok(hv.view.stagePoints === 100, '第 1 階段答對可拿 100%');

    // 小明第一階段就猜中（他前面幾題已經有分了，所以看的是增量而不是絕對值）
    const scoreBefore = v1.view.me.score;
    const right = s.options.find((o) => o.correct).id;
    await answer(p1, s.id, right);
    await v1.wait((v) => v.myAnswer);
    ok(v1.view.myAnswer.stage === 0, '記錄下小明在第 1 階段作答');
    ok(v1.view.myAnswer.correct === null, '⭐ 公布前不告訴參與者猜中了沒');
    ok(v1.view.me.score === scoreBefore, '⭐ 公布前分數不動（會動就等於先爆雷）');

    // 揭到最後一階段，小華才猜中
    for (let i = 0; i < s.stages - 1; i++) await act('nextStage');
    await hv.wait((v) => v.stage === s.stages - 1, '揭到最後一階段');
    ok(hv.view.stagePoints === 40, '⭐ 最後一階段只剩 40%');
    await answer(p2, s.id, right);
    await v2.wait((v) => v.myAnswer);

    await waitResults();
    // 分數是公布答案才入帳的，所以要在這裡才讀得到
    const early = v1.view.myAnswer.points;
    const late = v2.view.myAnswer.points;
    ok(v1.view.me.score === scoreBefore + early, '⭐ 公布後分數才入帳');
    ok(v1.view.myAnswer.correct && v2.view.myAnswer.correct, '兩人都猜中同一個答案');
    ok(early === 2000, `第 1 階段猜中拿滿分 ${early}`);
    ok(late === 800, `⭐ 最後階段猜中只拿 ${late}（40% of 2000）`);
    ok(early > late, '⭐ 越早猜中分數越高');
    ok(v1.view.solution?.optionIds?.[0] === right, '公布後參與者才拿到正確答案');
    ok(hv.view.stage === s.stages - 1, '公布答案時圖片全開');
  }

  /* ---------- 音樂題 ---------- */
  step('音樂題');
  {
    const s = await gotoType('music');
    ok(s.type === 'music', '題型為音樂題');
    ok(v1.view.slide.audio === undefined, '⭐ 音檔不會送到參與者手機');
    ok(v1.view.slide.options.length === 4, '參與者看得到 4 個選項');
    await answer(p1, s.id, s.options.find((o) => o.correct).id);
    await answer(p2, s.id, s.options.find((o) => !o.correct).id);
    await waitResults();
    ok(v1.view.myAnswer.correct && !v2.view.myAnswer.correct, '音樂題批改正確');
  }

  /* ---------- 評分題 ---------- */
  step('評分題');
  {
    const s = await gotoType('scale');
    ok(s.type === 'scale', '題型為評分題');
    ok(v1.view.slide.graded === false, '評分題不計分');
    await answer(p1, s.id, 5);
    await answer(p2, s.id, 3);
    await waitResults();
    ok(hv.view.results.kind === 'scale' && hv.view.results.avg === 4, '⭐ 平均分算出來是 4（5 和 3）');
    const b5 = hv.view.results.buckets.find((b) => b.value === 5);
    ok(b5.count === 1, '分布長條圖統計正確');
    ok(v1.view.myAnswer.points === 0, '評分題不給分');
  }

  /* ---------- 匯入沒有 id 的題庫 ---------- */
  step('匯入沒有 id 的題庫（AI 產的都長這樣）');
  {
    // AI 產出的 JSON 只有 text / correct，沒有任何 id。
    // 以前這樣匯入會壞得很安靜：批改變成 undefined === undefined（答錯也算對）、
    // 統計的票數全塌到最後一個選項、前端 v-for 的 key 撞在一起。
    const payload = {
      title: '無 id 匯入測試',
      slides: [
        {
          type: 'single',
          title: '正確答案是 A',
          timeLimit: 30,
          points: 'standard',
          options: [{ text: 'A', correct: true }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
          // 正規的寫法：物件
          explain: { text: '因為 A 才對', image: null },
        },
        {
          type: 'order',
          title: '排序',
          timeLimit: 30,
          points: 'standard',
          items: [{ text: '一' }, { text: '二' }, { text: '三' }],
          // AI 很常直接寫成字串，要能接受
          explain: '一二三，很直覺',
        },
        {
          type: 'match',
          title: '配對',
          timeLimit: 30,
          points: 'standard',
          pairs: [{ left: 'L1', right: 'R1' }, { left: 'L2', right: 'R2' }],
          // 沒寫 explain 的題目要補成空的，編輯器讀 slide.explain.text 才不會炸
        },
        {
          type: 'categorize',
          title: '分類',
          timeLimit: 30,
          points: 'standard',
          categories: [{ id: 'cat_a', name: '甲' }, { id: 'cat_b', name: '乙' }],
          items: [
            { text: 'a1', categoryId: 'cat_a' },
            { text: 'a2', categoryId: 'cat_a' },
            { text: 'b1', categoryId: 'cat_b' },
          ],
        },
      ],
    };
    const imported = await req('/api/import', { method: 'POST', token, body: payload });
    const full = await req(`/api/presentations/${imported.id}`, { token });

    // 每一個巢狀項目都要有 id
    const noId = [];
    for (const s of full.slides) {
      for (const key of ['options', 'items', 'pairs', 'categories']) {
        for (const x of s[key] || []) if (!x.id) noId.push(`${s.type}.${key}`);
      }
    }
    ok(noId.length === 0, noId.length ? `還有沒 id 的：${[...new Set(noId)].join(', ')}` : '⭐ 匯入後所有選項／項目／配對／分類都補上 id 了');

    const ids = full.slides.flatMap((s) => (s.options || []).map((o) => o.id));
    ok(new Set(ids).size === ids.length, '⭐ id 彼此不重複（不然統計會塌在一起）');

    // 匯入要能帶進公布後的解說
    const sg = full.slides.find((s) => s.type === 'single');
    ok(sg.explain?.text === '因為 A 才對', '⭐ 匯入保留物件形式的解說');
    const og = full.slides.find((s) => s.type === 'order');
    ok(og.explain?.text === '一二三，很直覺', '⭐ 解說寫成字串也吃得下（AI 很常這樣寫）');
    ok(og.explain.image === null, '字串形式的解說補上 image: null');
    const mg = full.slides.find((s) => s.type === 'match');
    ok(mg.explain?.text === '', '沒寫解說的題目補成空字串，編輯器不會炸');

    // 分類題的 categoryId 要換成新的內部 id 並且對得上
    const cat = full.slides.find((s) => s.type === 'categorize');
    ok(
      cat.items.every((i) => cat.categories.some((c) => c.id === i.categoryId)),
      '⭐ 分類題的 categoryId 有正確對應到分類'
    );
    ok(cat.items.filter((i) => i.categoryId === cat.categories[0].id).length === 2, '項目的歸屬沒有跑掉');

    // 作者給重複的 id 也要能救回來（不然統計會把兩個項目算成同一個）
    const dup = await req('/api/import', {
      method: 'POST',
      token,
      body: {
        title: '重複 id 測試',
        slides: [
          {
            type: 'single',
            title: 'x',
            options: [
              { id: 'same', text: 'A', correct: true },
              { id: 'same', text: 'B' },
              { id: 'same', text: 'C' },
            ],
          },
        ],
      },
    });
    const dupFull = await req(`/api/presentations/${dup.id}`, { token });
    const dupIds = dupFull.slides[0].options.map((o) => o.id);
    ok(new Set(dupIds).size === 3, `⭐ 作者給重複的 id 會被重新編號（${dupIds.length} 個都不一樣）`);
    await req(`/api/presentations/${dup.id}`, { method: 'DELETE', token });

    // 真的跑一場，確認答錯不會加分
    const hi = await connect();
    const hvi = tracker(hi, 'host:sync');
    const oi = await emit(hi, 'host:open', { presentationId: imported.id, token, origin: BASE });
    hvi.set(oi.view);
    const pw = await connect();
    const vw = tracker(pw, 'player:sync');
    vw.set((await emit(pw, 'player:join', { code: oi.code, name: '答錯的人' })).view);

    await emit(hi, 'host:action', { action: 'goto', payload: { index: 0 } });
    await hvi.wait((v) => v.state === 'live' && v.slide.type === 'single');
    const s0 = hvi.view.slide;
    const wrongOpt = s0.options.find((o) => !o.correct);
    // 這一場只有他一個人，所以他一答完就自動公布了（沒有公布前的空窗期可以測，
    // 那個在上面的單選題那節用兩個人測過了）
    await emit(pw, 'player:answer', { slideId: s0.id, value: wrongOpt.id });
    await hvi.wait((v) => v.state === 'results', '單人場次：答完立刻自動公布');
    await vw.wait((v) => v.myAnswer?.correct !== null);

    // 票數要落在他真的選的那一個，不是最後一個

    ok(vw.view.myAnswer.correct === false, '⭐ 答錯就是答錯（以前 undefined===undefined 會判成對）');
    ok(vw.view.myAnswer.points === 0, '⭐ 答錯不加分');
    ok(vw.view.me.score === 0, '⭐ 答錯總分還是 0');
    const bars = hvi.view.results.bars;
    const picked = bars.find((b) => b.id === wrongOpt.id);
    ok(picked.count === 1, `⭐ 票數記在他選的「${picked.text}」上`);
    ok(bars.filter((b) => b.count > 0).length === 1, '沒有跑到別的選項去');
    ok(bars.find((b) => b.correct).count === 0, '正確答案沒有人選，就顯示 0');

    hi.close();
    pw.close();
    await req(`/api/presentations/${imported.id}`, { method: 'DELETE', token });
  }

  /* ---------- 分類題 ---------- */
  step('分類題（拖曳項目進分類）');
  {
    const s = await gotoType('categorize');
    ok(s.type === 'categorize', '題型為分類題');
    ok(s.categories.length >= 2 && s.items.length >= 4, `${s.categories.length} 個分類、${s.items.length} 個項目`);

    const pv = v1.view.slide;
    ok(pv.categories.length === s.categories.length, '參與者收到所有分類');
    ok(pv.items.length === s.items.length, '參與者收到所有項目');
    ok(
      pv.items.every((i) => i.categoryId === undefined),
      '⭐ 項目不帶 categoryId（那就是答案）'
    );
    ok(!JSON.stringify(pv).includes('categoryId'), '⭐ 整包資料裡都沒有 categoryId');

    // 小明全對
    const right = Object.fromEntries(s.items.map((i) => [i.id, i.categoryId]));
    // 小華把一半放錯（丟到別的分類）
    const wrong = Object.fromEntries(
      s.items.map((i, n) => [
        i.id,
        n < s.items.length / 2 ? i.categoryId : s.categories.find((c) => c.id !== i.categoryId).id,
      ])
    );
    await answer(p1, s.id, right);
    await answer(p2, s.id, wrong);
    await waitResults();

    ok(v1.view.myAnswer.correct === true && v1.view.myAnswer.ratio === 1, '全部放對 → 滿分');
    ok(
      Math.abs(v2.view.myAnswer.ratio - 0.5) < 0.01,
      `⭐ 放對一半 → 部分給分 50%（實得 ${(v2.view.myAnswer.ratio * 100).toFixed(0)}%）`
    );
    ok(v2.view.myAnswer.correct === false, '放錯就不算完全正確');
    ok(v2.view.myAnswer.points > 0 && v2.view.myAnswer.points < v1.view.myAnswer.points, '部分正確拿部分分數');
    ok(hv.view.results.kind === 'categorize' && hv.view.results.perfect === 1, '主持端統計：1 人全對');

    const col = hv.view.results.cols[0];
    ok(col.items.every((i) => typeof i.count === 'number'), '主持端統計每個項目放對幾人');
    ok(v1.view.solution.categories[0].items.length > 0, '公布後才送出正解分類');
  }

  /* ---------- 海龜湯（分階段提示、每輪重置人數、全員答完自動出下一條） ---------- */
  step('海龜湯（分階段提示、每輪重置作答人數、全員答完自動出下一條）');
  {
    const s = await gotoType('soup');
    ok(s.type === 'soup', '題型為海龜湯');
    ok(s.accepted.length >= 2, `設定了 ${s.accepted.length} 組可接受答案`);
    ok(hv.view.stages === s.hints.length, `階段數等於提示條數（${s.hints.length}）`);
    ok(hv.view.answeredCount === 0, '這一輪一開始 0 人作答');

    // 一開始只給第一條提示，後面的提示與答案都不能先外洩
    ok(v1.view.slide.hints.length === 1, '⭐ 一開始參與者只看得到第 1 條提示');
    ok(v1.view.slide.hints[0].text === s.hints[0].text, '第 1 條提示內容正確');
    ok(!JSON.stringify(v1.view.slide).includes(s.hints[1].text), '⭐ 還沒揭露的提示不會提前送出去');
    ok(!JSON.stringify(v1.view.slide).includes(s.accepted[0]), '⭐ 參與者拿不到答案');
    ok(hv.view.stagePoints === 100, '第 1 條提示就猜中可拿 100%');

    // 小華先在第 1 條賭一把，猜錯：這一輪計數 +1，但還沒全員答完，停在原地
    await answer(p2, s.id, '亂猜的答案');
    await v2.wait((v) => v.myAnswer);
    await hv.wait((v) => v.answeredCount === 1, '這一輪 1 人作答');
    ok(hv.view.stage === 0 && hv.view.answeredCount === 1, '⭐ 只有一人答 → 停在第 1 條、已作答計為 1');
    ok(v2.view.myAnswer.correct === false, '小華第 1 條就猜，猜錯了');

    // 同一條提示不能連猜
    const again = await emit(p2, 'player:answer', { slideId: s.id, value: '再亂猜' }).catch((e) => e);
    ok(again instanceof Error && /這條提示/.test(again.message), '⭐ 同一條提示只能猜一次');

    // 小明也在第 1 條猜錯 → 兩人都表態、又不是都對 → 自動出第 2 條、計數歸零
    await answer(p1, s.id, '我也亂猜');
    await hv.wait((v) => v.stage === 1, '全員答完自動出下一條提示');
    ok(hv.view.stage === 1, '⭐ 全部人答完這一輪，就自動揭下一條提示（不必等主持人）');
    ok(hv.view.answeredCount === 0, '⭐ 換提示後「已作答人數」重新計算（歸零）');
    await v2.wait((v) => v.slide.hints.length === 2, '小華收到第 2 條提示');
    ok(v2.view.slide.hints.length === 2, '⭐ 新提示出現');
    ok(v2.view.myAnswer.stage === 0 && v2.view.myAnswer.correct === false, '上一輪的猜測還留著，等這一輪再改');

    // 第 2 條：小明先猜中（stage 1）—— 海龜湯即時判定，live 就拿得到分數
    await answer(p1, s.id, s.accepted[0]);
    await v1.wait((v) => v.myAnswer && v.myAnswer.correct);
    const early = v1.view.myAnswer.points;
    ok(v1.view.myAnswer.stage === 1, '記錄下小明在第 2 條提示猜中');
    await hv.wait((v) => v.stage === 1 && v.answeredCount === 1, '一人已中、另一人未答');
    ok(hv.view.stage === 1 && hv.view.answeredCount === 1, '⭐ 一人已中、一人未答 → 停在第 2 條；已猜對的人算已作答');

    // 已經答對就不能再送
    const afterCorrect = await emit(p1, 'player:answer', { slideId: s.id, value: '改答案' }).catch((e) => e);
    ok(afterCorrect instanceof Error && /答對/.test(afterCorrect.message), '⭐ 已經答對就不能再送');

    // 小華在第 2 條猜錯 → 兩人都表態（一對一錯）→ 自動出第 3 條
    await answer(p2, s.id, '第二次亂猜');
    await hv.wait((v) => v.stage === 2, '再次全員答完 → 自動出第 3 條');
    ok(hv.view.stage === 2, '⭐ 又一次全員答完就自動前進');
    ok(hv.view.answeredCount === 1, '換提示後只剩已猜對的小明算已作答（歸零後重算）');

    // 小華再猜錯 → 自動出最後一條提示
    await answer(p2, s.id, '第三次亂猜');
    await hv.wait((v) => v.stage === s.hints.length - 1, '自動出最後一條提示');
    ok(hv.view.stage === s.hints.length - 1, '⭐ 一路自動推進到最後一條提示');
    ok(hv.view.stagePoints === 40, '⭐ 最後一條提示只剩 40%');

    // 最後一條：小華換「另一組」答案猜中 → 兩人皆對 → 自動公布，不必等主持人
    await answer(p2, s.id, s.accepted[1]);
    await hv.wait((v) => v.state === 'results', '全員都猜對 → 自動公布');
    await v1.wait((v) => v.state === 'results');
    await v2.wait((v) => v.state === 'results');
    const late = v2.view.myAnswer.points;
    ok(hv.view.state === 'results', '⭐ 大家都猜對就直接公布答案（不必等主持人按）');
    ok(v2.view.myAnswer.correct === true, '⭐ 換一組可接受答案也算對');
    ok(v2.view.myAnswer.tries === 4, `⭐ 記錄下小華一共猜了 ${v2.view.myAnswer.tries} 次`);
    ok(early === 1600, `小明第 2 條猜中拿 ${early}（80% of 2000）`);
    ok(late === 800, `⭐ 小華最後一條才中只拿 ${late}（40% of 2000）`);
    ok(early > late, '⭐ 越早猜中分數越高');
    ok(hv.view.results.stageHits?.length === 2, '主持端統計「大家在第幾條提示猜中」');
    ok(v1.view.solution.accepted.length === s.accepted.length, '公布後才送出所有可接受答案');
    // 大小寫／空白的正規化跟填空題共用同一段程式碼，已在填空題那節測過
  }

  /* ---------- 表情符號 ---------- */
  /* ---------- 參與者頭像 ---------- */
  step('參與者頭像');
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    const post = async (fields) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'file') form.append('file', new Blob([v], { type: 'image/png' }), 'a.png');
        else form.append(k, v);
      }
      const r = await fetch(BASE + '/api/avatar', { method: 'POST', body: form });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };

    // 頭像端點不能用主持人密碼把關 —— 參與者沒有。它認的是自己的 session token。
    const noToken = await post({ code: hv.view.code, token: 'not-a-real-token', file: png });
    ok(noToken.status === 401, `⭐ 別人的假 token 上傳不了頭像（${noToken.status}）`);

    const badCode = await post({ code: '000000', token: j1.token, file: png });
    ok(badCode.status === 404, `⭐ 房號不存在就擋掉（${badCode.status}）`);

    const notImage = await post({ code: hv.view.code, token: j1.token, file: Buffer.from('這才不是圖片') });
    ok(notImage.status === 415, `⭐ 不是圖片就擋掉（看的是 magic bytes，不是副檔名）（${notImage.status}）`);

    const good = await post({ code: hv.view.code, token: j1.token, file: png });
    ok(good.status === 200 && /^\/uploads\/.+\.png$/.test(good.body.url), `⭐ 帶著自己的 token 就傳得上去：${good.body.url}`);

    await v1.wait((v) => !!v.me.avatar, '參與者收到自己的頭像');
    ok(v1.view.me.avatar === good.body.url, '⭐ 頭像同步回自己的畫面');
    await hv.wait((v) => v.players.some((p) => p.avatar), '主持端收到頭像');
    ok(
      hv.view.players.find((p) => p.id === v1.view.me.id)?.avatar === good.body.url,
      '⭐ 大螢幕的名單／排行榜也拿得到頭像'
    );
    ok(!JSON.stringify(hv.view.players).includes('token'), '⭐ 玩家名單裡不會夾帶 token');
  }

  step('自訂表情符號');
  {
    // 先上傳兩個表符並掛到簡報上
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    const upload = async () => {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'e.png');
      const r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
      return (await r.json()).url;
    };
    const [u1, u2] = [await upload(), await upload()];
    const reactions = [
      { id: 'r_love', url: u1, label: '愛心' },
      { id: 'r_cry', url: u2, label: '哭' },
    ];
    await req(`/api/presentations/${demo.id}`, { method: 'PUT', token, body: { reactions } });
    const saved = await req(`/api/presentations/${demo.id}`, { token });
    ok(saved.reactions.length === 2 && saved.reactions[0].label === '愛心', '⭐ 表情符號存進簡報');

    // 開一場新的（場次是開場時深拷貝簡報，舊場次拿不到新表符）
    const h4 = await connect();
    const hv4 = tracker(h4, 'host:sync');
    const o4 = await emit(h4, 'host:open', { presentationId: demo.id, token, origin: BASE });
    hv4.set(o4.view);
    ok(hv4.view.reactions.length === 2, '⭐ 主持端收到表情符號清單');

    const pa = await connect();
    const pb = await connect();
    const va = tracker(pa, 'player:sync');
    const ja = await emit(pa, 'player:join', { code: o4.code, name: '送表符的人' });
    const jb = await emit(pb, 'player:join', { code: o4.code, name: '旁觀者' });
    va.set(ja.view);
    ok(ja.view.reactions.length === 2, '⭐ 參與者也收到表情符號清單');
    ok(ja.view.settings.reactionsEnabled === true, '表情符號功能預設開啟');

    // 收 reaction 廣播
    const inbox = { host: [], self: [], other: [] };
    h4.on('reaction', (r) => inbox.host.push(r));
    pa.on('reaction', (r) => inbox.self.push(r));
    pb.on('reaction', (r) => inbox.other.push(r));

    const sent = await emit(pa, 'player:reaction', { id: 'r_love' });
    ok(sent.ok === true, '參與者送出表情符號');
    await sleep(300);
    ok(inbox.host.length === 1, '⭐ 大螢幕收到表情符號');
    ok(inbox.other.length === 1, '⭐ 其他參與者也收到（大家一起看到氣氛才熱）');
    ok(inbox.self.length === 1, '送的人自己也收到（當作回饋）');
    ok(inbox.host[0].url === u1, '收到的是正確那一顆表符的圖');

    // 最重要：廣播內容不能洩漏是誰送的
    const payload = JSON.stringify(inbox.host[0]);
    ok(!payload.includes('送表符的人'), '⭐ 廣播不含發送者暱稱');
    ok(!payload.includes(ja.view.me.id), '⭐ 廣播不含發送者 id');
    ok(!payload.includes(ja.token), '⭐ 廣播不含發送者 token');
    ok(Object.keys(inbox.host[0]).sort().join(',') === 'id,n,url', `⭐ 廣播只有 id/url/n 三個欄位：${Object.keys(inbox.host[0]).join(',')}`);
    ok(typeof inbox.host[0].n === 'number', '帶一個流水號給前端動畫當 key');

    // 節流：連發只會過第一個
    // （先等上一發的節流窗過期，不然這裡測到的會是上一發的殘留）
    await sleep(800);
    inbox.host.length = 0;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => emit(pa, 'player:reaction', { id: 'r_cry' }).catch((e) => ({ error: e.message })))
    );
    await sleep(300);
    ok(burst.filter((r) => r.ok).length === 1, '⭐ 連發被節流，只過第一個');
    ok(burst.filter((r) => r.error).length === 4, '其餘被擋下並回錯誤');
    ok(inbox.host.length === 1, '大螢幕只收到一個，不會被洗版');

    // 不存在的表符要被擋
    const bogus = await emit(pa, 'player:reaction', { id: 'r_不存在' }).catch((e) => e);
    ok(bogus instanceof Error, '⭐ 送不存在的表符會被擋下');

    // 沒加入房間的人不能送
    const outsider = await connect();
    const noJoin = await emit(outsider, 'player:reaction', { id: 'r_love' }).catch((e) => e);
    ok(noJoin instanceof Error, '⭐ 沒加入房間不能送表符');
    outsider.close();

    // 主持人關掉功能後就不能送了
    await emit(h4, 'host:action', { action: 'settings', payload: { reactionsEnabled: false } });
    await va.wait((v) => v.settings.reactionsEnabled === false, '參與者收到已關閉');
    ok(va.view.settings.reactionsEnabled === false, '參與者端顯示功能已關閉');
    await sleep(800); // 等節流過期，確保是被設定擋下而不是節流
    const off = await emit(pa, 'player:reaction', { id: 'r_love' }).catch((e) => e);
    ok(off instanceof Error && /關閉/.test(off.message), '⭐ 主持人關閉後送不出去');

    h4.close();
    pa.close();
    pb.close();
    await req(`/api/presentations/${demo.id}`, { method: 'PUT', token, body: { reactions: [] } });
  }

  /* ---------- 時間到不自動公布 ---------- */
  step('時間到只鎖定，不自動公布');
  await nextSlide(indexOfType('single'));
  await act('addTime', { seconds: -100 }); // 直接把時間扣到過去，觸發鎖定
  await hv.wait((v) => v.locked === true, '等待鎖定');
  ok(hv.view.state === 'live' && hv.view.locked === true, '⭐ 時間到後 state 仍是 live，只是 locked=true（沒有自動公布）');
  ok(hv.view.solution === null, '鎖定時仍然不會外洩正確答案');
  await v1.wait((v) => v.locked === true, '參與者收到鎖定');
  const lateAns = await emit(p2, 'player:answer', { slideId: hv.view.slide.id, value: 'x' }).catch((e) => e);
  ok(lateAns instanceof Error && /時間到/.test(lateAns.message), '⭐ 鎖定後不能再作答');

  await act('addTime', { seconds: 30 });
  await hv.wait((v) => v.locked === false, '加時後解鎖');
  ok(hv.view.locked === false && hv.view.endsAt > Date.now(), '⭐ 主持人加時後重新開放作答');

  /* ---------- 速度加分開關 ---------- */
  step('速度加分開關');
  {
    const full = await req(`/api/presentations/${demo.id}`, { token });
    // 複製一份來改設定，不動到示範簡報
    const copy = await req(`/api/presentations/${demo.id}/duplicate`, { method: 'POST', token });
    const slides = copy.slides;
    const single = slides.find((s) => s.type === 'single');
    single.timeLimit = 60;
    single.speedBonus = 'off'; // 這一題關掉速度加分
    const multi = slides.find((s) => s.type === 'multi');
    multi.timeLimit = 60;
    multi.speedBonus = 'on';
    await req(`/api/presentations/${copy.id}`, { method: 'PUT', token, body: { slides } });
    ok(full.settings.speedBonus === true, '示範簡報整體有開速度加分');

    const h2 = await connect();
    const hv2 = tracker(h2, 'host:sync');
    const o2 = await emit(h2, 'host:open', { presentationId: copy.id, token, origin: BASE });
    hv2.set(o2.view);
    const pa = await connect();
    const va = tracker(pa, 'player:sync');
    const ja = await emit(pa, 'player:join', { code: o2.code, name: '慢慢答' });
    va.set(ja.view);

    const act2 = (a, p) => emit(h2, 'host:action', { action: a, payload: p });
    await act2('goto', { index: slides.indexOf(single) });
    await hv2.wait((v) => v.state === 'live' && v.slide.type === 'single');
    await sleep(2500); // 故意拖 2.5 秒才作答
    await emit(pa, 'player:answer', { slideId: single.id, value: single.options.find((o) => o.correct).id });
    await va.wait((v) => v.myAnswer);
    ok(hv2.view.slide.speedBonusOn === false, '主持端顯示這題沒有速度加分');
    // 分數要公布答案才入帳
    await act2('reveal');
    await va.wait((v) => v.myAnswer.points !== null);
    ok(va.view.myAnswer.points === 1000, `⭐ 關掉速度加分 → 慢慢答也拿滿分 1000（實得 ${va.view.myAnswer.points}）`);

    await act2('goto', { index: slides.indexOf(multi) });
    await hv2.wait((v) => v.state === 'live' && v.slide.type === 'multi');
    await sleep(2500);
    await emit(pa, 'player:answer', { slideId: multi.id, value: multi.options.filter((o) => o.correct).map((o) => o.id) });
    await va.wait((v) => v.myAnswer);
    ok(hv2.view.slide.speedBonusOn === true, '主持端顯示這題有速度加分');
    await act2('reveal');
    await va.wait((v) => v.myAnswer.points !== null);
    ok(va.view.myAnswer.points < 2000 && va.view.myAnswer.points > 1800, `⭐ 開啟速度加分 → 拖 2.5 秒扣了一些分（實得 ${va.view.myAnswer.points}/2000）`);

    h2.close();
    pa.close();
    await req(`/api/presentations/${copy.id}`, { method: 'DELETE', token });
  }

  /* ---------- 圖片上傳 ---------- */
  step('圖片上傳');
  {
    // 1x1 的透明 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
    const up = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const upData = await up.json();
    ok(up.ok && /^\/uploads\/[a-z0-9]+-[a-f0-9]{16}\.png$/.test(upData.url), `⭐ 圖片上傳成功：${upData.url}`);

    const got = await fetch(BASE + upData.url);
    ok(got.ok && got.headers.get('content-type') === 'image/png', '上傳的圖片可以正常取回');
    ok((await got.arrayBuffer()).byteLength === png.length, '取回的內容和原檔一致');

    const noAuth = await fetch(BASE + '/api/upload', { method: 'POST', body: new FormData() });
    ok(noAuth.status === 401, '沒登入不能上傳');

    // 偽裝成 png 的文字檔要被擋下（靠 magic bytes 判斷，不信任副檔名）
    const fake = new FormData();
    fake.append('file', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'evil.png');
    const bad = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fake });
    ok(bad.status === 415, '⭐ 假裝成 PNG 的非圖片檔會被擋下');

    const trav = await fetch(BASE + '/uploads/..%2F..%2Fpresentations.json');
    ok(trav.status >= 400, '⭐ 路徑穿越會被擋下');
  }

  /* ---------- 音訊上傳 ---------- */
  step('音訊上傳');
  {
    // 最小的合法 MP3：ID3 標頭 + 一個 frame header
    const mp3 = Buffer.concat([
      Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'binary'),
      Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      Buffer.alloc(512),
    ]);
    const form = new FormData();
    form.append('file', new Blob([mp3], { type: 'audio/mpeg' }), 'song.mp3');
    const up = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const data = await up.json();
    ok(up.ok && data.kind === 'audio' && data.url.endsWith('.mp3'), `⭐ MP3 上傳成功：${data.url}`);

    const got = await fetch(BASE + data.url);
    ok(got.ok && got.headers.get('content-type') === 'audio/mpeg', '音檔可以正常取回');
    ok(got.headers.get('accept-ranges') === 'bytes', '音檔支援 range request');

    // 拖曳進度條會發 Range，伺服器要回 206 而不是整包 200
    const part = await fetch(BASE + data.url, { headers: { Range: 'bytes=0-99' } });
    ok(part.status === 206, '⭐ Range request 回 206 Partial Content');
    ok(part.headers.get('content-range') === `bytes 0-99/${mp3.length}`, 'Content-Range 標頭正確');
    ok((await part.arrayBuffer()).byteLength === 100, '只回傳要求的那 100 bytes');

    // OggS 開頭
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(256)]);
    const f2 = new FormData();
    f2.append('file', new Blob([ogg], { type: 'audio/ogg' }), 'a.ogg');
    const up2 = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f2 });
    ok(up2.ok, 'OGG 也能上傳');

    // 假裝成 mp3 的文字檔要被擋
    const f3 = new FormData();
    f3.append('file', new Blob([Buffer.from('this is not audio')], { type: 'audio/mpeg' }), 'evil.mp3');
    const bad3 = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f3 });
    ok(bad3.status === 415, '⭐ 假裝成 MP3 的非音訊檔會被擋下');
  }

  /* ---------- 自訂背景 ---------- */
  step('自訂背景設定');
  {
    const p = await req(`/api/presentations/${demo.id}`, { token });
    ok(p.background && typeof p.background.dim === 'number', '簡報有背景設定（遮罩／模糊）');
    ok(p.background.image === null, '預設沒有背景圖，只用純色');

    await req(`/api/presentations/${demo.id}`, {
      method: 'PUT',
      token,
      body: { background: { image: '/uploads/fake-0000000000000000.png', dim: 70, blur: 9, auto: true } },
    });
    const after = await req(`/api/presentations/${demo.id}`, { token });
    ok(after.background.dim === 70 && after.background.blur === 9, '⭐ 背景的遮罩與模糊設定有存下來');

    // 場次要把背景送給主持端與參與者，兩邊才會長一樣
    const h3 = await connect();
    const hv3 = tracker(h3, 'host:sync');
    const o3 = await emit(h3, 'host:open', { presentationId: demo.id, token, origin: BASE });
    hv3.set(o3.view);
    ok(hv3.view.background?.dim === 70, '⭐ 主持端收到背景設定');
    const pb = await connect();
    const jb = await emit(pb, 'player:join', { code: o3.code, name: '背景測試' });
    ok(jb.view.background?.dim === 70, '⭐ 參與者也收到同一份背景設定');
    h3.close();
    pb.close();

    await req(`/api/presentations/${demo.id}`, { method: 'PUT', token, body: { background: p.background } });
  }

  step('結束活動與排行榜');
  await act('goto', { index: hv.view.total - 1 });
  await hv.wait((v) => v.index === hv.view.total - 1, '跳到最後一頁');
  await act('advance');
  await hv.wait((v) => v.state === 'ended', '活動結束');
  ok(hv.view.state === 'ended', '走完最後一頁後自動結束');

  const board = hv.view.players;
  ok(board[0].name === '小明' && board[0].rank === 1, `⭐ 小明第 1 名（${board[0].score} 分）`);
  ok(board[1].score < board[0].score, `小華第 2 名（${board[1].score} 分）`);
  ok(v1.view.podium?.length === 2, '參與者看得到最終排名');

  /* ---------- 結束後重按播放要開新房間 ---------- */
  step('結束後再開一場，不能接回舊房間');
  {
    // 這場已經 ended 了。主持人回後台再按「播放」時，
    // 分頁裡還留著這一場的代碼 —— 絕對不能被接回這個已結束的房間。
    const h5 = await connect();
    const resumed = await emit(h5, 'host:resume', { code, token }).catch((e) => e);
    ok(resumed instanceof Error && /結束/.test(resumed.message), '⭐ 已結束的場次不給接回（這是重按播放跳回舊房間的根因）');

    // 進行中的場次才可以接回（重新整理不能把房間弄丟）
    const h6 = await connect();
    const fresh = await emit(h6, 'host:open', { presentationId: demo.id, token, origin: BASE });
    ok(fresh.code !== code, `⭐ 重新播放拿到全新的房號 ${fresh.code}（舊的是 ${code}）`);
    ok(fresh.view.state === 'lobby', '新房間從大廳開始');
    ok(fresh.view.playerCount === 0, '新房間沒有人，不會沿用舊場次的參與者');

    const h7 = await connect();
    const back = await emit(h7, 'host:resume', { code: fresh.code, token });
    ok(back.ok === true && back.code === fresh.code, '⭐ 進行中的場次仍然可以接回（重新整理不會弄丟房間）');

    // 每次播放都要是獨立的房間
    const h8 = await connect();
    const third = await emit(h8, 'host:open', { presentationId: demo.id, token, origin: BASE });
    ok(third.code !== fresh.code && third.code !== code, '⭐ 每按一次播放就是一個全新房間');

    for (const h of [h5, h6, h7, h8]) h.close();
  }

  step('成績報表');
  const report = await req(`/api/sessions/${code}/report`, { token });
  ok(report.players.length === 2, '報表包含 2 位參與者');
  const contentPages = hv.view.outline.filter((s) => s.type === 'content').length;
  ok(report.slides.length === hv.view.total - contentPages, `報表包含 ${report.slides.length} 個互動頁（內容頁不列入）`);
  ok(report.qa.length === 2, '報表包含 2 則提問');
  const singleReport = report.slides.find((s) => s.type === 'single');
  ok(singleReport.entries.length === 2 && singleReport.entries.every((e) => typeof e.ms === 'number'), '報表記錄每個人的作答與秒數');

  host.close();
  p1.close();
  p2.close();

  /* ---------- 題庫市集 ---------- */
  step('題庫市集（上架 → 瀏覽 → 下載）');
  {
    /*
     * 市集是唯一會碰到雲端的地方，而且只在「逛／上架／下載」三個時刻。
     * 這一節測的是那條管道的資料完整性：傳上去的東西，下載回來要一模一樣。
     * 目前跑在本機驅動上（沒設定 Supabase 時的預設），之後換成 Supabase 驅動
     * 這一整節不用改 —— 測的是介面行為，不是實作。
     */
    const mkBundle = (title, slides, assets = {}) =>
      zipSync({
        'presentation.json': strToU8(JSON.stringify({ title, description: '測試用', slides })),
        ...Object.fromEntries(Object.entries(assets).map(([k, v]) => [`assets/${k}`, strToU8(v)])),
      });

    const publish = async (bundle, author = '出題的人', description = '') => {
      const form = new FormData();
      form.append('bundle', new Blob([bundle], { type: 'application/zip' }), 'b.zip');
      form.append('author', author);
      form.append('description', description);
      const r = await fetch(BASE + '/api/gallery', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };

    const ASSET = '這是一張假裝成圖片的位元組';
    const bundle = mkBundle(
      'CLANNAD 猜圖大會',
      [
        { id: 's1', type: 'reveal', title: '這是誰', options: [{ id: 'o1', text: '渚', correct: true }] },
        { id: 's2', type: 'single', title: '哪一年', options: [{ id: 'o2', text: '2004', correct: true }] },
        { id: 's3', type: 'single', title: '誰寫的', options: [{ id: 'o3', text: '麻枝准', correct: true }] },
      ],
      { '渚.png': ASSET }
    );

    const pub = await publish(bundle, '麵包店老闆', '給同好玩的');
    ok(pub.status === 201, `上架成功（${pub.status}）`);
    ok(pub.body.item.author === '麵包店老闆', '⭐ 上架時填的製作者有記下來');
    ok(!('manageCode' in pub.body), '⭐ 不再發管理碼（刪除一律由管理員處理）');

    // 列表上的題數／題型是伺服器自己拆 zip 算的，不採信 client 送什麼
    ok(pub.body.item.slideCount === 3, `⭐ 題數由伺服器自己算（${pub.body.item.slideCount}）`);
    ok(
      pub.body.item.typeCounts.single === 2 && pub.body.item.typeCounts.reveal === 1,
      `⭐ 題型分布由伺服器自己算（${JSON.stringify(pub.body.item.typeCounts)}）`
    );

    // 壞東西一律擋在上架，不要等別人下載了才發現
    const bad = [
      [await publish(new Uint8Array([1, 2, 3, 4])), '不是 zip'],
      [await publish(zipSync({ 'readme.txt': strToU8('hi') })), '沒有 presentation.json'],
      [await publish(mkBundle('壞題型', [{ id: 'x', type: '我亂打的', title: 'x' }])), '不認得的題型'],
      [await publish(mkBundle('空的', [])), '沒有題目'],
      [await publish(bundle, ''), '沒填製作者'],
    ];
    for (const [res, label] of bad) ok(res.status === 400, `⭐ ${label} 會被擋下（${res.status}）`);

    const noAuth = await fetch(BASE + '/api/gallery', { method: 'POST', body: new FormData() });
    ok(noAuth.status === 401, '⭐ 沒有主持人身分不能上架');

    // 搜尋與題型篩選
    await publish(
      mkBundle('海龜湯之夜', [{ id: 'a', type: 'soup', title: '湯', accepted: ['x'], hints: [{ text: 'a' }, { text: 'b' }] }]),
      '出湯的人'
    );
    const all = await req('/api/gallery');
    ok(
      all.total === 2 && all.remote === false,
      `列出 ${all.total} 筆（來源：${all.source}）：${all.items.map((i) => `${i.title}/${i.author}`).join('、')}`
    );
    const search = await req('/api/gallery?q=' + encodeURIComponent('海龜'));
    ok(search.total === 1 && search.items[0].title === '海龜湯之夜', '⭐ 搜尋得到');
    const byType = await req('/api/gallery?type=reveal');
    ok(byType.total === 1 && byType.items[0].title === 'CLANNAD 猜圖大會', '⭐ 依題型篩選得到');

    // 下載回來的必須跟傳上去的一模一樣 —— 這是這條管道唯一的責任
    const id = pub.body.item.id;
    const dl = await fetch(`${BASE}/api/gallery/${id}/download`);
    ok(dl.status === 200 && dl.headers.get('content-type') === 'application/zip', '下載得到 zip');
    const got = new Uint8Array(await dl.arrayBuffer());
    const files = unzipSync(got);
    const back = JSON.parse(new TextDecoder().decode(files['presentation.json']));
    ok(back.title === 'CLANNAD 猜圖大會' && back.slides.length === 3, '⭐ 下載回來的題目內容一致');
    ok(new TextDecoder().decode(files['assets/渚.png']) === ASSET, '⭐ 素材逐位元組一致');

    const after = await req(`/api/gallery/${id}`);
    ok(after.downloads === 1, `下載數有累加（${after.downloads}）`);

    // 管理碼拿掉了：一般人沒有任何刪除管道，只有市集後台能刪
    const noRoute = await fetch(`${BASE}/api/gallery/${id}`, { method: 'DELETE' });
    ok(noRoute.status === 405 || noRoute.status === 404, `⭐ 沒有「憑管理碼下架」這條路了（${noRoute.status}）`);

    const del = await fetch(`${BASE}/api/gallery-admin/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    ok(del.status === 200, '市集後台刪得掉');
    const gone = await fetch(`${BASE}/api/gallery/${id}`);
    ok(gone.status === 404, '⭐ 刪掉後就查不到了');
  }

  /* ---------- 市集封面與外部網址 ---------- */
  step('市集封面與外部網址');
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    const pub = async (files, author = '封面測試') => {
      const form = new FormData();
      form.append('bundle', new Blob([zipSync(files)], { type: 'application/zip' }), 'b.zip');
      form.append('author', author);
      const r = await fetch(BASE + '/api/gallery', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
      });
      return (await r.json()).item;
    };
    const pres = (title, slides) => strToU8(JSON.stringify({ title, slides }));

    // 封面 = 第一張有配圖的投影片，上架時就抽出來另存
    const a = await pub({
      'presentation.json': pres('有封面', [
        { id: 'a', type: 'content', title: '開場', image: 'assets/封面.png' },
        { id: 'b', type: 'single', title: 'x', options: [{ id: 'o', text: 'a', correct: true }] },
      ]),
      'assets/封面.png': png,
    });
    ok(!!a.cover, `⭐ 抽得出封面（${a.cover}）`);
    // 本機驅動給的是相對路徑、雲端給的是絕對網址，用 new URL 兩種都接得住
    const coverUrl = (c) => new URL(c, BASE).href;
    const cov = await fetch(coverUrl(a.cover));
    ok(cov.status === 200 && cov.headers.get('content-type') === 'image/png', '⭐ 封面圖抓得到而且型別正確');

    /*
     * 解說圖絕對不能當封面 —— 那張圖常常直接畫著答案，
     * 拿去當封面等於在市集列表上把答案貼出來。
     */
    const b = await pub({
      'presentation.json': pres('只有解說圖', [
        { id: 'a', type: 'single', title: 'x', explain: { text: '答案', image: 'assets/答案.png' }, options: [{ id: 'o', text: 'a', correct: true }] },
      ]),
      'assets/答案.png': png,
    });
    ok(b.cover === null, '⭐ 解說圖不會被拿去當封面（會爆雷）');

    // 外部網址：不打包，原樣帶著走
    const c = await pub({
      'presentation.json': pres('用網址', [
        { id: 'a', type: 'reveal', title: '猜', image: 'https://example.com/cg.png', options: [{ id: 'o', text: 'a', correct: true }] },
        { id: 'b', type: 'music', title: '聽', audio: 'https://example.com/song.mp3', options: [{ id: 'o2', text: 'a', correct: true }] },
      ]),
    });
    ok(c.cover === 'https://example.com/cg.png', '⭐ 圖片用外部網址時，封面直接就是那個網址');
    ok(c.hasAssets === false, '⭐ 外部網址不打包，所以沒有素材');

    const zip = unzipSync(new Uint8Array(await (await fetch(`${BASE}/api/gallery/${c.id}/download`)).arrayBuffer()));
    const back = JSON.parse(new TextDecoder().decode(zip['presentation.json']));
    ok(back.slides[0].image === 'https://example.com/cg.png', '⭐ 下載回來圖片網址原樣保留');
    ok(back.slides[1].audio === 'https://example.com/song.mp3', '⭐ 下載回來音檔網址原樣保留');

    // 沒配圖就是沒封面
    const d = await pub({
      'presentation.json': pres('純文字', [{ id: 'a', type: 'single', title: 'x', options: [{ id: 'o', text: 'a', correct: true }] }]),
    });
    ok(d.cover === null, '沒有配圖的題庫就沒有封面');

    // 收乾淨，順便驗封面檔案有沒有跟著刪
    for (const it of [a, b, c, d]) {
      await fetch(`${BASE}/api/gallery-admin/${it.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
    }
    ok((await fetch(coverUrl(a.cover))).status === 404, '⭐ 刪掉題庫，封面檔案也跟著走（不留孤兒）');
  }

  /* ---------- Supabase 錯誤翻譯 ---------- */
  step('Supabase 的錯誤要翻成人話');
  {
    /*
     * 這些 body 是實際打 Supabase API 收下來的原文，不是編的。
     * 重點：Storage 的錯誤一律回 HTTP 400，真正的碼藏在 body 的 statusCode 裡 ——
     * 只看 res.status 會得到「失敗（400）」這種等於沒講的訊息。
     */
    const say = async (status, body) =>
      (await req('/api/diag/explain', { method: 'POST', token, body: { status, body } })).message;

    const quota = await say(400, JSON.stringify({ statusCode: '507', error: 'Insufficient Storage', message: 'Storage quota exceeded' }));
    ok(quota.includes('容量不足'), `⭐ 容量不足講得出來：${quota.slice(0, 24)}…`);

    const tooBig = await say(400, JSON.stringify({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }));
    ok(tooBig.includes('沒對齊') && tooBig.includes('supabase-setup.sql'), `⭐ 雲端上限比程式小 → 叫他重跑 SQL：${tooBig.slice(0, 20)}…`);

    const noBucket = await say(400, JSON.stringify({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }));
    ok(noBucket.includes('supabase-setup.sql'), '⭐ 桶子不存在 → 叫他跑 SQL');

    // 舊表的 CHECK 上限太小（檔案傳得上去、資料列插不進來）：不要再誤說「太大」，
    // 要認出是哪個欄位、並指去重跑 SQL（新版會把 CHECK 對齊）
    const oldBytes = await say(400, JSON.stringify({ code: '23514', message: 'new row for relation "gallery_items" violates check constraint "gallery_items_bundle_bytes_check"' }));
    ok(oldBytes.includes('supabase-setup.sql') && !oldBytes.includes('超過雲端資料庫的限制（上限'), `⭐ 舊版上限擋下 → 叫他重跑 SQL（不再一律說「太大」）：${oldBytes.slice(0, 24)}…`);
    const descLong = await say(400, JSON.stringify({ code: '23514', message: 'violates check constraint "gallery_items_description_check"' }));
    ok(descLong.includes('說明') && descLong.includes('500'), '⭐ 違反的是說明長度 → 講清楚是說明超過 500 字，不是整包太大');

    const noFn = await say(404, JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.publish_item(p_title) in the schema cache' }));
    ok(noFn.includes('重新跑一次'), '⭐ 函式簽章不符 → 叫他重跑 SQL');

    const noTable = await say(404, JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.gallery_items' in the schema cache" }));
    ok(noTable.includes('gallery_items'), '⭐ 資料表不存在 → 講清楚是哪張表');

    const badKey = await say(401, JSON.stringify({ message: 'Invalid API key', hint: 'Double check your API key.' }));
    ok(badKey.includes('金鑰'), '⭐ 金鑰不對 → 叫他重新複製');

    const asleep = await say(503, 'Service Unavailable');
    ok(asleep.includes('暫停'), '⭐ 5xx → 提醒免費專案閒置七天會自動暫停');

    // 認不出來的不要硬掰，原文附上比較有用
    const weird = await say(400, JSON.stringify({ message: 'something nobody predicted' }));
    ok(weird.includes('something nobody predicted'), '⭐ 認不出來的錯誤原文附上，不要硬掰');
  }

  /* ---------- 市集後台 ---------- */
  step('市集後台（檢舉、隱藏、刪除）');
  {
    const form = new FormData();
    form.append(
      'bundle',
      new Blob([
        zipSync({
          'presentation.json': strToU8(
            JSON.stringify({ title: '會被檢舉的題庫', slides: [{ id: 'z', type: 'single', title: 'x', options: [{ id: 'o', text: 'a', correct: true }] }] })
          ),
        }),
      ]),
      'b.zip'
    );
    form.append('author', '被檢舉的人');
    const pub = await (
      await fetch(BASE + '/api/gallery', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form })
    ).json();
    const id = pub.item.id;

    const admin = (path, opts = {}) =>
      fetch(BASE + '/api/gallery-admin' + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
      });

    // 路徑要用 gallery-admin，不能是 gallery/admin —— 後者會被 /api/gallery/[id] 吃掉
    const noAuth = await fetch(BASE + '/api/gallery-admin');
    ok(noAuth.status === 401, '⭐ 市集後台要主持人密碼');

    const listed = await (await admin('')).json();
    ok(listed.items.some((i) => i.id === id), '後台列得出剛上架的');

    // 檢舉三次會自動隱藏 —— 一個人的誤按不該讓東西消失
    const report = () =>
      fetch(`${BASE}/api/gallery/${id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '亂傳' }),
      });
    await report();
    await report();
    ok((await req('/api/gallery?q=' + encodeURIComponent('會被檢舉'))).total === 1, '被檢舉兩次還看得到');
    await report();
    ok((await req('/api/gallery?q=' + encodeURIComponent('會被檢舉'))).total === 0, '⭐ 累積三次檢舉自動隱藏');
    ok((await (await admin('')).json()).items.find((i) => i.id === id)?.status === 'hidden', '後台看得到它是 hidden');

    // 誤報要救得回來
    const back = await admin(`/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
    ok(back.status === 200, '後台可以放回去');
    ok((await req('/api/gallery?q=' + encodeURIComponent('會被檢舉'))).total === 1, '⭐ 誤報救得回來');
    ok(
      (await (await admin('')).json()).items.find((i) => i.id === id)?.reports.length === 0,
      '⭐ 放回去時清掉檢舉紀錄（不然下一個檢舉又立刻壓下去）'
    );

    const badStatus = await admin(`/${id}`, { method: 'PATCH', body: JSON.stringify({ status: '亂寫' }) });
    ok(badStatus.status === 400, '亂給 status 會被擋');

    // 後台刪除不用管理碼
    const del = await admin(`/${id}`, { method: 'DELETE' });
    ok(del.status === 200, '⭐ 後台不用管理碼就刪得掉');
    ok((await fetch(`${BASE}/api/gallery/${id}`)).status === 404, '刪掉就真的不在了');
    ok((await admin(`/${id}`, { method: 'DELETE' })).status === 404, '刪不存在的回 404');
  }

  /* ---------- 收尾 ---------- */

  async function nextSlide(index) {
    // results → leaderboard → 下一頁；用 goto 直接跳比較穩
    await act('goto', { index });
    await hv.wait((v) => v.state === 'live' && v.index === index, `跳到第 ${index + 1} 頁`);
    await v1.wait((v) => v.index === index && v.state === 'live');
    await v2.wait((v) => v.index === index && v.state === 'live');
  }

  /** 依題型找頁碼 —— 不要寫死索引，示範簡報加題目時測試才不會整排壞掉 */
  function indexOfType(type) {
    const i = hv.view.outline.findIndex((s) => s.type === type);
    if (i < 0) throw new Error(`示範簡報裡找不到題型：${type}`);
    return i;
  }

  async function gotoType(type) {
    await nextSlide(indexOfType(type));
    return hv.view.slide;
  }
}

main()
  .then(() => {
    console.log(`\n${'─'.repeat(52)}`);
    if (fail === 0) console.log(`\x1b[32m\x1b[1m ✓ 全部通過：${pass} 項檢查\x1b[0m\n`);
    else console.log(`\x1b[31m\x1b[1m ✗ ${fail} 項失敗 / ${pass + fail} 項\x1b[0m\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n\x1b[31m測試中斷：' + err.message + '\x1b[0m');
    console.error(err.stack);
    process.exit(1);
  });
