// 할 일의 걸리는 시간 테스트 (2026-11-23. 헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
// "몇 시부터"는 정하지 않고 "15분 걸릴 것"만 정하는 기능: 줄의 "길이" 버튼과 "15분" 글자, 작은 창, 제목 옆 합계, Ctrl+Z,
// 시간표로 끌어다 놓기·"+ 시간"이 그 길이로 계획을 만드는지 본다. 시드는 memo_server.py
// (오늘: 발표 자료 만들기(프로젝트), LC 파트 풀기, 장보기 / 할 일 목록: 여권 사진 찍기 / 밀린 할 일: 지난 일 마무리)
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
const key = (k, extra = {}) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: k === "Enter" ? 13 : k === "Escape" ? 27 : 0, text: k === "Enter" ? "\r" : undefined, ...extra });
const type = (text) => send("Input.insertText", { text });
// 되돌리기는 앞 되돌리기가 화면을 다시 그리는 동안 들어온 Ctrl+Z를 무시한다(undoRunning). 그래서 누르기 전에 그게 끝나기를 기다린다
const ctrlZ = async () => {
  await waitFor(async () => !(await js(`undoRunning`)), 5000);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
};
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(800);
const today = await js(`viewedDate`);

// ----- 도우미 -----
// list: "#today-tasks", "#overdue-tasks", "#inbox-tasks" 중 하나 (할 일 목록 칸의 id는 app.js의 inboxList에서 읽는다)
const INBOX = "#" + (await js(`inboxList.id`));
const rowSel = (title, list = "#today-tasks") => `[...document.querySelectorAll(${JSON.stringify(list + " .task-row")})].find(l => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === ${JSON.stringify(title)})`;
const taskOf = async (title) => (await api("/api/tasks?date=" + today)).data.tasks.find((t) => t.content === title);
const durOf = async (title) => { const t = await taskOf(title); return t ? t.duration_min : undefined; };
const chipText = (title, list) => js(`(() => { const c = ${rowSel(title, list)}.querySelector(".task-duration:not(.task-duration-empty)"); return c ? c.textContent : null; })()`);
const totalText = () => js(`document.getElementById("tasks-total").textContent`);
const popOpen = () => js(`!!document.querySelector(".tl-popover")`);
const center = (sel) => js(`(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
const hoverRow = async (title, list) => {
  const r = await js(`(() => { const li = ${rowSel(title, list)}; li.scrollIntoView({ block: "center" }); const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2 }; })()`);
  await mouse("mouseMoved", r.x, r.y, 0); await sleep(250); return r;
};
// "+ 길이"(아직 안 정한 줄) 또는 "15분" 글자(정한 줄)를 눌러 작은 창을 연다
const openPopover = async (title, list) => {
  await hoverRow(title, list);
  const b = await center(`${rowSel(title, list)}.querySelector(".task-duration")`);
  await click(b.x, b.y); await sleep(300); return b;
};
const presetButton = (label) => center(`[...document.querySelectorAll(".tl-popover .duration-chip")].find(b => b.textContent === ${JSON.stringify(label)})`);
const popButton = (label) => center(`[...document.querySelectorAll(".tl-popover .tl-pop-buttons button")].find(b => b.textContent === ${JSON.stringify(label)})`);
const reloadList = async () => { await js(`loadToday()`); await sleep(1500); };

console.log("--- 처음 모습 ---");
check("처음에는 어느 줄에도 길이 글자가 없다", (await js(`document.querySelectorAll(".task-duration:not(.task-duration-empty)").length`)) === 0);
check("처음에는 제목 옆 합계가 비어 있다", (await totalText()) === "", await totalText());
check("제목 글자는 그대로 '오늘 할 일'", (await js(`document.getElementById("tasks-heading").textContent`)) === "오늘 할 일");
// "+ 길이": 안 정한 줄에서 마우스를 올렸을 때만 보이고, 안 보일 때도 자리는 차지한다
const addInfo = (title, list) => js(`(() => { const b = ${rowSel(title, list)}.querySelector(".task-duration-empty"); if (!b) return null; const r = b.getBoundingClientRect(); return { vis: getComputedStyle(b).visibility, text: b.textContent, w: r.width, x: r.left, y: r.top }; })()`);
await mouse("mouseMoved", 5, 5, 0); await sleep(200);
let add0 = await addInfo("LC 파트 풀기");
check("마우스를 올리기 전에는 '+ 길이'가 숨어 있지만 자리는 차지한다", add0 && add0.vis === "hidden" && add0.w > 10, add0);
await hoverRow("LC 파트 풀기");
let add1 = await addInfo("LC 파트 풀기");
check("마우스를 올리면 '+ 길이'가 보인다", add1 && add1.vis === "visible" && add1.text === "+ 길이", add1);
// 마우스를 올리면 줄 버튼이 나타나서 오른쪽 것들(프로젝트 이름표, "+ 길이")은 원래 설계대로 왼쪽으로 조금 밀린다. 줄이 두 줄로 접히지만 않으면 된다
check("마우스를 올려도 '+ 길이'가 다음 줄로 내려가지 않는다(이름이 접히지 않음)", add1 && Math.abs(add1.y - add0.y) < 3, [add0, add1]);
check("길이 버튼은 마우스를 올리면 뜨는 버튼 묶음에 없다", !(await js(`!!${rowSel("LC 파트 풀기")}.querySelector(".task-actions .task-duration")`)));
check("밀린 할 일 줄에도 '+ 길이'가 있다", !!(await addInfo("지난 일 마무리", "#overdue-tasks")));
check("할 일 목록(수집함) 줄에도 '+ 길이'가 있다", !!(await addInfo("여권 사진 찍기", INBOX)));

console.log("--- 길이 버튼으로 정하기 ---");
await openPopover("LC 파트 풀기");
check("'+ 길이'를 누르면 작은 창이 열린다", await popOpen());
let pop = JSON.parse(await js(`JSON.stringify({ title: document.querySelector(".tl-popover h3").textContent, presets: [...document.querySelectorAll(".tl-popover .duration-chip")].map(b => b.textContent), active: document.querySelectorAll(".tl-popover .duration-chip.active").length, focused: document.activeElement && document.activeElement.classList.contains("task-duration-input"), clear: [...document.querySelectorAll(".tl-popover button")].some(b => b.textContent === "길이 지우기") })`));
check("창 제목은 할 일 이름", pop.title === "LC 파트 풀기", pop);
check("길이 버튼은 15분, 30분, 45분, 1시간, 1시간 30분, 2시간", JSON.stringify(pop.presets) === JSON.stringify(["15분", "30분", "45분", "1시간", "1시간 30분", "2시간"]), pop.presets);
check("안 정한 할 일이라 강조된 버튼이 없고 '길이 지우기'도 없다", pop.active === 0 && !pop.clear, pop);
check("창이 열리면 직접 쓰는 칸에 포커스가 있다", pop.focused, pop);
await shot("d_popover.png");
let b = await presetButton("15분"); await click(b.x, b.y);
check("15분을 누르면 창이 닫히고 저장된다", await waitFor(async () => (await durOf("LC 파트 풀기")) === 15) && !(await popOpen()), await durOf("LC 파트 풀기"));
check("줄에 '15분' 글자가 보인다", await waitFor(async () => (await chipText("LC 파트 풀기")) === "15분"), await chipText("LC 파트 풀기"));
check("길이를 정한 줄에는 '+ 길이'가 없다", !(await js(`!!${rowSel("LC 파트 풀기")}.querySelector(".task-duration-empty")`)));
check("제목 옆 합계가 '· 총 15분 남음'", (await totalText()) === "· 총 15분 남음", await totalText());
let tip = await js(`document.getElementById("tasks-total").title`);
check("합계 설명에 길이를 안 정한 할 일 2개가 빠졌다고 나온다", /안 정한 2개/.test(tip), tip);
await mouse("mouseMoved", 5, 5, 0); await sleep(200);
let chipVis = await js(`getComputedStyle(${rowSel("LC 파트 풀기")}.querySelector(".task-duration")).visibility`);
check("길이 글자는 마우스를 올리지 않아도 보인다", chipVis === "visible", chipVis);
await shot("d_chip.png");

console.log("--- 글자를 눌러 바꾸기, 직접 쓰기 ---");
await openPopover("LC 파트 풀기");
pop = JSON.parse(await js(`JSON.stringify({ active: [...document.querySelectorAll(".tl-popover .duration-chip.active")].map(b => b.textContent), value: document.querySelector(".tl-popover .task-duration-input").value, clear: [...document.querySelectorAll(".tl-popover button")].some(b => b.textContent === "길이 지우기") })`));
check("'15분' 글자를 누르면 창이 열리고 15분 버튼이 강조되어 있다", JSON.stringify(pop.active) === '["15분"]', pop);
check("버튼에 있는 길이라 직접 쓰는 칸은 비어 있고, '길이 지우기'가 있다", pop.value === "" && pop.clear, pop);
await type("1시간 20분"); await key("Enter");
check("'1시간 20분'을 쓰고 Enter를 누르면 80분으로 저장된다", await waitFor(async () => (await durOf("LC 파트 풀기")) === 80), await durOf("LC 파트 풀기"));
check("줄 글자가 '1시간 20분'", await waitFor(async () => (await chipText("LC 파트 풀기")) === "1시간 20분"), await chipText("LC 파트 풀기"));
await openPopover("LC 파트 풀기");
pop = JSON.parse(await js(`JSON.stringify({ active: document.querySelectorAll(".tl-popover .duration-chip.active").length, value: document.querySelector(".tl-popover .task-duration-input").value })`));
check("버튼에 없는 길이(80분)면 직접 쓰는 칸에 '1시간 20분'이 미리 들어 있다", pop.active === 0 && pop.value === "1시간 20분", pop);
b = await openPopover("LC 파트 풀기");
check("창이 열린 채 길이 글자를 다시 누르면 창이 닫힌다", !(await popOpen()));

// 틀린 값
await openPopover("장보기");
await type("3"); await key("Enter"); await sleep(300);
let st = JSON.parse(await js(`JSON.stringify({ open: !!document.querySelector(".tl-popover"), invalid: !!document.querySelector(".tl-popover .task-duration-input.invalid") })`));
check("3분(5분보다 짧음)은 저장하지 않고 창이 열린 채 칸이 빨개진다", st.open && st.invalid && (await durOf("장보기")) === null, [st, await durOf("장보기")]);
await js(`document.querySelector(".tl-popover .task-duration-input").select()`);
await type("abc"); await key("Enter"); await sleep(300);
check("읽을 수 없는 글자(abc)도 저장하지 않는다", (await popOpen()) && (await durOf("장보기")) === null);
await js(`document.querySelector(".tl-popover .task-duration-input").select()`);
await type("13시간"); await key("Enter"); await sleep(300);
check("12시간보다 길면 저장하지 않는다", (await popOpen()) && (await durOf("장보기")) === null);
await js(`document.querySelector(".tl-popover .task-duration-input").select()`);
await type("40");
check("다시 쓰기 시작하면 빨간 표시가 사라진다", !(await js(`!!document.querySelector(".tl-popover .task-duration-input.invalid")`)));
b = await popButton("정하기"); await click(b.x, b.y);
check("'40'을 쓰고 [정하기]를 누르면 40분으로 저장된다", await waitFor(async () => (await durOf("장보기")) === 40), await durOf("장보기"));
check("합계가 80 + 40 = '· 총 2시간 남음'", await waitFor(async () => (await totalText()) === "· 총 2시간 남음"), await totalText());
tip = await js(`document.getElementById("tasks-total").title`);
check("합계 설명: 안 정한 할 일 1개", /안 정한 1개/.test(tip), tip);

// Esc와 [닫기]는 아무것도 바꾸지 않는다
await openPopover("장보기");
await type("90"); await key("Escape"); await sleep(300);
check("쓰다가 Esc를 누르면 창이 닫히고 바뀌지 않는다", !(await popOpen()) && (await durOf("장보기")) === 40);
await openPopover("장보기");
await type("90"); b = await popButton("닫기"); await click(b.x, b.y); await sleep(300);
check("[닫기]도 바꾸지 않는다", !(await popOpen()) && (await durOf("장보기")) === 40);
await openPopover("장보기");
await click(700, 40); await sleep(300);
check("창 밖을 누르면 닫히고 바뀌지 않는다", !(await popOpen()) && (await durOf("장보기")) === 40);

console.log("--- 지우기와 Ctrl+Z ---");
await openPopover("장보기");
b = await popButton("길이 지우기"); await click(b.x, b.y);
check("[길이 지우기]를 누르면 안 정함으로 돌아간다", await waitFor(async () => (await durOf("장보기")) === null), await durOf("장보기"));
check("줄의 길이 글자가 사라진다", await waitFor(async () => (await chipText("장보기")) === null));
check("합계가 '· 총 1시간 20분 남음'", (await totalText()) === "· 총 1시간 20분 남음", await totalText());
await mouse("mouseMoved", 5, 5, 0); await js(`document.activeElement && document.activeElement.blur()`);
await ctrlZ();
check("Ctrl+Z로 지우기 전 길이(40분)로 돌아간다", await waitFor(async () => (await durOf("장보기")) === 40), await durOf("장보기"));
check("줄 글자도 '40분'으로 돌아온다", await waitFor(async () => (await chipText("장보기")) === "40분"), await chipText("장보기"));
await ctrlZ();
check("한 번 더 Ctrl+Z: 장보기를 처음 정하기 전(안 정함)으로", await waitFor(async () => (await durOf("장보기")) === null), await durOf("장보기"));
await ctrlZ();
check("한 번 더 Ctrl+Z: LC는 80분 → 15분으로", await waitFor(async () => (await durOf("LC 파트 풀기")) === 15), await durOf("LC 파트 풀기"));
// 다시 앞으로: 장보기 40분 (다음 구간에서 쓴다)
await openPopover("장보기"); await type("40"); await key("Enter");
await waitFor(async () => (await durOf("장보기")) === 40);
await openPopover("LC 파트 풀기"); b = await presetButton("15분"); await click(b.x, b.y); await sleep(500);
check("같은 길이(15분)를 다시 고르면 창만 닫히고 그대로", !(await popOpen()) && (await durOf("LC 파트 풀기")) === 15);

console.log("--- 다른 목록 ---");
await openPopover("여권 사진 찍기", INBOX);
b = await presetButton("30분"); await click(b.x, b.y);
check("할 일 목록(수집함) 줄에서도 정할 수 있다", await waitFor(async () => (await api("/api/inbox")).data.some((t) => t.content === "여권 사진 찍기" && t.duration_min === 30)));
check("수집함 줄에 '30분' 글자", await waitFor(async () => (await chipText("여권 사진 찍기", INBOX)) === "30분"));
await openPopover("지난 일 마무리", "#overdue-tasks");
b = await presetButton("45분"); await click(b.x, b.y);
check("밀린 할 일 줄에서도 정할 수 있다", await waitFor(async () => (await api("/api/tasks?date=" + today)).data.overdue.some((t) => t.content === "지난 일 마무리" && t.duration_min === 45)));
check("밀린 할 일·수집함의 길이는 오늘 합계에 더하지 않는다(15 + 40)", (await totalText()) === "· 총 55분 남음", await totalText());

console.log("--- 끝낸 할 일 ---");
await js(`${rowSel("LC 파트 풀기")}.querySelector('input[type="checkbox"]').click()`);
check("끝낸 할 일은 합계에서 빠진다(40분만)", await waitFor(async () => (await totalText()) === "· 총 40분 남음"), await totalText());
check("끝낸 줄에도 길이 글자는 남아 있다", (await chipText("LC 파트 풀기")) === "15분");
await js(`${rowSel("LC 파트 풀기")}.querySelector('input[type="checkbox"]').click()`);
await waitFor(async () => (await totalText()) === "· 총 55분 남음");

console.log("--- 시간표와 연결 ---");
// 장보기(40분)를 시간표 10:00에 끌어다 놓는다
const tgt = JSON.parse(await js(`(() => { timelineScroll.scrollTop = minToY(600) - 100; const r = timelineGrid.getBoundingClientRect(); return JSON.stringify({ x: r.left + 150, y: r.top + minToY(600) + 5 }); })()`));
await sleep(300);
const src = await hoverRow("장보기");
await mouse("mousePressed", src.x, src.y);
for (let i = 1; i <= 10; i++) await mouse("mouseMoved", src.x + (tgt.x - src.x) * i / 10, src.y + (tgt.y - src.y) * i / 10, 1);
await sleep(200);
const prev = JSON.parse(await js(`(() => { const p = document.querySelector(".tl-drop-preview"); return JSON.stringify(p ? { h: p.getBoundingClientRect().height, want: minToY(40) } : null); })()`));
check("끄는 동안 점선 상자가 40분 높이다", prev && Math.abs(prev.h - prev.want) <= 2, prev);
await mouse("mouseReleased", tgt.x, tgt.y);
let blocks = [];
await waitFor(async () => { blocks = (await api("/api/time-blocks?date=" + today)).data; return blocks.length > 0; });
const shopTask = await taskOf("장보기");
const shopPlan = blocks.find((p) => p.taskId === shopTask.id);
check("놓으면 40분짜리 계획이 생긴다", shopPlan && shopPlan.end - shopPlan.start === 40, blocks);
// 길이를 안 정한 할 일(발표 자료)은 예전처럼 1시간
const tgt2 = JSON.parse(await js(`(() => { timelineScroll.scrollTop = minToY(780) - 100; const r = timelineGrid.getBoundingClientRect(); return JSON.stringify({ x: r.left + 150, y: r.top + minToY(780) + 5 }); })()`));
await sleep(300);
const src2 = await hoverRow("발표 자료 만들기");
await mouse("mousePressed", src2.x, src2.y);
for (let i = 1; i <= 10; i++) await mouse("mouseMoved", src2.x + (tgt2.x - src2.x) * i / 10, src2.y + (tgt2.y - src2.y) * i / 10, 1);
await mouse("mouseReleased", tgt2.x, tgt2.y);
const presTask = await taskOf("발표 자료 만들기");
await waitFor(async () => (await api("/api/time-blocks?date=" + today)).data.some((p) => p.taskId === presTask.id));
const presPlan = (await api("/api/time-blocks?date=" + today)).data.find((p) => p.taskId === presTask.id);
check("길이를 안 정한 할 일은 예전처럼 1시간짜리 계획", presPlan && presPlan.end - presPlan.start === 60, presPlan);
// 시간표에 들어간 할 일은 길이가 계획으로 정해져 있으므로 "+ 길이"를 두지 않는다(붐비는 줄이 접히지 않게). 이미 정한 "40분"은 남는다
await waitFor(async () => await js(`${rowSel("발표 자료 만들기")}.classList.contains("has-plan")`));
await hoverRow("발표 자료 만들기");
const presAdd = await js(`(() => { const b = ${rowSel("발표 자료 만들기")}.querySelector(".task-duration-empty"); return b ? getComputedStyle(b).display : "없음"; })()`);
check("시간표에 들어간(길이 안 정한) 할 일에는 마우스를 올려도 '+ 길이'가 없다", presAdd === "none" || presAdd === "없음", presAdd);
check("시간표에 들어간 할 일이어도 이미 정한 길이 글자(장보기 40분)는 보인다", (await js(`getComputedStyle(${rowSel("장보기")}.querySelector(".task-duration")).display`)) !== "none" && (await chipText("장보기")) === "40분");

// "+ 시간": LC(15분)
await reloadList();
await hoverRow("LC 파트 풀기");
b = await center(`${rowSel("LC 파트 풀기")}.querySelector(".task-slot-empty")`);
await click(b.x, b.y); await sleep(300);
const plen = await js(`(() => { const i = document.querySelector(".tl-popover .tl-pop-length-input"); return i ? i.value : null; })()`);
check("'+ 시간' 창의 처음 길이가 할 일의 길이(15분)", plen === "15분", plen);
await key("Enter");
const lcTask = await taskOf("LC 파트 풀기");
await waitFor(async () => (await api("/api/time-blocks?date=" + today)).data.some((p) => p.taskId === lcTask.id));
const lcPlan = (await api("/api/time-blocks?date=" + today)).data.find((p) => p.taskId === lcTask.id);
check("Enter를 누르면 15분짜리 계획이 생긴다", lcPlan && lcPlan.end - lcPlan.start === 15, lcPlan);
await sleep(500);
await shot("d_timeline.png");

console.log("--- 설정 탭: 시간표에 넣을 때 기본 길이 ---");
check("설정 탭의 처음 값은 1시간", (await js(`planDefaultMinutesSelect.value`)) === "60", await js(`planDefaultMinutesSelect.value`));
await js(`(() => { const s = planDefaultMinutesSelect; s.value = "30"; s.dispatchEvent(new Event("change")); })()`);
check("30분을 고르면 서버에 저장된다", await waitFor(async () => (await api("/api/settings")).data.values.planDefaultMinutes === 30), (await api("/api/settings")).data.values.planDefaultMinutes);
// 길이를 안 정하고 시간표에도 없는 새 할 일을 만들어 "+ 시간"을 연다
await api("/api/tasks", "POST", { content: "새 할 일", date: today, projectId: null });
await reloadList();
await hoverRow("새 할 일");
b = await center(`${rowSel("새 할 일")}.querySelector(".task-slot-empty")`);
await click(b.x, b.y); await sleep(300);
const plen2 = await js(`(() => { const i = document.querySelector(".tl-popover .tl-pop-length-input"); return i ? i.value : null; })()`);
check("길이를 안 정한 할 일의 '+ 시간' 처음 길이가 설정한 30분", plen2 === "30분", plen2);
await key("Enter");
const newTask = await taskOf("새 할 일");
await waitFor(async () => (await api("/api/time-blocks?date=" + today)).data.some((p) => p.taskId === newTask.id));
const newPlan = (await api("/api/time-blocks?date=" + today)).data.find((p) => p.taskId === newTask.id);
check("Enter를 누르면 30분짜리 계획이 생긴다", newPlan && newPlan.end - newPlan.start === 30, newPlan);
check("길이를 정한 할 일은 설정과 관계없이 자기 길이(LC 15분 계획 그대로)", lcPlan.end - lcPlan.start === 15);
// 기본값으로
await js(`document.getElementById("today-settings-reset").click()`);
check("오늘 탭 칸의 [기본값으로]를 누르면 1시간으로 돌아가고 저장된다", await waitFor(async () => (await api("/api/settings")).data.values.planDefaultMinutes === 60) && (await js(`planDefaultMinutesSelect.value`)) === "60");
check("다시 불러와도 설정 칸에 저장된 값이 보인다", await (async () => { await api("/api/settings", "PUT", { planDefaultMinutes: 90 }); await js(`loadSettings()`); await sleep(500); return (await js(`planDefaultMinutesSelect.value`)) === "90"; })(), await js(`planDefaultMinutesSelect.value`));

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
