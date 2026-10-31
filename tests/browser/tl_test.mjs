// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9387;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "edge_t_"))}`, "--window-size=1400,900", "--no-first-run", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling", "about:blank"], { stdio: "ignore" });
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
let p = await posAt(9 * 60 + 5);
await click(p.x, p.y);
await sleep(300);
check("빈 곳을 한 번 누르면 제목 입력 칸이 열린다(1시간짜리)", (await js(`!!document.querySelector(".tl-creating .tl-title-input") && document.activeElement.className === "tl-title-input"`)));
const geo = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }); })()`));
check("09:05를 눌렀으면 09:00부터 1시간(15분 단위로 내림)", Math.abs(geo.top - 9 * HOUR) < 1 && Math.abs(geo.h - HOUR) < 1, geo);
await type("토익 공부"); await key("Enter");
check("Enter로 저장되고 블록이 나타난다", await waitFor(async () => (await plans()).some((x) => x.title === "토익 공부" && x.start === 540 && x.end === 600)), await plans());
check("서버에도 09:00–10:00으로 저장", (await plans()).some((x) => x.title === "토익 공부" && x.start === 540 && x.end === 600 && x.taskId === null));
check("화면에 점선 계획 블록이 보인다", (await planTitles()).includes("토익 공부"));

p = await posAt(13 * 60 + 2);
const p2 = await posAt(13 * 60 + 2); // 같은 스크롤
const yEnd = p.y + (14 * 60 + 20 - (13 * 60 + 2)) / 60 * HOUR;
await drag(p.x, p.y, p.x, yEnd);
await sleep(300);
const g2 = JSON.parse(await js(`(() => { const b = document.querySelector(".tl-creating"); return b ? JSON.stringify({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }) : "null"; })()`));
check("13:02에서 14:20까지 끌면 13:00–14:30 블록", g2 && Math.abs(g2.top - 13 * HOUR) < 1 && Math.abs(g2.h - 1.5 * HOUR) < 1, g2);
await type("복습 정리"); await key("Enter");
check("끌어서 만든 계획이 13:00–14:30으로 저장", await waitFor(async () => (await plans()).some((x) => x.title === "복습 정리" && x.start === 780 && x.end === 870)), await plans());

p = await posAt(16 * 60 + 5);
await click(p.x, p.y); await sleep(250);
await type("취소될 계획"); await key("Escape"); await sleep(400);
check("Esc로 만들기를 취소하면 저장되지 않는다", !(await plans()).some((x) => x.title === "취소될 계획") && !(await js(`!!document.querySelector(".tl-creating")`)));
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
check("끌어서 옮기면 09:00 → 10:30 (15분 단위)", (await plans()).some((x) => x.title === "토익 공부" && x.start === 630 && x.end === 690), await plans());
await posAt(11 * 60);
r = await blockRect("토익 공부");
await drag(r.x, r.bottom - 3, r.x, r.bottom - 3 + HOUR);   // 아래쪽 끝을 1시간 아래로
await sleep(700);
check("아래쪽 끝을 끌면 길이가 늘어난다: 10:30–12:30", (await plans()).some((x) => x.title === "토익 공부" && x.start === 630 && x.end === 750), await plans());
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
check("시간과 길이가 보인다", (await js(`document.querySelector(".tl-popover .tl-pop-sub").textContent`)).includes("13:00–14:30 (1시간 30분)"));
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
await js(`[...document.querySelectorAll(".tl-popover button")].find(b => b.textContent === "정말?").click()`); await sleep(600);
check("두 번째 클릭에 지워진다", !(await plans()).some((x) => x.title === "복습 완성") && !(await planTitles()).includes("복습 완성"));

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
check("연결된 계획의 창: 제목은 읽기 전용이고 '할 일 완료' 체크가 있다", (await js(`!document.querySelector(".tl-popover input.tl-title-input") && !!document.querySelector(".tl-popover .tl-pop-check input")`)));
await js(`document.querySelector(".tl-popover .tl-pop-check input").click()`); await sleep(1000);
check("체크하면 할 일이 끝나고 계획 블록도 끝난 모양(흐림)이 된다", (await js(`!!document.querySelector("#timeline-grid .tl-plan.done")`)) && (await api("/api/tasks?date=" + today)).data.tasks.find((t) => t.content === "발표 자료 만들기").done === 1);
await key("Escape"); await sleep(200);
await shot("t_after.png");

// ===== H. 날짜 넘기기 / 오프라인 / 스크롤 =====
console.log("--- H. 날짜, 오프라인, 스크롤 ---");
await js(`document.getElementById("day-next").click()`); await sleep(1800);
const tm = JSON.parse(await js(`JSON.stringify({ st: timelineScroll.scrollTop, plans: document.querySelectorAll("#timeline-grid .tl-plan").length, ev: [...document.querySelectorAll("#timeline-grid .tl-event")].map(b => b.querySelector(".tl-title").textContent), now: document.querySelectorAll(".tl-now").length })`));
check("내일: 07:00이 맨 위에 오도록 스크롤", Math.abs(tm.st - 7 * HOUR) <= 2, tm);
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
p = await posAt(9 * 60 + 7);
await click(p.x, p.y); await sleep(300);
await type("정밀 계획"); await key("Enter");
check("5분 단위: 09:07을 누르면 09:05부터 1시간", await waitFor(async () => (await plans()).some((x) => x.title === "정밀 계획" && x.start === 545 && x.end === 605)), await plans());
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
check("5분 단위로 길이가 바뀐다(60분에서 70분: 15분 단위로는 불가능한 길이)", rz.end % 5 === 0 && (rz.end - rz.start) === 70, rz);
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
check("서버: 글자/true/null은 기본값(64)", (await putZoom("abc")) === 64 && (await putZoom(true)) === 64 && (await putZoom(null)) === 64);
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
await js(`setTimelineZoom(64)`); await sleep(300);

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

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
