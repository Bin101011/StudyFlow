// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9392;
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


console.log("--- 프로젝트 메모 ---");
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card").length`)) > 0, 10000);
await sleep(500);
const NAME = "기말 프로젝트";
const card = (extra) => `[...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name").textContent === ${JSON.stringify(NAME)})` + (extra || "");
const memoApi = async () => (await api("/api/projects")).data.find((p) => p.name === NAME).memo;
const info = async () => JSON.parse(await js(`(() => { const c = ${card()}; const v = c.querySelector(".project-memo"); const a = c.querySelector(".project-memo-add"); const t = c.querySelector(".project-memo-input"); return JSON.stringify({ text: v ? v.textContent : null, unsaved: v ? v.classList.contains("unsaved") : false, add: a ? getComputedStyle(a).display : null, input: t ? t.value : null, focused: !!t && document.activeElement === t }); })()`));

let st = await info();
check("메모가 없는 카드: 메모 글자는 없고 [+ 메모] 버튼은 평소에 숨어 있다", st.text === null && st.add === "none", st);
check("카드의 메모 상자가 빈 여백을 만들지 않는다(버튼이 숨어 있는 동안 높이 0)", await js(`(() => { const b = ${card()}.querySelector(".project-memo-box"); return b.getBoundingClientRect().height < 30; })()`));

// 1. 카드에서 쓰기: Enter로 저장
await js(`${card()}.querySelector(".project-memo-add").click()`); await sleep(250);
st = await info();
check("[+ 메모]를 누르면 입력 칸이 열리고 커서가 있다", st.input === "" && st.focused, st);
check("입력 칸 예시 글자", (await js(`${card()}.querySelector(".project-memo-input").placeholder`)) === "예: 제출 형식, 연락처, 참고 링크");
await type("제출 형식: PDF");
check("입력 직후엔 아직 저장 전", (await memoApi()) === "");
await key("Enter"); await sleep(800);
st = await info();
check("Enter를 누르면 저장되고 글자로 보인다", st.text === "제출 형식: PDF" && st.input === null && (await memoApi()) === "제출 형식: PDF", [st, await memoApi()]);
check("메모가 있으면 [+ 메모] 버튼은 없다", st.add === null);
await shot("pm_card.png");

// 2. 눌러서 고치기 + Shift+Enter 줄바꿈 + 자동 저장
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
st = await info();
check("메모 글자를 누르면 입력 칸에 기존 내용이 채워진다", st.input === "제출 형식: PDF", st);
await key("Enter", { modifiers: 8 }); await type("연락처: 교수님");
check("Shift+Enter는 줄바꿈이고 입력 칸이 열려 있다", (await info()).input === "제출 형식: PDF\n연락처: 교수님");
await sleep(2200);
check("입력을 멈추고 1.5초 뒤 자동 저장되고 입력 칸은 열린 채", (await memoApi()) === "제출 형식: PDF\n연락처: 교수님" && (await info()).input !== null, [await memoApi(), await info()]);
// 한글 조합 중 Enter
await js(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }))`); await sleep(300);
check("한글 조합 중 Enter는 입력을 끝내지 않는다", (await info()).input !== null);
await key("Escape"); await sleep(600);
st = await info();
check("Esc로 끝내면 글자 표시로 돌아간다(줄바꿈 유지)", st.input === null && st.text === "제출 형식: PDF\n연락처: 교수님", st);

// 3. 다른 곳을 누르면 저장 (blur)
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await type(" (수정)");
await js(`document.activeElement.blur()`); await sleep(800);
check("입력 칸을 벗어나면 즉시 저장된다", (await memoApi()).endsWith("(수정)"), await memoApi());

// 4. HTML 글자는 글자로만
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = "<b>굵게</b> <img src=x onerror=window.__xss=1>"; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await sleep(800);
check("메모에 HTML이 있어도 태그로 해석되지 않고 글자 그대로 보인다", await js(`(() => { const v = ${card()}.querySelector(".project-memo"); return v.textContent.includes("<b>굵게</b>") && !v.querySelector("b") && !v.querySelector("img") && window.__xss === undefined; })()`));

// 5. 지우기
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await sleep(800);
st = await info();
check("모두 지우면 메모가 삭제되고 [+ 메모]가 돌아온다", st.text === null && st.add === "none" && (await memoApi()) === "", [st, await memoApi()]);

// 6. 저장 실패: 빨갛게 표시하고, 다시 눌러 저장하면 회복
await js(`window.__f = window.fetch; window.fetch = (u, o) => (o && o.method === "PATCH") ? Promise.resolve(new Response(JSON.stringify({ error: "가짜 오류" }), { status: 500, headers: { "Content-Type": "application/json" } })) : window.__f(u, o);`);
await js(`${card()}.querySelector(".project-memo-add").click()`); await sleep(250);
await type("실패할 메모"); await key("Enter"); await sleep(900);
st = await info();
const toast = await js(`document.getElementById("toast").textContent`);
check("저장 실패: 글자는 남고 빨간 표시 + 알림", st.text === "실패할 메모" && st.unsaved && /메모를 저장하지 못했습니다/.test(toast), [st, toast]);
check("서버에는 저장되지 않았다", (await memoApi()) === "");
await js(`window.fetch = window.__f`);
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await key("Enter"); await sleep(900);
st = await info();
check("다시 눌렀다 닫으면 재저장되고 빨간 표시가 사라진다", !st.unsaved && (await memoApi()) === "실패할 메모", [st, await memoApi()]);

// 7. 수정 창
await js(`[...${card()}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`); await sleep(400);
check("수정 창의 메모 칸에 기존 메모가 들어 있다", (await js(`document.getElementById("project-dialog").open && document.getElementById("project-memo").value`)) === "실패할 메모");
await shot("pm_dialog.png");
await js(`document.getElementById("project-memo").value = "수정 창에서 쓴 메모\\n둘째 줄"; document.getElementById("project-save").click()`); await sleep(1500);
check("수정 창에서 저장하면 카드와 서버에 반영된다", (await memoApi()) === "수정 창에서 쓴 메모\n둘째 줄" && (await info()).text === "수정 창에서 쓴 메모\n둘째 줄", [await memoApi(), await info()]);
// 수정 창에서 메모를 안 건드리고 다른 것만 바꿔도 메모가 유지된다
await js(`[...${card()}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`); await sleep(300);
await js(`document.getElementById("project-deadline").value = "2026-12-31"; document.getElementById("project-save").click()`); await sleep(1500);
check("수정 창에서 메모를 그대로 두고 다른 값을 저장해도 메모가 유지된다", (await memoApi()) === "수정 창에서 쓴 메모\n둘째 줄");
// 새 프로젝트
await js(`document.getElementById("project-add-button").click()`); await sleep(300);
check("새 프로젝트 창의 메모 칸은 비어 있다", (await js(`document.getElementById("project-memo").value`)) === "");
await js(`document.getElementById("project-name").value = "새 프로젝트 X"; document.getElementById("project-memo").value = "처음부터 쓴 메모"; document.getElementById("project-save").click()`); await sleep(1500);
check("새 프로젝트를 메모와 함께 만든다", (await api("/api/projects")).data.some((p) => p.name === "새 프로젝트 X" && p.memo === "처음부터 쓴 메모") && (await js(`[...document.querySelectorAll(".project-card")].some(c => c.querySelector(".project-name").textContent === "새 프로젝트 X" && c.querySelector(".project-memo") && c.querySelector(".project-memo").textContent === "처음부터 쓴 메모")`)));

// 8. 새로고침해도 유지 + 쓰는 중에도 다른 기능(단계 추가 등)이 영향을 받지 않는다
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card").length`)) > 0, 10000);
await sleep(500);
check("껐다 켜도 메모가 유지된다", (await info()).text === "수정 창에서 쓴 메모\n둘째 줄", await info());
check("카드 안의 메모가 카드 폭을 넘지 않는다", await js(`(() => { const c = ${card()}.getBoundingClientRect(); const m = ${card()}.querySelector(".project-memo").getBoundingClientRect(); return m.left >= c.left && m.right <= c.right + 1; })()`));

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
