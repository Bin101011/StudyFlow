// 오늘 탭 크기 끌기 시험: 칸 사이 손잡이로 시간표 칸·오른쪽 칸 너비, 메모 위 선으로 메모 칸 높이를 바꾼다.
// 헤드리스 Edge를 CDP로 조종, 실제 마우스 입력, 가짜 Google 서버 5057번.
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9431;
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
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }

// 화면의 지금 크기: 시간표 칸·오른쪽 칸 너비, 메모 입력 칸 높이, 할 일 목록 상자 높이, 손잡이 가운데 위치, 설정값
const state = async () => JSON.parse(await js(`(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const mid = (s) => { const b = r(s); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
  const memoTop = r("#day-memo-resize-handle");
  return JSON.stringify({
    timeline: r("#timeline-column").width, right: r("#inbox-column").width, memo: r("#day-memo").height, list: r("#tasks-column .column-scroll").height,
    tasksBottom: r("#tasks-column").bottom, memoBottom: r("#day-memo").bottom,
    tlHandle: mid("#timeline-resize-handle"), rightHandle: mid("#inbox-resize-handle"), memoHandle: { x: memoTop.left + memoTop.width / 2, y: memoTop.top + memoTop.height / 2 },
    gapMid: (r("#timeline-column").right + r("#tasks-column").left) / 2, gapMid2: (r("#tasks-column").right + r("#inbox-column").left) / 2,
    set: [settings.timelineWidth, settings.todayRightWidth, settings.dayMemoHeight],
    bodyClass: document.body.className, selection: String(window.getSelection()),
    tlHandleShown: getComputedStyle(document.getElementById("timeline-resize-handle")).display !== "none",
  });
})()`));
const saved = async () => { const v = (await api("/api/settings")).data.values; return [v.timelineWidth, v.todayRightWidth, v.dayMemoHeight]; };
const near = (a, b) => Math.abs(a - b) < 1.01;
const sliderText = (k) => js(`document.querySelector('input[data-key="${k}"]').nextElementSibling.textContent`);

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`settingsLoaded && !document.getElementById("day-memo").disabled`)), 15000);
await sleep(500);

// ===== A. 처음 모양 =====
console.log("--- A. 처음 모양 ---");
let s = await state();
check("기본: 시간표 400px, 오른쪽 칸 300px, 메모 칸 110px", near(s.timeline, 400) && near(s.right, 300) && near(s.memo, 110) && JSON.stringify(s.set) === "[400,300,110]", s);
check("칸 경계 손잡이는 칸 사이 빈 곳의 가운데에 있다", near(s.tlHandle.x, s.gapMid) && near(s.rightHandle.x, s.gapMid2), s);
check("메모 손잡이는 메모 위쪽 선에 걸쳐 있다", Math.abs(s.memoHandle.y - (await js(`document.querySelector(".day-memo").getBoundingClientRect().top`))) < 2, s);
check("손잡이 커서: 칸 경계는 ↔(col-resize), 메모는 ↕(row-resize)",
  (await js(`getComputedStyle(document.getElementById("timeline-resize-handle")).cursor`)) === "col-resize" && (await js(`getComputedStyle(document.getElementById("day-memo-resize-handle")).cursor`)) === "row-resize");
check("메모 칸 오른쪽 아래의 브라우저 기본 손잡이는 없앴다", (await js(`getComputedStyle(document.getElementById("day-memo")).resize`)) === "none");
check("메모 칸이 할 일 칸의 바닥에 붙어 있다", Math.abs(s.memoBottom - s.tasksBottom) < 2, s);

// ===== B. 시간표 칸 너비 끌기 =====
console.log("--- B. 시간표 칸 너비 ---");
let p = s.tlHandle;
await mouse("mouseMoved", p.x, p.y, 0); await mouse("mousePressed", p.x, p.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", p.x + 10 * i, p.y, 1);
s = await state();
check("끄는 동안 바로 넓어진다(+60 → 460px), 아직 저장은 안 했다", near(s.timeline, 460) && s.set[0] === 460 && (await saved())[0] === 400, [s.timeline, s.set, await saved()]);
check("끄는 동안 커서 모양을 유지하고(body에 resizing-x) 글자가 선택되지 않는다", /resizing-x/.test(s.bodyClass) && s.selection === "", s);
check("손잡이가 칸 경계를 따라 움직였다", near(s.tlHandle.x, s.gapMid) && near(s.tlHandle.x, p.x + 60), [s.tlHandle.x, p.x]);
await mouse("mouseReleased", p.x + 60, p.y);
check("놓으면 460으로 저장되고 body의 resizing 표시가 지워진다", (await waitFor(async () => (await saved())[0] === 460)) && !/resizing/.test((await state()).bodyClass), await saved());
check("설정 탭의 슬라이더 글자도 460px", (await sliderText("timelineWidth")) === "460px", await sliderText("timelineWidth"));

s = await state();
await drag(s.tlHandle.x, s.tlHandle.y, s.tlHandle.x + 300, s.tlHandle.y);
check("오른쪽 끝까지 끌어도 500px에서 멈춘다", near((await state()).timeline, 500) && (await waitFor(async () => (await saved())[0] === 500)), [(await state()).timeline, await saved()]);
s = await state();
await drag(s.tlHandle.x, s.tlHandle.y, s.tlHandle.x - 400, s.tlHandle.y);
check("왼쪽으로 많이 끌어도 300px에서 멈춘다", near((await state()).timeline, 300) && (await waitFor(async () => (await saved())[0] === 300)), [(await state()).timeline, await saved()]);
s = await state();
await drag(s.tlHandle.x, s.tlHandle.y, s.tlHandle.x + 160, s.tlHandle.y);
check("다시 오른쪽으로 160 끌면 460px", near((await state()).timeline, 460) && (await waitFor(async () => (await saved())[0] === 460)), [(await state()).timeline, await saved()]);

// ===== C. 오른쪽 칸 너비 끌기 (합계 900 한계) =====
console.log("--- C. 오른쪽 칸 너비 ---");
s = await state();
await drag(s.rightHandle.x, s.rightHandle.y, s.rightHandle.x - 50, s.rightHandle.y);
check("왼쪽으로 50 끌면 오른쪽 칸이 350px", near((await state()).right, 350) && (await waitFor(async () => (await saved())[1] === 350)), [(await state()).right, await saved()]);
s = await state();
await drag(s.rightHandle.x, s.rightHandle.y, s.rightHandle.x - 200, s.rightHandle.y);
check("시간표가 460이면 오른쪽 칸은 440px에서 멈춘다(합 900)", near((await state()).right, 440) && (await waitFor(async () => JSON.stringify((await saved()).slice(0, 2)) === "[460,440]")), [(await state()).right, await saved()]);
check("설정 탭의 오른쪽 칸 슬라이더 글자도 440px", (await sliderText("todayRightWidth")) === "440px", await sliderText("todayRightWidth"));
s = await state();
await drag(s.tlHandle.x, s.tlHandle.y, s.tlHandle.x + 100, s.tlHandle.y);
check("오른쪽 칸이 440이면 시간표는 넓히려 해도 460px에서 멈춘다", near((await state()).timeline, 460) && (await saved())[0] === 460, [(await state()).timeline, await saved()]);
s = await state();
await drag(s.rightHandle.x, s.rightHandle.y, s.rightHandle.x + 300, s.rightHandle.y);
check("오른쪽으로 많이 끌면 오른쪽 칸이 300px에서 멈춘다", near((await state()).right, 300) && (await waitFor(async () => (await saved())[1] === 300)), [(await state()).right, await saved()]);
check("가로 스크롤이 생기지 않는다", (await js(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);

// ===== D. 메모 칸 높이 끌기 =====
console.log("--- D. 메모 칸 높이 ---");
s = await state();
p = s.memoHandle;
await mouse("mouseMoved", p.x, p.y, 0); await mouse("mousePressed", p.x, p.y);
for (let i = 1; i <= 5; i++) await mouse("mouseMoved", p.x, p.y - 20 * i, 1);
let s2 = await state();
check("위로 100 끌면 끄는 동안 메모 칸이 210px로 높아지고 할 일 목록이 그만큼 줄어든다", near(s2.memo, 210) && near(s.list - s2.list, 100) && s2.set[2] === 210, [s.memo, s2.memo, s.list, s2.list]);
check("메모 칸은 여전히 바닥에 붙어 있고, 위쪽 선(손잡이)이 마우스를 따라 올라갔다", Math.abs(s2.memoBottom - s2.tasksBottom) < 2 && Math.abs(s2.memoHandle.y - (p.y - 100)) < 2, s2);
check("끄는 동안 body에 resizing-y", /resizing-y/.test(s2.bodyClass));
await mouse("mouseReleased", p.x, p.y - 100);
check("놓으면 210으로 저장된다", await waitFor(async () => (await saved())[2] === 210), await saved());
check("설정 탭의 메모 칸 높이 슬라이더 글자도 210px", (await sliderText("dayMemoHeight")) === "210px", await sliderText("dayMemoHeight"));

s = await state();
await drag(s.memoHandle.x, s.memoHandle.y, s.memoHandle.x, s.memoHandle.y - 2000, 10);
s2 = await state();
const tall = (await saved())[2];
check("위로 아주 많이 끌어도 할 일 목록은 80px 남는다", near(s2.list, 80), s2);
check("저장된 값은 실제로 보이는 메모 칸 높이와 같다(보이지 않는 여분을 저장하지 않는다)", near(tall, s2.memo) && s2.set[2] === tall && tall < 600, [tall, s2.memo]);
s = await state();
await drag(s.memoHandle.x, s.memoHandle.y, s.memoHandle.x, s.memoHandle.y + 50);
s2 = await state();
check("그 뒤 아래로 50 끌면 바로 50px 낮아진다", near(s.memo - s2.memo, 50) && (await waitFor(async () => (await saved())[2] === tall - 50)), [s.memo, s2.memo, await saved()]);
await drag(s2.memoHandle.x, s2.memoHandle.y, s2.memoHandle.x, s2.memoHandle.y + 2000, 10);
check("아래로 많이 끌면 60px에서 멈춘다", near((await state()).memo, 60) && (await waitFor(async () => (await saved())[2] === 60)), [(await state()).memo, await saved()]);
s = await state();
await drag(s.memoHandle.x, s.memoHandle.y, s.memoHandle.x, s.memoHandle.y - 120);
check("다시 위로 120 끌면 180px", near((await state()).memo, 180) && (await waitFor(async () => (await saved())[2] === 180)), [(await state()).memo, await saved()]);

// 메모를 쓰는 데 지장이 없는지: 손잡이를 끈 뒤에도 입력 칸을 눌러 글을 쓸 수 있다
const memoBox = JSON.parse(await js(`JSON.stringify(document.getElementById("day-memo").getBoundingClientRect())`));
await click(memoBox.x + 40, memoBox.y + 30);
await send("Input.insertText", { text: "크기 시험" });
check("메모 칸을 눌러 글을 쓸 수 있다", (await js(`document.getElementById("day-memo").value`)).endsWith("크기 시험"));

// ===== E. 창이 낮아지면 메모가 줄어든다 =====
console.log("--- E. 창 높이 ---");
await js(`document.activeElement.blur()`);
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 560, deviceScaleFactor: 1, mobile: false });
await sleep(400);
s = await state();
check("창이 낮아 다 들어가지 않으면 메모 칸이 줄고 할 일 목록은 80px 남는다", s.memo < 180 && near(s.list, 80) && Math.abs(s.memoBottom - s.tasksBottom) < 2, s);
check("이때 저장된 값은 그대로(180) — 창을 키우면 돌아온다", (await saved())[2] === 180, await saved());
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
check("창을 다시 키우면 메모 칸이 180px로 돌아온다", near((await state()).memo, 180), await state());

// ===== F. 다시 켜도 그대로 =====
console.log("--- F. 다시 열기 ---");
await send("Page.reload"); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`settingsLoaded`)), 15000); await sleep(400);
s = await state();
check("새로 열어도 시간표 460px, 오른쪽 칸 300px, 메모 칸 180px", near(s.timeline, 460) && near(s.right, 300) && near(s.memo, 180), s);

// ===== G. 좁은 창 =====
console.log("--- G. 좁은 창 ---");
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(400);
s = await state();
check("창이 좁아 칸 배치가 바뀌면 칸 경계 손잡이를 숨긴다", !s.tlHandleShown && (await js(`getComputedStyle(document.getElementById("inbox-resize-handle")).display`)) === "none", s);
check("좁은 창에서도 메모 칸 높이(180px)는 그대로", near(s.memo, 180), s);
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300);

// ===== H. 설정 탭의 [기본값으로] =====
console.log("--- H. 기본값으로 ---");
await js(`document.querySelector('.tab-button[data-tab="settings"]').click()`); await sleep(300);
await js(`document.getElementById("today-settings-reset").click()`);
check("[기본값으로]를 누르면 400/300/110으로 저장된다", await waitFor(async () => JSON.stringify(await saved()) === "[400,300,110]"), await saved());
await js(`document.querySelector('.tab-button[data-tab="today"]').click()`); await sleep(300);
s = await state();
check("오늘 탭도 400/300/110으로 돌아온다", near(s.timeline, 400) && near(s.right, 300) && near(s.memo, 110), s);
await shot("resize_done.png");

check("JS 오류 없음", jsErrors.length === 0, jsErrors);
console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}개`);
ws.close(); edge.kill();
process.exit(failed === 0 ? 0 : 1);
