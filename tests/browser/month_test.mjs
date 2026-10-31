// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9394;
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


console.log("--- 월간 캘린더 줄 수 ---");
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(2500);
const info = async () => JSON.parse(await js(`(() => {
  const s = calendar.view.activeStart; const m = shownMonthDate(s); const days = [...document.querySelectorAll(".fc-daygrid-day")];
  const dim = days.filter(d => d.classList.contains("fc-day-other")).length;
  return JSON.stringify({ view: calendar.view.type, title: document.querySelector(".fc-toolbar-title").textContent,
    rows: document.querySelectorAll(".fc-daygrid-body .fc-scrollgrid-sync-table tr").length, cells: days.length, dim,
    month: m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0"), first: days[0].dataset.date, last: days[days.length - 1].dataset.date,
    needed: monthWeeksNeeded(m.getFullYear(), m.getMonth()), daysInMonth: new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(),
    todayDisabled: document.querySelector(".fc-today-button").disabled, firstIsSunday: new Date(days[0].dataset.date + "T00:00:00").getDay() === 0 });
})()`));
const monthNow = await js(`(() => { const n = new Date(); return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0"); })()`);
const needNow = await js(`monthWeeksNeeded(new Date().getFullYear(), new Date().getMonth())`);
let st = await info();
check("처음: 새 월간 보기(monthGrid)이고 제목은 '2026년 10월' 같은 '년 월' 모양이다", st.view === "monthGrid" && /^\d{4}년 \d{1,2}월$/.test(st.title), st);
check("처음: 보고 있는 달이 오늘의 달이다", st.month === monthNow, [st.month, monthNow]);
check("처음(6줄 설정): 줄 수 = max(6, 그 달이 필요한 주 수)", st.rows === Math.max(6, needNow) && st.cells === st.rows * 7, st);
check("첫 칸은 일요일이고 그 달 1일이 첫 주에 있다", st.firstIsSunday && st.first <= st.month + "-01" && st.month + "-01" < new Date(new Date(st.first + "T00:00:00").getTime() + 7 * 86400000).toISOString().slice(0, 10), st);
check("다른 달 날짜만 흐리게(fc-day-other): 흐린 칸 = 전체 칸 - 그 달 날짜 수", st.dim === st.cells - st.daysInMonth, st);
check("월간 버튼 글자는 '월간'", (await js(`document.querySelector(".fc-" + MONTH_VIEW + "-button").textContent`)) === "월간");
check("오늘이 있는 달을 볼 때는 오늘 버튼이 꺼져 있다", st.todayDisabled === true);
await shot("m_6rows.png");

// 설정 탭에서 7줄로
await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(500);
check("설정 탭에 '월간 캘린더 줄 수' 6줄/7줄 선택이 있고 기본은 6줄", (await js(`document.querySelector('input[name="month-rows"][value="6"]').checked && !document.querySelector('input[name="month-rows"][value="7"]').checked && [...document.querySelectorAll(".settings-label")].some(l => l.textContent === "월간 캘린더 줄 수")`)));
await js(`document.querySelector('input[name="month-rows"][value="7"]').click()`); await sleep(1000);
check("7줄을 고르면 서버에 저장된다", (await api("/api/settings")).data.values.monthRows === 7);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(1500);
st = await info();
check("7줄: 줄 수 = max(7, 필요한 주 수)이고 같은 달이 그대로 보인다", st.rows === Math.max(7, needNow) && st.month === monthNow && st.cells === st.rows * 7, st);
check("7줄: 흐린 칸 = 전체 칸 - 그 달 날짜 수(다음 달 주가 더 붙었다)", st.dim === st.cells - st.daysInMonth, st);
check("7줄: 제목은 그대로 '년 월'", /^\d{4}년 \d{1,2}월$/.test(st.title), st.title);
await shot("m_7rows.png");

// 다른 달을 보는 중에 줄 수를 바꿔도 그 달이 유지된다
await js(`calendar.next()`); await sleep(800); await js(`calendar.next()`); await sleep(800);
const before = await info();
await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(400);
await js(`document.querySelector('input[name="month-rows"][value="6"]').click()`); await sleep(800);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(1200);
const after = await info();
check("다른 달(두 달 뒤)을 보는 중에 줄 수를 바꿔도 같은 달이 유지된다", after.month === before.month && after.rows === Math.max(6, after.needed), [before.month, after.month, after.rows]);
await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(300);
await js(`document.querySelector('input[name="month-rows"][value="7"]').click()`); await sleep(800);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(1200);

// 연속 이동: 앞에서 12월에서 멈추고 이전은 두 달씩 건너뛰던 문제
console.log("--- 연속 이동 ---");
await js(`document.querySelector(".fc-today-button").click()`); await sleep(1000);
const expectMonth = (base, d) => { const [y, m] = base.split("-").map(Number); const t = new Date(y, m - 1 + d, 1); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0"); };
let seqOk = true; const seqBad = [];
for (let i = 1; i <= 15; i++) { await js(`document.querySelector(".fc-next-button").click()`); await sleep(220); const s = await info(); if (s.month !== expectMonth(monthNow, i)) { seqOk = false; seqBad.push([i, s.month]); } if (!/^\d{4}년 \d{1,2}월$/.test(s.title)) { seqOk = false; seqBad.push(["제목", s.title]); } }
check("다음 버튼을 15번 눌러도 한 달씩 차례로 간다(12월에서 멈추지 않는다)", seqOk, seqBad);
seqOk = true; const seqBad2 = [];
for (let i = 1; i <= 30; i++) { await js(`document.querySelector(".fc-prev-button").click()`); await sleep(220); const s = await info(); if (s.month !== expectMonth(monthNow, 15 - i)) { seqOk = false; seqBad2.push([i, s.month]); } }
check("이전 버튼을 30번 눌러도 한 달씩 차례로 간다(두 달씩 건너뛰지 않는다)", seqOk, seqBad2);
// 매달 줄 수 규칙 (4주짜리 달, 6주가 필요한 달 포함)
const rowsOk = await js(`(async () => { const bad = []; for (let k = 0; k < 24; k++) { calendar.gotoDate(new Date(2026, 0 + k, 15)); await new Promise(r => setTimeout(r, 150)); const s = calendar.view.activeStart; const m = shownMonthDate(s); const rows = document.querySelectorAll(".fc-daygrid-body .fc-scrollgrid-sync-table tr").length; const need = monthWeeksNeeded(m.getFullYear(), m.getMonth()); if (rows !== Math.max(7, need) || m.getMonth() !== (k % 12)) bad.push([k, m.getMonth(), rows, need]); } return JSON.stringify(bad); })()`);
check("2026~2027년 24개 달 모두: 줄 수 = max(7, 필요한 주 수)이고 보고 있는 달이 맞다(2월처럼 4주짜리 달도 7줄)", rowsOk === "[]", rowsOk);
// 키보드 ←/→
await js(`document.querySelector(".fc-today-button").click()`); await sleep(800);
await js(`document.activeElement && document.activeElement.blur()`);
await key("ArrowRight"); await sleep(500);
check("키보드 →는 다음 달", (await info()).month === expectMonth(monthNow, 1), await info());
await key("ArrowLeft"); await sleep(500); await key("ArrowLeft"); await sleep(500);
check("키보드 ←는 이전 달", (await info()).month === expectMonth(monthNow, -1), await info());

// 오늘 버튼
st = await info();
check("오늘이 없는 달을 보면 오늘 버튼이 켜져 있다", st.todayDisabled === false, st);
await js(`document.querySelector(".fc-today-button").click()`); await sleep(1000);
st = await info();
check("오늘 버튼을 누르면 오늘이 있는 달로 돌아오고 버튼은 꺼진다", st.month === monthNow && st.todayDisabled === true, st);

// 주간/일간 전환과 복귀
await js(`calendar.gotoDate(new Date(2026, 8, 15))`); await sleep(800);
await js(`document.querySelector(".fc-timeGridWeek-button").click()`); await sleep(1000);
const weekTitleSep = await js(`calendar.view.type + "|" + calendar.view.activeStart.getFullYear() + "-" + (calendar.view.activeStart.getMonth() + 1)`);
check("9월(오늘이 없는 달)을 보다가 주간을 누르면 9월 8일이 있는 주가 나온다(전부 9월 안의 주)", await js(`(() => { const s = calendar.view.activeStart, e = calendar.view.activeEnd; return s >= new Date(2026, 8, 1) && e <= new Date(2026, 9, 1) && s <= new Date(2026, 8, 8) && new Date(2026, 8, 8) < e; })()`), weekTitleSep);
await js(`document.querySelector(".fc-" + MONTH_VIEW + "-button").click()`); await sleep(1000);
st = await info();
check("주간에서 월간 버튼을 누르면 9월 달력이 나온다", st.view === "monthGrid" && st.month === "2026-09", st);
// 주를 넘기다가 월간으로 돌아오면: 그 주의 수요일이 속한 달(방금 보던 달과 겹치지 않을 때)
await js(`document.querySelector(".fc-" + MONTH_VIEW + "-button").click()`); await sleep(800);
await js(`calendar.gotoDate(new Date(2026, 5, 10))`); await sleep(600);
await js(`document.querySelector(".fc-timeGridWeek-button").click()`); await sleep(800);
await js(`for (let i = 0; i < 6; i++) calendar.next()`); await sleep(1200);   // 6월 둘째 주에서 6주 뒤 = 7월 하순
await js(`document.querySelector(".fc-" + MONTH_VIEW + "-button").click()`); await sleep(1000);
st = await info();
check("주간에서 몇 주 넘긴 뒤 월간 버튼: 그 주가 있는 달이 나온다(보던 달과 겹치지 않을 때)", st.view === "monthGrid" && st.month === "2026-07", st);
await js(`document.querySelector(".fc-today-button").click()`); await sleep(800);
await js(`document.querySelector(".fc-timeGridWeek-button").click()`); await sleep(1000);
check("오늘이 있는 달에서 주간을 누르면 오늘이 있는 주가 나온다", await js(`(() => { const n = new Date(); return calendar.view.activeStart <= n && n < calendar.view.activeEnd; })()`));
await js(`document.querySelector(".fc-timeGridDay-button").click()`); await sleep(800);
await js(`document.querySelector(".fc-" + MONTH_VIEW + "-button").click()`); await sleep(1000);
check("일간 → 월간도 정상", (await info()).view === "monthGrid");

// 일정/할 일 요약이 보이는 기간 전체(다음 달 주 포함)를 따라간다
await js(`window.__reqs = []; const of = window.fetch; window.fetch = (u, o) => { window.__reqs.push(String(u)); return of(u, o); };`);
await js(`calendar.gotoDate(new Date(2026, 9, 15))`); await sleep(1500);
st = await info();
const reqs = JSON.parse(await js(`JSON.stringify(window.__reqs.filter(u => u.includes("/api/events") || u.includes("/api/task-days")))`));
const lastDay = st.last;
check("일정/할 일 요약 요청이 보이는 기간의 끝(다음 달 주까지)을 포함한다", reqs.some((u) => u.includes("/api/events") && u.includes("end=" + encodeURIComponent(lastDay)) || /end=\d{4}-\d{2}-\d{2}/.test(u) && u.slice(u.indexOf("end=") + 4, u.indexOf("end=") + 14) > lastDay) && reqs.some((u) => u.includes("/api/task-days") && u.includes("end=" + addDaysStr(lastDay, 1))), [lastDay, reqs]);
function addDaysStr(t, n) { const d = new Date(t + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
await js(`window.fetch = window.__fetchOrig || window.fetch`);

// 오늘 칸 가운데로 맞추기(앞서 만든 기능)가 새 보기에서도 동작
await js(`document.documentElement.style.setProperty("--month-cell-height", "170px"); calendar.updateSize();`); await sleep(500);
await js(`document.querySelector(".fc-today-button").click()`); await sleep(400);
await js(`calendar.next()`); await sleep(900); await js(`calendar.prev()`); await sleep(3200);
const sc = JSON.parse(await js(`(() => { const cell = document.querySelector(".fc-daygrid-day.fc-day-today"); const sc = cell.closest(".fc-scroller"); const a = cell.getBoundingClientRect(), b = sc.getBoundingClientRect(); return JSON.stringify({ top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, visible: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, off: Math.round((a.top + a.height / 2) - (b.top + b.height / 2)) }); })()`));
check("오늘 칸 가운데로 맞추기: 오늘이 있는 달로 돌아오면 오늘 칸이 보이고 스크롤이 내려가 있다(가운데이거나 맨 아래)", sc.visible && sc.top > 0 && (Math.abs(sc.off) <= 4 || sc.top >= sc.max - 1), sc);
await js(`document.documentElement.style.removeProperty("--month-cell-height"); calendar.updateSize();`);

// 서버가 줄 수 값을 검사한다
const cur = (await api("/api/settings")).data.values;
const put = async (v) => { await api("/api/settings", "PUT", { ...cur, monthRows: v }); return (await api("/api/settings")).data.values.monthRows; };
check("서버: 6, 7만 인정한다(7→7, 6→6)", (await put(7)) === 7 && (await put(6)) === 6);
check("서버: 5, 8, 글자 '7', 7.5, true, null은 기본값 6", (await put(5)) === 6 && (await put(8)) === 6 && (await put("7")) === 6 && (await put(7.5)) === 6 && (await put(true)) === 6 && (await put(null)) === 6);
await put(7);

// 새로 열어도 유지
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(2500);
st = await info();
check("껐다 켜도 7줄 설정이 유지된다", st.rows === Math.max(7, st.needed) && st.month === monthNow, st);

// 오늘이 '다음 달 주'에 걸리는 경우(예: 11월 3일): 10월을 볼 때 오늘 버튼이 켜져 있어야 11월로 갈 수 있다
console.log("--- 오늘이 앞 달의 다음 달 주에 걸리는 경우(가짜 날짜 2026-11-03) ---");
const mockSrc = `const RealDate = Date; const off = new RealDate("2026-11-03T10:00:00").getTime() - RealDate.now();
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); } static now() { return RealDate.now() + off; } }
  window.Date = FakeDate;`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: mockSrc });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(2500);
st = await info();
check("(가짜 날짜) 11월을 보고 있다", st.month === "2026-11", st);
await js(`calendar.prev()`); await sleep(1000);
st = await info();
check("(가짜 날짜) 10월(7줄)에는 아래에 11월 3일(오늘)이 보인다", st.month === "2026-10" && st.last >= "2026-11-03", st);
check("(가짜 날짜) 그래도 오늘 버튼은 켜져 있다(보고 있는 달이 오늘의 달이 아니므로)", st.todayDisabled === false, st);
check("(가짜 날짜) 10월을 보는 중에는 오늘 칸 가운데로 맞추기가 일어나지 않는다(맨 위에서 시작)", await js(`(() => { const sc = document.querySelector(".fc-daygrid-day").closest(".fc-scroller"); return sc.scrollTop === 0; })()`));
await js(`document.querySelector(".fc-today-button").click()`); await sleep(1000);
st = await info();
check("(가짜 날짜) 오늘 버튼으로 11월로 돌아온다", st.month === "2026-11" && st.todayDisabled === true, st);

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
