// credentials.json이 없을 때(처음 설치한 친구가 Google 설정을 하기 전) 화면이 진짜 이유를 알려 주는지 시험 (헤드리스 Edge를 CDP로 조종, 서버는 nocred_server.py)
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
// - 예전에는 "인터넷 연결을 확인하세요"만 떠서, 파일이 없는 것을 인터넷 탓으로 오해했다
// - 2026-11-23부터: Google은 설정 탭에서 연결한다. 캘린더 목록 칸에 오류 대신 "연결하기" 안내가 나오고, 알림이 뜨지 않는지,
//   설정 탭의 Google 칸에 앱 신분증 준비 안내가 보이고 파일 고르기(잘못된 파일 거절, 맞는 파일 저장)가 되는지, 다른 탭이 오류 없이 열리는지 본다
// - 설정 화면을 눈으로 보려면 NOCRED_SHOT_SETTINGS=<저장할 png 경로> 를 준다
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
  // 화면이 캘린더 목록을 받아 "연결하기" 안내를 그릴 때까지 기다린다
  let hint = "";
  for (let i = 0; i < 60; i++) { hint = (await js(`(document.querySelector("#calendar-list .calendar-connect-hint") || {}).textContent || ""`)); if (hint) break; await sleep(150); }
  await sleep(1500);

  console.log("--- 왼쪽 캘린더 목록 칸: 오류가 아니라 연결 안내 ---");
  check("캘린더 목록 칸에 'Google Calendar가 연결되지 않았습니다' 안내", hint.includes("연결되지 않았습니다"), hint);
  check("안내에 [설정에서 연결하기] 버튼", hint.includes("설정에서 연결하기"), hint);
  check("오류 문장(.calendar-list-error)은 없다", !(await js(`!!document.querySelector("#calendar-list .calendar-list-error")`)));
  check("오른쪽 위는 'Google 연결 안 됨'", (await js(`document.getElementById("sync-text").textContent`)) === "Google 연결 안 됨", await js(`document.getElementById("sync-text").textContent`));

  console.log("--- 알림(토스트): Google이 없다고 오류 알림을 띄우지 않는다 ---");
  const toasts = await js(`window.__toasts`);
  check("'불러오지 못했습니다' 알림이 없다", !toasts.some((t) => t.includes("불러오지 못했습니다")), toasts);
  check("알림 어디에도 '인터넷 연결을 확인하세요'가 없다", !toasts.some((t) => t.includes("인터넷 연결")), toasts);

  console.log("--- [설정에서 연결하기] → 설정 탭의 Google 칸: 앱 신분증 준비 안내 ---");
  await js(`document.querySelector("#calendar-list .calendar-connect-hint button").click()`);
  check("설정 탭이 열린다", await js(`document.getElementById("settings").classList.contains("active")`));
  const statusText = () => js(`document.getElementById("google-status-text").textContent`);
  for (let i = 0; i < 30 && (await statusText()) === "확인 중..."; i++) await sleep(150);
  check("상태: '연결 안 됨 · Google 없이 쓰는 중'", (await statusText()) === "연결 안 됨 · Google 없이 쓰는 중", await statusText());
  check("앱 신분증 준비 안내(단계 목록)가 보인다", await js(`!document.getElementById("google-client-setup").hidden && document.querySelectorAll(".google-steps li").length === 7`));
  const links = await js(`Array.from(document.querySelectorAll("[data-google-link]")).map((b) => b.dataset.googleLink)`);
  check("[열기] 버튼 6개가 모두 Google Cloud Console 주소", links.length === 6 && links.every((u) => u.startsWith("https://console.cloud.google.com/")), links);
  check("[credentials.json 고르기]가 눈에 띄는 버튼(primary)", await js(`!document.getElementById("google-client-pick").hidden && document.getElementById("google-client-pick").classList.contains("primary")`));
  check("신분증이 없으니 [연결하기]는 눌리지 않는다", await js(`!document.getElementById("google-connect").hidden && document.getElementById("google-connect").disabled`));
  check("[연결 끊기]는 없다", await js(`document.getElementById("google-disconnect").hidden`));
  if (process.env.NOCRED_SHOT_SETTINGS) {
    await js(`document.getElementById("google-section").scrollIntoView()`); await sleep(300);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(process.env.NOCRED_SHOT_SETTINGS, Buffer.from(shot.result.data, "base64"));
    console.log("   설정 화면을 저장했습니다:", process.env.NOCRED_SHOT_SETTINGS);
  }

  console.log("--- 파일 고르기: 잘못된 파일은 이유와 함께 거절, 맞는 파일은 저장 ---");
  // 파일 선택 창 대신 CDP로 파일 칸에 직접 파일을 넣는다 (사람이 창에서 고른 것과 같은 change 이벤트가 난다)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nocred_files_"));
  const webFile = path.join(dir, "client_secret_web.json");
  fs.writeFileSync(webFile, JSON.stringify({ web: { client_id: "x.apps.googleusercontent.com", client_secret: "y" } }));
  const goodFile = path.join(dir, "client_secret_123.apps.googleusercontent.com.json");
  fs.writeFileSync(goodFile, JSON.stringify({ installed: { client_id: "test.apps.googleusercontent.com", project_id: "t", client_secret: "s",
    auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: "https://oauth2.googleapis.com/token", redirect_uris: ["http://localhost"] } }));
  async function pickFile(file) {
    const doc = await send("DOM.getDocument", {});
    const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#google-client-input" });
    await send("DOM.setFileInputFiles", { files: [file], nodeId: node.result.nodeId });
  }
  await js(`window.__toasts = []`);
  await pickFile(webFile);
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = (await js(`window.__toasts`)).some((t) => t.includes("데스크톱 앱")); await sleep(150); }
  check("웹 애플리케이션 유형은 '데스크톱 앱으로 다시' 안내와 함께 거절", ok, await js(`window.__toasts`));
  check("거절된 뒤에도 [연결하기]는 눌리지 않는다", await js(`document.getElementById("google-connect").disabled`));
  await js(`window.__toasts = []`);
  await pickFile(goodFile);
  ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = (await js(`window.__toasts`)).some((t) => t.includes("앱 신분증을 저장했습니다")); await sleep(150); }
  check("맞는 파일(이름이 client_secret_….json이어도 됨)은 저장했다는 알림", ok, await js(`window.__toasts`));
  check("저장 뒤 준비 안내는 숨기고 [연결하기]가 눌린다", await js(`document.getElementById("google-client-setup").hidden && !document.getElementById("google-connect").disabled`));
  check("고르기 버튼은 '다른 credentials.json 고르기…'로 바뀐다", (await js(`document.getElementById("google-client-pick").textContent`)) === "다른 credentials.json 고르기…");
  check("안내: '[연결하기]를 누르면 브라우저에서…'", (await js(`document.getElementById("google-note").textContent`)).includes("[연결하기]를 누르면"));
  // [연결하기]는 누르지 않는다: 이 시험 서버는 진짜 로그인 코드라서 진짜 브라우저가 열린다 (연결 흐름은 login_test가 본다)

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
