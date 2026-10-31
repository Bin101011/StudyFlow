// 오늘 탭을 켜 둔 채 자정이 지났을 때의 시험 (헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번). 브라우저의 Date를 하루씩 앞당겨서 흉내 낸다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9401;
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

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);

async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
const type = (text) => send("Input.insertText", { text });
const state = async () => JSON.parse(await js(`JSON.stringify({
  today: todayText, viewed: viewedDate,
  heading: document.getElementById("tasks-heading").textContent,
  backHidden: document.getElementById("day-today").hidden,
  title: document.getElementById("today-title").textContent })`));

// 브라우저의 "지금"을 n일 앞당긴다 (이미 앞당겼다면 더 앞당긴다)
const shiftDays = (n) => js(`(() => {
  window.__shift = (window.__shift || 0) + ${n} * 86400000;
  if (!window.__RealDate) {
    window.__RealDate = Date; const R = window.__RealDate;
    window.Date = class extends R { constructor(...a) { if (a.length === 0) super(R.now() + window.__shift); else super(...a); } static now() { return R.now() + window.__shift; } };
  }
  return 1; })()`);
// 창이 다시 보이게 된 것처럼 알린다 (노트북을 덮었다 열었을 때). 앱은 이때와 1분마다 날짜가 바뀌었는지 본다
const wake = () => js(`document.dispatchEvent(new Event("visibilitychange"))`);
const dayNumber = (text) => Number(text.slice(8, 10));

console.log("--- 오늘 탭을 켜 둔 채 자정이 지나면 새 오늘로 넘어간다 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(2000);
const s0 = await state();
check("처음에는 오늘을 보고 있고 제목이 '오늘 할 일'이다", s0.viewed === s0.today && s0.heading === "오늘 할 일" && s0.backHidden === true, s0);

await shiftDays(1); await wake();
const expected1 = await js(`toDateText(new Date())`);
check("(준비) 브라우저의 지금이 하루 뒤로 바뀌었다", expected1 !== s0.today, [expected1, s0.today]);
const rolled1 = await waitFor(async () => (await state()).today === expected1, 5000);
check("자정이 지나 창이 다시 보이면 '오늘'이 새 날짜로 바뀐다", rolled1, await state());
await sleep(800);
const s1 = await state();
check("어제를 보고 있었으면 새 오늘로 따라간다", s1.viewed === expected1, s1);
// "1일"만 보면 "31일"에도 들어맞으므로 연, 월, 일을 모두 본다
const [ey, em, ed] = expected1.split("-").map(Number);
check("제목이 새 오늘의 날짜(" + ey + "년 " + em + "월 " + ed + "일)로 바뀐다", s1.title.includes(ey + "년 " + em + "월 " + ed + "일"), s1.title);
check("'오늘 할 일' 제목이고 '오늘로 돌아가기' 버튼은 숨겨져 있다", s1.heading === "오늘 할 일" && s1.backHidden === true, s1);

console.log("--- 다른 날을 보고 있으면 그 날짜는 그대로 둔다 ---");
for (let i = 0; i < 3; i++) { await js(`document.getElementById("day-next").click()`); await sleep(500); }
const s2 = await state();
const farDay = s2.viewed;
check("(준비) 오늘로부터 3일 뒤를 보고 있다", farDay === await js(`addDaysToText(todayText, 3)`) && s2.heading === "할 일" && s2.backHidden === false, s2);
await shiftDays(1); await wake();
const expected2 = await js(`toDateText(new Date())`);
await waitFor(async () => (await state()).today === expected2, 5000); await sleep(800);
const s3 = await state();
check("'오늘'은 하루 더 지나지만 보고 있던 날짜는 그대로다", s3.today === expected2 && s3.viewed === farDay, s3);
check("다른 날을 보는 중이라 제목은 '할 일'이고 돌아가기 버튼이 보인다", s3.heading === "할 일" && s3.backHidden === false, s3);

console.log("--- 보고 있던 미래의 날이 '오늘'이 되면 오늘로 표시된다 ---");
await shiftDays(2); await wake();
const expected3 = await js(`toDateText(new Date())`);
await waitFor(async () => (await state()).today === expected3, 5000); await sleep(800);
const s4 = await state();
check("보던 날(" + farDay + ")이 오늘이 되었다", s4.today === farDay && s4.viewed === farDay, s4);
check("그래서 '오늘 할 일' 제목이고 돌아가기 버튼이 숨는다", s4.heading === "오늘 할 일" && s4.backHidden === true, s4);

console.log("--- 메모를 쓰는 중에는 화면을 바꾸지 않는다 ---");
await waitFor(async () => (await js(`!dayMemoInput.disabled`)), 5000);
const typingDay = (await state()).viewed;
await js(`dayMemoInput.focus()`); await type("야간 공부 메모"); await sleep(300);
await shiftDays(1); await wake(); await sleep(1500);
const expected4 = await js(`toDateText(new Date())`);
const s5 = await state();
check("메모 칸에 글자를 쓰는 중에는 날짜가 바뀌지 않는다", s5.today !== expected4 && s5.viewed === typingDay, s5);
check("쓰던 글자가 그대로 남아 있다", (await js(`dayMemoInput.value`)) === "야간 공부 메모");
await js(`document.activeElement.blur()`); await sleep(500); await wake();
const rolled5 = await waitFor(async () => (await state()).today === expected4, 5000); await sleep(1200);
check("메모 칸에서 나오면 다음 확인 때 새 오늘로 넘어간다", rolled5, await state());
check("쓰던 메모는 보고 있던 날짜에 저장되어 있다", (await api("/api/day-memo?date=" + typingDay)).data.content === "야간 공부 메모");

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
