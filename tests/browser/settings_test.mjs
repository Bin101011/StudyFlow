// 설정 저장 화면 시험 (docs/review-2026-11.md의 M1, L2). 헤드리스 Edge를 CDP로 조종, 시험 서버 settings_server.py(5057번)
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
// 1) 켤 때 settings.json을 못 읽으면 알림이 나오고, 그 상태에서 설정을 바꿔도 진짜 설정을 기본값으로 덮지 않는다
// 2) 정상으로 켜면 설정 하나를 바꿔도 나머지(vault 경로 등)가 그대로다
// 3) 화면의 설정 저장이 실패해도, 만든 캘린더는 서버가 기록해서 다시 켠 뒤에도 "삭제"할 수 있다
// 4) settings.json이 깨졌으면 알림이 나오고 옛 파일이 옆에 남는다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const BASE = "http://127.0.0.1:5057";
const PORT = 9416;
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
const server = async (url, method = "GET", body) => { const r = await fetch(BASE + url, { method, body }); return r.json(); };
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(150); } return false; }

const fileText = async () => (await server("/__test/settings-file")).text;
const fileValues = async () => JSON.parse(await fileText());
// 실패했을 때 보여 줄 짧은 요약 (파일 전체는 너무 길다)
const brief = async () => { try { const v = await fileValues(); return JSON.stringify({ vaultPath: v.vaultPath, hidden: v.hiddenCalendarIds, created: v.createdCalendarIds, monthRows: v.monthRows, fontSize: v.fontSize }); } catch { return String(await fileText()).slice(0, 200); } };
const toasts = () => js(`window.__toasts`);
const monthRowsChecked = () => js(`document.querySelector('input[name="month-rows"]:checked') ? document.querySelector('input[name="month-rows"]:checked').value : null`);
// 처음 채워 둔 설정 중 지켜져야 하는 값들 (settings_server.py와 같다)
const MINE = { fontSize: 15, vaultPath: "C:\\시험\\vault", lastNote: "공부/영어.md", hiddenCalendarIds: ["holiday@test"], defaultCalendarId: "proj@test" };
const keptMine = (v) => Object.entries(MINE).every(([k, x]) => JSON.stringify(v[k]) === JSON.stringify(x));

// 페이지를 (다시) 열고 설정 불러오기가 끝날 때까지 기다린다
async function openPage() {
  await send("Page.navigate", { url: BASE + "/" });
  for (let i = 0; i < 60 && !(await js(`typeof settingsReady !== "undefined"`).catch(() => false)); i++) await sleep(150);
  await js(`settingsReady.then(() => true)`);
  await sleep(500);
}

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
  // 알림은 몇 초 뒤 사라지므로, 화면이 알림에 쓴 글자를 전부 기록해 둔다
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__toasts = [];
    new MutationObserver(() => { const t = document.getElementById("toast"); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); })
      .observe(document, { childList: true, subtree: true, characterData: true });` });

  const original = await fileText();
  check("시험 준비: 채워 둔 settings.json이 있다", original && keptMine(JSON.parse(original)), original);

  console.log("--- 1) 켤 때 settings.json을 못 읽음 → 설정을 바꿔도 덮지 않음 ---");
  await server("/__test/settings-lock/1");
  await openPage();
  await server("/__test/settings-lock/0");  // 잠깐 잡혀 있다가 풀린 상황 (예: 백신 검사, 동기화 프로그램)
  check("못 읽었다는 알림이 나온다", (await toasts()).some((t) => t.includes("설정을 불러오지 못해") && t.includes("settings.json")), await toasts());
  await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(500);
  await js(`window.__toasts = []; document.querySelector('input[name="month-rows"][value="7"]').click()`);
  await js(`document.getElementById("wrap-all-day-checkbox").click()`);
  await sleep(1500);
  check("설정을 바꿔도 settings.json은 처음 그대로다 (기본값으로 덮이지 않음)", (await fileText()) === original, await brief());
  check("저장하지 않았다는 알림이 나온다", (await toasts()).some((t) => t.includes("저장하지 않았습니다")), await toasts());

  console.log("--- 2) 정상으로 켜면 설정 하나만 바뀐다 ---");
  await openPage();
  check("다시 켜면 불러오기 실패 알림이 없다", !(await toasts()).some((t) => t.includes("불러오지 못해")), await toasts());
  check("vault 경로 칸에 저장된 경로가 보인다", (await js(`vaultPathInput.value`)) === MINE.vaultPath, await js(`vaultPathInput.value`));
  check("월간 줄 수는 저장된 6줄", (await monthRowsChecked()) === "6", await monthRowsChecked());
  await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(500);
  await js(`document.querySelector('input[name="month-rows"][value="7"]').click()`);
  check("7줄을 고르면 저장된다", await waitFor(async () => (await fileValues()).monthRows === 7), await brief());
  check("다른 설정(vault 경로, 숨긴 캘린더, 마지막 노트 등)은 그대로", keptMine(await fileValues()), await brief());

  console.log("--- 3) 화면의 설정 저장이 실패해도 만든 캘린더는 서버가 기록 ---");
  await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(1000);
  await server("/__test/settings-put-fail/1");
  await js(`document.getElementById("calendar-add-button").click()`); await sleep(300);
  await js(`calendarNameInput.value = "시험 캘린더"; calendarAddSave.click()`);
  check("캘린더 만들기 창이 닫힌다", await waitFor(async () => !(await js(`calendarAddDialog.open`)), 8000), await js(`calendarAddError.textContent`));
  const madeId = await waitFor(async () => (await js(`[...document.querySelectorAll("#calendar-list .calendar-name")].some((n) => n.textContent === "시험 캘린더")`)), 8000)
    ? (await (await fetch(BASE + "/api/calendars")).json()).find((c) => c.name === "시험 캘린더").id : null;
  check("목록에 새 캘린더가 보인다", !!madeId);
  await sleep(500);
  await server("/__test/settings-put-fail/0");
  check("settings.json에 새 캘린더가 'StudyFlow가 만든 것'으로 기록됐다", ((await fileValues()).createdCalendarIds || []).includes(madeId), await brief());
  check("기록할 때 다른 설정은 그대로", keptMine(await fileValues()) && (await fileValues()).createdCalendarIds.includes("made-old@test"), await brief());
  const removeTitle = () => js(`(() => { const n = [...document.querySelectorAll("#calendar-list .calendar-name")].find((x) => x.textContent === "시험 캘린더"); const b = n && n.parentElement.querySelector(".calendar-remove"); return b ? b.title : null; })()`);
  await openPage();
  await waitFor(async () => (await removeTitle()) !== null, 8000);
  check("다시 켠 뒤에도 그 캘린더의 ✕는 '삭제'다 (목록에서 빼기가 아님)", (await removeTitle()) === "이 캘린더 삭제", await removeTitle());

  console.log("--- 4) settings.json이 깨졌을 때 ---");
  const broken = '{"fontSize": 15, "vaultPath": "C:\\\\시';
  await server("/__test/settings-write", "POST", broken);
  await openPage();
  check("깨졌다는 알림이 나온다", (await toasts()).some((t) => t.includes("깨져")), await toasts());
  const copies = await server("/__test/settings-broken");
  check("옛 파일이 settings.broken-…json으로 남아 있다 (내용 그대로)", Object.values(copies).length === 1 && Object.values(copies)[0] === broken, copies);
  check("알림에 남겨 둔 파일 이름이 보인다", (await toasts()).some((t) => Object.keys(copies).some((name) => t.includes(name))), await toasts());
  check("화면은 기본값(6줄)으로 시작한다", (await monthRowsChecked()) === "6", await monthRowsChecked());
  await js(`document.querySelector('[data-tab="settings"]').click()`); await sleep(500);
  await js(`document.querySelector('input[name="month-rows"][value="7"]').click()`);
  check("그 뒤 설정 저장은 정상 (settings.json이 올바른 JSON이 됨)", await waitFor(async () => (await fileValues()).monthRows === 7), await brief());

  check("자바스크립트 오류가 없다", jsErrors.length === 0, jsErrors);
} catch (error) {
  check("시험이 중간에 멈추지 않는다", false, String(error && error.stack || error));
} finally {
  console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
  ws.close(); edge.kill();
  process.exit(failed ? 1 : 0);
}
