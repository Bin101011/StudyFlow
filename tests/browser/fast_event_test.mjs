// 새 일정을 Google 저장을 기다리지 않고 달력에 먼저 그리는지 시험 (docs/review-2026-11.md의 N26 ②, 헤드리스 Edge를 CDP로 조종, 서버는 memo_server.py)
// - 붙여넣기와 일정 추가 창: 누르자마자 흐리게 보이고, 저장이 끝나면 같은 번호의 일정 하나로 이어받는지 (두 개로 보이거나 깜빡 사라지지 않는지)
// - 저장 중에 다시 불러와도 사라지지 않는지, 저장 중인 일정은 눌러도 수정 창이 안 열리는지
// - 연달아 붙여넣기가 모두 들어가는지(예전에는 앞 저장이 끝날 때까지 말없이 무시), 키를 꾹 눌러 반복된 Ctrl+V는 무시하는지
// - 저장에 실패하면 지우고 알리는지, 일정 추가 창은 쓴 내용 그대로 다시 열리는지
// Google 저장이 느린 상황은 memo_server.py의 /__test/rule 스위치로 만든다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const BASE = "http://127.0.0.1:5057";
const PORT = 9418;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "edge_t_"))}`, "--window-size=1400,900", "--no-first-run", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") { const s = JSON.stringify(d.params.exceptionDetails); if (!/chrome-extension|Receiving end does not exist/.test(s)) jsErrors.push(s.slice(0, 500)); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("시간 초과: " + method)); } }, 20000); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
const T0 = Date.now(); let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(((Date.now() - T0) / 1000).toFixed(0) + "s " + (ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  [" + (typeof x === "string" ? x : JSON.stringify(x)) + "]")); };
const server = async (p) => (await fetch(BASE + p)).json();
// Google 저장(POST /api/events)을 늦추거나 실패시킨다 (memo_server.py의 스위치)
const slowSave = (ms, extra = "") => server(`/__test/rule?method=POST&path=/api/events&ms=${ms}&count=1${extra}`);
async function waitFor(condition, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await condition()) return true; await sleep(50); }
  return false;
}
// 달력에 있는 그 날짜의 그 제목 일정들: [번호, 저장 중인가, 흐리게 그려졌는가]
const onDay = (title, day) => js(`calendar.getEvents().filter((e) => e.title === ${JSON.stringify(title)} && toDateText(e.start) === ${JSON.stringify(day)})
  .map((e) => [e.id, !!e.extendedProps.saving, e.classNames.includes("event-saving")])`);
// 서버(가짜 Google)에 있는 그 날짜의 그 제목 일정 번호들
const serverIds = async (title, day) => (await server("/__test/state")).list.filter((e) => e.title === title && (e.start.dateTime || e.start.date || "").startsWith(day)).map((e) => e.id);
const day = (n) => js(`toDateText(addDays(new Date(), ${n}))`);
const keyV = async (repeat = false) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86, autoRepeat: repeat });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
};
// 붙여넣을 날짜 칸 위에 마우스가 있는 상태를 만든다 (진짜 마우스 대신 화면이 기억하는 값을 정한다. memo_test_cal과 같은 방식)
const hoverDay = (d) => js(`hoveredDate = ${JSON.stringify(d)}; document.activeElement.blur(); true`);

{
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
  await send("Page.navigate", { url: BASE + "/" });
  for (let i = 0; i < 40 && !(await js(`typeof pasteCopiedEvent === "function"`).catch(() => false)); i++) await sleep(150);
  await js(`document.querySelector('[data-tab="calendar"]').click()`);
  await waitFor(async () => (await js(`calendar.getEvents().some((e) => e.title === "학생회 팀장 회의") && editableCalendars.length > 0`)), 15000);
  // 알림은 몇 초 뒤 사라지므로, 화면이 띄운 알림 글자를 전부 기록해 둔다
  await js(`window.__toasts = []; const originalToast = showToast; showToast = function (message, duration) { window.__toasts.push(message); return originalToast(message, duration); }; true`);
  const T = "학생회 팀장 회의";
  await js(`hoveredEvent = calendar.getEvents().find((e) => e.title === ${JSON.stringify(T)}); copyHoveredEvent(); true`);

  console.log("--- A. 붙여넣기: Google 저장이 2초 걸려도 바로 보인다 ---");
  const d2 = await day(2);
  const createsBefore = (await server("/__test/state")).creates;
  await slowSave(2000);
  await hoverDay(d2); await keyV();
  const shownFast = await waitFor(async () => (await onDay(T, d2)).length === 1, 300);
  check("Ctrl+V를 누르자마자(0.3초 안) 달력에 보인다", shownFast, await onDay(T, d2));
  const [drawn] = await onDay(T, d2);
  check("저장하는 동안은 흐리게(event-saving) 보이고 '저장 중'이다", drawn && drawn[1] && drawn[2], drawn);
  check("그때 Google에는 아직 저장되지 않았다", (await server("/__test/state")).creates === createsBefore);
  check("흐린 일정이 실제 화면에 그려져 있다", await js(`!!document.querySelector(".fc-event.event-saving")`));
  await js(`openEditDialog({ event: calendar.getEventById(${JSON.stringify(drawn && drawn[0])}) }); true`);
  check("저장 중인 일정을 누르면 수정 창 대신 안내가 뜬다", !(await js(`eventDialog.open`)) && (await js(`window.__toasts`)).some((t) => t.includes("저장하는 중")), await js(`window.__toasts`));
  await js(`calendar.refetchEvents(); true`); await sleep(500);
  check("저장 중에 달력을 다시 불러와도 사라지지 않는다(15초마다 다시 불러오는 것)", (await onDay(T, d2)).length === 1, await onDay(T, d2));
  const savedOnce = await waitFor(async () => { const now = await onDay(T, d2); return now.length === 1 && !now[0][1]; }, 6000);
  const ids = await serverIds(T, d2);
  check("저장이 끝나면 Google에 하나 생기고 번호가 먼저 그린 것과 같다", savedOnce && ids.length === 1 && drawn && ids[0] === drawn[0], { ids, drawn });
  await js(`calendar.refetchEvents(); true`); await sleep(800);
  const after = await onDay(T, d2);
  check("다시 불러온 뒤에도 하나뿐이고 흐리지 않다", after.length === 1 && !after[0][1] && !after[0][2], after);
  check("먼저 그린 일정 목록이 비었다(서버 것이 이어받음)", (await js(`drawnBeforeSave.size`)) === 0, await js(`drawnBeforeSave.size`));

  console.log("--- B. 연달아 붙여넣기 (저장 하나에 1초) ---");
  const days = [await day(3), await day(4), await day(5)];
  await server(`/__test/rule?method=POST&path=/api/events&ms=1000&count=3`);
  // 저장하는 동안 20ms마다 세 날짜의 일정 개수를 기록한다 (잠깐 사라지거나 두 개가 되는 순간을 잡으려고)
  await js(`window.__samples = []; window.__sampler = setInterval(() => { window.__samples.push(${JSON.stringify(days)}.map((d) =>
    calendar.getEvents().filter((e) => e.title === ${JSON.stringify(T)} && toDateText(e.start) === d).length).join("")); }, 20); true`);
  for (const d of days) { await hoverDay(d); await keyV(); }
  const allShown = await waitFor(async () => { for (const d of days) if ((await onDay(T, d)).length !== 1) return false; return true; }, 400);
  check("세 번 연달아 붙여넣으면 셋 다 바로 보인다 (예전에는 앞 저장이 끝날 때까지 무시)", allShown, await Promise.all(days.map((d) => onDay(T, d))));
  const d6 = await day(6);
  await hoverDay(d6); await keyV(true);
  await sleep(300);
  check("키를 꾹 눌러 반복된 Ctrl+V는 무시한다", (await onDay(T, d6)).length === 0, await onDay(T, d6));
  const allSaved = await waitFor(async () => { for (const d of days) if ((await serverIds(T, d)).length !== 1) return false; return (await js(`drawnBeforeSave.size`)) === 0; }, 8000);
  await sleep(1000);  // 마지막 다시 불러오기까지 끝나기를 기다린다
  const samples = await js(`clearInterval(window.__sampler); window.__samples`);
  check("셋 다 Google에 하나씩 저장되고 달력에도 하나씩이다", allSaved && (await Promise.all(days.map((d) => onDay(T, d)))).every((x) => x.length === 1),
    { server: await Promise.all(days.map((d) => serverIds(T, d))), screen: await Promise.all(days.map((d) => onDay(T, d))) });
  const firstFull = samples.indexOf("111");
  const blips = samples.slice(firstFull).filter((s) => s !== "111");
  check("저장·다시 불러오기가 겹치는 동안 한 번도 사라지거나 두 개가 되지 않는다", firstFull >= 0 && blips.length === 0,
    { 기록수: samples.length, 어긋남: [...new Set(blips)] });

  console.log("--- C. 붙여넣기 실패 ---");
  const d7 = await day(7);
  await slowSave(500, "&status=502");
  await hoverDay(d7); await keyV();
  check("실패할 붙여넣기도 먼저 보인다", await waitFor(async () => (await onDay(T, d7)).length === 1, 300));
  check("저장에 실패하면 달력에서 지워지고 알림이 뜬다",
    await waitFor(async () => (await onDay(T, d7)).length === 0, 4000) && (await js(`window.__toasts`)).some((t) => t.includes("붙여넣지 못했습니다")), await js(`window.__toasts`));
  check("실패한 일정은 Google에도 없다", (await serverIds(T, d7)).length === 0);

  console.log("--- D. 일정 추가 창: Google 저장이 2초 걸려도 창이 바로 닫히고 보인다 ---");
  const d8 = await day(8);
  await slowSave(2000);
  await js(`openAddDialog({ date: addDays(new Date(new Date().toDateString()), 8), view: { type: MONTH_VIEW } }); true`); await sleep(200);
  await js(`document.getElementById("event-title").value = "빠른 새 일정"; document.getElementById("event-memo").value = "새 일정 메모"; document.getElementById("event-save").click(); true`);
  check("저장을 누르자마자 창이 닫히고 달력에 보인다",
    await waitFor(async () => !(await js(`eventDialog.open`)) && (await onDay("빠른 새 일정", d8)).length === 1, 300), await onDay("빠른 새 일정", d8));
  const newSaved = await waitFor(async () => { const now = await onDay("빠른 새 일정", d8); return now.length === 1 && !now[0][1]; }, 6000);
  const newIds = await serverIds("빠른 새 일정", d8);
  check("저장이 끝나면 Google에 하나, 달력에도 하나(같은 번호)", newSaved && newIds.length === 1 && (await onDay("빠른 새 일정", d8))[0][0] === newIds[0], newIds);
  const memo = await js(`calendar.getEventById(${JSON.stringify(newIds[0] || "")})?.extendedProps.description`);
  check("메모와 시각(09:00)도 맞다", memo === "새 일정 메모" && (await server("/__test/state")).list.find((e) => e.id === newIds[0])?.start.dateTime?.includes("T09:00"), memo);

  console.log("--- E. 일정 추가 창 실패: 쓴 내용 그대로 창이 다시 열린다 ---");
  const d9 = await day(9);
  await slowSave(500, "&status=502");
  await js(`openAddDialog({ date: addDays(new Date(new Date().toDateString()), 9), view: { type: MONTH_VIEW } }); true`); await sleep(200);
  await js(`document.getElementById("event-title").value = "실패할 새 일정"; document.getElementById("event-memo").value = "남아야 할 메모"; document.getElementById("event-save").click(); true`);
  check("실패할 일정도 창이 바로 닫히고 먼저 보인다",
    await waitFor(async () => !(await js(`eventDialog.open`)) && (await onDay("실패할 새 일정", d9)).length === 1, 300));
  const reopened = await waitFor(async () => await js(`eventDialog.open`), 4000);
  const fields = await js(`[document.getElementById("event-title").value, document.getElementById("event-memo").value, document.getElementById("event-start-date").value, document.getElementById("event-error").textContent]`);
  check("저장에 실패하면 쓴 제목·메모·날짜 그대로 창이 다시 열리고 이유가 보인다",
    reopened && fields[0] === "실패할 새 일정" && fields[1] === "남아야 할 메모" && fields[2] === d9 && fields[3].includes("시험용 실패"), fields);
  check("실패한 일정은 달력에서 지워졌다", (await onDay("실패할 새 일정", d9)).length === 0);
  await js(`document.getElementById("event-save").click(); true`);
  check("다시 저장하면 이번에는 저장된다",
    await waitFor(async () => (await serverIds("실패할 새 일정", d9)).length === 1 && (await onDay("실패할 새 일정", d9)).length === 1 && (await js(`drawnBeforeSave.size`)) === 0, 6000));

  check("자바스크립트 오류가 없다", jsErrors.length === 0, jsErrors.join(" | "));
}
await server("/__test/rule");
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
