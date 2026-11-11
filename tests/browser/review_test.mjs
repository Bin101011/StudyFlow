// 아침 정리 창(밀린 할 일 정리) 시험 (헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번).
// 하루가 지나는 것은 rollover_test처럼 브라우저의 Date를 하루씩 앞당겨서 흉내 낸다. 시험 서버는 정리 창을 기본으로 끄므로(fake_google.py) 설정으로 켠다
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9402;
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

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });

async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
// 진짜 마우스로 누른다: 버튼이 창 뒤에 가려져 있으면 눌리지 않으므로, 정말 화면 맨 위에 있는지도 함께 확인된다
async function click(selector) {
  const box = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) throw new Error("없는 요소: " + selector);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(150);
}
const pressEscape = async () => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(200); };
const type = (text) => send("Input.insertText", { text });
const shiftDays = (n) => js(`(() => {
  window.__shift = (window.__shift || 0) + ${n} * 86400000;
  if (!window.__RealDate) {
    window.__RealDate = Date; const R = window.__RealDate;
    window.Date = class extends R { constructor(...a) { if (a.length === 0) super(R.now() + window.__shift); else super(...a); } static now() { return R.now() + window.__shift; } };
  }
  return 1; })()`);
const wake = () => js(`document.dispatchEvent(new Event("visibilitychange"))`);
const isOpen = () => js(`document.getElementById("review-dialog").open`);
const rows = () => js(`Array.from(document.querySelectorAll("#review-list .review-row")).map((r) => r.querySelector(".review-name").textContent)`);
const rowSel = (name, action) => js(`(() => { const r = Array.from(document.querySelectorAll("#review-list .review-row")).find((x) => x.querySelector(".review-name").textContent === ${JSON.stringify(name)}); return r ? '#review-list .review-row[data-task-id="' + r.dataset.taskId + '"] [data-action="${action}"]' : null; })()`);
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const TODAY = day(0), Y1 = day(-1), Y2 = day(-2), Y3 = day(-3);
// 할 일 하나의 지금 상태. 끝낸 할 일은 끝낸 날짜의 목록에, 안 끝낸 것은 date의 목록에 나오므로 여러 날을 찾아본다
async function getTask(taskId) {
  for (const d of [Y3, Y2, Y1, TODAY, day(1), day(2), day(3)]) {
    const data = (await api("/api/tasks?date=" + d)).data;
    const found = data.tasks.concat(data.overdue).find((t) => t.id === taskId);
    if (found) return found;
  }
  return null;
}

console.log("--- 준비: 시험 서버는 정리 창이 꺼져 있다 ---");
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
check("시험 서버 기본(꺼짐)에서는 밀린 할 일이 있어도 창이 뜨지 않는다", !(await isOpen()) && (await api("/api/tasks?date=" + TODAY)).data.overdue.length > 0);

const project = (await api("/api/projects")).data;
const projectId = (Array.isArray(project) ? project : project.projects)[0].id;
const add = async (content, date, projectId) => (await api("/api/tasks", "POST", { content, date, projectId })).data.id;
const idDone = await add("어제 과제", Y1);
const idToday = await add("옮길 일", Y2);
const idLater = await add("사흘 전 독서", Y3);
const idProject = await add("발표 준비 <b>굵게</b>", Y1, projectId);
const idSkip = await add("나중에 볼 일", Y1);
await api("/api/settings", "PUT", { overdueReviewEnabled: true, overdueReviewDate: "" });

console.log("--- 앱을 켜면 정리 창이 저절로 뜬다 ---");
await send("Page.navigate", { url: BASE + "/" });
const opened = await waitFor(isOpen, 8000);
check("켜자마자 밀린 할 일 정리 창이 뜬다", opened);
await sleep(300); await shot("review_open.png");
const names0 = await rows();
check("밀린 할 일 6개가 날짜 순서로, 같은 날은 만든 순서로 나온다 (시험 서버의 '지난 일 마무리' 포함)",
  JSON.stringify(names0) === JSON.stringify(["사흘 전 독서", "지난 일 마무리", "옮길 일", "어제 과제", "발표 준비 <b>굵게</b>", "나중에 볼 일"]), names0);
check("개수 '6개'", (await js(`document.getElementById("review-count").textContent`)) === "6개");
const label = await js(`document.querySelector('#review-list .review-row[data-task-id="${idLater}"] .review-date').textContent`);
const d3 = new Date(); d3.setDate(d3.getDate() - 3);
check("날짜가 '11/8 (토)' 모양", label === (d3.getMonth() + 1) + "/" + d3.getDate() + " (" + "일월화수목금토"[d3.getDay()] + ")", label);
check("프로젝트 할 일에는 프로젝트 이름표가 붙는다", await js(`Boolean(document.querySelector('#review-list .review-row[data-task-id="${idProject}"] .project-chip'))`));
check("할 일 이름의 < >는 글자 그대로 (HTML로 해석하지 않음)", await js(`!document.querySelector('#review-list .review-row[data-task-id="${idProject}"] .review-name b')`));
check("처음 포커스는 [닫기] (Enter 한 번에 [전부 끝냈음]이 눌리지 않게)", (await js(`document.activeElement.id`)) === "review-close");
check("버튼 이름: 끝냈음 / 오늘로 / 건너뛰기", JSON.stringify(await js(`Array.from(document.querySelectorAll('#review-list .review-row')[0].querySelectorAll("button")).map((b) => b.textContent)`)) === JSON.stringify(["끝냈음", "오늘로", "건너뛰기"]));
const width = await js(`document.getElementById("review-dialog").getBoundingClientRect().width`);
const overflow = await js(`Array.from(document.querySelectorAll("#review-list .review-row")).some((r) => r.scrollWidth > r.clientWidth + 1)`);
check("창 너비 520px 안에서 줄이 넘치지 않는다", Math.round(width) === 520 && !overflow, [width, overflow]);

console.log("--- [끝냈음]: 하려던 날짜에 끝낸 것으로 ---");
await click(await rowSel("어제 과제", "done"));
await waitFor(async () => !(await rows()).includes("어제 과제"));
check("줄이 창에서 빠지고 '5개'", !(await rows()).includes("어제 과제") && (await js(`document.getElementById("review-count").textContent`)) === "5개");
let t = await getTask(idDone);
check("서버: 끝냄, 끝낸 날짜는 어제(하려던 날) 23:59:59", t && t.done === 1 && t.done_at === Y1 + "T23:59:59", t);

console.log("--- [오늘로]: 날짜를 오늘로 ---");
await click(await rowSel("옮길 일", "today"));
await waitFor(async () => !(await rows()).includes("옮길 일"));
t = await getTask(idToday);
check("줄이 빠지고 서버에서 날짜가 오늘, 안 끝냄", !(await rows()).includes("옮길 일") && t.date === TODAY && t.done === 0, t);

console.log("--- [건너뛰기]: 아무것도 바꾸지 않는다 ---");
await click(await rowSel("사흘 전 독서", "later"));
t = await getTask(idLater);
check("줄만 빠지고 서버는 그대로(사흘 전, 안 끝냄)", !(await rows()).includes("사흘 전 독서") && t.date === Y3 && t.done === 0, t);

console.log("--- [전부 끝냈음]: 두 번 눌러야 ---");
await click("#review-finish-all");
check("한 번 누르면 '정말 3개 모두? (한 번 더)'로 바뀌고 아무것도 끝내지 않는다",
  (await js(`document.getElementById("review-finish-all").textContent`)) === "정말 3개 모두? (한 번 더)" && (await rows()).length === 3 && (await getTask(idProject)).done === 0);
check("눌린 상태가 파랗게 보인다", await js(`getComputedStyle(document.getElementById("review-finish-all")).backgroundColor === "rgb(26, 115, 232)"`));
await click(await rowSel("나중에 볼 일", "later"));
check("그 사이 다른 줄 버튼을 누르면 원래 글자로 돌아온다", (await js(`document.getElementById("review-finish-all").textContent`)) === "전부 끝냈음" && (await rows()).length === 2);
await click("#review-finish-all");
check("다시 한 번 누르면 '정말 2개 모두? (한 번 더)'", (await js(`document.getElementById("review-finish-all").textContent`)) === "정말 2개 모두? (한 번 더)");
await click("#review-finish-all");
const closedAll = await waitFor(async () => !(await isOpen()));
check("두 번째 누름에 남은 2개를 끝내고 창이 닫힌다", closedAll);
t = await getTask(idProject);
const old = (await api("/api/tasks?date=" + Y2)).data.tasks.find((x) => x.content === "지난 일 마무리");
check("각자 하려던 날짜로 기록 (어제, 그저께)", t.done_at === Y1 + "T23:59:59" && old && old.done === 1 && old.done_at === Y2 + "T23:59:59", [t, old]);
check("[건너뛰기] 한 줄은 그대로", (await getTask(idSkip)).done === 0);
const saved = (await api("/api/settings")).data.values;
check("창을 닫으면 오늘 날짜를 설정에 적는다", saved.overdueReviewDate === TODAY, saved.overdueReviewDate);

console.log("--- 오늘 탭: 결과가 보이고, [정리]로 다시 연다 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1500);
const todayState = await js(`({
  overdue: Array.from(document.querySelectorAll("#overdue-tasks .task-row .task-text, #overdue-tasks .task-row .task-content")).map((e) => e.textContent),
  overdueRows: document.querySelectorAll("#overdue-tasks .task-row").length,
  todayText: document.getElementById("today-tasks").textContent,
  buttonVisible: !document.getElementById("overdue-section").hidden && document.getElementById("overdue-review-open").offsetParent !== null })`);
check("밀린 할 일은 [건너뛰기] 두 줄만 남는다", todayState.overdueRows === 2, todayState);
check("오늘 목록에 [오늘로] 옮긴 일은 있고 [끝냈음] 한 일은 없다", todayState.todayText.includes("옮길 일") && !todayState.todayText.includes("어제 과제"), todayState.todayText);
check("'밀린 할 일' 옆에 [정리] 버튼이 보인다", todayState.buttonVisible);
const headBox = await js(`(() => { const h = document.querySelector(".overdue-head h3").getBoundingClientRect(); const b = document.getElementById("overdue-review-open").getBoundingClientRect(); return { hMid: h.top + h.height / 2, bMid: b.top + b.height / 2, gap: b.left - h.right }; })()`);
check("[정리]는 제목과 같은 줄, 제목 바로 오른쪽", Math.abs(headBox.hMid - headBox.bMid) < 3 && headBox.gap > 0 && headBox.gap < 20, headBox);
await shot("review_today.png");
await click("#overdue-review-open");
await waitFor(isOpen);
check("[정리]를 누르면 창이 남은 2개로 열린다", (await isOpen()) && JSON.stringify(await rows()) === JSON.stringify(["사흘 전 독서", "나중에 볼 일"]), await rows());
await pressEscape();
check("Esc로 닫힌다", !(await isOpen()));
check("닫은 뒤 [정리]로 연 창은 아무것도 바꾸지 않는다", (await getTask(idLater)).done === 0 && (await getTask(idSkip)).done === 0);

console.log("--- 같은 날 다시 켜면 뜨지 않는다 ---");
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
check("오늘 이미 닫았으므로 다시 켜도 창이 뜨지 않는다", !(await isOpen()));

console.log("--- 켜 둔 채 자정이 지나면 뜬다 ---");
await shiftDays(1); await wake();
check("하루가 지나고 창이 다시 보이면 정리 창이 뜬다", await waitFor(isOpen, 5000));
const rolledRows = await rows();
check("'오늘'로 옮겼던 일도 이제 밀린 할 일로 나온다", rolledRows.includes("옮길 일") && !rolledRows.includes("어제 과제"), rolledRows);
await click("#review-close");
check("[닫기]로 닫힌다", !(await isOpen()));
const savedDay = await js(`toDateText(new Date())`);
await sleep(500);
check("새 날짜를 설정에 적는다", (await api("/api/settings")).data.values.overdueReviewDate === savedDay);

console.log("--- 글을 쓰는 중에는 기다렸다가 띄운다 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1200);
await waitFor(async () => await js(`!dayMemoInput.disabled`), 5000);
await js(`dayMemoInput.focus()`); await type("메모 쓰는 중"); await sleep(200);
await shiftDays(1); await wake(); await sleep(1500);
check("메모 칸에 쓰는 중에는 창이 뜨지 않는다", !(await isOpen()));
check("쓰던 글자가 그대로", (await js(`dayMemoInput.value`)).includes("메모 쓰는 중"));
await js(`document.activeElement.blur()`); await sleep(300); await wake();
check("메모 칸에서 나온 뒤 다음 확인 때 뜬다", await waitFor(isOpen, 5000));
await pressEscape();

console.log("--- 다른 창이 열려 있으면 기다린다 ---");
await shiftDays(1);
await js(`document.getElementById("dday-dialog").showModal()`); await wake(); await sleep(1500);
check("D-day 창이 열려 있으면 정리 창이 뜨지 않는다", !(await isOpen()) && (await js(`document.querySelectorAll("dialog[open]").length`)) === 1);
// 닫은 직후에는 브라우저가 포커스를 닫힌 창의 입력 칸에 잠깐 남겨 둔다. 그래도 "쓰는 중"으로 보지 않고 바로 띄워야 한다
await js(`document.getElementById("dday-dialog").close()`); await wake();
const afterDday = await waitFor(isOpen, 5000);
check("D-day 창을 닫은 뒤 다음 확인 때 뜬다", afterDday, await js(`({ active: document.activeElement.tagName + "#" + document.activeElement.id, checked: reviewCheckedDate, today: toDateText(new Date()), saved: settings.overdueReviewDate, busy: isUserBusyForReview() })`));
await pressEscape();

console.log("--- 설정에서 끄면 뜨지 않는다 ---");
await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(600);
check("설정 탭의 체크가 켜져 있다", await js(`document.getElementById("overdue-review-checkbox").checked`));
await click("#overdue-review-checkbox"); await sleep(600);
check("끄면 저장된다", (await api("/api/settings")).data.values.overdueReviewEnabled === false);
await shiftDays(1); await wake(); await sleep(1500);
check("꺼져 있으면 날이 바뀌어도 뜨지 않는다", !(await isOpen()));
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1200);
await click("#overdue-review-open");
check("꺼져 있어도 [정리]로는 열린다", await waitFor(isOpen, 4000));
await pressEscape();

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
