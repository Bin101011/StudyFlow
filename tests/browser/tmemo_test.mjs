// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9397;
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


console.log("--- 할 일 메모 ---");
const rowSel = (title, list) => `[...document.querySelectorAll("${list || "#today-tasks"} .task-row")].find(l => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === ${JSON.stringify(title)})`;
const taskApi = async (title) => {
  const day = (await api("/api/tasks?date=" + today)).data.tasks.find((t) => t.content === title);
  if (day) return day.memo;
  const inbox = (await api("/api/inbox")).data;
  const list = Array.isArray(inbox) ? inbox : inbox.tasks;
  const x = list.find((t) => t.content === title);
  return x ? x.memo : undefined;
};
const info = async (title, list) => JSON.parse(await js(`(() => {
  const li = ${rowSel(title, list)}; if (!li) return "null";
  const v = li.querySelector(".task-memo"), t = li.querySelector(".task-memo-input"), b = li.querySelector(".task-memo-button");
  const box = li.querySelector(".task-memo-box"), c = li.querySelector(".task-content").getBoundingClientRect(), r = li.getBoundingClientRect();
  const m = v || t;
  return JSON.stringify({ text: v ? v.textContent : null, unsaved: v ? v.classList.contains("unsaved") : false, input: t ? t.value : null, focused: !!t && document.activeElement === t,
    btnDisplay: b ? getComputedStyle(b).display : null, rowH: r.height, rowLeft: r.left, rowRight: r.right, contentLeft: c.left,
    memoLeft: m ? m.getBoundingClientRect().left : null, memoRight: m ? m.getBoundingClientRect().right : null, memoTop: m ? m.getBoundingClientRect().top : null, contentBottom: c.bottom,
    boxEmpty: box.childElementCount === 0, boxH: box.getBoundingClientRect().height, wrap: getComputedStyle(li).flexWrap });
})()`));
const hoverRow = async (title, list) => {
  const r = await js(`(() => { const li = ${rowSel(title, list)}; li.scrollIntoView({ block: "center" }); const c = li.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2 }; })()`);
  await mouse("mouseMoved", r.x, r.y, 0); await sleep(250); return r;
};
const clickMemoButton = async (title, list) => {
  await hoverRow(title, list);
  const b = await js(`(() => { const r = ${rowSel(title, list)}.querySelector(".task-memo-button").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  await click(b.x, b.y); await sleep(300); return b;
};

const T = "장보기";   // 끝내지 않은 할 일이 셋이라 번호표가 있는 줄
let st = await info(T);
check("메모 없는 줄: 상자는 비어 있고 높이를 차지하지 않으며 줄바꿈 설정도 없다", st.boxEmpty && st.boxH === 0 && st.wrap === "nowrap", st);
const h0 = st.rowH;
check("번호표가 있는 줄(첫 줄 보기)", await js(`!!${rowSel(T)}.querySelector(".task-rank")`));

// 1. 마우스를 올리면 [메모] 버튼이 뜨고, 누르면 입력 칸
const hiddenBefore = (await info(T)).btnDisplay;
const b = await clickMemoButton(T);
st = await info(T);
check("마우스를 올리고 [메모]를 누르면 입력 칸이 열리고 커서가 있다", st.input === "" && st.focused, [st, hiddenBefore]);
check("입력 칸 예시 글자", (await js(`${rowSel(T)}.querySelector(".task-memo-input").placeholder`)) === "예: 준비물, 참고 링크");
check("입력 칸이 열린 동안 [메모] 버튼은 숨는다", st.btnDisplay === "none", st);
check("입력 칸은 줄 안에 있고(넘치지 않고) 할 일 이름 아래, 같은 선에서 시작한다", st.memoRight <= st.rowRight + 1 && st.memoTop >= st.contentBottom - 1 && Math.abs(st.memoLeft - st.contentLeft) <= 2, st);
await shot("tm_input.png");
await type("우유, 계란");
check("입력 직후엔 아직 저장 전", (await taskApi(T)) === "");
await key("Enter"); await sleep(800);
st = await info(T);
check("Enter를 누르면 저장되고 글자로 보인다", st.text === "우유, 계란" && st.input === null && (await taskApi(T)) === "우유, 계란", [st, await taskApi(T)]);
check("메모가 있으면 줄이 두 줄이 되고 줄바꿈이 켜진다", st.rowH > h0 + 10 && st.wrap === "wrap", [st, h0]);
check("메모 글자가 할 일 이름과 같은 선에서 시작한다(번호표 있는 줄)", Math.abs(st.memoLeft + 8 - st.contentLeft) <= 2, st);
check("메모 글자가 줄 폭을 넘지 않는다", st.memoRight <= st.rowRight + 1, st);
check("메모가 있으면 [메모] 버튼은 숨는다", st.btnDisplay === "none", st);
await shot("tm_view.png");

// 2. 한 줄 안에서 이름/버튼은 그대로 (첫 줄에 남는다)
const lineCheck = await js(`(() => { const li = ${rowSel(T)}; const c = li.querySelector(".task-content").getBoundingClientRect(); const k = li.querySelector("input[type=checkbox]").getBoundingClientRect(); const a = li.querySelector(".task-actions"); const ar = a.getBoundingClientRect(); return { sameLine: Math.abs((c.top + c.bottom) / 2 - (k.top + k.bottom) / 2) < 4, actionsOnFirstLine: ar.height === 0 || ar.bottom <= li.querySelector(".task-memo-box").getBoundingClientRect().top + 2 }; })()`);
check("체크박스와 이름은 첫 줄에 그대로, 버튼 묶음도 메모 위", lineCheck.sameLine && lineCheck.actionsOnFirstLine, lineCheck);

// 3. 눌러서 고치기, Shift+Enter, 자동 저장, 한글 조합, Esc
await js(`${rowSel(T)}.querySelector(".task-memo").click()`); await sleep(250);
st = await info(T);
check("메모 글자를 누르면 입력 칸에 기존 내용이 채워진다", st.input === "우유, 계란" && st.focused, st);
await key("Enter", { modifiers: 8 }); await type("두부");
check("Shift+Enter는 줄바꿈이고 입력 칸이 열려 있다", (await info(T)).input === "우유, 계란\n두부");
await sleep(2200);
check("입력을 멈추고 1.5초 뒤 자동 저장되고 입력 칸은 열린 채", (await taskApi(T)) === "우유, 계란\n두부" && (await info(T)).input !== null, [await taskApi(T), await info(T)]);
await js(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }))`); await sleep(300);
check("한글 조합 중 Enter는 입력을 끝내지 않는다", (await info(T)).input !== null);
await key("Escape"); await sleep(600);
st = await info(T);
check("Esc로 끝내면 글자 표시로 돌아간다(줄바꿈 유지)", st.input === null && st.text === "우유, 계란\n두부", st);

// 4. blur 저장, HTML은 글자로만
await js(`${rowSel(T)}.querySelector(".task-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = "<b>굵게</b> <img src=x onerror=window.__xss=1>"; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await sleep(800);
check("입력 칸을 벗어나면 즉시 저장되고 HTML은 태그가 아니라 글자로 보인다", (await taskApi(T)).startsWith("<b>굵게</b>") && await js(`(() => { const v = ${rowSel(T)}.querySelector(".task-memo"); return v.textContent.includes("<b>굵게</b>") && !v.querySelector("b") && !v.querySelector("img") && window.__xss === undefined; })()`));

// 5. 끌기와의 충돌: 메모 글자를 누르고 끌어도 줄이 끌려가지 않는다. 이름 쪽을 끌면 여전히 순서가 바뀐다
const before = await js(`[...document.querySelectorAll("#today-tasks .task-row")].map(l => l.querySelector(".task-content").textContent).join(",")`);
let mv = await js(`(() => { const r = ${rowSel(T)}.querySelector(".task-memo").getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
await mouse("mouseMoved", mv.x, mv.y, 0); await mouse("mousePressed", mv.x, mv.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", mv.x, mv.y - 90 * i / 6, 1);
await sleep(200);
const ghost = await js(`!!document.querySelector(".task-ghost")`);
await mouse("mouseReleased", mv.x, mv.y - 90); await sleep(600);
check("메모 글자를 누른 채 끌어도 할 일이 끌려가지 않는다", !ghost && (await js(`[...document.querySelectorAll("#today-tasks .task-row")].map(l => l.querySelector(".task-content").textContent).join(",")`)) === before, [ghost, before]);
// 입력 칸 안에서 끌어서 글자 고르기
await js(`${rowSel(T)}.querySelector(".task-memo").click()`); await sleep(250);
mv = await js(`(() => { const r = ${rowSel(T)}.querySelector(".task-memo-input").getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2, x2: r.right - 10 }; })()`);
await mouse("mouseMoved", mv.x, mv.y, 0); await mouse("mousePressed", mv.x, mv.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", mv.x + (mv.x2 - mv.x) * i / 6, mv.y + 40 * i / 6, 1);
const ghost2 = await js(`!!document.querySelector(".task-ghost")`);
await mouse("mouseReleased", mv.x2, mv.y + 40); await sleep(200);
check("입력 칸 안에서 끌어도(글자 고르기) 할 일이 끌려가지 않는다", !ghost2 && (await info(T)).input !== null);
await key("Escape"); await sleep(500);
// 이름 쪽을 끌면 여전히 순서가 바뀐다 (메모가 있는 줄을 맨 위로)
await js(`loadToday()`); await sleep(1500);
const rT = await js(`(() => { const c = ${rowSel(T)}.querySelector(".task-content").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2 }; })()`);
const rTop = await js(`(() => { const r = document.querySelector("#today-tasks .task-row").getBoundingClientRect(); return r.top; })()`);
await drag(rT.x, rT.y, rT.x, rTop + 4, 8); await sleep(900);
const after = await js(`[...document.querySelectorAll("#today-tasks .task-row")].map(l => l.querySelector(".task-content").textContent)`);
check("메모가 있는 줄도 이름을 끌어 순서를 바꿀 수 있고 메모가 따라온다", after[0] === T && (await info(T)).text.startsWith("<b>굵게</b>"), after);
await shot("tm_rank.png");

// 6. 지우기와 버튼 복귀
await js(`${rowSel(T)}.querySelector(".task-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await sleep(800);
st = await info(T);
check("모두 지우면 메모가 삭제되고 줄이 한 줄로 돌아온다", st.text === null && st.boxEmpty && (await taskApi(T)) === "" && Math.abs(st.rowH - h0) < 2, [st, await taskApi(T), h0]);
await hoverRow(T);
check("메모가 없으면 [메모] 버튼이 다시 보인다(마우스를 올렸을 때)", (await info(T)).btnDisplay !== "none");

// 7. 저장 실패
await js(`window.__f = window.fetch; window.fetch = (u, o) => (o && o.method === "PATCH") ? Promise.resolve(new Response(JSON.stringify({ error: "가짜 오류" }), { status: 500, headers: { "Content-Type": "application/json" } })) : window.__f(u, o);`);
await clickMemoButton(T);
await type("실패할 메모"); await key("Enter"); await sleep(900);
st = await info(T);
const toast = await js(`document.getElementById("toast").textContent`);
check("저장 실패: 글자는 남고 빨간 표시 + 알림", st.text === "실패할 메모" && st.unsaved && /메모를 저장하지 못했습니다/.test(toast), [st, toast]);
check("서버에는 저장되지 않았다", (await taskApi(T)) === "");
await js(`window.fetch = window.__f`);
await js(`${rowSel(T)}.querySelector(".task-memo").click()`); await sleep(250);
await key("Enter"); await sleep(900);
st = await info(T);
check("다시 눌렀다 닫으면 재저장되고 빨간 표시가 사라진다", !st.unsaved && (await taskApi(T)) === "실패할 메모", [st, await taskApi(T)]);

// 8. 끝낸 할 일, 새로고침 후 유지
await js(`${rowSel(T)}.querySelector("input[type=checkbox]").click()`); await sleep(1500);
st = await info(T);
check("끝낸 할 일에도 메모가 그대로 보인다(순서 번호는 빠진다)", st && st.text === "실패할 메모", st);
await js(`${rowSel(T)}.querySelector("input[type=checkbox]").click()`); await sleep(1500);
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#today-tasks .task-row").length`)) > 0, 10000);
await sleep(500);
check("껐다 켜도 메모가 유지된다", (await info(T)).text === "실패할 메모", await info(T));

// 9. 다른 목록과 프로젝트 할 일
const P = "발표 자료 만들기";   // 프로젝트 할 일 ("빼기" 버튼만 있는 줄)
await clickMemoButton(P);
await type("슬라이드 10장"); await key("Enter"); await sleep(800);
check("프로젝트 할 일(오늘 목록)에도 메모를 쓸 수 있다", (await taskApi(P)) === "슬라이드 10장" && (await info(P)).text === "슬라이드 10장", [await taskApi(P), await info(P)]);

const I = "여권 사진 찍기";   // 할 일 목록(수집함)
await clickMemoButton(I, "#inbox-tasks");
await type("증명사진 규격 3.5x4.5"); await key("Enter"); await sleep(800);
st = await info(I, "#inbox-tasks");
check("할 일 목록(수집함)의 줄에도 메모를 쓸 수 있다", st.text === "증명사진 규격 3.5x4.5" && (await taskApi(I)) === "증명사진 규격 3.5x4.5" && st.memoRight <= st.rowRight + 1, [st, await taskApi(I)]);
check("번호표가 없는 줄은 메모 글자가 이름과 같은 선에서 시작한다", Math.abs(st.memoLeft + 8 - st.contentLeft) <= 2, st);
await shot("tm_inbox.png");

const O = "지난 일 마무리";   // 밀린 할 일
await clickMemoButton(O, "#overdue-tasks");
await type("밀린 메모"); await key("Enter"); await sleep(800);
check("밀린 할 일 줄에도 메모를 쓸 수 있다", (await info(O, "#overdue-tasks")).text === "밀린 메모");

// 수집함 줄을 끌어다 오늘로 옮겨도 메모가 따라간다
let ir = await js(`(() => { const c = ${rowSel(I, "#inbox-tasks")}.querySelector(".task-content").getBoundingClientRect(); const t = document.querySelector("#tasks-column .column-scroll").getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2, tx: t.left + t.width / 2, ty: t.top + 30 }; })()`);
await drag(ir.x, ir.y, ir.tx, ir.ty, 10); await sleep(1200);
check("수집함 줄을 오늘 할 일로 끌어와도 메모가 유지된다", (await js(`!!${rowSel(I)}`)) && (await info(I)).text === "증명사진 규격 3.5x4.5", await info(I));

// 10. 프로젝트 탭의 단계 줄
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card .task-row").length`)) > 0, 10000);
await sleep(500);
const stepInfo = JSON.parse(await js(`(() => { const li = [...document.querySelectorAll(".project-card .task-row")].find(l => l.querySelector(".task-content").textContent === "발표 자료 만들기"); if (!li) return "null"; const v = li.querySelector(".task-memo"); const card = li.closest(".project-card").getBoundingClientRect(); const r = li.getBoundingClientRect(); return JSON.stringify({ text: v ? v.textContent : null, hasBtn: !!li.querySelector(".task-memo-button"), inside: v ? v.getBoundingClientRect().right <= card.right : null }); })()`));
check("프로젝트 카드의 단계 줄에도 같은 메모가 보인다(오늘 탭에서 쓴 메모)", stepInfo && stepInfo.text === "슬라이드 10장" && stepInfo.hasBtn && stepInfo.inside, stepInfo);
await shot("tm_project.png");

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
