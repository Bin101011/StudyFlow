// Google 로그인이 필요할 때 오른쪽 위 동기화 표시가 알려 주는지 시험 (docs/review-2026-11.md의 H1c, 헤드리스 Edge를 CDP로 조종, 서버는 login_server.py)
// - 예전에는 로그인 창을 기다리는 동안 지난번 "12:35 동기화"(초록)가 그대로 있었고, 로그인 창을 닫으면 "오프라인"(빨강)만 보였다
// - 로그인 기다리는 중 → 취소 → 새로고침으로 다시 열기 → 또 취소 → 로그인 성공 순서로 표시와 알림, 캘린더 목록을 본다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const BASE = "http://127.0.0.1:5057";
const PORT = 9414;
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
const syncText = () => js(`document.getElementById("sync-text").textContent`);
const syncClass = () => js(`document.getElementById("sync-status").className`);
// 캘린더 이름들. 줄 끝의 "✕"(목록에서 빼기 버튼) 글자는 뗀다
const calendarNames = () => js(`Array.from(document.querySelectorAll("#calendar-list label")).map((l) => l.textContent.replace("✕", "").trim())`);
// 조건이 맞을 때까지 최대 ms 동안 기다린다. 화면은 15초마다 상태를 물으므로, 기다리는 동안 pollSyncStatus()를 직접 불러 바로 묻게 한다
async function waitFor(condition, ms = 8000, poll = true) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (poll) await js(`pollSyncStatus()`);
    if (await condition()) return true;
    await sleep(200);
  }
  return false;
}

{
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
  // 알림은 4초 뒤 사라지므로, 화면이 알림에 쓴 글자를 전부 기록해 둔다
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__toasts = [];
    new MutationObserver(() => { const t = document.getElementById("toast"); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); })
      .observe(document, { childList: true, subtree: true, characterData: true });` });

  await send("Page.navigate", { url: BASE + "/" });
  for (let i = 0; i < 40 && !(await js(`typeof pollSyncStatus === "function"`).catch(() => false)); i++) await sleep(150);

  console.log("--- 켜자마자: 로그인 창을 기다리는 중 ---");
  check("서버가 켜지면서 로그인 창을 한 번 열었다", (await server("/__test/login")).opened === 1, await server("/__test/login"));
  check("오른쪽 위에 '브라우저에서 Google 로그인을 끝내세요'가 보인다", await waitFor(async () => (await syncText()).includes("브라우저에서 Google 로그인을 끝내세요")), await syncText());
  check("기다리는 중은 주황 표시(login-waiting)", (await syncClass()).includes("login-waiting"), await syncClass());

  console.log("--- 로그인 화면에서 취소(또는 창을 닫음) ---");
  await server("/__test/cancel-login");
  check("오른쪽 위가 'Google 로그인 필요'로 바뀐다", await waitFor(async () => (await syncText()).includes("Google 로그인 필요")), await syncText());
  check("'오프라인'만 보이지 않는다", !(await syncText()).includes("오프라인"), await syncText());
  check("로그인 필요는 빨간 표시(offline)이고 주황은 꺼진다", (await syncClass()).includes("offline") && !(await syncClass()).includes("login-waiting"), await syncClass());
  check("캘린더 목록은 지난번 것으로 보인다", await waitFor(async () => (await calendarNames()).includes("개인"), 8000, false), await calendarNames());
  check("로그인 전이라 '로그인 뒤 캘린더'는 아직 없다", !(await calendarNames()).includes("로그인 뒤 캘린더"), await calendarNames());

  console.log("--- 새로고침 → 로그인 창이 다시 열림 → 또 취소 ---");
  await js(`window.__toasts = []; document.getElementById("toast").textContent = ""; document.getElementById("sync-refresh").click()`);
  check("새로고침을 누르면 로그인 창을 다시 연다", await waitFor(async () => (await server("/__test/login")).opened === 2, 8000, false), await server("/__test/login"));
  check("다시 '브라우저에서 Google 로그인을 끝내세요'가 보인다", await waitFor(async () => (await syncText()).includes("브라우저에서 Google 로그인을 끝내세요")), await syncText());
  await server("/__test/cancel-login");
  check("새로고침이 끝나면 알림이 '로그인이 끝나지 않았습니다'다", await waitFor(async () => (await js(`window.__toasts`)).some((t) => t.includes("로그인이 끝나지 않았습니다")), 8000, false), await js(`window.__toasts`));
  check("새로고침 버튼이 다시 눌리는 상태로 돌아온다", await waitFor(async () => !(await js(`document.getElementById("sync-refresh").disabled`)), 8000, false));
  check("오른쪽 위는 다시 'Google 로그인 필요'", (await syncText()).includes("Google 로그인 필요"), await syncText());

  console.log("--- 새로고침 → 이번에는 로그인을 끝낸다 ---");
  await server("/__test/login-succeed");
  await js(`window.__toasts = []; document.getElementById("toast").textContent = ""; document.getElementById("sync-refresh").click()`);
  check("오른쪽 위가 'HH:MM 동기화'로 돌아온다", await waitFor(async () => /^\d{1,2}:\d{2} 동기화$/.test(await syncText()), 10000, false), await syncText());
  check("빨강·주황 표시가 꺼진다", !/offline|login-waiting/.test(await syncClass()), await syncClass());
  check("로그인이 끝나면 캘린더 목록을 새로 받는다 ('로그인 뒤 캘린더'가 보인다)", await waitFor(async () => (await calendarNames()).includes("로그인 뒤 캘린더"), 8000, false), await calendarNames());
  check("로그인 성공 뒤에는 인터넷·로그인 알림이 없다", !(await js(`window.__toasts`)).some((t) => /인터넷|로그인/.test(t)), await js(`window.__toasts`));
  check("자바스크립트 오류가 없다", jsErrors.length === 0, jsErrors.join(" | "));
}
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
