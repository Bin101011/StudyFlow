// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9395;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "edge_t_"))}`, "--window-size=1400,900", "--no-first-run", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") { const s = JSON.stringify(d.params.exceptionDetails); if (!/chrome-extension|Receiving end does not exist/.test(s)) jsErrors.push(s.slice(0, 500)); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("시간 초과: " + method)); } }, 20000); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
const shot = async (name) => { if (!outDir) return; const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64")); };
const T0 = Date.now(); let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(((Date.now() - T0) / 1000).toFixed(0) + "s " + (ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  [" + (typeof x === "string" ? x : JSON.stringify(x)) + "]")); };
const api = async (url, method = "GET", body) => { const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };

// ----- 마우스/키보드 -----
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && buttons === 0 ? "none" : "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1 });
async function click(x, y) { await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); }
async function drag(x1, y1, x2, y2, steps = 8) {
  await mouse("mouseMoved", x1, y1, 0); await mouse("mousePressed", x1, y1);
  for (let i = 1; i <= steps; i++) await mouse("mouseMoved", x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, 1);
  await mouse("mouseReleased", x2, y2);
}
const key = (k, extra = {}) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "Escape" ? 27 : 0, text: k === "Enter" ? "\r" : undefined, ...extra });
const type = (text) => send("Input.insertText", { text });

// 시간표 안의 위치: 분 → 화면 좌표 (그 분이 보이도록 스크롤한 뒤 계산)
async function posAt(min, xOffset = 120) {
  await js(`timelineScroll.scrollTop = Math.max(0, minToY(${min}) - timelineScroll.clientHeight / 2)`);
  await sleep(150);   // 스크롤 이벤트(시간표가 스크롤되면 작은 창이 닫힌다)가 먼저 지나가도록 기다린다
  return JSON.parse(await js(`(() => { const r = timelineGrid.getBoundingClientRect(); return JSON.stringify({ x: r.left + ${xOffset}, y: r.top + minToY(${min}) }); })()`));
}
const plans = async () => (await api("/api/time-blocks?date=" + today)).data;
const planTitles = () => js(`[...document.querySelectorAll("#timeline-grid .tl-plan")].map(b => b.querySelector(".tl-title") ? b.querySelector(".tl-title").textContent : "")`);
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
const rowRect = (text) => js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === ${JSON.stringify(text)}); if (!li) return null; const r = li.querySelector(".task-content").getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(500);
const today = await js(`viewedDate`);
const HOUR = await js(`tlHourPx`);


console.log("--- 오늘 할 일 순서 ---");
const today2 = await js(`viewedDate`);
// 목록의 줄들: 제목, 번호, 끝냈는지, 끌 수 있는지 (위에서 아래 순서)
const rowsInfo = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#today-tasks .task-row")].map(li => ({ t: li.querySelector(".task-content").textContent, rank: li.querySelector(".task-rank") ? li.querySelector(".task-rank").textContent : null, first: !!li.querySelector(".task-rank.first"), done: li.dataset.done === "1", drag: li.classList.contains("task-draggable") })))`));
const titles = async () => (await rowsInfo()).map((r) => r.t);
const apiTitles = async () => (await api("/api/tasks?date=" + today2)).data.tasks.map((t) => t.content);
const box = (title) => js(`(() => { const li = [...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(title)}); const r = li.getBoundingClientRect(); const c = li.querySelector(".task-content").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2, x: c.left + 20 }; })()`);
const reloadList = async () => { await js(`loadToday()`); await sleep(1500); };
await reloadList();

let info = await rowsInfo();
check("처음 순서는 만든 순서(발표 자료 → LC → 장보기)", JSON.stringify(info.map((r) => r.t)) === JSON.stringify(["발표 자료 만들기", "LC 파트 풀기", "장보기"]), info);
check("끝내지 않은 할 일이 둘 이상이면 1, 2, 3 번호가 붙고 1번만 파랗다", JSON.stringify(info.map((r) => r.rank)) === '["1","2","3"]' && info[0].first && !info[1].first, info);
check("끝내지 않은 줄은 모두 끌 수 있다(프로젝트 할 일 포함)", info.every((r) => r.drag), info);
await shot("o_before.png");

// 1. 3번째를 맨 위로
let b3 = await box("장보기"), b1 = await box("발표 자료 만들기");
await mouse("mouseMoved", b3.x, b3.mid, 0); await mouse("mousePressed", b3.x, b3.mid);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", b3.x, b3.mid + (b1.top + 4 - b3.mid) * i / 8, 1);
await sleep(200);
const line = JSON.parse(await js(`(() => { const l = document.querySelector(".task-drop-line"); if (!l) return "null"; const a = document.querySelector("#tasks-column .column-scroll"); return JSON.stringify({ top: l.getBoundingClientRect().top, h: l.getBoundingClientRect().height }); })()`));
check("끄는 동안 놓일 자리에 파란 줄이 보인다(맨 위 줄의 위쪽 경계)", line && Math.abs(line.top - b1.top) <= 3, [line, b1]);
await shot("o_dragging.png");
await mouse("mouseReleased", b3.x, b1.top + 4);
check("놓으면 순서가 바뀐다: 장보기가 맨 위", await waitFor(async () => (await titles())[0] === "장보기", 4000), await titles());
info = await rowsInfo();
check("번호도 따라 바뀐다(장보기 1번, 발표 2번, LC 3번)", JSON.stringify(info.map((r) => r.t + ":" + r.rank)) === JSON.stringify(["장보기:1", "발표 자료 만들기:2", "LC 파트 풀기:3"]), info);
check("서버에 저장됐다", JSON.stringify(await apiTitles()) === JSON.stringify(["장보기", "발표 자료 만들기", "LC 파트 풀기"]), await apiTitles());
check("놓고 나면 파란 줄이 사라진다", !(await js(`!!document.querySelector(".task-drop-line")`)));
await reloadList();
check("다시 불러와도 순서가 유지된다", JSON.stringify(await titles()) === JSON.stringify(["장보기", "발표 자료 만들기", "LC 파트 풀기"]), await titles());

// 2. 맨 위를 맨 아래로(마지막 줄 아래로)
b1 = await box("장보기"); b3 = await box("LC 파트 풀기");
await drag(b1.x, b1.mid, b1.x, b3.bottom + 3, 8);
check("맨 위 줄을 마지막 줄 아래로 끌면 맨 뒤로 간다", await waitFor(async () => JSON.stringify(await titles()) === JSON.stringify(["발표 자료 만들기", "LC 파트 풀기", "장보기"]), 4000), await titles());

// 3. 가운데로 (프로젝트 할 일을 끌기)
let bA = await box("발표 자료 만들기"), bB = await box("LC 파트 풀기"), bC = await box("장보기");
await drag(bA.x, bA.mid, bA.x, bC.top + 4, 8);   // 장보기 위쪽 경계(= LC 뒤, 장보기 앞)
check("프로젝트 할 일도 끌어서 가운데로 옮길 수 있다", await waitFor(async () => JSON.stringify(await titles()) === JSON.stringify(["LC 파트 풀기", "발표 자료 만들기", "장보기"]), 4000), await titles());

// 4. Esc로 취소
bA = await box("LC 파트 풀기"); bC = await box("장보기");
await mouse("mouseMoved", bA.x, bA.mid, 0); await mouse("mousePressed", bA.x, bA.mid);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", bA.x, bA.mid + (bC.bottom + 3 - bA.mid) * i / 6, 1);
await key("Escape"); await mouse("mouseReleased", bA.x, bC.bottom + 3); await sleep(700);
check("끄는 중 Esc를 누르면 순서가 그대로다", JSON.stringify(await titles()) === JSON.stringify(["LC 파트 풀기", "발표 자료 만들기", "장보기"]) && !(await js(`!!document.querySelector(".task-drop-line")`)), await titles());

// 5. 같은 자리에 놓으면 아무 일도 없다(순서 유지)
bA = await box("발표 자료 만들기");
await drag(bA.x, bA.mid, bA.x, bA.mid + 2, 6);
await sleep(600);
check("제자리에 놓으면 순서가 그대로다", JSON.stringify(await titles()) === JSON.stringify(["LC 파트 풀기", "발표 자료 만들기", "장보기"]), await titles());

// 6. 밀린 할 일 → 목록의 두 번째 자리
await reloadList();
const overdueHas = await js(`!document.getElementById("overdue-section").hidden`);
check("(준비) 밀린 할 일이 있다", overdueHas);
let od = await js(`(() => { const li = [...document.querySelectorAll("#overdue-tasks .task-row")][0]; const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2, text: li.querySelector(".task-content").textContent }; })()`);
b1 = await box("LC 파트 풀기"); bB = await box("발표 자료 만들기");
await drag(od.x, od.y, od.x, bB.top + 4, 10);   // LC 뒤, 발표 앞
check("밀린 할 일을 오늘 목록의 두 번째 자리에 놓으면 오늘 할 일이 되어 그 자리에 들어간다", await waitFor(async () => (await titles())[1] === od.text, 5000), await titles());
check("그 할 일의 날짜가 오늘로 바뀌었다", (await api("/api/tasks?date=" + today2)).data.tasks.some((t) => t.content === od.text));
check("밀린 할 일 구역에서는 사라진다", await js(`document.getElementById("overdue-section").hidden`));
check("알림이 '2번째로 정했습니다'를 알려 준다", /2번째로 정했습니다/.test(await js(`document.getElementById("toast").textContent`)), await js(`document.getElementById("toast").textContent`));

// 7. 할 일 목록(수집함) → 맨 위
const inboxRow = await js(`(() => { const li = [...document.querySelectorAll("#inbox-tasks .task-row")][0]; const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2, text: li.querySelector(".task-content").textContent }; })()`);
b1 = await box((await titles())[0]);
await drag(inboxRow.x, inboxRow.y, b1.x, b1.top + 3, 10);
check("할 일 목록의 할 일을 오늘 목록 맨 위에 놓으면 오늘 할 일 1번이 된다", await waitFor(async () => (await titles())[0] === inboxRow.text, 5000), await titles());
check("수집함에서는 빠진다", !(await js(`[...document.querySelectorAll("#inbox-tasks .task-content")].some(c => c.textContent === ${JSON.stringify(inboxRow.text)})`)));
await shot("o_after_inbox.png");

// 8. 체크: 끝낸 것은 아래로, 번호가 다시 매겨진다. 체크를 풀면 제자리로
const order0 = await titles();
await js(`[...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(order0[1])}).querySelector("input[type=checkbox]").click()`);
await sleep(1500);
info = await rowsInfo();
check("끝낸 할 일은 맨 아래로 가고 번호가 없다", info[info.length - 1].t === order0[1] && info[info.length - 1].done && info[info.length - 1].rank === null && !info[info.length - 1].drag, info);
check("나머지 번호는 1부터 다시 매겨진다", info.filter((r) => !r.done).every((r, i) => r.rank === String(i + 1)), info);
await js(`[...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(order0[1])}).querySelector("input[type=checkbox]").click()`);
await sleep(1500);
check("체크를 풀면 정해 둔 자리(2번째)로 돌아온다", JSON.stringify(await titles()) === JSON.stringify(order0), await titles());

// 9. 새 할 일은 맨 뒤에 붙고 번호가 이어진다
await js(`document.getElementById("task-input").value = "새로 적은 할 일"; document.getElementById("task-add-button").click()`); await sleep(1500);
info = await rowsInfo();
check("새로 적은 할 일은 맨 뒤(번호가 이어짐)에 붙는다", info[info.length - 1].t === "새로 적은 할 일" && info[info.length - 1].rank === String(info.length), info);

// 10. 하나만 남으면 번호를 숨긴다
const all = (await api("/api/tasks?date=" + today2)).data.tasks;
for (const t of all.slice(1)) await api("/api/tasks/" + t.id, "PATCH", { done: true });
await reloadList();
info = await rowsInfo();
check("끝내지 않은 할 일이 하나뿐이어도 1이 보인다(끝낸 할 일에는 없음)", info.filter((r) => !r.done).length === 1 && info.filter((r) => !r.done)[0].rank === "1" && info.filter((r) => r.done).every((r) => r.rank === null), info);
// 하나뿐일 때도 번호 ↔ 점을 오갈 수 있다 (예전에는 점을 눌러 번호를 붙이면 번호 칸이 사라져서 다시 점으로 못 돌렸다)
const oneTitle = info.find((r) => !r.done).t;
const oneRank = () => js(`(() => { const li = [...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(oneTitle)}); const b = li.querySelector(".task-rank"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent }; })()`);
let one = await oneRank(); await click(one.x, one.y);
check("하나뿐인 할 일의 1을 누르면 점이 된다", await waitFor(async () => ((await oneRank()) || {}).text === "·", 4000), await oneRank());
one = await oneRank(); await click(one.x, one.y);
check("점을 누르면 다시 1이 된다", await waitFor(async () => ((await oneRank()) || {}).text === "1", 4000), await oneRank());
one = await oneRank(); await click(one.x, one.y);
check("다시 누르면 또 점이 된다(번호 칸이 사라지지 않는다)", await waitFor(async () => ((await oneRank()) || {}).text === "·", 4000), await oneRank());
await api("/api/tasks/" + all[0].id, "PATCH", { no_rank: false });
for (const t of all.slice(1)) await api("/api/tasks/" + t.id, "PATCH", { done: false });

// 10b. 번호 없는 할 일: 번호 글자를 누르면 번호에서 빠지고 점이 남는다(글자는 "·", 모양은 CSS로 그린 5px 동그라미). 줄 자리는 그대로이고 번호만 건너뛴다
console.log("--- 번호 없는 할 일 ---");
await reloadList();
const rankRect = (title) => js(`(() => { const li = [...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(title)}); const b = li.querySelector(".task-rank"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, tag: b.tagName }; })()`);
const noRankOf = async (title) => (await api("/api/tasks?date=" + today2)).data.tasks.find((t) => t.content === title).no_rank;
const checkLefts = () => js(`[...document.querySelectorAll("#today-tasks .task-row")].filter(l => l.dataset.done !== "1").map(l => Math.round(l.querySelector("input[type=checkbox]").getBoundingClientRect().left))`);
const orderNR = await titles();
const X = orderNR[1];   // 2번 줄
let rr = await rankRect(X);
check("번호 글자는 누를 수 있는 버튼이다", rr && rr.tag === "BUTTON", rr);
await click(rr.x, rr.y);
check("번호를 누르면 서버에 번호 없음(no_rank 1)으로 저장된다", await waitFor(async () => (await noRankOf(X)) === 1, 4000));
await waitFor(async () => (await rowsInfo()).find((r) => r.t === X).rank === "·", 3000);
info = await rowsInfo();
let open = info.filter((r) => !r.done);
check("번호를 뺀 줄은 번호 자리에 점이 남는다", open[1].t === X && open[1].rank === "·" && !open[1].first, info);
check("줄 자리는 그대로다(누르기가 끌기로 이어지지 않음)", JSON.stringify(await titles()) === JSON.stringify(orderNR), await titles());
check("나머지 번호는 건너뛰어 1, 2, 3…으로 이어진다", JSON.stringify(open.filter((r) => r.t !== X).map((r) => r.rank)) === JSON.stringify(open.slice(1).map((_, i) => String(i + 1))), open);
check("1번은 여전히 파랗다", open[0].rank === "1" && open[0].first, open[0]);
let lefts = await checkLefts();
check("점이 있는 줄도 체크박스가 다른 줄과 같은 선에 있다", lefts.every((x) => x === lefts[0]), lefts);
check("점도 번호와 같은 폭이다", (await rankRect(X)).w === (await rankRect(open[0].t)).w, [await rankRect(X), await rankRect(open[0].t)]);
const dotStyle = await js(`(() => { const li = [...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(X)}); const s = getComputedStyle(li.querySelector(".task-rank"), "::before"); return { w: s.width, h: s.height, bg: s.backgroundColor }; })()`);
check("점은 지름 5px의 회색 동그라미로 그려진다(글자 점이 아니라)", dotStyle.w === "5px" && dotStyle.h === "5px" && dotStyle.bg !== "rgba(0, 0, 0, 0)", dotStyle);
await shot("o_norank.png");

// 번호 없는 줄을 끌어서 맨 위로: 자리는 바뀌고 여전히 점, 1번은 그다음 줄이 된다
let bX = await box(X), bTop = await box(orderNR[0]);
await drag(bX.x, bX.mid, bX.x, bTop.top + 4, 8);
check("번호 없는 줄도 끌어서 순서를 바꿀 수 있다", await waitFor(async () => (await titles())[0] === X, 4000), await titles());
info = await rowsInfo(); open = info.filter((r) => !r.done);
check("맨 위에 있어도 점이고, 1번(파랑)은 그다음 줄이다", open[0].rank === "·" && !open[0].first && open[1].rank === "1" && open[1].first, open);

// 할 일 목록에서 끌어와 점 줄 바로 뒤에 놓으면 알림은 화면 번호대로 "1번째"
const inboxTitle = "번호 확인용 수집함 할 일";
await api("/api/tasks", "POST", { content: inboxTitle, date: null, projectId: null });
await js(`reloadTodayAndInbox()`); await sleep(1500);
const ib = await js(`(() => { const li = [...document.querySelectorAll("#inbox-tasks .task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(inboxTitle)}); const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2 }; })()`);
const second = await box((await titles())[1]);
await drag(ib.x, ib.y, second.x, second.top + 4, 10);
check("(준비) 수집함 할 일이 점 줄 뒤(두 번째 줄)에 들어간다", await waitFor(async () => (await titles())[1] === inboxTitle, 5000), await titles());
const toastNR = await js(`document.getElementById("toast").textContent`);
check("알림의 'N번째'는 번호 없는 줄을 세지 않는다(1번째)", /1번째로 정했습니다/.test(toastNR), toastNR);
info = await rowsInfo();
check("화면에서도 그 줄이 1번이다", info.find((r) => r.t === inboxTitle).rank === "1", info);

// 점을 누르면 번호가 다시 붙는다
rr = await rankRect(X);
await click(rr.x, rr.y);
check("점을 누르면 번호가 다시 붙는다(no_rank 0)", await waitFor(async () => (await noRankOf(X)) === 0, 4000));
await waitFor(async () => (await rowsInfo()).find((r) => r.t === X).rank === "1", 3000);
info = await rowsInfo(); open = info.filter((r) => !r.done);
check("모든 줄이 다시 1부터 번호를 가진다", open.every((r, i) => r.rank === String(i + 1)) && open[0].t === X, open);

// 번호 있는 할 일이 하나뿐이어도 번호 없는 할 일이 있으면 번호 칸을 보인다(점을 눌러 되돌릴 수 있어야 하므로)
const all2 = (await api("/api/tasks?date=" + today2)).data.tasks.filter((t) => !t.done);
for (const t of all2.slice(2)) await api("/api/tasks/" + t.id, "PATCH", { done: true });
await api("/api/tasks/" + all2[1].id, "PATCH", { no_rank: true });
await reloadList();
info = await rowsInfo(); open = info.filter((r) => !r.done);
check("번호 있는 할 일 하나 + 번호 없는 할 일 하나: '1'과 '·'가 보인다", JSON.stringify(open.map((r) => r.rank)) === '["1","·"]', open);
await api("/api/tasks/" + all2[0].id, "PATCH", { no_rank: true });
await reloadList();
info = await rowsInfo(); open = info.filter((r) => !r.done);
check("모두 번호 없으면 모두 점이다", JSON.stringify(open.map((r) => r.rank)) === '["·","·"]', open);
check("끝낸 할 일에는 번호도 점도 없다", info.filter((r) => r.done).every((r) => r.rank === null), info);
// 끝내지 않은 할 일과 끝낸 할 일 사이의 구분선: 끝낸 첫 줄에만 있고, 그 줄 위쪽 여백(두 줄 사이)에 있다
const dividers = await js(`[...document.querySelectorAll("#today-tasks .task-row")].map((l, i, all) => { const s = getComputedStyle(l, "::before"); const has = s.content !== "none" && s.borderTopStyle === "solid"; const r = l.getBoundingClientRect(); const prev = i > 0 ? all[i - 1].getBoundingClientRect() : null; return { done: l.dataset.done, has, gapTop: prev ? Math.round(r.top - prev.bottom) : null, lineTop: parseFloat(s.top) }; })`);
const firstDone = dividers.findIndex((d) => d.done === "1");
check("구분선은 끝낸 첫 줄 위 하나뿐이다", firstDone > 0 && dividers.filter((d) => d.has).length === 1 && dividers[firstDone].has, dividers);
check("구분선은 두 줄 사이 틈 안에 있다", dividers[firstDone].lineTop < 0 && -dividers[firstDone].lineTop <= dividers[firstDone].gapTop, dividers[firstDone]);
await shot("o_divider.png");
await api("/api/tasks/" + all2[0].id, "PATCH", { no_rank: false }); await api("/api/tasks/" + all2[1].id, "PATCH", { no_rank: false });
for (const t of all2.slice(2)) await api("/api/tasks/" + t.id, "PATCH", { done: false });
await reloadList();
check("끝낸 할 일이 없으면 구분선도 없다", await js(`[...document.querySelectorAll("#today-tasks .task-row")].every(l => l.dataset.done === "0" && getComputedStyle(l, "::before").content === "none")`));

// 11. 목록이 길어 스크롤될 때: 아래쪽 할 일을 위쪽으로 (끌면서 위 끝에 대고 있으면 목록이 스크롤된다)
for (let i = 1; i <= 22; i++) await api("/api/tasks", "POST", { content: "많은 할 일 " + i, date: today2, projectId: null });
await reloadList();
await js(`document.querySelector("#tasks-column .column-scroll").scrollTop = 99999`); await sleep(300);
const idsBefore = (await api("/api/tasks?date=" + today2)).data.tasks.map((t) => t.id);
const lastOpen = await js(`(() => { const rows = [...document.querySelectorAll("#today-tasks .task-row")].filter(l => l.dataset.done !== "1"); const li = rows[rows.length - 3]; const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2, text: li.querySelector(".task-content").textContent }; })()`);
const area = await js(`(() => { const r = document.querySelector("#tasks-column .column-scroll").getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
await mouse("mouseMoved", lastOpen.x, lastOpen.y, 0); await mouse("mousePressed", lastOpen.x, lastOpen.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", lastOpen.x, lastOpen.y + (area.top + 8 - lastOpen.y) * i / 6, 1);
for (let i = 0; i < 40; i++) await mouse("mouseMoved", lastOpen.x, area.top + 8 + (i % 2), 1);   // 위 끝에 대고 있는다 → 스크롤
const scrolledTop = await js(`document.querySelector("#tasks-column .column-scroll").scrollTop`);
await mouse("mouseReleased", lastOpen.x, area.top + 8);
await sleep(1500);
const idsAfter = (await api("/api/tasks?date=" + today2)).data.tasks.map((t) => t.id);
const newPos = (await titles()).indexOf(lastOpen.text);
check("끄는 동안 위 끝에 대고 있으면 목록이 스크롤된다", scrolledTop < 99999 && scrolledTop >= 0, scrolledTop);
check("긴 목록에서도 끌어 올린 할 일이 원래보다 훨씬 위로 갔다", newPos >= 0 && newPos < 10, newPos);
check("순서를 바꿔도 할 일이 사라지거나 늘지 않는다(번호 집합 동일)", JSON.stringify([...idsBefore].sort()) === JSON.stringify([...idsAfter].sort()), [idsBefore.length, idsAfter.length]);

// 12. 시간표로 끌어다 놓기는 그대로 된다
await reloadList();
const tlRow = await box((await titles())[0]);
const tgt = JSON.parse(await js(`(() => { timelineScroll.scrollTop = minToY(600) - 100; const r = timelineGrid.getBoundingClientRect(); return JSON.stringify({ x: r.left + 150, y: r.top + minToY(600) + 5 }); })()`));
await sleep(200);
await drag(tlRow.x, tlRow.mid, tgt.x, tgt.y, 10);
await sleep(1200);
check("(기존 기능) 할 일을 시간표로 끌어다 놓으면 여전히 계획이 된다", (await api("/api/time-blocks?date=" + today2)).data.some((p) => p.taskId !== null), await api("/api/time-blocks?date=" + today2));

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
