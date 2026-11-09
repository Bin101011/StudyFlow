// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9387;
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

// ===== A. 레이아웃과 표시 =====
console.log("--- A. 레이아웃과 표시 ---");
check("처음 확대 정도는 한 시간 64px, 15분 단위(처음 42px는 너무 작다고 해서 키웠다)", HOUR === 64 && (await js(`document.getElementById("tl-snap").textContent`)) === "15분 단위", HOUR);
check("시간 눈금 글자 25개(00:00~24:00)", (await js(`document.querySelectorAll("#timeline-labels span").length`)) === 25);
check("시간 있는 일정 블록 4개 + 종일 알약 2개", (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) === 4 && (await js(`document.querySelectorAll("#timeline-allday .tl-event").length`)) === 2);
check("종일 줄이 보인다", (await js(`document.getElementById("timeline-allday").hidden`)) === false);
const overlap = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#timeline-grid .tl-event")].filter(b => /학생회|겹치는/.test(b.textContent)).map(b => ({ t: b.querySelector(".tl-title").textContent, left: b.style.left, width: b.style.width })))`));
check("겹치는 두 일정은 폭을 반씩 나눠 나란히", overlap.length === 2 && overlap.every((o) => o.width === "calc(50% - 4px)") && new Set(overlap.map((o) => o.left)).size === 2, overlap);
check("겹치지 않는 일정은 폭을 다 쓴다", (await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].filter(b => /메모 없는/.test(b.textContent)).every(b => b.style.width === "calc(100% - 4px)")`)));
check("일정 메모가 블록에 보인다", (await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].some(b => b.querySelector(".tl-memo") && /가져갈 물품/.test(b.querySelector(".tl-memo").textContent))`)));
check("HTML 설명은 글자만(태그 없음)", (await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].filter(b => /HTML 설명/.test(b.textContent)).every(b => !/[<>]/.test(b.textContent))`)));
check("지금 시각 빨간 줄이 있다", (await js(`document.querySelectorAll(".tl-now").length`)) === 1);
const lay = JSON.parse(await js(`JSON.stringify({ pageH: document.documentElement.scrollHeight, winH: window.innerHeight, memoBottom: document.querySelector(".day-memo").getBoundingClientRect().bottom, tlW: document.getElementById("timeline-column").getBoundingClientRect().width, cols: getComputedStyle(document.querySelector(".today-layout")).gridTemplateColumns })`));
check("오늘 탭이 화면 높이에 맞고 페이지 스크롤이 없다", lay.pageH <= lay.winH + 2, lay);
check("하루 메모가 화면 안(바닥)에 있다", lay.memoBottom <= lay.winH, lay);
check("시간표 칸 폭이 330~400px", lay.tlW >= 329 && lay.tlW <= 401, lay.tlW);
await shot("t_overview.png");

// ===== B. 겹침 배치 알고리즘 =====
console.log("--- B. 겹침 배치 ---");
const lo = JSON.parse(await js(`(() => { const a = [{start:0,end:60},{start:30,end:90},{start:120,end:180}]; layoutOverlaps(a); const b = [{start:0,end:120},{start:30,end:60},{start:70,end:100}]; layoutOverlaps(b); const c = [{start:0,end:60},{start:10,end:50},{start:20,end:40}]; layoutOverlaps(c); const d = [{start:600,end:605},{start:610,end:615}]; layoutOverlaps(d); return JSON.stringify({a: a.map(i => [i.col, i.cols]), b: b.map(i => [i.col, i.cols]), c: c.map(i => [i.col, i.cols]), d: d.map(i => [i.col, i.cols])}); })()`));
check("둘 겹침: 2칸, 떨어진 것은 1칸", JSON.stringify(lo.a) === "[[0,2],[1,2],[0,1]]", lo.a);
check("긴 블록 안에 짧은 둘(서로 안 겹침): 칸을 재사용해 2칸", JSON.stringify(lo.b) === "[[0,2],[1,2],[1,2]]", lo.b);
check("셋이 한꺼번에 겹침: 3칸", JSON.stringify(lo.c) === "[[0,3],[1,3],[2,3]]", lo.c);
check("아주 짧은 블록(5분)은 최소 높이(15분 분량)로 그려지므로, 그 안에 시작하는 블록과는 나눈다", lo.d[0][1] === 2, lo.d);
const adj = JSON.parse(await js(`(() => {
  const t = (arr) => { layoutOverlaps(arr); return arr.map(i => [i.col, i.cols]); };
  return JSON.stringify({
    touch: t([{start:1080,end:1155},{start:1155,end:1200}]),            // 18:00–19:15 과 19:15–20:00: 바로 붙어 있다
    touchShort: t([{start:1140,end:1155},{start:1155,end:1215}]),      // 19:00–19:15(15분) 과 19:15–20:15
    gap10: t([{start:1140,end:1155},{start:1165,end:1200}]),           // 15분 블록 뒤 10분 간격
    gap5: t([{start:1140,end:1155},{start:1160,end:1200}]),            // 15분 블록 뒤 5분 간격
    tiny: t([{start:1140,end:1145},{start:1150,end:1200}]),            // 5분 블록(그려지는 높이는 15분 분량) 뒤 5분 간격
    realOverlap: t([{start:1140,end:1170},{start:1155,end:1200}]),     // 진짜로 겹친다
  });
})()`));
check("19:15에 끝나는 블록과 19:15에 시작하는 블록은 바로 붙는다(분할 안 함)", JSON.stringify(adj.touch) === "[[0,1],[0,1]]" && JSON.stringify(adj.touchShort) === "[[0,1],[0,1]]", adj);
check("15분 블록 뒤 10분 떨어져 시작하는 블록은 분할하지 않는다", JSON.stringify(adj.gap10) === "[[0,1],[0,1]]", adj.gap10);
check("15분 블록 뒤 5분 떨어진 블록도 분할하지 않는다(15분 블록은 딱 15분 높이로 그려진다)", JSON.stringify(adj.gap5) === "[[0,1],[0,1]]", adj.gap5);
check("5분 블록은 최소 높이(15분 분량) 안에 시작하는 블록과만 나눈다", JSON.stringify(adj.tiny) === "[[0,2],[1,2]]", adj.tiny);
check("진짜로 겹치면 나눈다", JSON.stringify(adj.realOverlap) === "[[0,2],[1,2]]", adj.realOverlap);

// ===== C. 계획 만들기 =====
console.log("--- C. 계획 만들기 ---");
let p = await posAt(9 * 60 + 1);
await click(p.x, p.y);
await sleep(300);
check("빈 곳을 한 번 누르면 제목 입력 칸이 열린다(30분짜리)", (await js(`!!document.querySelector(".tl-creating .tl-title-input") && document.activeElement.className === "tl-title-input"`)));
const geo = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }); })()`));
check("09:01을 눌렀으면 가장 가까운 5분인 09:00부터 30분", Math.abs(geo.top - 9 * HOUR) < 1 && Math.abs(geo.h - HOUR / 2) < 1, geo);
check("기본 배율(30분 = 32px)에서도 입력 칸이 블록 안에 다 들어간다", await js(`(() => { const b = document.querySelector(".tl-creating").getBoundingClientRect(); const i = document.querySelector(".tl-creating .tl-title-input").getBoundingClientRect(); return i.top >= b.top && i.bottom <= b.bottom; })()`));
await type("토익 공부"); await key("Enter");
check("Enter로 저장되고 블록이 나타난다", await waitFor(async () => (await plans()).some((x) => x.title === "토익 공부" && x.start === 540 && x.end === 570)), await plans());
check("서버에도 09:00–09:30으로 저장", (await plans()).some((x) => x.title === "토익 공부" && x.start === 540 && x.end === 570 && x.taskId === null));
// 서버에 저장된 뒤 화면이 계획을 다시 받아 그리기까지 조금 걸리므로 기다린 뒤 본다
check("화면에 점선 계획 블록이 보인다", await waitFor(async () => (await planTitles()).includes("토익 공부"), 3000), await planTitles());

p = await posAt(13 * 60 + 1);
const p2 = await posAt(13 * 60 + 1); // 같은 스크롤
const yEnd = p.y + (14 * 60 + 20 - (13 * 60 + 1)) / 60 * HOUR;
await drag(p.x, p.y, p.x, yEnd);
await sleep(300);
const g2 = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return b ? JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }) : "null"; })()`));
check("13:01에서 14:20까지 끌면 13:00–14:30 블록", g2 && Math.abs(g2.top - 13 * HOUR) < 1 && Math.abs(g2.h - 1.5 * HOUR) < 1, g2);
await type("복습 정리"); await key("Enter");
check("끌어서 만든 계획이 13:00–14:30으로 저장", await waitFor(async () => (await plans()).some((x) => x.title === "복습 정리" && x.start === 780 && x.end === 870)), await plans());

p = await posAt(16 * 60 + 44);
await click(p.x, p.y); await sleep(250);
const geo1644 = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }); })()`));
check("15분 단위 배율에서도 16:44를 누르면 16:45부터 30분(내림하지 않는다)", Math.abs(geo1644.top - (16 * 60 + 45) / 60 * HOUR) < 1 && Math.abs(geo1644.h - HOUR / 2) < 1, geo1644);
await type("취소될 계획"); await key("Escape"); await sleep(400);
check("Esc로 만들기를 취소하면 저장되지 않는다", !(await plans()).some((x) => x.title === "취소될 계획") && !(await js(`!!document.querySelector(".tl-creating")`)));
// 끌어서 만들 때도 누른 자리는 가까운 5분이고, 끄는 쪽 끝은 지금 단위(15분)에 맞는다. 위로 끌면 누른 자리가 끝이 된다
p = await posAt(16 * 60 + 44);
await drag(p.x, p.y, p.x, p.y + 36 / 60 * HOUR); await sleep(300);   // 17:20쯤까지
const dragDown = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }); })()`));
check("16:44에서 아래로 17:20까지 끌면 16:45–17:30", Math.abs(dragDown.top - (16 * 60 + 45) / 60 * HOUR) < 1 && Math.abs(dragDown.h - 0.75 * HOUR) < 1, dragDown);
await key("Escape"); await sleep(300);
p = await posAt(16 * 60 + 44);
await drag(p.x, p.y, p.x, p.y - 24 / 60 * HOUR); await sleep(300);   // 16:20쯤까지
const dragUp = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }); })()`));
check("16:44에서 위로 16:20까지 끌면 16:15–16:45", Math.abs(dragUp.top - (16 * 60 + 15) / 60 * HOUR) < 1 && Math.abs(dragUp.h - 0.5 * HOUR) < 1, dragUp);
await key("Escape"); await sleep(300);
p = await posAt(17 * 60 + 5);
await click(p.x, p.y); await sleep(250);
await js(`document.activeElement.blur()`); await sleep(400);
check("빈 제목으로 벗어나면 만들어지지 않는다", (await plans()).length === 2);

// ===== D. 계획 옮기기 / 길이 바꾸기 =====
console.log("--- D. 옮기기와 길이 바꾸기 ---");
const blockRect = (title) => js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-plan")].find(x => x.querySelector(".tl-title") && x.querySelector(".tl-title").textContent === ${JSON.stringify(title)}); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom, left: r.left, top: r.top }; })()`);
await posAt(10 * 60);
let r = await blockRect("토익 공부");
await drag(r.x, r.y, r.x, r.y + HOUR * 1.5);   // 90분
await sleep(700);
check("끌어서 옮기면 09:00 → 10:30 (15분 단위)", (await plans()).some((x) => x.title === "토익 공부" && x.start === 630 && x.end === 660), await plans());
await posAt(11 * 60);
r = await blockRect("토익 공부");
await drag(r.x, r.bottom - 3, r.x, r.bottom - 3 + HOUR);   // 아래쪽 끝을 1시간 아래로
await sleep(700);
check("아래쪽 끝을 끌면 길이가 늘어난다: 10:30–12:00", (await plans()).some((x) => x.title === "토익 공부" && x.start === 630 && x.end === 720), await plans());
r = await blockRect("토익 공부");
await drag(r.x, r.bottom - 3, r.x, r.top - 200);   // 시작보다 위로 끌어도 최소 길이(15분)
await sleep(700);
check("너무 줄이면 최소 15분에서 멈춘다", (await plans()).some((x) => x.title === "토익 공부" && x.end - x.start === 15 && x.start === 630), await plans());
r = await blockRect("복습 정리");
const before = (await plans()).find((x) => x.title === "복습 정리");
await mouse("mouseMoved", r.x, r.y, 0); await mouse("mousePressed", r.x, r.y);
await mouse("mouseMoved", r.x, r.y + 60, 1); await key("Escape"); await mouse("mouseReleased", r.x, r.y + 60);
await sleep(600);
const after = (await plans()).find((x) => x.title === "복습 정리");
check("끄는 중 Esc를 누르면 원래 자리", after.start === before.start && after.end === before.end, [before, after]);

// ===== E. 계획 작은 창 =====
console.log("--- E. 계획 작은 창 ---");
await posAt(13 * 60 + 30);
r = await blockRect("복습 정리");
await click(r.x, r.y); await sleep(400);
check("계획을 누르면 작은 창이 열리고 제목 입력 칸이 있다", (await js(`!!document.querySelector(".tl-popover input.tl-title-input") && document.querySelector(".tl-popover input.tl-title-input").value === "복습 정리"`)));
check("시작·끝 시간 칸과 길이가 보인다", (await js(`[...document.querySelectorAll(".tl-popover .tl-pop-times input")].map(i => i.value).join("–") + " " + document.querySelector(".tl-popover .tl-pop-length").textContent`)) === "13:00–14:30 (1시간 30분)", await js(`document.querySelector(".tl-popover").textContent`));
await shot("t_plan_popover.png");
if (!(await js(`!!document.querySelector(".tl-popover input.tl-title-input")`))) { await posAt(13 * 60 + 30); r = await blockRect("복습 정리"); await click(r.x, r.y); await sleep(400); }   // 스크롤 이벤트로 창이 닫혔으면 한 번 다시 연다 (테스트 타이밍 보정)
await js(`document.querySelector(".tl-popover input.tl-title-input").select()`);
await type("복습 완성"); await key("Enter");
check("제목을 고치고 Enter하면 저장되고 창이 닫힌다", await waitFor(async () => (await plans()).some((x) => x.title === "복습 완성")) && !(await js(`!!document.querySelector(".tl-popover")`)), await plans());
await waitFor(async () => (await planTitles()).includes("복습 완성"));
await posAt(13 * 60 + 30);
r = await blockRect("복습 완성");
await click(r.x, r.y); await sleep(300);
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent === "삭제").click()`); await sleep(200);
check("삭제는 첫 클릭에 '정말?'로 바뀐다", (await js(`[...document.querySelectorAll(".tl-popover button")].some(b => b.textContent === "정말?")`)) && (await plans()).some((x) => x.title === "복습 완성"));
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent === "정말?").click()`);
// 지운 뒤 화면이 계획을 다시 받아 그리기까지 조금 걸리므로 기다린 뒤 본다 (예전에는 0.6초만 기다려서 가끔 흔들렸다)
check("두 번째 클릭에 지워진다", await waitFor(async () => !(await plans()).some((x) => x.title === "복습 완성") && !(await planTitles()).includes("복습 완성"), 3000), await planTitles());

// ===== F. 일정 작은 창 =====
console.log("--- F. 일정 작은 창과 메모 ---");
const eventBlock = (re) => js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /${re}/.test(x.textContent)); return b ? "ok" : null; })()`);
await posAt(15 * 60 + 30);
await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /학생회/.test(x.textContent)).click()`); await sleep(400);
const popMemo = await js(`document.querySelector(".tl-popover textarea") ? document.querySelector(".tl-popover textarea").value : null`);
check("일정을 누르면 작은 창에 기존 메모가 들어 있다", popMemo === "가져갈 물품: 노트북, 포스터 2장\n3 < 5 이고 a<b", popMemo);
check("입력 칸 예시 글자는 '예: 노트 가져가기'", (await js(`document.querySelector(".tl-popover textarea").placeholder`)) === "예: 노트 가져가기");
check("창이 화면 안에 있다", await js(`(() => { const r = document.querySelector(".tl-popover").getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
await type("\n충전기");
await key("Enter");
await sleep(900);
const desc = (await api("/__test/state")).data.events["학생회 팀장 회의|me@test"].description;
check("Enter를 누르면 메모가 저장되고 창이 닫힌다", desc.endsWith("충전기") && !(await js(`!!document.querySelector(".tl-popover")`)), desc);
check("블록에 새 메모가 보인다", await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].some(b => /충전기/.test(b.textContent))`));
// Shift+Enter 줄바꿈
await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /메모 없는/.test(x.textContent)).click()`); await sleep(300);
await type("첫 줄"); await key("Enter", { modifiers: 8 }); await type("둘째 줄");
check("Shift+Enter는 줄바꿈이고 창이 열려 있다", (await js(`document.querySelector(".tl-popover textarea").value`)) === "첫 줄\n둘째 줄");
await key("Escape"); await sleep(800);
check("Esc로 닫아도 저장된다", (await api("/__test/state")).data.events["메모 없는 일정|me@test"].description === "첫 줄\n둘째 줄");
// 일정 수정…
await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /학생회/.test(x.textContent)).click()`); await sleep(300);
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent.startsWith("일정 수정")).click()`); await sleep(500);
check("[일정 수정…]을 누르면 일정 수정 창이 그 일정으로 열린다", (await js(`document.getElementById("event-dialog").open && document.getElementById("event-title").value === "학생회 팀장 회의" && document.getElementById("event-dialog-title").textContent === "일정 수정"`)));
await js(`document.getElementById("event-title").value = "학생회 팀장 회의(수정)"; document.getElementById("event-save").click()`); await sleep(1500);
check("수정 창에서 저장하면 오늘 탭 시간표도 새 제목으로 바뀐다", await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].some(b => b.querySelector(".tl-title").textContent === "학생회 팀장 회의(수정)")`));
// 읽기 전용(공휴일)
await js(`[...document.querySelectorAll("#timeline-allday .tl-event")].find(x => /공휴일/.test(x.textContent)).click()`); await sleep(300);
check("읽기 전용 일정의 창: 메모는 글자로만 보이고 입력 칸/수정 버튼이 없다", (await js(`!document.querySelector(".tl-popover textarea") && !![...document.querySelectorAll(".tl-popover .tl-pop-readonly")].find(p => /공휴일 설명/.test(p.textContent)) && ![...document.querySelectorAll(".tl-popover button")].some(b => b.textContent.startsWith("일정 수정"))`)));
await key("Escape"); await sleep(200);
// 쓰는 중 동기화 새로고침
await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /메모 없는/.test(x.textContent)).click()`); await sleep(300);
await type("쓰던 글");
await js(`reloadVisibleEvents()`); await sleep(1200);
check("창을 연 동안 동기화 새로고침이 와도 창과 쓰던 글이 그대로", (await js(`!!document.querySelector(".tl-popover textarea") && document.querySelector(".tl-popover textarea").value.endsWith("쓰던 글")`)));
await key("Escape"); await sleep(700);
check("창 밖을 누르면 닫힌다", await (async () => { await js(`[...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /메모 없는/.test(x.textContent)).click()`); await sleep(200); const q = await posAt(21 * 60); await click(q.x, q.y); await sleep(300); const closed = !(await js(`!!document.querySelector(".tl-popover")`)); await key("Escape"); await sleep(300); return closed; })());

// ===== G. 할 일을 시간표로 끌어다 놓기 =====
console.log("--- G. 할 일 끌어다 놓기 ---");
const before2 = (await plans()).length;
let row = await rowRect("발표 자료 만들기");
check("프로젝트 할 일도 끌 수 있는 줄이다", await js(`[...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content").textContent === "발표 자료 만들기").classList.contains("task-draggable")`));
p = await posAt(16 * 60 + 5, 150);
await mouse("mouseMoved", row.x, row.y, 0); await mouse("mousePressed", row.x, row.y);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", row.x + (p.x - row.x) * i / 8, row.y + (p.y - row.y) * i / 8, 1);
await sleep(200);
const prev = JSON.parse(await js(`(() => { const e = document.querySelector(".tl-drop-preview"); return e ? JSON.stringify({ txt: e.textContent, hover: document.getElementById("timeline-grid").classList.contains("drop-hover") }) : "null"; })()`));
check("끄는 동안 놓일 자리 미리보기(16:00)와 놓을 칸 강조", prev && /^16:00/.test(prev.txt) && prev.hover, prev);
await shot("t_drag_preview.png");
await mouse("mouseReleased", p.x, p.y);
check("시간표에 놓으면 그 할 일과 연결된 1시간 계획이 만들어진다", await waitFor(async () => (await plans()).some((x) => x.title === "발표 자료 만들기" && x.taskId !== null && x.start === 960 && x.end === 1020)), await plans());
await sleep(500);
check("할 일 줄 옆에 시간(16:00–17:00)이 붙는다", (await js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content").textContent === "발표 자료 만들기"); const s = li && li.querySelector(".task-slot"); return s ? s.textContent : null; })()`)) === "16:00–17:00");
check("계획 블록이 점선(계획) 모양이다", (await planTitles()).includes("발표 자료 만들기"));

// 수집함 → 시간표: 날짜가 오늘로 정해진다
row = await rowRect("여권 사진 찍기");
p = await posAt(18 * 60 + 5, 150);
await drag(row.x, row.y, p.x, p.y, 10);
await sleep(900);
const todayTasks = (await api("/api/tasks?date=" + today)).data.tasks.map((t) => t.content);
check("할 일 목록(수집함)의 할 일을 시간표에 놓으면 오늘 할 일이 되고 계획도 생긴다", todayTasks.includes("여권 사진 찍기") && (await plans()).some((x) => x.title === "여권 사진 찍기" && x.start === 1080), { todayTasks, plans: await plans() });
// 밀린 할 일 → 시간표
row = await rowRect("지난 일 마무리");
p = await posAt(19 * 60 + 5, 150);
await drag(row.x, row.y, p.x, p.y, 10);
await sleep(900);
check("밀린 할 일을 시간표에 놓으면 날짜가 오늘로 바뀐다", (await api("/api/tasks?date=" + today)).data.tasks.some((t) => t.content === "지난 일 마무리"));
// 일반(프로젝트 없는) 할 일 → 시간표 (날짜 그대로)
row = await rowRect("장보기");
p = await posAt(11 * 60 + 5, 150);
await drag(row.x, row.y, p.x, p.y, 10);
await sleep(900);
check("프로젝트 없는 오늘 할 일도 시간표에 놓을 수 있다", (await plans()).some((x) => x.title === "장보기" && x.start === 660));
// 시간표 밖(할 일 목록 칸)으로 놓으면 기존 동작(날짜 빼기)
row = await rowRect("LC 파트 풀기");
const inbox = JSON.parse(await js(`(() => { const r = document.getElementById("inbox-tasks").getBoundingClientRect(); return JSON.stringify({ x: r.left + 60, y: r.top + 40 }); })()`));
await drag(row.x, row.y, inbox.x, inbox.y, 10);
await sleep(900);
check("기존 동작: 오늘 할 일을 '할 일 목록' 칸에 놓으면 날짜가 빠진다", !(await api("/api/tasks?date=" + today)).data.tasks.some((t) => t.content === "LC 파트 풀기"));
check("계획이 늘어난 개수가 맞다(할 일 4개를 놓았다)", (await plans()).length === before2 + 4, (await plans()).map((x) => x.title));

// 연결된 계획 작은 창: 할 일 완료 체크
await posAt(16 * 60 + 30);
r = await blockRect("발표 자료 만들기");
await click(r.x, r.y); await sleep(400);
check("연결된 계획의 창: 제목 칸(할 일 이름)과 '할 일 완료' 체크가 있다 (단계 5부터 이름도 고칠 수 있다)", (await js(`!!document.querySelector(".tl-popover input.tl-title-input") && document.querySelector(".tl-popover input.tl-title-input").value === "발표 자료 만들기" && !!document.querySelector(".tl-popover .tl-pop-check input")`)));
await js(`document.querySelector(".tl-popover .tl-pop-check input").click()`); await sleep(1000);
check("체크하면 할 일이 끝나고 계획 블록도 끝난 모양(흐림)이 된다", (await js(`!!document.querySelector("#timeline-grid .tl-plan.done")`)) && (await api("/api/tasks?date=" + today)).data.tasks.find((t) => t.content === "발표 자료 만들기").done === 1);
await key("Escape"); await sleep(200);
await shot("t_after.png");

// ===== H. 날짜 넘기기 / 오프라인 / 스크롤 =====
console.log("--- H. 날짜, 오프라인, 스크롤 ---");
await js(`document.getElementById("day-next").click()`); await sleep(1800);
const tm = JSON.parse(await js(`JSON.stringify({ st: timelineScroll.scrollTop, plans: document.querySelectorAll("#timeline-grid .tl-plan").length, ev: [...document.querySelectorAll("#timeline-grid .tl-event")].map(b => b.querySelector(".tl-title").textContent), now: document.querySelectorAll(".tl-now").length })`));
const tmCenter = await js(`yToMin(timelineScroll.getBoundingClientRect().top + timelineScroll.clientHeight / 2)`);
check("내일: 설정의 기본값 17:00이 가운데에 오도록 스크롤", Math.abs(tmCenter - 17 * 60) <= 2, [tmCenter, tm]);
check("내일: 내 계획은 없고 내일 일정이 보이고 지금 시각 줄은 없다", tm.plans === 0 && tm.ev.includes("내일 일정") && tm.now === 0, tm);
await js(`document.getElementById("day-prev").click()`); await sleep(1800);
check("오늘로 돌아오면 계획이 다시 보인다", (await js(`document.querySelectorAll("#timeline-grid .tl-plan").length`)) >= 3);
// 오프라인에서 이미 기억해 둔 날짜는 기억해 둔 일정이 그대로 보인다(기존 설계). 기억해 둔 적 없는 먼 날짜에서는 일정을 못 불러오지만 계획은 보여야 한다
await api("/__test/offline/1");
await js(`loadTimeline()`); await sleep(1200);
check("오프라인: 기억해 둔 오늘의 일정은 그대로 보인다", (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) >= 4);
const far = await js(`addDaysToText(viewedDate, 500)`);
await api("/api/time-blocks", "POST", { date: far, start: 600, end: 660, title: "먼 날짜 계획" });
await js(`showDay(${JSON.stringify(far)})`); await sleep(2500);
check("오프라인 + 기억 없는 날짜: 일정은 못 불러왔다고 알리고 내 계획은 그대로 보인다", (await planTitles()).includes("먼 날짜 계획") && /일정을 불러오지 못했습니다/.test(await js(`document.getElementById("timeline-allday").textContent`)), await js(`document.getElementById("timeline-allday").textContent`));
await api("/__test/offline/0");
await js(`showDay(todayText)`); await sleep(1800);
check("다시 연결되고 오늘로 돌아오면 일정이 돌아온다", (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) >= 4);

// 할 일이 아주 많아도 메모가 밀리지 않는다
for (let i = 0; i < 25; i++) await api("/api/tasks", "POST", { content: "많은 할 일 " + i, date: today, projectId: null });
await js(`document.getElementById("day-today").click(); loadToday()`); await sleep(1800);
const crowd = JSON.parse(await js(`JSON.stringify({ scrollable: (() => { const s = document.querySelector("#tasks-column .column-scroll"); return s.scrollHeight > s.clientHeight; })(), memoBottom: document.querySelector(".day-memo").getBoundingClientRect().bottom, winH: innerHeight, pageH: document.documentElement.scrollHeight })`));
check("할 일이 많아지면 목록만 스크롤되고 메모는 화면 안에 그대로", crowd.scrollable && crowd.memoBottom <= crowd.winH && crowd.pageH <= crowd.winH + 2, crowd);
await shot("t_crowd.png");

// 좁은 창
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(800);
const narrow = JSON.parse(await js(`JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth, tlH: document.getElementById("timeline-column").getBoundingClientRect().height })`));
check("좁은 창(1000px)에서도 가로로 넘치지 않는다", narrow.sw <= narrow.iw + 1, narrow);
await shot("t_narrow.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });


// ===== I. 확대 / 축소 =====
console.log("--- I. 확대와 축소 ---");
await js(`document.getElementById("day-today").hidden || document.getElementById("day-today").click()`); await sleep(1500);
const wheel = (x, y, deltaY, ctrl = true) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY, modifiers: ctrl ? 2 : 0 });
const hourNow = () => js(`tlHourPx`);
const snapNow = () => js(`document.getElementById("tl-snap").textContent`);
const labelCount = () => js(`document.querySelectorAll("#timeline-labels span").length`);
let q = await posAt(12 * 60);
const h0 = await hourNow();
// 마우스 휠(Ctrl 없이)은 확대되지 않고 스크롤만 된다
const st0 = await js(`timelineScroll.scrollTop`);
await wheel(q.x, q.y, 100, false); await sleep(300);
check("Ctrl 없이 굴리면 확대되지 않는다", (await hourNow()) === h0);
// 두 손가락 벌리기 = Ctrl+휠(deltaY가 음수). 12:00 위에서 확대하면 12:00이 제자리에 남는다
q = await posAt(12 * 60);
const minuteAt = (y) => js(`yToMin(${y})`);
const minBefore = await minuteAt(q.y);
for (let i = 0; i < 6; i++) await wheel(q.x, q.y, -20);
await sleep(300);
const h1 = await hourNow();
const minAfter = await minuteAt(q.y);
check("Ctrl+휠(두 손가락 벌리기)로 확대된다", h1 > h0 * 1.3, [h0, h1]);
check("포인터가 가리킨 시각이 제자리에 남는다(±1.5분)", Math.abs(minAfter - minBefore) < 1.5, [minBefore, minAfter]);
check("블록 높이도 함께 커진다(1시간짜리 일정 = 한 시간 높이)", await js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-event")].find(x => /메모 없는/.test(x.textContent)); return Math.abs(parseFloat(b.style.height) - tlHourPx) < 1.5; })()`));
check("확대 정도 중간(84px 이상)에서는 30분 눈금 글자가 생긴다", h1 < 84 || (await labelCount()) === 49, [h1, await labelCount()]);
// 오므리기
for (let i = 0; i < 6; i++) await wheel(q.x, q.y, 20);
await sleep(300);
check("Ctrl+휠(오므리기)로 다시 줄어든다", Math.abs((await hourNow()) - h0) < h0 * 0.1, [h0, await hourNow()]);
// 최대 확대
for (let i = 0; i < 40; i++) await wheel(q.x, q.y, -30);
await sleep(400);
check("최대 확대(160px)에서 멈춘다", (await hourNow()) === 160, await hourNow());
check("최대 확대: 5분 단위로 표시", (await snapNow()) === "5분 단위");
check("최대 확대: 30분 눈금 글자가 생기고(49개) 확대 버튼이 꺼진다", (await labelCount()) === 49 && (await js(`document.getElementById("tl-zoom-in").disabled`)) === true);
check("최대 확대: 15분 줄(tl-quarter)이 그려진다", await js(`document.getElementById("timeline").classList.contains("tl-quarter")`));
// 5분 단위로 계획 만들기
p = await posAt(9 * 60 + 6);
await click(p.x, p.y); await sleep(300);
await type("정밀 계획"); await key("Enter");
check("5분 단위: 09:06을 누르면 09:05부터 30분", await waitFor(async () => (await plans()).some((x) => x.title === "정밀 계획" && x.start === 545 && x.end === 575)), await plans());
p = await posAt(13 * 60 + 2);
await drag(p.x, p.y, p.x, p.y + (81 + 1) / 60 * 160);   // 13:02 → 14:23 근처
await sleep(300);
await type("5분 끌기"); await key("Enter");
check("5분 단위: 13:02에서 14:23쯤까지 끌면 5분 단위로 맞춰진다(13:00–14:25)", await waitFor(async () => (await plans()).some((x) => x.title === "5분 끌기" && x.start === 780 && x.end === 865)), await plans());
// 길이 바꾸기: 5분 단위
await waitFor(async () => (await planTitles()).includes("정밀 계획"));
await posAt(9 * 60 + 30);
r = await blockRect("정밀 계획");
await drag(r.x, r.bottom - 3, r.x, r.bottom - 3 + 20);   // 160px/시간에서 20px = 7.5분
await sleep(700);
const rz = (await plans()).find((x) => x.title === "정밀 계획");
check("5분 단위로 길이가 바뀐다(30분에서 40분: 15분 단위로는 불가능한 길이)", rz.end % 5 === 0 && (rz.end - rz.start) === 40, rz);
r = await blockRect("정밀 계획");
await drag(r.x, r.bottom - 3, r.x, r.top - 300);
await sleep(700);
check("5분 단위의 최소 길이는 5분", (await plans()).find((x) => x.title === "정밀 계획").end - (await plans()).find((x) => x.title === "정밀 계획").start === 5, await plans());
// 최대 축소
await js(`document.getElementById("tl-zoom-out").click()`);
for (let i = 0; i < 40; i++) await wheel(q.x, q.y, 30);
await sleep(400);
check("최대 축소(36px)에서 멈춘다", (await hourNow()) === 36, await hourNow());
check("최대 축소: 15분 단위로 표시되고 30분 눈금 글자/줄이 없다", (await snapNow()) === "15분 단위" && (await labelCount()) === 25 && !(await js(`document.getElementById("timeline").classList.contains("tl-half")`)));
check("최대 축소: 축소 버튼이 꺼진다", await js(`document.getElementById("tl-zoom-out").disabled`));
check("최대 축소: 짧은 블록도 눌러 볼 수 있는 높이(16px) 이상", await js(`[...document.querySelectorAll("#timeline-grid .tl-block")].every(b => parseFloat(b.style.height) >= 15.9)`));
p = await posAt(23 * 60 + 50);
await click(p.x, p.y); await sleep(300);
const tiny = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); const i = b.querySelector(".tl-title-input"); const br = b.getBoundingClientRect(); const ir = i.getBoundingClientRect(); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height), blockH: br.height, inputH: ir.height, inside: ir.top >= br.top && ir.bottom <= br.bottom, reachable: br.bottom <= timelineScroll.getBoundingClientRect().top - timelineScroll.scrollTop + timelineScroll.scrollHeight }); })()`));
check("최대 축소: 하루 맨 끝을 누르면 23:30–24:00으로 맞춰진다", Math.abs(tiny.top - 23.5 * 36) < 1 && Math.abs(tiny.h - 18) < 1, tiny);
check("최대 축소: 제목을 쓰는 동안 입력 칸이 블록 안에 다 들어가고 스크롤로 닿는다", tiny.inside && tiny.reachable, tiny);
await key("Escape"); await sleep(300);
// 버튼
await js(`document.getElementById("tl-zoom-in").click()`); await sleep(300);
check("[+] 버튼은 한 번에 25%씩 확대한다", Math.abs((await hourNow()) - 45) < 0.5, await hourNow());
// 5분 ↔ 15분 경계 (120px 이상이 5분)
await js(`setTimelineZoom(119)`); await sleep(100);
const s119 = await snapNow();
await js(`setTimelineZoom(120)`); await sleep(100);
check("120px부터 5분 단위(119px는 15분 단위)", s119 === "15분 단위" && (await snapNow()) === "5분 단위", [s119, await snapNow()]);
// 저장과 복원
await js(`setTimelineZoom(100, undefined, true)`); await sleep(1500);
const saved = (await api("/api/settings")).data.values.timelineHourPx;
check("확대 정도가 멈춘 뒤 설정에 저장된다", saved === 100, saved);
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(2500);
check("껐다 켜도 확대 정도가 유지된다", (await hourNow()) === 100, await hourNow());
// 서버가 이상한 값을 걸러낸다
const cur = (await api("/api/settings")).data.values;
const putZoom = async (v) => { await api("/api/settings", "PUT", { ...cur, timelineHourPx: v }); return (await api("/api/settings")).data.values.timelineHourPx; };
check("서버: 범위 밖 값은 끝값으로(9999→160, 3→36)", (await putZoom(9999)) === 160 && (await putZoom(3)) === 36);
// 틀린 값이 오면 기본값이 아니라 원래 값(바로 위에서 정한 36)을 지킨다 (docs/review-2026-11.md의 M1: 설정을 기본값으로 덮어쓰지 않기)
check("서버: 글자/true/null이면 원래 값 유지(36)", (await putZoom("abc")) === 36 && (await putZoom(true)) === 36 && (await putZoom(null)) === 36);
check("서버: 소수는 반올림", (await putZoom(80.6)) === 81);


// ===== J. 짧은 블록의 글자 크기 / 할 일을 지우면 계획도 지워진다 =====
console.log("--- J. 짧은 블록 글자, 할 일 삭제 ---");
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(500);
await js(`setTimelineZoom(64)`); await sleep(200);
for (const [start, end, title] of [[1290, 1295, "5분 블록"], [1320, 1335, "15분 블록"], [1350, 1380, "30분 블록"], [1395, 1440, "45분 블록"]]) await api("/api/time-blocks", "POST", { date: today, start, end, title });
await js(`reloadPlans()`); await sleep(800);
const fs64 = JSON.parse(await js(`JSON.stringify(Object.fromEntries([...document.querySelectorAll("#timeline-grid .tl-plan")].filter(b => /^\\d+분 블록$/.test(b.querySelector(".tl-title").textContent)).map(b => [b.querySelector(".tl-title").textContent, { fs: parseFloat(b.style.getPropertyValue("--tl-fs")), short: b.classList.contains("tl-short"), h: parseFloat(b.style.height) }])))`));
check("5분/15분 블록(16px)은 글자를 80%로 줄이고 짧은 블록 모양(tl-short)이 된다", fs64["5분 블록"].fs === 0.8 && fs64["5분 블록"].short && fs64["15분 블록"].fs === 0.8 && fs64["15분 블록"].short, fs64);
check("30분 이상(32px~)이면 글자를 줄이지 않는다", fs64["30분 블록"].fs === 1 && !fs64["30분 블록"].short && fs64["45분 블록"].fs === 1, fs64);
const clipped = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#timeline-grid .tl-plan")].filter(b => /^\\d+분 블록$/.test(b.querySelector(".tl-title").textContent)).map(b => { const t = b.querySelector(".tl-title").getBoundingClientRect(), r = b.getBoundingClientRect(); return { n: b.querySelector(".tl-title").textContent, over: +(t.bottom - r.bottom).toFixed(1) }; }))`));
const cl = await clipped();
check("짧은 블록의 제목 한 줄이 블록 밖으로 잘리지 않는다(기본 확대)", cl.every((x) => x.over <= 1), cl);
await js(`setTimelineZoom(36)`); await sleep(400);
const cl36 = await clipped();
check("많이 축소해도(36px) 제목 한 줄이 잘리지 않는다", cl36.every((x) => x.over <= 1), cl36);
const fs36 = JSON.parse(await js(`JSON.stringify(Object.fromEntries([...document.querySelectorAll("#timeline-grid .tl-plan")].filter(b => /^\\d+분 블록$/.test(b.querySelector(".tl-title").textContent)).map(b => [b.querySelector(".tl-title").textContent, parseFloat(b.style.getPropertyValue("--tl-fs"))])))`));
check("축소하면 더 많은 블록의 글자가 줄어든다(30분 블록 = 18px)", fs36["30분 블록"] < 1 && fs36["30분 블록"] >= 0.8, fs36);
await js(`setTimelineZoom(160)`); await sleep(400);
const fs160 = JSON.parse(await js(`JSON.stringify(Object.fromEntries([...document.querySelectorAll("#timeline-grid .tl-plan")].filter(b => /^\\d+분 블록$/.test(b.querySelector(".tl-title").textContent)).map(b => [b.querySelector(".tl-title").textContent, parseFloat(b.style.getPropertyValue("--tl-fs"))])))`));
check("최대 확대하면 5분 블록(13px)도 15분 블록(40px)도 글자 크기가 달라진다: 5분만 줄고 15분은 그대로", fs160["5분 블록"] < 1 && fs160["15분 블록"] === 1, fs160);
// 시간 글자(단계 4): 블록 높이로 정한다. 두 줄이 들어가면 제목 아래, 안 들어가면 제목 옆 한 줄. 짧은 블록도 시간이 보이고, 겹쳐서 아주 좁으면 시간만 숨긴다
// 블록 하나의 글자 배치를 잰다. "옆"은 시간이 제목과 같은 줄에서 제목 오른쪽에 있다는 뜻, "아래"는 제목보다 아래에 있다는 뜻이다
const textOf = (title, kind = "") => js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-block${kind}")].find(x => x.querySelector(".tl-title") && x.querySelector(".tl-title").textContent === ${JSON.stringify(title)}); if (!b) return "null";
  const br = b.getBoundingClientRect(), ti = b.querySelector(".tl-title"), tr = ti.getBoundingClientRect(), t = b.querySelector(".tl-time"), shown = t && getComputedStyle(t).display !== "none", mr = shown ? t.getBoundingClientRect() : null;
  return JSON.stringify({ one: b.classList.contains("tl-one-line"), text: t ? t.textContent : null, shown,
    beside: shown && mr.left >= tr.right - 1 && Math.abs((mr.top + mr.height / 2) - (tr.top + tr.height / 2)) < tr.height / 2,
    below: shown && mr.top >= tr.bottom - 1,
    inside: !shown || (mr.bottom <= br.bottom + 1 && mr.right <= br.right + 1 && mr.top >= br.top - 1),
    titleInside: tr.bottom <= br.bottom + 1 && tr.height > 0, titleCut: ti.scrollWidth > ti.clientWidth || ti.scrollHeight > ti.clientHeight + 1,
    ratio: shown ? +(parseFloat(getComputedStyle(t).fontSize) / parseFloat(getComputedStyle(ti).fontSize)).toFixed(2) : null, titlePx: parseFloat(getComputedStyle(ti).fontSize), h: br.height, w: br.width }); })()`).then(JSON.parse);
await js(`setTimelineZoom(99)`); await sleep(300);
const time99 = await textOf("30분 블록");
check("99px 배율: 30분 계획(50px)은 두 줄 모양이라 시간이 제목 아래에 보이고 블록 안에 들어간다", time99 && time99.text === "22:30–23:00" && !time99.one && time99.below && time99.inside, time99);
await js(`setTimelineZoom(64)`); await sleep(300);
const time30 = await textOf("30분 블록");
check("64px 배율: 30분 계획(32px)은 두 줄이 안 들어가서 시간이 제목 옆 한 줄에 보인다", time30 && time30.one && time30.beside && time30.inside && time30.titleInside, time30);
const time45 = await textOf("45분 블록");
check("64px 배율: 45분 계획(48px)은 시간이 제목 아래에 보이고 블록 안에 들어간다", time45 && !time45.one && time45.below && time45.inside, time45);
const time5 = await textOf("5분 블록");
check("64px 배율: 5분 계획(16px)도 시간이 제목 옆에 보이고 블록 안에 들어간다", time5 && time5.one && time5.beside && time5.inside && time5.titleInside, time5);
check("글자를 줄인 블록은 시간 글자도 함께 작아진다(제목 11.52px, 시간은 그 0.88배)", time5 && Math.abs(time5.titlePx - 11.52) < 0.1 && time5.ratio === 0.88, time5);
await js(`setTimelineZoom(36)`); await sleep(300);
const time30s = await textOf("30분 블록");
check("36px 배율: 30분 계획(18px)도 시간이 옆에 보이고 블록 안에 들어간다", time30s && time30s.one && time30s.beside && time30s.inside && time30s.titleInside, time30s);
await js(`setTimelineZoom(64)`); await sleep(300);

// 다른 날짜(40일 뒤, 비어 있는 날)에서 짧은 일정, 긴 제목, 겹침, 끄는 도중, 글자 크기 설정을 본다. 오늘의 다른 시험 계획과 겹치지 않게 하려는 것이다
const day4 = await js(`addDaysToText(todayText, 40)`);
const at = (m) => day4 + "T" + String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") + ":00+09:00";
await api("/api/events", "POST", { calendarId: "me@test", title: "짧은 일정", allDay: false, start: at(450), end: at(470) });
await api("/api/events", "POST", { calendarId: "me@test", title: "한 시간 일정", allDay: false, start: at(540), end: at(600) });
for (const [start, end, title] of [[1080, 1110, "끌 계획"], [1140, 1170, "아주 긴 제목의 짧은 계획: 수학 문제집 3단원 복습하고 오답 정리"],
  [1200, 1260, "아주 긴 제목의 한 시간 계획: 수학 문제집 3단원 복습하고 오답 노트 정리까지 끝내기 그리고 영어 단어 외우기"]]) {
  await api("/api/time-blocks", "POST", { date: day4, start, end, title });
}
for (let i = 0; i < 4; i++) await api("/api/time-blocks", "POST", { date: day4, start: 1320, end: 1380, title: "겹침" + i });
for (let i = 0; i < 3; i++) await api("/api/time-blocks", "POST", { date: day4, start: 1410, end: 1440, title: "셋겹침" + i });
await js(`showDay(${JSON.stringify(day4)})`);
await waitFor(async () => (await textOf("짧은 일정", ".tl-event")) !== null && (await textOf("셋겹침2")) !== null, 8000);
await sleep(300);
const ev20 = await textOf("짧은 일정", ".tl-event");
check("일정도 같은 규칙: 20분 일정(21px)은 시간이 제목 옆에 보인다 (예전에는 1시간 미만이면 시간이 없었다)", ev20 && ev20.one && ev20.beside && ev20.inside && ev20.text === "07:30–07:50", ev20);
const ev60 = await textOf("한 시간 일정", ".tl-event");
check("일정도 두 줄이 들어가면 시간이 제목 아래에 있다", ev60 && !ev60.one && ev60.below && ev60.inside, ev60);
const longOne = await textOf("아주 긴 제목의 짧은 계획: 수학 문제집 3단원 복습하고 오답 정리");
check("한 줄 모양에서 제목이 길면 제목이 '…'로 줄고 시간은 옆에 남는다", longOne && longOne.one && longOne.titleCut && longOne.beside && longOne.inside, longOne);
const longTwo = await textOf("아주 긴 제목의 한 시간 계획: 수학 문제집 3단원 복습하고 오답 노트 정리까지 끝내기 그리고 영어 단어 외우기");
check("두 줄 모양에서 제목이 길어도 줄 수를 제한해 시간이 블록 안에 보인다", longTwo && !longTwo.one && longTwo.titleCut && longTwo.below && longTwo.inside, longTwo);
const narrow4 = await Promise.all([0, 1, 2, 3].map((i) => textOf("겹침" + i)));
check("4개가 겹쳐 아주 좁은 블록은 시간을 숨기고 제목을 보여준다", narrow4.every((x) => x && !x.shown && x.titleInside && !x.titleCut), narrow4);
const three = await Promise.all([0, 1, 2].map((i) => textOf("셋겹침" + i)));
check("3개가 겹친 30분 블록(한 줄 모양)도 제목 두 글자가 안 들어가면 시간을 숨기고 제목을 다 보여준다", three.every((x) => x && x.one && !x.shown && !x.titleCut), three);
await js(`setTimelineZoom(160)`); await sleep(300);
const three160 = await Promise.all([0, 1, 2].map((i) => textOf("셋겹침" + i)));
check("최대 확대(두 줄 모양)에서는 3개가 겹쳐도 시간 한 줄이 들어가 제목 아래에 보인다", three160.every((x) => x && !x.one && x.shown && x.below && x.inside), three160);
await js(`setTimelineZoom(64)`); await sleep(300);

// 길이를 끄는 도중에도 표시가 바뀐다: 30분(한 줄) → 1시간으로 늘리면 두 줄, 다시 줄이면 한 줄. 손을 떼기 전에 본다
await posAt(18 * 60 + 15);
r = await blockRect("끌 계획");
await mouse("mouseMoved", r.x, r.bottom - 3, 0); await mouse("mousePressed", r.x, r.bottom - 3);
for (let i = 1; i <= 4; i++) await mouse("mouseMoved", r.x, r.bottom - 3 + HOUR / 2 * i / 4, 1);
await sleep(100);
const dragTwo = await textOf("끌 계획");
check("길이를 늘리는 도중(30분 → 1시간): 두 줄 모양으로 바뀌고 시간 글자도 18:00–19:00", dragTwo && !dragTwo.one && dragTwo.below && dragTwo.text === "18:00–19:00", dragTwo);
for (let i = 3; i >= 0; i--) await mouse("mouseMoved", r.x, r.bottom - 3 + HOUR / 2 * i / 4, 1);
await sleep(100);
const dragOne = await textOf("끌 계획");
check("다시 줄이는 도중(30분): 한 줄 모양으로 돌아간다", dragOne && dragOne.one && dragOne.beside && dragOne.text === "18:00–18:30", dragOne);
await mouse("mouseReleased", r.x, r.bottom - 3); await sleep(600);

// 글자 크기 설정이 커지면 두 줄에 필요한 높이도 커진다 (설정 탭 슬라이더와 같은 길: settings 값을 바꾸고 applySettings. 저장은 하지 않는다)
const fontBefore = await js(`settings.fontSize`);
await js(`settings.fontSize = 20; applySettings()`); await sleep(300);
const big = await textOf("끌 계획");
await js(`setTimelineZoom(99)`); await sleep(300);
const big99 = await textOf("끌 계획");
check("글자 20px: 64px 배율의 30분은 한 줄, 99px 배율의 30분(50px)도 두 줄이 안 들어가 한 줄(16px에서는 두 줄)", big && big.one && big.beside && big99 && big99.one && big99.beside && big99.inside, [big, big99]);
await js(`settings.fontSize = ${fontBefore}; applySettings()`); await sleep(300);
const back99 = await textOf("끌 계획");
check("글자 크기를 되돌리면 시간표를 다시 그려 두 줄로 돌아온다", back99 && !back99.one && back99.below, back99);
await js(`setTimelineZoom(36)`); await sleep(300);
await js(`settings.fontSize = 20; applySettings()`); await sleep(300);
const big36 = await Promise.all(["끌 계획", "짧은 일정"].map((t) => textOf(t)));
check("글자 20px에 최대 축소(16~18px 블록)여도 제목이 블록 밖으로 나가지 않는다", big36.every((x) => x && x.titleInside && x.inside), big36);
await js(`settings.fontSize = ${fontBefore}; applySettings()`); await js(`setTimelineZoom(64)`);
await js(`showDay(todayText)`); await sleep(1800);

// 할 일을 지우면 시간표의 그 계획도 사라진다 (화면에서 직접 삭제 버튼을 눌러 확인)
const jt = (await api("/api/tasks", "POST", { content: "삭제할 할 일", date: today, projectId: null })).data;
await api("/api/time-blocks", "POST", { date: today, start: 1000, end: 1060, taskId: jt.id });
await js(`loadToday()`); await sleep(1500);
await waitFor(async () => (await planTitles()).includes("삭제할 할 일"));
check("(준비) 삭제할 할 일이 시간표에 계획으로 있다", (await planTitles()).includes("삭제할 할 일"));
await js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content").textContent === "삭제할 할 일"); const b = li.querySelector(".task-actions .danger"); b.click(); })()`); await sleep(250);
await js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content").textContent === "삭제할 할 일"); li.querySelector(".task-actions .danger").click(); })()`);
check("오늘 할 일에서 삭제하면 시간표의 계획도 바로 사라진다", await waitFor(async () => !(await planTitles()).includes("삭제할 할 일"), 4000), await planTitles());
check("서버에서도 그 계획이 지워졌다", !(await plans()).some((x) => x.title === "삭제할 할 일"), await plans());


// 날짜를 바꾸면 계획도 지워진다 ("내일로", "목록으로")
console.log("--- K. 날짜를 바꾸면 계획도 지워진다 ---");
const clickTaskButton = (title, label) => js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(title)}); const b = [...li.querySelectorAll(".task-actions button")].find(x => x.textContent === ${JSON.stringify(label)}); if (!b) return "버튼 없음"; b.click(); return "ok"; })()`);
await js(`loadToday()`); await sleep(1500);
check("(준비) 여권 사진 찍기, 지난 일 마무리가 시간표에 계획으로 있다", (await planTitles()).includes("여권 사진 찍기") && (await planTitles()).includes("지난 일 마무리"), await planTitles());
check("'내일로' 버튼을 눌렀다", (await clickTaskButton("여권 사진 찍기", "내일로")) === "ok");
check("'내일로'로 보내면 시간표의 그 계획이 바로 사라진다", await waitFor(async () => !(await planTitles()).includes("여권 사진 찍기"), 4000) && !(await plans()).some((x) => x.title === "여권 사진 찍기"), await planTitles());
check("'목록으로' 버튼을 눌렀다", (await clickTaskButton("지난 일 마무리", "목록으로")) === "ok");
check("'목록으로' 보내면 시간표의 그 계획이 바로 사라진다", await waitFor(async () => !(await planTitles()).includes("지난 일 마무리"), 4000) && !(await plans()).some((x) => x.title === "지난 일 마무리"), await planTitles());
check("다른 할 일의 계획은 그대로다", (await planTitles()).includes("장보기"), await planTitles());

// ===== L. 서버나 Google이 느릴 때 다시 그리기 (docs/review-2026-11.md의 M2) =====
// memo_server.py의 늦추기 스위치(/__test/rule)로 일정이나 계획 응답을 늦춘다. 비어 있는 새벽 시간(01:00~08:00)을 쓴다
console.log("--- L. 느릴 때 다시 그리기 ---");
const rule = (query) => api("/__test/rule" + (query ? "?" + query : ""));
const countTitle = async (title) => (await planTitles()).filter((t) => t === title).length;
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(500);
await js(`setTimelineZoom(64)`); await sleep(200);

// ① Google 일정이 느린 동안(2.5초) 계획을 만든다. 늦게 끝난 불러오기가 "시작할 때 받은 옛 계획"으로 덮으면 방금 만든 블록이 사라진다
await rule("method=GET&path=/api/events&ms=2500");
let slowStart = Date.now();
await js(`void loadTimeline()`);
p = await posAt(1 * 60 + 5);
await click(p.x, p.y); await sleep(250);
await type("느린 일정 중 계획"); await key("Enter");
check("(준비) 일정이 느린 동안 만든 계획이 저장되고 바로 보인다(불러오기가 아직 도는 중)",
  await waitFor(async () => (await planTitles()).includes("느린 일정 중 계획"), 2000) && Date.now() - slowStart < 2400, [Date.now() - slowStart, await planTitles()]);
await sleep(Math.max(0, 2500 - (Date.now() - slowStart)) + 800);   // 늦은 불러오기가 끝나기를 기다린다
check("일정이 느린 동안 만든 계획이 늦게 끝난 불러오기 뒤에도 보인다", (await planTitles()).includes("느린 일정 중 계획"), await planTitles());

// ①-2 같은 상황에서 계획을 지운다 (E의 "두 번째 클릭에 지워진다"가 가끔 흔들리던 모양): 지운 블록이 다시 나타나면 안 된다
await api("/api/time-blocks", "POST", { date: today, start: 180, end: 240, title: "느린 중 지울 계획" });
await js(`reloadPlans()`);
await waitFor(async () => (await planTitles()).includes("느린 중 지울 계획"));
slowStart = Date.now();
await js(`void loadTimeline()`);
await posAt(3 * 60 + 30);
r = await blockRect("느린 중 지울 계획");
await click(r.x, r.y); await sleep(300);
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent === "삭제").click()`); await sleep(150);
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent === "정말?").click()`);
check("(준비) 일정이 느린 동안 지운 계획이 바로 사라진다(불러오기가 아직 도는 중)",
  await waitFor(async () => !(await planTitles()).includes("느린 중 지울 계획") && !(await plans()).some((x) => x.title === "느린 중 지울 계획"), 2000) && Date.now() - slowStart < 2400, [Date.now() - slowStart, await planTitles()]);
await sleep(Math.max(0, 2500 - (Date.now() - slowStart)) + 800);
check("일정이 느린 동안 지운 계획이 늦게 끝난 불러오기 뒤에 다시 나타나지 않는다", !(await planTitles()).includes("느린 중 지울 계획"), await planTitles());
await rule();

// ② 계획 A를 저장하고 다시 받는 동안(1.5초) 계획 B의 제목을 쓴다. 다시 그리면서 B 입력 칸을 지우면, 그 순간의 blur로 반쯤 쓴 제목이 저장된다
await rule("method=GET&path=/api/time-blocks&ms=1500&count=1&after=1");
p = await posAt(5 * 60 + 1);
await click(p.x, p.y); await sleep(250);
await type("계획 A"); await key("Enter");
p = await posAt(7 * 60 + 5);
await click(p.x, p.y); await sleep(250);
await type("계획 B 반");
await sleep(2000);   // 그 사이 A를 다시 받은 응답이 와서 시간표를 다시 그린다
const midB = JSON.parse(await js(`(() => { const i = document.querySelector(".tl-creating .tl-title-input"); return JSON.stringify({ value: i ? i.value : null, focused: !!i && document.activeElement === i }); })()`));
check("A를 저장하는 동안 B 제목을 써도 B 입력 칸과 쓰던 글이 그대로(포커스도)", midB.value === "계획 B 반" && midB.focused, midB);
check("그동안 A는 화면에 보인다", (await planTitles()).includes("계획 A"), await planTitles());
await type("쯤 완성"); await key("Enter");
check("B는 다 쓴 제목으로 하나만 저장된다(반쯤 쓴 제목이 따로 저장되지 않는다)",
  await waitFor(async () => (await plans()).some((x) => x.title === "계획 B 반쯤 완성")) && !(await plans()).some((x) => x.title === "계획 B 반"), (await plans()).map((x) => x.title));
check("화면에 A와 B가 하나씩 보인다", await waitFor(async () => (await countTitle("계획 A")) === 1 && (await countTitle("계획 B 반쯤 완성")) === 1, 3000), await planTitles());
await rule();

// ③ 계획을 끄는 중에 늦은 불러오기가 끝난다: 끌던 블록이 사라지거나 옛 자리에 하나 더 생기면 안 된다
await posAt(5 * 60 + 30);
r = await blockRect("계획 A");
await rule("method=GET&path=/api/events&ms=1500");
await js(`void loadTimeline()`);
await mouse("mouseMoved", r.x, r.y, 0); await mouse("mousePressed", r.x, r.y);
for (let i = 1; i <= 4; i++) await mouse("mouseMoved", r.x, r.y + i * 8, 1);
await sleep(2300);   // 끄는 중에 늦은 불러오기가 끝난다
const midDrag = JSON.parse(await js(`JSON.stringify({ dragging: [...document.querySelectorAll("#timeline-grid .tl-plan.dragging")].map(b => b.querySelector(".tl-title").textContent), all: [...document.querySelectorAll("#timeline-grid .tl-plan")].filter(b => b.querySelector(".tl-title") && b.querySelector(".tl-title").textContent === "계획 A").length })`));
check("끄는 중에 늦은 불러오기가 끝나도 끌던 블록이 그대로 하나만 있다", midDrag.dragging.length === 1 && midDrag.dragging[0] === "계획 A" && midDrag.all === 1, midDrag);
for (let i = 5; i <= 8; i++) await mouse("mouseMoved", r.x, r.y + i * 8, 1);
await mouse("mouseReleased", r.x, r.y + 64);
await rule();
check("놓으면 1시간 아래(06:00–06:30)로 저장되고 블록은 하나", await waitFor(async () => (await plans()).some((x) => x.title === "계획 A" && x.start === 360 && x.end === 390) && (await countTitle("계획 A")) === 1, 3000), [(await plans()).find((x) => x.title === "계획 A"), await planTitles()]);
check("늦게 끝난 불러오기 뒤에도 만든 계획들이 모두 보인다", (await planTitles()).includes("느린 일정 중 계획") && (await planTitles()).includes("계획 B 반쯤 완성"), await planTitles());
// ③-2 블록을 누르고 있는(아직 안 뗀) 동안 계획이 새로 생기면, 그리기를 미뤘다가 손을 뗀 뒤 그린다
await posAt(6 * 60 + 30);
r = await blockRect("계획 A");
await mouse("mouseMoved", r.x, r.y, 0); await mouse("mousePressed", r.x, r.y);
await api("/api/time-blocks", "POST", { date: today, start: 450, end: 465, title: "누르는 중 생긴 계획" });
await js(`reloadPlans()`);   // 누르고 있는 동안이라 그리기가 미뤄진다
await mouse("mouseReleased", r.x, r.y);   // 움직이지 않고 떼면 작은 창이 열린다
check("누르는 동안 미뤄 둔 그리기를 손을 뗀 뒤 한다(새 계획이 보이고 작은 창도 열린다)",
  (await waitFor(async () => (await planTitles()).includes("누르는 중 생긴 계획"), 2000)) && (await js(`!!document.querySelector(".tl-popover")`)), await planTitles());
await key("Escape"); await sleep(300);

// ④ 새 계획 제목을 쓰는 중에 확대한다 (docs/review-2026-11.md의 N17. M2와 같은 방법으로 고쳐진다): 입력 칸과 글이 남고 새 눈금 위치로 옮겨진다
p = await posAt(2 * 60 + 1);
await click(p.x, p.y); await sleep(250);
await type("확대 중 계획");
await js(`setTimelineZoom(100)`); await sleep(200);
const zoomed = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); const i = b && b.querySelector(".tl-title-input"); return JSON.stringify({ value: i ? i.value : null, focused: !!i && document.activeElement === i, top: b ? parseFloat(b.style.top) : null, h: b ? parseFloat(b.style.height) : null }); })()`));
check("제목을 쓰는 중에 확대해도 입력 칸과 쓰던 글이 그대로이고, 블록이 새 눈금(02:00, 30분)에 맞는다", zoomed.value === "확대 중 계획" && zoomed.focused && Math.abs(zoomed.top - 200) < 1 && Math.abs(zoomed.h - 50) < 1, zoomed);
await key("Enter");
check("확대한 뒤 Enter하면 02:00–02:30으로 저장된다", await waitFor(async () => (await plans()).some((x) => x.title === "확대 중 계획" && x.start === 120 && x.end === 150)), (await plans()).map((x) => [x.title, x.start]));
await js(`setTimelineZoom(64)`);

// ===== M. 오늘 탭 너비 슬라이더 (실제 마우스로 끈다) =====
console.log("--- M. 너비 슬라이더 ---");
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
const openTab = async (name) => { await js(`document.querySelector('.tab-button[data-tab="${name}"]').click()`); await sleep(400); };
const layoutWidths = async () => { await openTab("today"); return JSON.parse(await js(`(() => { const w = (s) => document.querySelector(s).getBoundingClientRect().width; return JSON.stringify({ timeline: w("#timeline-column"), right: w("#inbox-column"), mini: w("#mini-calendar"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }); })()`)); };
const sliderState = (k) => js(`(() => { const s = document.querySelector('input[data-key="${k}"]'); return JSON.stringify({ value: Number(s.value), text: s.nextElementSibling.textContent, setting: settings["${k}"] }); })()`).then(JSON.parse);
const sliderEnds = (k) => js(`(() => { const s = document.querySelector('input[data-key="${k}"]'); s.scrollIntoView({ block: "center" }); const r = s.getBoundingClientRect(); return JSON.stringify({ left: r.left + 1, right: r.right - 1, y: r.top + r.height / 2, x: r.left + 8 + (Number(s.value) - Number(s.min)) / (Number(s.max) - Number(s.min)) * (r.width - 16) }); })()`).then(JSON.parse);
const savedWidths = async () => { const v = (await api("/api/settings")).data.values; return [v.timelineWidth, v.todayRightWidth]; };
// 손잡이를 잡아 한쪽 끝까지 끌고 놓는다
const dragSliderTo = async (k, side) => { await openTab("settings"); const e = await sliderEnds(k); await drag(e.x, e.y, e[side], e.y); await sleep(250); };

let w = await layoutWidths();
check("기본: 시간표 400px, 오른쪽 칸과 달력 300px", Math.abs(w.timeline - 400) < 1 && Math.abs(w.right - 300) < 1 && Math.abs(w.mini - 300) < 1, w);
await dragSliderTo("todayRightWidth", "right");
check("시간표가 400이면 오른쪽 칸 슬라이더는 끝까지 끌어도 450에서 막힌다(합 850)",(await sliderState("todayRightWidth")).value === 450 && (await sliderState("todayRightWidth")).text === "450px", await sliderState("todayRightWidth"));
w = await layoutWidths();
check("오른쪽 칸과 작은 달력이 450px로 넓어진다", Math.abs(w.right - 450) < 1 && Math.abs(w.mini - 450) < 1, w);

// 오른쪽이 450이면 시간표는 400에서 막힌다. 누른 채로 왔다 갔다 해도 손잡이가 한계에서 멈췄다가 다시 따라와야 한다
await openTab("settings");
let e = await sliderEnds("timelineWidth");
await mouse("mouseMoved", e.x, e.y, 0); await mouse("mousePressed", e.x, e.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", e.x + (e.right - e.x) * i / 6, e.y, 1);
const blocked = await sliderState("timelineWidth");
check("오른쪽이 450이면 시간표는 끄는 도중에도 400에서 막힌다", blocked.value === 400 && blocked.setting === 400 && blocked.text === "400px", blocked);
await mouse("mouseMoved", e.left, e.y, 1);
check("막힌 뒤 왼쪽으로 끌면 손잡이가 따라온다(300)", (await sliderState("timelineWidth")).value === 300, await sliderState("timelineWidth"));
await mouse("mouseMoved", e.right, e.y, 1);
check("다시 오른쪽 끝으로 끌면 또 400에서 막힌다", (await sliderState("timelineWidth")).value === 400, await sliderState("timelineWidth"));
await mouse("mouseReleased", e.right, e.y); await sleep(300);
check("놓으면 400/450으로 저장된다", JSON.stringify(await savedWidths()) === "[400,450]", await savedWidths());

// 반대 방향: 시간표가 500이면 오른쪽은 350에서 막힌다
await dragSliderTo("todayRightWidth", "left");
await dragSliderTo("timelineWidth", "right");
check("오른쪽이 300이면 시간표는 500까지 간다", (await sliderState("timelineWidth")).value === 500, await sliderState("timelineWidth"));
await dragSliderTo("todayRightWidth", "right");
check("시간표가 500이면 오른쪽 칸은 350에서 막히고 저장된다", (await sliderState("todayRightWidth")).value === 350 && JSON.stringify(await savedWidths()) === "[500,350]", [await sliderState("todayRightWidth"), await savedWidths()]);
w = await layoutWidths();
check("시간표 500px, 오른쪽 칸 350px이 실제로 적용된다", Math.abs(w.timeline - 500) < 1 && Math.abs(w.right - 350) < 1 && w.overflow <= 0, w);

// 가장 작은 값(예전 CSS 최솟값 330px 아래)도 실제로 적용되는지
await dragSliderTo("timelineWidth", "left");
w = await layoutWidths();
check("시간표 300px이 실제로 적용된다(330px에 걸리지 않는다)", Math.abs(w.timeline - 300) < 1, w);

// 시간표가 300이면 오른쪽 칸은 끝값 500까지 간다(합 800, 한계 850 안)
await dragSliderTo("todayRightWidth", "right");
check("시간표가 300이면 오른쪽 칸은 500까지 가고 저장된다", (await sliderState("todayRightWidth")).value === 500 && JSON.stringify(await savedWidths()) === "[300,500]", [await sliderState("todayRightWidth"), await savedWidths()]);
w = await layoutWidths();
check("오른쪽 칸과 작은 달력 500px이 실제로 적용된다", Math.abs(w.right - 500) < 1 && Math.abs(w.mini - 500) < 1 && w.overflow <= 0, w);

// 창이 좁으면 오른쪽 칸이 아래로 내려간다. 달력이 줄 전체로 늘어나거나 가로 스크롤이 생기면 안 된다
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(300);
w = await layoutWidths();
check("좁은 창: 오른쪽 칸은 줄 전체를 쓰고 달력은 슬라이더 값(500px)까지만, 가로 스크롤 없음", w.right > 600 && Math.abs(w.mini - 500) < 1 && w.overflow <= 0, w);
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });

await openTab("settings");
await js(`document.getElementById("today-settings-reset").click()`);
check("[기본값으로]를 누르면 400/300으로 돌아가 저장된다", await waitFor(async () => JSON.stringify(await savedWidths()) === "[400,300]", 2000), await savedWidths());
w = await layoutWidths();
check("기본값으로 돌아간 너비가 적용된다", Math.abs(w.timeline - 400) < 1 && Math.abs(w.right - 300) < 1, w);
await send("Emulation.clearDeviceMetricsOverride");

// ===== N. 기본값 설정: 시간표 첫 위치, 일정 추가 기본 시작·길이 =====
console.log("--- N. 기본값 설정 ---");
const centerMin = () => js(`yToMin(timelineScroll.getBoundingClientRect().top + timelineScroll.clientHeight / 2)`);
const savedValues = async () => (await api("/api/settings")).data.values;
// 설정 탭의 칸을 눌러 글자를 지우고 새로 쓴 뒤 Enter
const typeInto = async (id, text) => { await openTab("settings"); await js(`(() => { const i = document.getElementById("${id}"); i.scrollIntoView({ block: "center" }); i.focus(); i.select(); })()`); await type(text); await key("Enter"); await sleep(300); };

await openTab("today");
check("시간표 첫 위치 기본값: 17:00이 가운데", await waitFor(async () => Math.abs((await centerMin()) - 17 * 60) <= 2, 2000), await centerMin());
await typeInto("timeline-center-time", "1230");
check("'1230'을 쓰고 Enter하면 12:30으로 정리되어 저장된다", (await js(`timelineCenterInput.value`)) === "12:30" && (await savedValues()).timelineCenterTime === "12:30", [await js(`timelineCenterInput.value`), (await savedValues()).timelineCenterTime]);
await openTab("today");
check("오늘 탭을 열면(종일 일정 줄이 늦게 생겨도) 12:30이 가운데", await waitFor(async () => Math.abs((await centerMin()) - (12 * 60 + 30)) <= 2, 2000) && (await js(`!timelineAllDay.hidden`)), [await centerMin(), await js(`timelineAllDay.hidden`)]);
// 사용자가 스크롤한 뒤에는 칸 높이가 바뀌어도 저절로 움직이지 않는다
await js(`timelineScroll.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })); timelineScroll.scrollTop = 200; timelineAllDay.hidden = true`); await sleep(300);
check("스크롤한 뒤에는 종일 줄이 사라져 칸이 커져도 위치가 그대로", Math.abs((await js(`timelineScroll.scrollTop`)) - 200) <= 1, await js(`timelineScroll.scrollTop`));
await js(`timelineAllDay.hidden = false`);
await js(`document.getElementById("day-next").click()`); await sleep(1500);
check("날짜를 넘겨도 12:30이 가운데", Math.abs((await centerMin()) - (12 * 60 + 30)) <= 2, await centerMin());
await js(`document.getElementById("day-prev").click()`); await sleep(1000);
await typeInto("timeline-center-time", "abc");
check("읽을 수 없는 글자는 빨간 칸으로 알리고 저장하지 않는다", (await js(`timelineCenterInput.classList.contains("invalid")`)) && (await savedValues()).timelineCenterTime === "12:30");

// 일정 추가 창: 월간 보기는 설정의 시작 시각, 주간 보기는 누른 시각. 길이는 둘 다 설정값
const addDialogValues = async (view, hour) => {
  await js(`openAddDialog({ date: ${hour === undefined ? "new Date(2030, 0, 15)" : `new Date(2030, 0, 15, ${hour})`}, view: { type: ${view === "month" ? "MONTH_VIEW" : '"timeGridWeek"'} }, allDay: false }); true`);
  await sleep(150);
  const v = JSON.parse(await js(`JSON.stringify({ allDay: eventAllDayCheckbox.checked, start: eventStartDate.value + " " + eventStartTime.value, end: eventEndDate.value + " " + eventEndTime.value })`));
  await js(`eventDialog.close()`);
  return v;
};
let ad = await addDialogValues("month");
check("기본: 월간 보기에서 날짜를 누르면 09:00–10:00", !ad.allDay && ad.start === "2030-01-15 09:00" && ad.end === "2030-01-15 10:00", ad);
await typeInto("event-default-start", "4:45pm");
await js(`(() => { const s = eventDefaultMinutesSelect; s.value = "30"; s.dispatchEvent(new Event("change")); })()`); await sleep(300);
let sv = await savedValues();
check("'4:45pm'은 16:45로, 길이는 30분으로 저장된다", sv.eventDefaultStart === "16:45" && sv.eventDefaultMinutes === 30, sv);
ad = await addDialogValues("month");
check("월간 보기: 16:45–17:15", !ad.allDay && ad.start === "2030-01-15 16:45" && ad.end === "2030-01-15 17:15", ad);
ad = await addDialogValues("week", 14);
check("주간 보기: 누른 시각(14:00)부터 기본 길이 30분", !ad.allDay && ad.start === "2030-01-15 14:00" && ad.end === "2030-01-15 14:30", ad);
await openTab("settings");
await js(`eventDefaultAllDayCheckbox.click()`); await sleep(300);
sv = await savedValues();
check("종일을 체크하면 종일로 저장되고, 시각(16:45)은 그대로 쓸 수 있다", sv.eventDefaultAllDay === true && sv.eventDefaultStart === "16:45" && !(await js(`eventDefaultStartInput.disabled`)) && (await js(`eventDefaultStartInput.value`)) === "16:45", sv);
check("종일일 때 '종일을 끄면 이 시각' 안내가 보인다", await js(`!eventDefaultStartHint.hidden && eventDefaultStartHint.getBoundingClientRect().width > 0`));
ad = await addDialogValues("month");
check("월간 보기: 종일 일정 창으로 열린다(그날 하루)", ad.allDay && ad.start.startsWith("2030-01-15") && ad.end.startsWith("2030-01-15"), ad);
// 종일인 채로 시각을 바꾸고, 일정 창에서 종일을 끄면 그 시각이 보인다
await typeInto("event-default-start", "1330");
sv = await savedValues();
check("종일인 채로 시각만 13:30으로 바뀐다", sv.eventDefaultAllDay === true && sv.eventDefaultStart === "13:30", sv);
await js(`openAddDialog({ date: new Date(2030, 0, 15), view: { type: MONTH_VIEW }, allDay: false }); true`); await sleep(150);
await js(`eventAllDayCheckbox.click()`); await sleep(150);
let offAllDay = JSON.parse(await js(`JSON.stringify({ allDay: eventAllDayCheckbox.checked, start: eventStartTime.value, end: eventEndTime.value })`));
await js(`eventDialog.close()`);
check("일정 창에서 종일을 끄면 13:30–14:00(설정 시각 + 길이 30분)", !offAllDay.allDay && offAllDay.start === "13:30" && offAllDay.end === "14:00", offAllDay);
// 주간·일간 보기의 종일 줄도 같은 시각을 품고 열린다
await js(`openAddDialog({ date: new Date(2030, 0, 15), view: { type: "timeGridWeek" }, allDay: true }); true`); await sleep(150);
await js(`eventAllDayCheckbox.click()`); await sleep(150);
offAllDay = JSON.parse(await js(`JSON.stringify({ allDay: eventAllDayCheckbox.checked, start: eventStartTime.value })`));
await js(`eventDialog.close()`);
check("주간 보기 종일 줄: 종일을 끄면 13:30", !offAllDay.allDay && offAllDay.start === "13:30", offAllDay);
await typeInto("event-default-start", "4:45pm");
await js(`eventDefaultAllDayCheckbox.click()`); await sleep(300);
sv = await savedValues();
check("종일을 끄면 시각(16:45)으로 돌아가고 안내가 숨는다", sv.eventDefaultAllDay === false && sv.eventDefaultStart === "16:45" && (await js(`eventDefaultStartHint.hidden`)) && (await js(`eventDefaultStartInput.value`)) === "16:45", sv);

// 다시 불러와도 설정 칸에 저장된 값이 보인다
await send("Page.reload"); await sleep(3000);
const shown = JSON.parse(await js(`JSON.stringify({ center: timelineCenterInput.value, start: eventDefaultStartInput.value, allDay: eventDefaultAllDayCheckbox.checked, minutes: eventDefaultMinutesSelect.value })`));
check("새로 불러와도 설정 칸에 12:30, 16:45, 30분이 보인다", shown.center === "12:30" && shown.start === "16:45" && !shown.allDay && shown.minutes === "30", shown);
await openTab("settings");
await js(`document.getElementById("today-settings-reset").click()`);
check("오늘 탭 [기본값으로]는 시간표 첫 위치도 17:00으로 돌린다", await waitFor(async () => (await savedValues()).timelineCenterTime === "17:00", 2000) && (await js(`timelineCenterInput.value`)) === "17:00", (await savedValues()).timelineCenterTime);


// ===== O. 계획 작은 창: 이름 수정, 시간 수정, 가운데 시간 글자 (단계 5) =====
// 50일 뒤의 빈 날짜를 쓴다. 할 일과 연결된 계획(10:00–11:00), 빈칸 계획(점심 12:00–12:30, 저녁 18:00–19:00)
console.log("--- O. 계획 작은 창: 이름·시간 수정 ---");
await openTab("today");
const dayO = await js(`addDaysToText(todayText, 50)`);
const taskO = (await api("/api/tasks", "POST", { content: "영어 단어 외우기", date: dayO, projectId: null })).data;
await api("/api/time-blocks", "POST", { date: dayO, start: 600, end: 660, taskId: taskO.id });
await api("/api/time-blocks", "POST", { date: dayO, start: 720, end: 750, title: "점심" });
await api("/api/time-blocks", "POST", { date: dayO, start: 1080, end: 1140, title: "저녁" });
await js(`showDay(${JSON.stringify(dayO)})`);
await waitFor(async () => (await planTitles()).includes("저녁") && (await js(`!!document.querySelector(".task-row .task-slot")`)), 8000);
await sleep(300);
const plansO = async () => (await api("/api/time-blocks?date=" + dayO)).data;
const planO = async (title) => (await plansO()).find((x) => x.title === title);
const popTimes = () => js(`JSON.stringify([...document.querySelectorAll(".tl-popover .tl-pop-times input")].map(i => i.value).concat([document.querySelector(".tl-popover .tl-pop-length").textContent]))`).then(JSON.parse);
const popOpen = () => js(`!!document.querySelector(".tl-popover")`);
// 창 안의 칸을 진짜 마우스로 누른다 (0 = 시작, 1 = 끝). 처음 누르면 글자 전체가 선택되지만, 이미 커서가 있던 칸은 선택되지 않으므로 전체를 선택해 둔다
const clickPopTime = async (index) => { const p = JSON.parse(await js(`JSON.stringify((() => { const r = document.querySelectorAll(".tl-popover .tl-pop-times input")[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)); await click(p.x, p.y); await sleep(100); await js(`document.activeElement.select()`); };
const openPlanO = async (title, min) => { await posAt(min); const b = await blockRect(title); await click(b.x, b.y); await sleep(400); if (!(await popOpen())) { await posAt(min); const b2 = await blockRect(title); await click(b2.x, b2.y); await sleep(400); } };

// ① 연결된 계획의 이름 고치기 → 할 일 이름이 바뀐다
await openPlanO("영어 단어 외우기", 630);
check("연결된 계획 창: 제목 칸에 할 일 이름, 시간 칸 10:00–11:00 (1시간), 연결 안내", (await js(`document.querySelector(".tl-popover .tl-title-input").value`)) === "영어 단어 외우기" && JSON.stringify(await popTimes()) === JSON.stringify(["10:00", "11:00", "(1시간)"]) && (await js(`document.querySelector(".tl-popover .tl-pop-tip").textContent`)).includes("할 일 이름도 바뀝니다"), await popTimes());
check("블록에서 열면 제목 칸에 커서가 있다", await js(`document.activeElement === document.querySelector(".tl-popover .tl-title-input")`));
await js(`document.querySelector(".tl-popover .tl-title-input").select()`);
await type("영어 단어 50개 외우기"); await key("Enter");
check("Enter하면 창이 닫히고 할 일 이름이 서버에서 바뀐다", await waitFor(async () => (await api("/api/tasks?date=" + dayO)).data.tasks.some((t) => t.id === taskO.id && t.content === "영어 단어 50개 외우기")) && !(await popOpen()));
check("시간표 블록과 가운데 할 일 줄에도 새 이름이 보인다", await waitFor(async () => (await planTitles()).includes("영어 단어 50개 외우기") && (await js(`[...document.querySelectorAll(".task-row .task-content")].some(c => c.textContent === "영어 단어 50개 외우기")`))), await planTitles());
check("연결은 그대로다(계획의 taskId)", (await planO("영어 단어 50개 외우기")).taskId === taskO.id, await plansO());

// ② 시간 칸: 시작을 바꾸면 끝이 같은 길이로 따라오고, 끝을 바꾸면 길이가 바뀐다
await openPlanO("점심", 735);
await clickPopTime(0); await type("1315");
await clickPopTime(1);   // 끝 칸으로 옮기면 시작 칸이 확정된다
check("시작을 1315로 쓰고 칸을 옮기면 13:15로 정리되고 끝이 13:45로 따라온다(30분 유지)", JSON.stringify(await popTimes()) === JSON.stringify(["13:15", "13:45", "(30분)"]), await popTimes());
await type("14:00"); await key("Enter");
check("끝을 14:00으로 쓰고 Enter하면 13:15–14:00으로 저장되고 창이 닫힌다", await waitFor(async () => { const x = await planO("점심"); return x && x.start === 795 && x.end === 840; }) && !(await popOpen()), await planO("점심"));

// ③ 틀린 시간: Enter해도 닫히지 않고 빨간 칸, Esc는 아무것도 저장하지 않고 닫는다
await openPlanO("점심", 810);
await clickPopTime(1); await type("abc"); await key("Enter"); await sleep(200);
check("끝에 abc를 쓰고 Enter: 창이 열린 채 끝 칸이 빨갛고 알림이 뜬다", (await popOpen()) && (await js(`document.querySelectorAll(".tl-popover .tl-pop-times input")[1].classList.contains("invalid")`)) && (await js(`document.getElementById("toast").classList.contains("show") && /읽을 수 없습니다/.test(document.getElementById("toast").textContent)`)));
await clickPopTime(1); await type("13:00"); await key("Enter"); await sleep(200);
check("끝이 시작보다 빠르면(13:15–13:00) Enter해도 닫히지 않는다", (await popOpen()) && (await js(`/5분 이상/.test(document.getElementById("toast").textContent)`)));
await key("Escape"); await sleep(400);
const lunch = await planO("점심");
check("Esc로 닫으면 아무것도 저장하지 않는다(13:15–14:00 그대로)", !(await popOpen()) && lunch.start === 795 && lunch.end === 840, lunch);
await openPlanO("점심", 810);
await js(`document.querySelector(".tl-popover .tl-title-input").select()`); await type("점심 약속"); await key("Escape"); await sleep(400);
check("제목을 쓰다가 Esc로 닫아도 저장하지 않는다", (await planO("점심")) !== undefined && !(await planO("점심 약속")), (await plansO()).map((x) => x.title));

// ④ ↑/↓ 키와 하루의 끝(24:00)
await openPlanO("저녁", 1110);
await clickPopTime(0); await key("ArrowUp"); await key("ArrowUp", { modifiers: 8 });   // modifiers 8 = Shift
check("시작 칸에서 ↑는 5분, Shift+↑는 1시간: 19:05, 끝은 20:05로 따라온다", JSON.stringify(await popTimes()) === JSON.stringify(["19:05", "20:05", "(1시간)"]), await popTimes());
await clickPopTime(0); await type("23:30"); await clickPopTime(1);
check("시작 23:30이면 끝은 하루 끝 24:00에서 잘린다", JSON.stringify(await popTimes()) === JSON.stringify(["23:30", "24:00", "(30분)"]), await popTimes());
await key("Enter");
check("24:00까지인 계획으로 저장된다(23:30–24:00)", await waitFor(async () => { const x = await planO("저녁"); return x && x.start === 1410 && x.end === 1440; }), await planO("저녁"));
await openPlanO("저녁", 1420);
await clickPopTime(0); await type("2200"); await clickPopTime(1); await type("2400"); await key("Enter");
check("끝 칸에 2400을 써도 24:00으로 읽는다(22:00–24:00)", await waitFor(async () => { const x = await planO("저녁"); return x && x.start === 1320 && x.end === 1440; }), await planO("저녁"));

// ⑤ 칸을 떠나지 않은 채 시간표를 스크롤해도(창이 닫힘) 쓰던 시간이 저장되고 끝도 따라온다
await openPlanO("저녁", 1380);
await clickPopTime(0); await type("2030");
await js(`timelineScroll.scrollTop -= 40`); await sleep(200);
check("시작에 2030을 쓰고 바로 스크롤: 창이 닫히며 20:30–22:30(2시간 유지)으로 저장된다", !(await popOpen()) && await waitFor(async () => { const x = await planO("저녁"); return x && x.start === 1230 && x.end === 1350; }), await planO("저녁"));

// ⑥ 가운데 할 일 옆의 시간 글자를 누르면 같은 창이 열린다
// 줄에 마우스를 올리면 줄 버튼([내일로] 등)이 나타나서 시간 글자가 왼쪽으로 밀린다. 사람처럼 먼저 마우스를 올린 뒤 위치를 다시 잰다
const slotRectNow = async () => JSON.parse(await js(`JSON.stringify((() => { const s = document.querySelector(".task-row .task-slot"); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: s.textContent }; })())`));
const slotRect = async () => { await js(`document.querySelector(".task-row .task-slot").scrollIntoView({ block: "center" })`); await sleep(150); const a = await slotRectNow(); await mouse("mouseMoved", a.x, a.y, 0); await sleep(150); return slotRectNow(); };
await mouse("mouseMoved", 5, 5, 0); await js(`document.querySelector(".task-row .task-slot").scrollIntoView({ block: "center" })`); await sleep(200);
const slotBefore = await slotRectNow();
let sr = await slotRect();
check("시간 글자는 이름 바로 뒤에 있어서, 줄에 마우스를 올려 버튼이 나타나도 움직이지 않는다", Math.abs(sr.x - slotBefore.x) < 1 && (await js(`document.querySelector(".task-row .task-slot").getBoundingClientRect().left - document.querySelector(".task-row .task-slot").previousElementSibling.getBoundingClientRect().right`)) < 20, [slotBefore, sr]);
check("(준비) 할 일 줄 옆에 10:00–11:00이 붙어 있다", sr.text === "10:00–11:00", sr);
const hit = await js(`(() => { const e = document.elementFromPoint(${sr.x}, ${sr.y}); return e ? e.className + " / " + e.textContent.slice(0, 30) : "없음"; })()`);
check("(준비) 시간 글자 자리를 누르면 시간 글자가 눌린다", /task-slot/.test(hit), hit);
await click(sr.x, sr.y); await sleep(400);
check("시간 글자를 누르면 그 계획의 작은 창이 열리고 시작 칸에 커서가 있다", (await popOpen()) && (await js(`document.querySelector(".tl-popover .tl-title-input").value`)) === "영어 단어 50개 외우기" && (await js(`document.activeElement === document.querySelector(".tl-popover .tl-pop-times input")`)));
check("시간표의 그 블록에 선택 테두리가 생긴다", await js(`[...document.querySelectorAll("#timeline-grid .tl-plan.selected")].map(b => b.querySelector(".tl-title").textContent).join() === "영어 단어 50개 외우기"`));
const popLeft = JSON.parse(await js(`JSON.stringify({ pop: document.querySelector(".tl-popover").getBoundingClientRect().left, slot: document.querySelector(".task-row .task-slot").getBoundingClientRect().right })`));
check("창은 시간 글자 옆에 붙는다", popLeft.pop >= popLeft.slot, popLeft);
await click(sr.x, sr.y); await sleep(300);
check("같은 시간 글자를 다시 누르면 닫힌다", !(await popOpen()));
await click(sr.x, sr.y); await sleep(400);
await type("0930"); await key("Enter");
check("시간 글자에서 연 창에 0930을 쓰고 Enter: 09:30–10:30으로 옮겨진다", await waitFor(async () => { const x = await planO("영어 단어 50개 외우기"); return x && x.start === 570 && x.end === 630; }), await planO("영어 단어 50개 외우기"));
check("할 일 옆 시간 글자도 09:30–10:30으로 바뀐다", await waitFor(async () => (await js(`document.querySelector(".task-row .task-slot").textContent`)) === "09:30–10:30"));
// 할 일 목록을 스크롤하면 창이 닫힌다 (창이 목록 옆에 떠 있으므로)
sr = await slotRect(); await click(sr.x, sr.y); await sleep(400);
await js(`document.querySelector("#tasks-column .column-scroll").dispatchEvent(new Event("scroll"))`); await sleep(200);
check("할 일 목록이 스크롤되면 창이 닫힌다", !(await popOpen()));
await js(`showDay(todayText)`); await sleep(1500);

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
