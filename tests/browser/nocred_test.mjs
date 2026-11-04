// credentials.json이 없을 때(처음 설치한 친구가 Google 설정을 하기 전) 화면이 진짜 이유를 알려 주는지 시험 (헤드리스 Edge를 CDP로 조종, 서버는 nocred_server.py)
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
// - 예전에는 "인터넷 연결을 확인하세요"만 떠서, 파일이 없는 것을 인터넷 탓으로 오해했다
// - 왼쪽 캘린더 목록 칸(사라지지 않는다)과 알림(4초 뒤 사라진다)에 파일 안내가 나오는지, 다른 탭이 오류 없이 열리는지 본다
// - 화면 모양을 눈으로 보려면 NOCRED_SHOT=<저장할 png 경로> 를 주고 돌린다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const BASE = "http://127.0.0.1:5057";
const PORT = 9413;
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "edge_t_"))}`, "--window-size=1400,900", "--no-first-run", "--disable-extensions", "--disable-component-extensions-with-background-pages", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") { const s = JSON.stringify(d.params.exceptionDetails); if (!/chrome-extension|Receiving end does not exist/.test(s)) jsErrors.push(s.slice(0, 500)); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("시간 초과: " + method)); } }, 20000); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
const T0 = Date.now(); let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(((Date.now() - T0) / 1000).toFixed(0) + "s " + (ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  [" + (typeof x === "string" ? x : JSON.stringify(x)) + "]")); };

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
  // 화면이 일정과 캘린더 목록을 요청하고 실패하는 것을 기다린다
  let listError = "";
  for (let i = 0; i < 60; i++) { listError = (await js(`(document.querySelector("#calendar-list .calendar-list-error") || {}).textContent || ""`)); if (listError) break; await sleep(150); }
  await sleep(1500);

  console.log("--- 왼쪽 캘린더 목록 칸 ---");
  check("캘린더 목록 칸에 오류 문장이 떠 있다", listError.length > 0);
  check("그 문장이 credentials.json 파일 안내다", listError.includes("credentials.json") && listError.includes("README"), listError);
  check("'인터넷 연결을 확인하세요'가 아니다", !listError.includes("인터넷 연결"), listError);

  console.log("--- 알림(토스트) ---");
  const toasts = await js(`window.__toasts`);
  check("일정을 못 불러왔다는 알림에도 credentials.json 안내가 들어 있다", toasts.some((t) => t.includes("일정을 불러오지 못했습니다") && t.includes("credentials.json")), toasts);
  check("알림 어디에도 '인터넷 연결을 확인하세요'가 없다", !toasts.some((t) => t.includes("인터넷 연결")), toasts);

  console.log("--- Google 없이도 앱이 멀쩡하다 ---");
  const tabs = await js(`Array.from(document.querySelectorAll("[data-tab]")).map((b) => b.dataset.tab)`);
  check("탭 버튼이 6개 있다", tabs.length === 6, tabs);
  for (const tab of tabs) {
    await js(`document.querySelector('[data-tab="${tab}"]').click()`); await sleep(600);
  }
  check("모든 탭을 눌러도 자바스크립트 오류가 없다", jsErrors.length === 0, jsErrors.join(" | "));
  console.log("   (참고) 동기화 표시 글자:", JSON.stringify(await js(`document.getElementById("sync-text").textContent`)));

  // 눈으로 보고 싶을 때: 캘린더 탭으로 돌아가 화면을 저장한다
  if (process.env.NOCRED_SHOT) {
    await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(800);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(process.env.NOCRED_SHOT, Buffer.from(shot.result.data, "base64"));
    console.log("   화면을 저장했습니다:", process.env.NOCRED_SHOT);
  }
}
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
