// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
// 확장 프로그램을 끄고 띄운다: 이 PC의 시험용 Edge에는 BlockSite 확장이 켠 지 18~30초쯤 들어오는데, 그때 진행 중인 요청이 한 번 취소돼서(net::ERR_ABORTED) 저장이 실패한 것처럼 보인다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9392;
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
await key("Enter"); await waitFor(async () => (await memoApi()) === "제출 형식: PDF" && (await info()).input === null);
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
await waitFor(async () => (await memoApi()) === "제출 형식: PDF\n연락처: 교수님");
check("입력을 멈추고 1.5초 뒤 자동 저장되고 입력 칸은 열린 채", (await memoApi()) === "제출 형식: PDF\n연락처: 교수님" && (await info()).input !== null, [await memoApi(), await info()]);
// 한글 조합 중 Enter
await js(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }))`); await sleep(300);
check("한글 조합 중 Enter는 입력을 끝내지 않는다", (await info()).input !== null);
await key("Escape"); await waitFor(async () => (await info()).input === null);
st = await info();
check("Esc로 끝내면 글자 표시로 돌아간다(줄바꿈 유지)", st.input === null && st.text === "제출 형식: PDF\n연락처: 교수님", st);

// 3. 다른 곳을 누르면 저장 (blur)
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await type(" (수정)");
await js(`document.activeElement.blur()`); await waitFor(async () => (await memoApi()).endsWith("(수정)"));
check("입력 칸을 벗어나면 즉시 저장된다", (await memoApi()).endsWith("(수정)"), await memoApi());

// 4. HTML 글자는 글자로만
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = "<b>굵게</b> <img src=x onerror=window.__xss=1>"; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await waitFor(async () => (await memoApi()).includes("<b>굵게</b>"));
check("메모에 HTML이 있어도 태그로 해석되지 않고 글자 그대로 보인다", await js(`(() => { const v = ${card()}.querySelector(".project-memo"); return v.textContent.includes("<b>굵게</b>") && !v.querySelector("b") && !v.querySelector("img") && window.__xss === undefined; })()`));

// 5. 지우기
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await js(`(() => { const t = document.activeElement; t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`); await waitFor(async () => (await memoApi()) === "" && (await info()).text === null);
st = await info();
check("모두 지우면 메모가 삭제되고 [+ 메모]가 돌아온다", st.text === null && st.add === "none" && (await memoApi()) === "", [st, await memoApi()]);

// 6. 저장 실패: 빨갛게 표시하고, 다시 눌러 저장하면 회복
await js(`window.__f = window.fetch; window.fetch = (u, o) => (o && o.method === "PATCH") ? Promise.resolve(new Response(JSON.stringify({ error: "가짜 오류" }), { status: 500, headers: { "Content-Type": "application/json" } })) : window.__f(u, o);`);
await js(`${card()}.querySelector(".project-memo-add").click()`); await sleep(250);
await type("실패할 메모"); await key("Enter"); await waitFor(async () => (await info()).unsaved);
st = await info();
const toast = await js(`document.getElementById("toast").textContent`);
check("저장 실패: 글자는 남고 빨간 표시 + 알림", st.text === "실패할 메모" && st.unsaved && /메모를 저장하지 못했습니다/.test(toast), [st, toast]);
check("서버에는 저장되지 않았다", (await memoApi()) === "");
await js(`window.fetch = window.__f`);
await js(`${card()}.querySelector(".project-memo").click()`); await sleep(250);
await key("Enter"); await waitFor(async () => !(await info()).unsaved && (await memoApi()) === "실패할 메모");
st = await info();
check("다시 눌렀다 닫으면 재저장되고 빨간 표시가 사라진다", !st.unsaved && (await memoApi()) === "실패할 메모", [st, await memoApi()]);

// 7. 수정 창
await js(`[...${card()}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`); await sleep(400);
check("수정 창의 메모 칸에 기존 메모가 들어 있다", (await js(`document.getElementById("project-dialog").open && document.getElementById("project-memo").value`)) === "실패할 메모");
await shot("pm_dialog.png");
await js(`document.getElementById("project-memo").value = "수정 창에서 쓴 메모\\n둘째 줄"; document.getElementById("project-save").click()`); await waitFor(async () => (await memoApi()) === "수정 창에서 쓴 메모\n둘째 줄" && (await info()).text === "수정 창에서 쓴 메모\n둘째 줄");
check("수정 창에서 저장하면 카드와 서버에 반영된다", (await memoApi()) === "수정 창에서 쓴 메모\n둘째 줄" && (await info()).text === "수정 창에서 쓴 메모\n둘째 줄", [await memoApi(), await info()]);
// 수정 창에서 메모를 안 건드리고 다른 것만 바꿔도 메모가 유지된다
await js(`[...${card()}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`); await sleep(300);
await js(`document.getElementById("project-deadline").value = "2026-12-31"; document.getElementById("project-save").click()`); await waitFor(async () => !(await js(`document.getElementById("project-dialog").open`)) && (await js(`${card()}.querySelector(".project-deadline") ? ${card()}.querySelector(".project-deadline").textContent : ""`)).includes("2026-12-31"));
check("수정 창에서 메모를 그대로 두고 다른 값을 저장해도 메모가 유지된다", (await memoApi()) === "수정 창에서 쓴 메모\n둘째 줄");
// 새 프로젝트
await js(`document.getElementById("project-add-button").click()`); await sleep(300);
check("새 프로젝트 창의 메모 칸은 비어 있다", (await js(`document.getElementById("project-memo").value`)) === "");
await js(`document.getElementById("project-name").value = "새 프로젝트 X"; document.getElementById("project-memo").value = "처음부터 쓴 메모"; document.getElementById("project-save").click()`); await waitFor(() => js(`[...document.querySelectorAll(".project-card")].some(c => c.querySelector(".project-name").textContent === "새 프로젝트 X")`));
check("새 프로젝트를 메모와 함께 만든다", (await api("/api/projects")).data.some((p) => p.name === "새 프로젝트 X" && p.memo === "처음부터 쓴 메모") && (await js(`[...document.querySelectorAll(".project-card")].some(c => c.querySelector(".project-name").textContent === "새 프로젝트 X" && c.querySelector(".project-memo") && c.querySelector(".project-memo").textContent === "처음부터 쓴 메모")`)));

// 8. 새로고침해도 유지 + 쓰는 중에도 다른 기능(단계 추가 등)이 영향을 받지 않는다
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card").length`)) > 0, 10000);
await sleep(500);
check("껐다 켜도 메모가 유지된다", (await info()).text === "수정 창에서 쓴 메모\n둘째 줄", await info());
check("카드 안의 메모가 카드 폭을 넘지 않는다", await js(`(() => { const c = ${card()}.getBoundingClientRect(); const m = ${card()}.querySelector(".project-memo").getBoundingClientRect(); return m.left >= c.left && m.right <= c.right + 1; })()`));

// 9. 메모를 쓰는 중이나 저장하는 중에 카드가 다시 그려질 때. memo_server.py의 늦추기 스위치(/__test/rule)로 저장과 불러오기를 늦춘다.
// 시나리오마다 새 프로젝트를 쓰고, 번호로 카드를 찾는다(이름을 바꿔서 "미룬 그리기가 실제로 그려졌는지" 보기 때문이다)
console.log("--- 메모를 쓰는 중이나 저장 중에 다시 그리기 ---");
const rule = (query) => api("/__test/rule" + (query ? "?" + query : ""));
const cardOf = (id) => `document.querySelector('.project-card[data-project-id="${id}"]')`;
const memoOf = async (id) => (await api("/api/projects")).data.find((p) => p.id === id).memo;
const rename = (id, name) => api("/api/projects/" + id, "PATCH", { name });
const stateOf = async (id) => JSON.parse(await js(`(() => { const c = ${cardOf(id)}; if (!c) return "null"; const v = c.querySelector(".project-memo"); const t = c.querySelector(".project-memo-input"); return JSON.stringify({ name: c.querySelector(".project-name").textContent, text: v ? v.textContent : null, unsaved: v ? v.classList.contains("unsaved") : false, input: t ? t.value : null, focused: !!t && document.activeElement === t, sameCard: !!c.__mark, sameInput: !!t && !!t.__mark, blurs: window.__blurs || 0 }); })()`));
async function newProject(name) {
  const created = (await api("/api/projects", "POST", { name })).data;
  await js(`loadProjects()`);
  await waitFor(async () => (await js(`!!${cardOf(created.id)}`)));
  return created.id;
}
// 메모 입력 칸을 연다. 나중에 "같은 칸, 같은 카드가 그대로인지"와 "blur가 났는지" 보려고 표시를 달아 둔다
async function openMemo(id) {
  await js(`(() => { const c = ${cardOf(id)}; (c.querySelector(".project-memo") || c.querySelector(".project-memo-add")).click(); c.__mark = 1; const t = c.querySelector(".project-memo-input"); t.__mark = 1; window.__blurs = 0; t.addEventListener("blur", () => { window.__blurs++; }); })()`);
}
const waitMemo = (id, text) => waitFor(async () => (await memoOf(id)) === text);
const waitCard = (id, test) => waitFor(async () => { const s = await stateOf(id); return !!s && test(s); });
const hasColumnMemory = (id) => js(`projectColumnMemory.has(String(${id}))`);

// 9-1. ① 쓰는 중에 목록을 다시 불러온다 (옵션이 있는 호출: 빈틈 메우기는 잊지 않아야 한다)
let id1 = await newProject("쓰는중 A");
await openMemo(id1);
await type("앞부분");
await rename(id1, "쓰는중 A 새이름");
check("(준비) 카드의 열 기억이 있다", await hasColumnMemory(id1));
await js(`loadProjects({ animate: true, repackFolderIds: [null] })`);
st = await stateOf(id1);
check("쓰는 중에 목록을 다시 불러와도 같은 입력 칸이 남고 커서도 그대로다", st.sameInput && st.focused && st.input === "앞부분", st);
check("쓰는 중에 다시 불러와도 blur가 나지 않는다(반쯤 쓴 글이 저장되지 않는다)", st.blurs === 0, st);
check("쓰는 동안에는 카드를 다시 그리지 않는다", st.sameCard && st.name === "쓰는중 A", st);
check("미룬 동안에도 빈틈 메우기 옵션은 잊지 않는다", !(await hasColumnMemory(id1)));
await type("뒷부분");
st = await stateOf(id1);
check("이어 친 글자가 버려지지 않는다", st.input === "앞부분뒷부분", st);
await key("Enter");
check("Enter를 누르면 쓴 글 전부가 저장된다", await waitMemo(id1, "앞부분뒷부분"), await memoOf(id1));
check("쓰기가 끝나면 미룬 그리기를 한 번 한다(새 이름 + 새 메모)", await waitCard(id1, (s) => !s.sameCard && s.name === "쓰는중 A 새이름" && s.text === "앞부분뒷부분" && s.input === null), await stateOf(id1));

// 9-2. ① 서버에 묻지 않는 다시 그리기(폴더 접기, + 하위 등)도 쓰는 중에는 미룬다
let id2 = await newProject("쓰는중 B");
await openMemo(id2);
await type("직접 그리기");
await js(`renderProjects()`);
st = await stateOf(id2);
check("쓰는 중에 renderProjects를 불러도 입력 칸이 남는다", st.sameInput && st.focused && st.blurs === 0, st);
await key("Escape");
check("Esc로 끝내면 저장되고 미룬 그리기를 한다", (await waitMemo(id2, "직접 그리기")) && (await waitCard(id2, (s) => !s.sameCard && s.text === "직접 그리기")), await stateOf(id2));

// 9-2-2. ① 아무것도 안 고치고 닫아도(저장할 것이 없어도) 미룬 그리기를 한다
await openMemo(id2);
await rename(id2, "쓰는중 B 새이름");
await js(`loadProjects()`);
await key("Escape");
check("고치지 않고 닫아도 미룬 그리기를 한다", await waitCard(id2, (s) => !s.sameCard && s.name === "쓰는중 B 새이름" && s.text === "직접 그리기"), await stateOf(id2));

// 9-3. ① 자동 저장(1.5초)이 지나도 입력 칸이 열려 있는 동안에는 계속 미룬다
let id3 = await newProject("쓰는중 C");
await openMemo(id3);
await type("자동");
await js(`loadProjects()`);
check("쓰는 중 자동 저장이 된다", await waitMemo(id3, "자동"), await memoOf(id3));
await sleep(400);
st = await stateOf(id3);
check("자동 저장이 끝나도 입력 칸은 그대로다", st.sameInput && st.focused && st.input === "자동", st);
await type("저장");
await key("Enter");
check("이어 쓴 글까지 저장되고 카드에 보인다", (await waitMemo(id3, "자동저장")) && (await waitCard(id3, (s) => !s.sameCard && s.text === "자동저장")), await stateOf(id3));

// 9-4. ② 저장(PATCH)이 느린 동안 목록을 다시 불러온다
let id4 = await newProject("저장중 A");
await rule(`method=PATCH&path=/api/projects/${id4}&ms=2000&count=1`);
await openMemo(id4);
await type("저장 중 메모");
await key("Enter");
await sleep(200);
await js(`loadProjects()`);
st = await stateOf(id4);
check("저장 중에 다시 불러와도 카드에 새 메모가 보인다", st.text === "저장 중 메모", st);
check("저장이 끝난다", await waitMemo(id4, "저장 중 메모"), await memoOf(id4));
check("저장이 끝나고 미룬 그리기 뒤에도 새 메모가 보인다", await waitCard(id4, (s) => !s.sameCard && s.text === "저장 중 메모"), await stateOf(id4));
await openMemo(id4);
st = await stateOf(id4);
check("그 뒤 다시 고치면 새 메모에서 시작한다(옛 글로 덮지 않는다)", st.input === "저장 중 메모", st);
await type(" 추가");
await key("Enter");
check("다시 고친 글이 새 메모에 이어져 저장된다", await waitMemo(id4, "저장 중 메모 추가"), await memoOf(id4));

// 9-5. ② 저장 전에 읽은 목록이 저장이 끝난 뒤에 늦게 도착한다 (서버가 읽은 뒤 응답만 늦춘다)
let id5 = await newProject("저장중 B");
await rule(`method=GET&path=/api/projects&ms=1500&count=1&after=1`);
await openMemo(id5);
await type("늦은 응답");
await js(`void (window.__load = loadProjects())`);
await sleep(300);          // 서버가 저장 전 내용을 읽을 시간
await key("Enter");
check("늦은 응답을 기다리는 동안 저장이 끝난다", await waitMemo(id5, "늦은 응답"), await memoOf(id5));
await js(`window.__load`);
await sleep(300);
st = await stateOf(id5);
check("저장 전에 읽은 응답이 늦게 와도 새 메모를 덮지 않는다", st.text === "늦은 응답", st);
await rename(id5, "저장중 B 새이름");
await js(`loadProjects()`);
st = await stateOf(id5);
check("그 뒤의 불러오기는 평소처럼 그린다", st.name === "저장중 B 새이름" && st.text === "늦은 응답", st);

// 9-6. ② 저장 중에 또 고치고 닫은 뒤 다시 불러온다 (앞 저장이 끝나면 한 번 더 저장한다)
let id6 = await newProject("저장중 C");
await rule(`method=PATCH&path=/api/projects/${id6}&ms=1200&count=1`);
await openMemo(id6);
await type("첫째");
await sleep(1700);         // 자동 저장이 출발해서 늦어지는 중
await type(" 둘째");
await key("Enter");
await js(`loadProjects()`);
st = await stateOf(id6);
check("저장 중에 또 고쳐도 카드에는 마지막 글이 보인다", st.text === "첫째 둘째", st);
check("마지막 글까지 저장된다", await waitMemo(id6, "첫째 둘째"), await memoOf(id6));
check("모두 끝난 뒤에도 마지막 글이 보인다", await waitCard(id6, (s) => !s.sameCard && s.text === "첫째 둘째"), await stateOf(id6));

// 9-7. ② 저장이 느린 동안 수정 창을 열어도 옛 메모가 나오지 않는다 (옛 글로 저장하면 새 메모를 덮는다)
let id7 = await newProject("저장중 D");
await rule(`method=PATCH&path=/api/projects/${id7}&ms=1500&count=1`);
await openMemo(id7);
await type("창에도 보임");
await key("Enter");
await js(`[...${cardOf(id7)}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`);
check("저장 중에 연 수정 창에 새 메모가 들어 있다", (await js(`document.getElementById("project-memo").value`)) === "창에도 보임", await js(`document.getElementById("project-memo").value`));
await js(`document.getElementById("project-dialog").close()`);
check("(정리) 저장이 끝난다", await waitMemo(id7, "창에도 보임"), await memoOf(id7));

// 9-8. 메모 A를 저장하는 동안 메모 B를 쓰기 시작하면, A 저장이 끝나도 B를 다 쓸 때까지 미룬다
let id8a = await newProject("둘 A");
let id8b = await newProject("둘 B");
await rule(`method=PATCH&path=/api/projects/${id8a}&ms=1000&count=1`);
await openMemo(id8a);
await type("에이");
await key("Enter");
await openMemo(id8b);
await type("비");
await js(`loadProjects()`);
check("A 저장이 끝난다", await waitMemo(id8a, "에이"), await memoOf(id8a));
await sleep(400);
st = await stateOf(id8b);
check("A 저장이 끝나도 쓰고 있는 B 입력 칸은 남는다", st.sameInput && st.focused && st.input === "비" && st.blurs === 0, st);
await type("씨");
await key("Enter");
check("B까지 끝나면 둘 다 새 메모로 보인다", (await waitMemo(id8b, "비씨")) && (await waitCard(id8b, (s) => !s.sameCard && s.text === "비씨")) && (await stateOf(id8a)).text === "에이", [await stateOf(id8a), await stateOf(id8b)]);

// 9-9. 저장에 실패해도 미룬 그리기가 멈춰 있지 않고, 실패한 글이 저장된 것처럼 보이지 않는다
let id9 = await newProject("실패 A");
await openMemo(id9);
await type("실패할 글");
await rename(id9, "실패 A 새이름");
await js(`loadProjects()`);
await rule(`method=PATCH&path=/api/projects/${id9}&ms=100&status=500&count=1`);
await key("Enter");
check("저장 실패 알림이 나온다", await waitFor(async () => /메모를 저장하지 못했습니다/.test(await js(`document.getElementById("toast").textContent`))));
check("실패해도 미룬 그리기를 한다", await waitCard(id9, (s) => s.name === "실패 A 새이름"), await stateOf(id9));
st = await stateOf(id9);
check("실패한 글이 저장된 것처럼 보이지 않는다", !(st.text === "실패할 글" && !st.unsaved) && (await memoOf(id9)) === "", [st, await memoOf(id9)]);
await js(`[...${cardOf(id9)}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정").click()`);
check("실패한 뒤 수정 창에는 서버에 있는 메모가 나온다", (await js(`document.getElementById("project-memo").value`)) === "");
await js(`document.getElementById("project-dialog").close()`);

// 9-9-2. 미룬 그리기가 없을 때 실패하고, 그 뒤 받아 둔 목록으로 다시 그려도(서버에 다시 묻지 않음) 실패한 글이 저장된 것처럼 보이지 않는다
let id14 = await newProject("실패 B");
await rule(`method=PATCH&path=/api/projects/${id14}&ms=100&status=500&count=1`);
await openMemo(id14);
await type("실패할 글 둘");
await key("Enter");
check("(준비) 빨갛게 표시된다", await waitCard(id14, (s) => s.text === "실패할 글 둘" && s.unsaved), await stateOf(id14));
await js(`renderProjects()`);
st = await stateOf(id14);
check("다시 그려도 실패한 글이 저장된 글처럼 보이지 않는다", !(st.text === "실패할 글 둘" && !st.unsaved), st);

// 9-10. 미룬 그리기가 "누르고 있는 중"에 끼어들면 누른 것이 사라진다: 저장이 끝나도 손을 뗄 때까지 기다린다
let id10 = await newProject("누름 A");
await openMemo(id10);
await type("누르는 중");
await rename(id10, "누름 A 새이름");
await js(`loadProjects()`);
const editAt = JSON.parse(await js(`(() => { const b = [...${cardOf(id10)}.querySelectorAll(".project-card-head button")].find(b => b.textContent === "수정"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
await mouse("mouseMoved", editAt.x, editAt.y, 0);
await mouse("mousePressed", editAt.x, editAt.y);
check("누르는 사이 메모가 저장된다", await waitMemo(id10, "누르는 중"), await memoOf(id10));
await sleep(400);
st = await stateOf(id10);
check("누르고 있는 동안에는 미룬 그리기를 하지 않는다", st.sameCard && st.name === "누름 A", st);
await mouse("mouseReleased", editAt.x, editAt.y);
check("손을 떼면 누른 버튼이 정상으로 눌린다(수정 창이 열린다)", await waitFor(() => js(`document.getElementById("project-dialog").open`)));
check("수정 창에 저장된 메모가 있다", (await js(`document.getElementById("project-memo").value`)) === "누르는 중");
await js(`document.getElementById("project-dialog").close()`);
check("손을 뗀 뒤 미룬 그리기를 한다", await waitCard(id10, (s) => !s.sameCard && s.name === "누름 A 새이름"), await stateOf(id10));

// 9-11. 메모를 닫고 같은 카드의 다른 입력 칸(단계 추가)으로 옮겨 쓰는 중에는 미룬 그리기가 그 칸을 지우지 않는다
let id11 = await newProject("옮김 A");
await openMemo(id11);
await type("옮겨 가기");
await rename(id11, "옮김 A 새이름");
await js(`loadProjects()`);
await js(`${cardOf(id11)}.querySelector(".task-add input").focus()`);
check("메모가 저장된다", await waitMemo(id11, "옮겨 가기"), await memoOf(id11));
await sleep(400);
await type("다음 단계");
const stepInput = () => js(`(() => { const i = ${cardOf(id11)}.querySelector(".task-add input"); return { value: i.value, focused: document.activeElement === i }; })()`);
let inputState = await stepInput();
check("옮겨 간 입력 칸이 지워지지 않고 쓴 글이 남는다", inputState.value === "다음 단계" && inputState.focused, inputState);
await js(`document.activeElement.blur()`);
check("그 칸을 벗어나면 미룬 그리기를 한다", await waitCard(id11, (s) => !s.sameCard && s.name === "옮김 A 새이름" && s.text === "옮겨 가기"), await stateOf(id11));

// 9-11-1. 고치지 않고(저장할 것 없이) 메모를 닫으며 다른 입력 칸으로 옮겨 갈 때도 그 칸이 지워지지 않는다.
// blur 안에서 바로 그리면 포커스가 옮겨 가기 전이라서, 옮겨 갈 칸을 지워 버린다
await openMemo(id11);
await rename(id11, "옮김 A 또 새이름");
await js(`loadProjects()`);
await js(`${cardOf(id11)}.querySelector(".task-add input").focus()`);
await sleep(300);
await type("또 다음 단계");
inputState = await stepInput();
check("저장할 것이 없어도 옮겨 간 입력 칸이 지워지지 않는다", inputState.value === "또 다음 단계" && inputState.focused, inputState);
await js(`document.activeElement.blur()`);
check("그 칸을 벗어나면 미룬 그리기를 한다(저장할 것이 없었을 때)", await waitCard(id11, (s) => s.name === "옮김 A 또 새이름"), await stateOf(id11));

// 9-11-2. 서버에서 새로 받아야 하는 그리기가 미뤄져 있는 동안 받아 둔 목록으로 그려도(+ 하위 등), 새로 받기를 잊지 않는다
let id13 = await newProject("옮김 B");
await openMemo(id13);
await type("새로 받기");
await rename(id13, "옮김 B 새이름");
await js(`loadProjects()`);
await js(`${cardOf(id13)}.querySelector(".task-add input").focus()`);
check("(준비) 메모가 저장된다", await waitMemo(id13, "새로 받기"), await memoOf(id13));
await js(`renderProjects()`);
check("받아 둔 목록으로 그린 뒤에도 새로 받아서 새 이름이 보인다", await waitCard(id13, (s) => s.name === "옮김 B 새이름" && s.text === "새로 받기"), await stateOf(id13));

// 9-12. 미룬 그리기가 프로젝트 끌기(폴더로 옮기기)를 끊지 않는다. 끌기는 폴더가 있어야 켜지므로 맨 끝에 폴더를 만든다.
// 놓을 폴더와 카드가 한 화면에 들어오도록 앞에서 만든 프로젝트는 지운다
for (const old of [id1, id2, id3, id4, id5, id6, id7, id8a, id8b, id9, id10, id11, id13, id14]) await api("/api/projects/" + old, "DELETE");
const folderId = (await api("/api/folders", "POST", { name: "끌기 폴더" })).data.id;
let id12 = await newProject("끌기 A");
await sleep(700);          // 다시 그린 뒤 0.5초 동안 목록 높이를 붙잡아 둔다. 그것이 풀려 페이지가 짧아지고 스크롤이 움직인 뒤에 위치를 잰다
await openMemo(id12);
await type("끌기 전 메모");
await rename(id12, "끌기 A 새이름");
await js(`loadProjects()`);
const headAt = JSON.parse(await js(`(() => { const n = ${cardOf(id12)}.querySelector(".project-name"); n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); const f = document.querySelector('.folder-section[data-folder-id="${folderId}"]'); const fr = f.getBoundingClientRect(); return JSON.stringify({ x: r.left + 10, y: r.top + r.height / 2, fx: fr.left + 40, fy: fr.top + 12 }); })()`));
check("(준비) 누를 곳이 그 카드의 머리줄이다", await js(`(() => { const h = document.elementFromPoint(${headAt.x}, ${headAt.y}).closest(".project-card-head"); return !!h && h === ${cardOf(id12)}.querySelector(".project-card-head"); })()`));
await mouse("mouseMoved", headAt.x, headAt.y, 0);
await mouse("mousePressed", headAt.x, headAt.y);
check("끌기 시작 때 메모가 저장된다", await waitMemo(id12, "끌기 전 메모"), await memoOf(id12));
await mouse("mouseMoved", headAt.x + 12, headAt.y + 12, 1);
await sleep(400);
st = await stateOf(id12);
check("끄는 동안에는 미룬 그리기를 하지 않는다", st.sameCard && (await js(`!!projectDrag`)), st);
await mouse("mouseMoved", headAt.fx, headAt.fy, 1);
await mouse("mouseReleased", headAt.fx, headAt.fy);
check("놓으면 폴더로 옮겨진다", await waitFor(async () => (await api("/api/projects")).data.find((p) => p.id === id12).folderId === folderId), (await api("/api/projects")).data.find((p) => p.id === id12).folderId);
check("놓은 뒤 새 이름과 새 메모가 보인다", await waitCard(id12, (s) => s.name === "끌기 A 새이름" && s.text === "끌기 전 메모"), await stateOf(id12));
check("끌기 이름표가 남아 있지 않다", (await js(`document.querySelectorAll(".project-ghost").length`)) === 0);
await rule();

// 9-13. 메모 저장 중에 체크박스나 슬라이더를 건드려도 미룬 그리기가 멈추지 않는다 (N32). 이것들은 눌러도 포커스만 남을 뿐 글자를 쓰는 칸이 아니다
console.log("--- 메모 저장 중에 체크박스·슬라이더를 건드린 뒤 (N32) ---");
const progressOf = (id) => js(`${cardOf(id)}.innerText.match(/단계 \\d+ \\/ \\d+ 완료/)?.[0]`);
const stepRow = (id, text) => `[...${cardOf(id)}.querySelectorAll(".task-row")].find((l) => l.querySelector(".task-content").textContent === ${JSON.stringify(text)})`;
const idA = await newProject("메모 쓰는 카드");
const idB = await newProject("단계 체크 카드");
const stepIds = {};
for (const c of ["첫째", "둘째", "셋째"]) stepIds[c] = (await api("/api/tasks", "POST", { content: c, projectId: idB })).data.id;
await js(`loadProjects()`);
await waitFor(async () => (await progressOf(idB)) === "단계 0 / 3 완료");
await rule(`method=PATCH&path=/api/projects/${idA}&ms=1000&count=1`);
await openMemo(idA);
await type("체크 때 저장 중인 메모");
// 진짜 클릭처럼: 메모 칸이 먼저 포커스를 잃고(저장 시작), 체크박스에 포커스가 가고, 체크가 바뀐다
await js(`(() => { const c = ${stepRow(idB, "둘째")}.querySelector('input[type="checkbox"]'); c.focus(); c.click(); })()`);
await sleep(200);
check("(준비) 메모 저장 중이라 그리기를 미뤘다", (await js(`projectDeferred`)) === "reload", await js(`String(projectDeferred)`));
check("저장이 끝나면 다른 곳을 누르지 않아도 진행률이 바뀐다", await waitFor(async () => (await progressOf(idB)) === "단계 1 / 3 완료", 3000), await progressOf(idB));
check("미룬 그리기가 남아 있지 않다", (await js(`projectDeferred`)) === null, await js(`String(projectDeferred)`));
check("메모도 저장됐다", await waitMemo(idA, "체크 때 저장 중인 메모"), await memoOf(idA));

await api("/api/projects/" + idB, "PATCH", { progressMode: "manual", manualPercent: 20 });
await js(`loadProjects()`);
await waitFor(async () => (await js(`!!${cardOf(idB)}.querySelector('input[type="range"]')`)));
await rule(`method=PATCH&path=/api/projects/${idA}&ms=1000&count=1`);
await openMemo(idA);
await type(" 슬라이더");
await js(`${cardOf(idB)}.querySelector('input[type="range"]').focus()`);
await rename(idB, "슬라이더 카드 새이름");
await js(`loadProjects()`);
await sleep(200);
check("(준비) 슬라이더에 포커스가 있고 그리기를 미뤘다", await js(`document.activeElement.type === "range" && projectDeferred === "reload"`), await js(`document.activeElement.type + "/" + projectDeferred`));
check("슬라이더에 포커스가 남아 있어도 저장이 끝나면 다시 그린다", await waitCard(idB, (s) => s.name === "슬라이더 카드 새이름"), await stateOf(idB));
await api("/api/projects/" + idB, "PATCH", { progressMode: "auto" });

// 글자나 날짜를 넣는 칸은 지금까지처럼 기다린다. 다시 그리면 그 칸이 지워져서다
// 마감일이 있는 단계는 날짜 칸이 줄에 항상 있다 (없으면 마우스를 올려야 나타난다)
await api("/api/tasks/" + stepIds["셋째"], "PATCH", { deadline: "2030-01-15" });
await js(`loadProjects()`);
await waitFor(async () => (await js(`!!${stepRow(idB, "셋째")}?.querySelector(".deadline-input")`)) && (await progressOf(idB)) === "단계 1 / 3 완료");
await rule(`method=PATCH&path=/api/projects/${idA}&ms=500&count=1`);
await openMemo(idA);
await type(" 날짜");
await js(`(() => { const d = ${stepRow(idB, "셋째")}.querySelector(".deadline-input"); d.classList.add("visible"); d.focus(); })()`);
await rename(idB, "날짜 카드 새이름");
await js(`loadProjects()`);
check("(준비) 날짜 칸에 포커스가 있다", await js(`document.activeElement.type === "date"`), await js(`document.activeElement.type`));
await sleep(1000);
st = await stateOf(idB);
check("날짜 칸에 있는 동안에는 메모 저장이 끝나도 다시 그리지 않는다", st.name !== "날짜 카드 새이름" && (await js(`projectDeferred`)) === "reload", [st.name, await js(`String(projectDeferred)`)]);
await js(`document.activeElement.blur()`);
check("날짜 칸을 벗어나면 미룬 그리기를 한다", await waitCard(idB, (s) => s.name === "날짜 카드 새이름"), await stateOf(idB));
await rule();

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
