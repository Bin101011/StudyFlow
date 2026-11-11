// Ctrl+Z 되돌리기 시험 (오늘 탭, 단계 9). 헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번.
// 시험 서버의 다른 할 일·계획과 섞이지 않게 60일 뒤 날짜에서 본다.
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9423;
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
// 진짜 Ctrl+Z (modifiers 2 = Ctrl). key를 바꾸면 한글 입력 상태("ㅋ")도 흉내 낼 수 있다
const ctrlZ = async (k = "z", extra = {}) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2, ...extra });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(150);
};
const stackSize = () => js(`undoStack.length`);
const toast = () => js(`document.getElementById("toast").textContent`);
const waitIdle = () => waitFor(async () => !(await js(`undoRunning`)), 6000);
// 포커스를 아무 칸에도 두지 않는다 (사람이 빈 곳을 누른 것과 같다)
const blurAll = () => js(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);

async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
// 시간표 안의 위치: 분 → 화면 좌표 (그 분이 보이도록 스크롤한 뒤 계산)
async function posAt(min, xOffset = 120) {
  await js(`timelineScroll.scrollTop = Math.max(0, minToY(${min}) - timelineScroll.clientHeight / 2)`);
  await sleep(150);
  return JSON.parse(await js(`(() => { const r = timelineGrid.getBoundingClientRect(); return JSON.stringify({ x: r.left + ${xOffset}, y: r.top + minToY(${min}) }); })()`));
}
const blockRect = (title) => js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-plan")].find(x => x.querySelector(".tl-title") && x.querySelector(".tl-title").textContent === ${JSON.stringify(title)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const planTitles = () => js(`[...document.querySelectorAll("#timeline-grid .tl-plan")].map(b => b.querySelector(".tl-title") ? b.querySelector(".tl-title").textContent : "")`);
const popOpen = () => js(`!!document.querySelector(".tl-popover")`);
const popInputs = () => js(`[...document.querySelectorAll(".tl-popover .tl-pop-times input")].length`);
const clickPopTime = async (index) => { const p = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelectorAll(".tl-popover .tl-pop-times input")[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)); await click(p.x, p.y); await sleep(100); await js(`document.activeElement.select()`); };
const openPlan = async (title, min) => { await posAt(min); const b = await blockRect(title); await click(b.x, b.y); await sleep(400); if (!(await popOpen())) { await posAt(min); const b2 = await blockRect(title); await click(b2.x, b2.y); await sleep(400); } };
const rowOf = (title) => `[...document.querySelectorAll("#today-tasks .task-row")].find(l => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === ${JSON.stringify(title)})`;
const box = (title) => js(`(() => { const li = ${rowOf(title)}; if (!li) return null; const r = li.getBoundingClientRect(); const c = li.querySelector(".task-content").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2, x: c.left + 20 }; })()`);
const partRect = (title, selector) => js(`(() => { const li = ${rowOf(title)}; const el = li && li.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const titles = () => js(`[...document.querySelectorAll("#today-tasks .task-row .task-content")].map(c => c.textContent)`);

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(500);

// ----- 준비: 60일 뒤 날짜에 할 일 3개(하나는 계획과 연결), 빈칸 계획 하나 -----
const D = await js(`addDaysToText(todayText, 60)`);
const D2 = await js(`addDaysToText(todayText, 61)`);
const addTask = async (content) => (await api("/api/tasks", "POST", { content, date: D, projectId: null })).data;
const taskA = await addTask("수학 숙제");
const taskB = await addTask("영어 단어");
const taskC = await addTask("독서");
await api("/api/time-blocks", "POST", { date: D, start: 600, end: 660, taskId: taskA.id });
await api("/api/time-blocks", "POST", { date: D, start: 720, end: 750, title: "점심" });
await js(`showDay(${JSON.stringify(D)})`);
await waitFor(async () => (await planTitles()).includes("점심") && (await titles()).length === 3, 8000);
await sleep(300);
const plans = async () => (await api("/api/time-blocks?date=" + D)).data;
const planOf = async (title) => (await plans()).find((x) => x.title === title);
const taskOf = async (taskId) => { const data = (await api("/api/tasks?date=" + D)).data; return data.tasks.find((t) => t.id === taskId); };

console.log("--- 처음: 되돌릴 것이 없다 ---");
await blurAll();
check("(준비) 기록이 비어 있다", (await stackSize()) === 0);
await ctrlZ();
check("기록이 없을 때 Ctrl+Z: '되돌릴 것이 없습니다' 알림", /되돌릴 것이 없습니다/.test(await toast()), await toast());

console.log("--- 계획 끌어서 옮기기 ---");
let p = await posAt(735);
let b = await blockRect("점심");
const HOUR = await js(`tlHourPx`);
await drag(b.x, b.y, b.x, b.y + HOUR, 10);
check("(준비) 점심을 1시간 아래로 끌면 13:00–13:30", await waitFor(async () => { const x = await planOf("점심"); return x.start === 780 && x.end === 810; }), await planOf("점심"));
check("기록이 하나 생긴다", (await stackSize()) === 1);
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 12:00–12:30으로 돌아온다", await waitFor(async () => { const x = await planOf("점심"); return x.start === 720 && x.end === 750; }), await planOf("점심"));
check("알림: '점심'을(를) 12:00–12:30(으)로 되돌렸습니다", (await toast()) === "'점심'을(를) 12:00–12:30(으)로 되돌렸습니다", await toast());
check("시간표 블록도 제자리에 다시 그려진다", await waitFor(async () => (await js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-plan")].find(x => x.querySelector(".tl-title").textContent === "점심"); return b && Math.abs(parseFloat(b.style.top) - minToY(720)) < 1; })()`))));
check("기록은 다시 비었다", (await stackSize()) === 0);

console.log("--- 길이 바꾸기 두 번 → Ctrl+Z 두 번 (가장 최근 것부터) ---");
const resizeBy = async (minutes) => {
  await posAt(735);
  const r = await js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-plan")].find(x => x.querySelector(".tl-title").textContent === "점심"); const h = b.querySelector(".tl-resize").getBoundingClientRect(); return { x: h.left + h.width / 2, y: h.top + h.height / 2 }; })()`);
  await drag(r.x, r.y, r.x, r.y + HOUR * minutes / 60, 8);
};
await resizeBy(30);
await waitFor(async () => (await planOf("점심")).end === 780);
await resizeBy(30);
check("(준비) 길이를 두 번 늘이면 12:00–13:30", await waitFor(async () => (await planOf("점심")).end === 810), await planOf("점심"));
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z 한 번 → 12:00–13:00 (마지막 것만)", await waitFor(async () => (await planOf("점심")).end === 780), await planOf("점심"));
await ctrlZ(); await waitIdle();
check("Ctrl+Z 또 한 번 → 12:00–12:30", await waitFor(async () => (await planOf("점심")).end === 750), await planOf("점심"));

console.log("--- 계획 작은 창: 시간, 이름 + 시간 ---");
await openPlan("점심", 735);
await clickPopTime(0); await type("1500"); await key("Enter");
check("(준비) 작은 창에서 시작 1500 → 15:00–15:30", await waitFor(async () => (await planOf("점심")).start === 900), await planOf("점심"));
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 12:00–12:30", await waitFor(async () => (await planOf("점심")).start === 720 && (await planOf("점심")).end === 750), await planOf("점심"));
await openPlan("점심", 735);
await js(`document.querySelector(".tl-popover .tl-title-input").select()`); await type("점심 약속");
await clickPopTime(0); await type("1300"); await key("Enter");
check("(준비) 이름과 시작을 함께 고침: '점심 약속' 13:00–13:30", await waitFor(async () => { const x = await planOf("점심 약속"); return x && x.start === 780; }), await plans());
check("이름과 시간을 함께 고쳐도 기록은 하나", (await stackSize()) === 1);
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z 한 번에 이름과 시간이 모두 돌아온다('점심' 12:00–12:30)", await waitFor(async () => { const x = await planOf("점심"); return x && x.start === 720 && x.end === 750; }), await plans());
check("알림이 이름과 시간을 말한다", /'점심'의 이름과 시간\(12:00–12:30\)을 되돌렸습니다/.test(await toast()), await toast());

console.log("--- 연결된 계획의 이름(= 할 일 이름) ---");
await openPlan("수학 숙제", 630);
await js(`document.querySelector(".tl-popover .tl-title-input").select()`); await type("수학 숙제 3쪽"); await key("Enter");
check("(준비) 할 일 이름이 '수학 숙제 3쪽'", await waitFor(async () => (await taskOf(taskA.id)).content === "수학 숙제 3쪽"));
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 할 일 이름이 '수학 숙제'로 돌아오고 가운데 줄과 블록도 바뀐다", await waitFor(async () => (await taskOf(taskA.id)).content === "수학 숙제" && (await titles()).includes("수학 숙제") && (await planTitles()).includes("수학 숙제")), [await titles(), await planTitles()]);
check("알림: 이름을 '수학 숙제'(으)로 되돌렸습니다", (await toast()) === "이름을 '수학 숙제'(으)로 되돌렸습니다", await toast());

console.log("--- 계획 만들기(빈칸 클릭) → Ctrl+Z는 지우기 ---");
p = await posAt(960);
await click(p.x, p.y); await sleep(300);
await type("운동"); await key("Enter");
check("(준비) '운동' 계획이 생긴다", await waitFor(async () => !!(await planOf("운동"))), await plans());
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → '운동' 계획이 지워진다", await waitFor(async () => !(await planOf("운동")) && !(await planTitles()).includes("운동")), await plans());
check("알림: '운동' 계획을 지웠습니다 (만들기 되돌림)", (await toast()) === "'운동' 계획을 지웠습니다 (만들기 되돌림)", await toast());

console.log("--- + 시간으로 넣기 → Ctrl+Z는 계획만 지우고 할 일은 남긴다 ---");
await js(`(${rowOf("영어 단어")}).querySelector(".task-slot-empty").click()`); await sleep(300);
check("(준비) 시간 정하기 창이 열렸다", await popOpen());
await type("1700"); await key("Enter");
check("(준비) '영어 단어' 계획 17:00–18:00", await waitFor(async () => { const x = (await plans()).find((y) => y.taskId === taskB.id); return x && x.start === 1020; }), await plans());
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 계획이 지워진다", await waitFor(async () => !(await plans()).some((y) => y.taskId === taskB.id)), await plans());
check("할 일 '영어 단어'는 그 날짜에 그대로 있다", (await taskOf(taskB.id)) !== undefined && (await taskOf(taskB.id)).date === D);

console.log("--- 할 일을 시간표로 끌어다 놓기(같은 날) → Ctrl+Z는 계획 지우기 ---");
p = await posAt(1140);
const rC = await box("독서");
await drag(rC.x, rC.mid, p.x, p.y, 14);
check("(준비) '독서' 계획이 생긴다", await waitFor(async () => (await plans()).some((y) => y.taskId === taskC.id)), await plans());
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 계획이 지워지고 할 일은 그 날짜에 남는다", await waitFor(async () => !(await plans()).some((y) => y.taskId === taskC.id)) && (await taskOf(taskC.id)).date === D, await plans());

console.log("--- 할 일 이름 고치기(두 번 클릭) ---");
const nameAt = await partRect("독서", ".task-content");
await mouse("mouseMoved", nameAt.x, nameAt.y, 0);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: nameAt.x, y: nameAt.y, button: "left", buttons: 1, clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: nameAt.x, y: nameAt.y, button: "left", buttons: 0, clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: nameAt.x, y: nameAt.y, button: "left", buttons: 1, clickCount: 2 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: nameAt.x, y: nameAt.y, button: "left", buttons: 0, clickCount: 2 });
await sleep(200);
check("(준비) 이름 칸이 열렸다", await js(`!!document.querySelector("#today-tasks .task-edit-input")`));
await js(`document.querySelector("#today-tasks .task-edit-input").select()`); await type("소설 읽기"); await key("Enter");
check("(준비) 이름이 '소설 읽기'", await waitFor(async () => (await taskOf(taskC.id)).content === "소설 읽기"));
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → '독서'로 돌아온다", await waitFor(async () => (await taskOf(taskC.id)).content === "독서" && (await titles()).includes("독서")), await titles());

console.log("--- 같은 목록 안의 순서 바꾸기 ---");
const before = await titles();
check("(준비) 처음 순서 수학 → 영어 → 독서", JSON.stringify(before) === JSON.stringify(["수학 숙제", "영어 단어", "독서"]), before);
const bTop = await box("수학 숙제"), bLast = await box("독서");
await drag(bLast.x, bLast.mid, bLast.x, bTop.top + 4, 10);
check("(준비) 독서를 맨 위로", await waitFor(async () => (await titles())[0] === "독서"), await titles());
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 수학 → 영어 → 독서로 돌아온다", await waitFor(async () => JSON.stringify(await titles()) === JSON.stringify(["수학 숙제", "영어 단어", "독서"])), await titles());
check("서버 순서도 돌아왔다", JSON.stringify((await api("/api/tasks?date=" + D)).data.tasks.map((t) => t.content)) === JSON.stringify(["수학 숙제", "영어 단어", "독서"]));
check("알림: 할 일 순서를 되돌렸습니다", (await toast()) === "할 일 순서를 되돌렸습니다", await toast());
const bSame = await box("영어 단어");
const sizeBefore = await stackSize();
await drag(bSame.x, bSame.mid, bSame.x, bSame.mid + 2, 6); await sleep(700);
check("제자리에 놓으면 기록하지 않는다", (await stackSize()) === sizeBefore, await stackSize());

console.log("--- 체크 → Ctrl+Z는 체크 풀기 ---");
await click(...Object.values(await partRect("영어 단어", "input[type=checkbox]")));
check("(준비) '영어 단어' 끝냄", await waitFor(async () => (await taskOf(taskB.id)).done === 1));
await ctrlZ(); await waitIdle();   // 체크박스를 누른 바로 뒤 (blurAll 없이)
check("Ctrl+Z → 체크가 풀리고 끝낸 시각이 지워진다", await waitFor(async () => { const t = await taskOf(taskB.id); return t.done === 0 && t.done_at === null; }), await taskOf(taskB.id));
check("알림: '영어 단어'의 체크를 풀었습니다", (await toast()) === "'영어 단어'의 체크를 풀었습니다", await toast());
check("자리도 원래대로(가운데)", await waitFor(async () => JSON.stringify(await titles()) === JSON.stringify(["수학 숙제", "영어 단어", "독서"])), await titles());

console.log("--- 시간표 작은 창의 '할 일 완료' 체크 ---");
await openPlan("수학 숙제", 630);
await js(`document.querySelector(".tl-popover .tl-pop-check input").click()`);
check("(준비) '수학 숙제' 끝냄", await waitFor(async () => (await taskOf(taskA.id)).done === 1));
await key("Escape"); await sleep(300); await blurAll();
await ctrlZ(); await waitIdle();
check("Ctrl+Z → 체크가 풀린다", await waitFor(async () => (await taskOf(taskA.id)).done === 0), await taskOf(taskA.id));

console.log("--- 번호 빼기 / 넣기 ---");
await click(...Object.values(await partRect("영어 단어", ".task-rank")));
check("(준비) '영어 단어' 번호에서 뺌", await waitFor(async () => (await taskOf(taskB.id)).no_rank === 1));
await blurAll(); await ctrlZ(); await waitIdle();
check("Ctrl+Z → 번호가 다시 붙는다", await waitFor(async () => (await taskOf(taskB.id)).no_rank === 0 && (await js(`(${rowOf("영어 단어")}).querySelector(".task-rank").textContent`)) === "2"));
check("알림: '영어 단어'에 다시 번호를 붙였습니다", (await toast()) === "'영어 단어'에 다시 번호를 붙였습니다", await toast());

console.log("--- 기록하지 않는 동작 ---");
await api("/api/tasks/" + taskB.id, "PATCH", { done: true });
await js(`reloadTodayAndTimeline()`); await sleep(800);
let size = await stackSize();
await click(...Object.values(await partRect("영어 단어", "input[type=checkbox]")));
check("(준비) 체크 풀기", await waitFor(async () => (await taskOf(taskB.id)).done === 0 && (await js(`(${rowOf("영어 단어")}).dataset.done === "0"`))));
check("체크 풀기는 기록하지 않는다", (await stackSize()) === size, await stackSize());
const moved = await js(`(() => { const b = [...(${rowOf("영어 단어")}).querySelectorAll(".task-actions button")].find(x => x.textContent === "다음 날로"); if (!b) return "버튼 없음"; b.click(); return "ok"; })()`);
check("(준비) '다음 날로'로 옮김", moved === "ok" && await waitFor(async () => (await taskOf(taskB.id)) === undefined), moved);
check("날짜 옮기기는 기록하지 않는다", (await stackSize()) === size, await stackSize());
await api("/api/tasks/" + taskB.id, "PATCH", { date: D });
await js(`reloadTodayAndTimeline()`); await sleep(800);

console.log("--- Ctrl+Z가 듣지 않는 때 ---");
// 기록 하나를 만들어 둔다 (점심 1시간 아래로)
await posAt(735); b = await blockRect("점심");
await drag(b.x, b.y, b.x, b.y + HOUR, 10);
await waitFor(async () => (await planOf("점심")).start === 780);
size = await stackSize();
await js(`document.getElementById("day-memo").focus()`);
await ctrlZ();
check("하루 메모 칸에 커서가 있으면 그 칸의 글자 되돌리기만 (기록 그대로, 점심 13:00)", (await stackSize()) === size && (await planOf("점심")).start === 780);
await blurAll();
await openPlan("점심", 795); await blurAll();
check("(준비) 작은 창이 열려 있다", await popOpen());
await ctrlZ();
check("시간표 작은 창이 열려 있으면 듣지 않는다", (await stackSize()) === size && (await planOf("점심")).start === 780);
await key("Escape"); await sleep(300);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(400); await blurAll();
await ctrlZ();
check("다른 탭(캘린더)에서는 듣지 않는다", (await stackSize()) === size && (await planOf("점심")).start === 780);
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1200);
await js(`showDay(${JSON.stringify(D)})`); await sleep(1200); await blurAll();   // 오늘 탭을 다시 열면 오늘 날짜로 돌아가므로 시험 날짜로 다시 간다
await ctrlZ("z", { modifiers: 10 });   // Ctrl+Shift
check("Ctrl+Shift+Z는 듣지 않는다", (await stackSize()) === size && (await planOf("점심")).start === 780);
await ctrlZ("ㅋ"); await waitIdle();   // 한글 입력 상태에서는 e.key가 "ㅋ"일 수 있다
check("한글 입력 상태(e.key가 'ㅋ')여도 Ctrl+Z가 듣는다 → 점심 12:00", await waitFor(async () => (await planOf("점심")).start === 720), await planOf("점심"));

console.log("--- 다른 날을 보면서 되돌리기 ---");
await posAt(735); b = await blockRect("점심");
await drag(b.x, b.y, b.x, b.y + HOUR, 10);
await waitFor(async () => (await planOf("점심")).start === 780);
await js(`showDay(${JSON.stringify(D2)})`); await sleep(1200); await blurAll();
await ctrlZ(); await waitIdle();
const md = D.slice(5).replace("-", "/");
check("다른 날을 보고 있어도 되돌리고, 알림 끝에 그 날짜를 붙인다", await waitFor(async () => (await planOf("점심")).start === 720) && (await toast()).endsWith("(" + md + ")"), await toast());
await js(`showDay(${JSON.stringify(D)})`); await sleep(1200);

console.log("--- 대상이 이미 없으면(404) ---");
p = await posAt(1260);
await click(p.x, p.y); await sleep(300); await type("지울 계획"); await key("Enter");
await waitFor(async () => !!(await planOf("지울 계획")));
await api("/api/time-blocks/" + (await planOf("지울 계획")).id, "DELETE");
size = await stackSize();
await blurAll(); await ctrlZ(); await waitIdle();
check("알림: 되돌릴 대상이 이미 없습니다, 기록은 버린다", /되돌릴 대상이 이미 없습니다/.test(await toast()) && (await stackSize()) === size - 1, [await toast(), await stackSize()]);

console.log("--- 서버가 응답하지 않으면 기록을 돌려놓는다 ---");
await posAt(735); b = await blockRect("점심");
await drag(b.x, b.y, b.x, b.y + HOUR, 10);
await waitFor(async () => (await planOf("점심")).start === 780);
size = await stackSize();
await js(`window.__realFetch = window.fetch; window.fetch = (url, opts) => (opts && opts.method === "PATCH") ? Promise.reject(new TypeError("Failed to fetch")) : window.__realFetch(url, opts)`);
await blurAll(); await ctrlZ(); await waitIdle();
check("연결 실패: 알림이 뜨고 기록이 그대로 남는다", /되돌리지 못했습니다/.test(await toast()) && (await stackSize()) === size, [await toast(), await stackSize()]);
await js(`window.fetch = window.__realFetch`);
await ctrlZ(); await waitIdle();
check("다시 Ctrl+Z → 이번엔 되돌린다(12:00)", await waitFor(async () => (await planOf("점심")).start === 720), await planOf("점심"));

console.log("--- [할 일로 만들기]는 기록하지 않는다 (함께 저장한 제목도) ---");
await api("/api/time-blocks", "POST", { date: D, start: 1200, end: 1230, title: "메모 정리" });
await js(`reloadPlans()`); await sleep(800);
await openPlan("메모 정리", 1215);
await js(`document.querySelector(".tl-popover .tl-title-input").select()`); await type("노트 정리");
size = await stackSize();
await js(`document.querySelector(".tl-popover .tl-make-task").click()`);
check("(준비) '노트 정리' 할 일이 생기고 계획과 연결된다", await waitFor(async () => { const x = await planOf("노트 정리"); return x && x.taskId !== null; }), await plans());
check("고친 제목 저장과 할 일 만들기 모두 기록하지 않는다", (await stackSize()) === size, await stackSize());

console.log("--- 최근 20개만 기억한다 ---");
await js(`(() => { for (let i = 0; i < 25; i++) rememberUndo({ requests: [], message: "시험 " + i }); })()`);
check("25개를 넣어도 20개", (await stackSize()) === 20);
check("남은 것은 가장 최근 20개(시험 5 ~ 시험 24)", await js(`undoStack[0].message === "시험 5" && undoStack[19].message === "시험 24"`));

check("JS 오류 없음", jsErrors.length === 0, jsErrors);
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
ws.close(); edge.kill();
process.exit(failed === 0 ? 0 : 1);
