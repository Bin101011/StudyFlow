// 창을 닫기 직전에 쓴 글이 저장되는지(docs/review-2026-11.md의 N30), 화면 쪽을 확인한다 (헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번)
// main.py의 close_guard가 부르는 prepareToClose를 직접 불러, 입력 칸마다 저장 대기 중인 글이 서버에 도착하는지 본다. 파이썬 쪽 순서는 tests/test_close_guard.py가 본다
// 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9421;
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

async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; }
const rule = (q) => api("/__test/rule" + (q ? "?" + q : ""));
// 파이썬(close_guard)처럼 닫기 전 절차를 그대로 밟는다: 저장을 시키고, 쓰기 수가 0으로 0.1초 머물 때까지 기다린다
async function closeLikePython(limitMs = 6000) {
  await js(`prepareToClose()`);
  const started = Date.now(); let quietSince = null;
  while (Date.now() - started < limitMs) {
    const pending = await js(`pendingWrites`);
    if (pending > 0) quietSince = null;
    else if (quietSince === null) quietSince = Date.now();
    else if (Date.now() - quietSince >= 100) return Date.now() - started;
    await sleep(20);
  }
  return null;
}

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "studyflow_vault_"));
fs.writeFileSync(path.join(vault, "닫기.md"), "처음 내용\n", "utf8");
const readNote = () => fs.readFileSync(path.join(vault, "닫기.md"), "utf8");

try {
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
const current = (await api("/api/settings")).data.values;
await api("/api/settings", "PUT", { ...current, vaultPath: vault });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0, 15000);
await sleep(500);
const today = await js(`viewedDate`);
const memoOnServer = async () => (await api("/api/day-memo?date=" + today)).data.content;

console.log("--- 쓰기 요청 세기 ---");
await sleep(500);
check("(준비) prepareToClose가 있다", (await js(`typeof prepareToClose`)) === "function");
check("시작할 때 쓰기 수는 0이다", (await js(`pendingWrites`)) === 0, await js(`String(pendingWrites)`));
await rule(`method=GET&path=/api/settings&ms=500&count=1`);
const getCount = await js(`(async () => { const p = fetch("/api/settings"); const during = pendingWrites; await p; return during; })()`);
check("읽기 요청(GET)은 세지 않는다", getCount === 0, getCount);
await rule(`method=PUT&path=/api/day-memo&ms=500&count=1`);
const during = JSON.parse(await js(`(async () => { const p = fetch("/api/day-memo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2020-01-01", content: "세기" }) }); const d = pendingWrites; const r = await p; const body = await r.json(); return JSON.stringify({ d, after: pendingWrites, ok: r.ok, isResponse: r instanceof Response, body }); })()`));
check("쓰기 요청은 끝날 때까지 센다", during.d === 1 && during.after === 0, during);
check("fetch의 결과(Response)는 그대로 돌려준다", during.ok && during.isResponse, during);
await rule(`method=PUT&path=/api/day-memo&ms=100&status=502&count=1`);
const failed502 = JSON.parse(await js(`(async () => { const r = await fetch("/api/day-memo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" }); return JSON.stringify({ status: r.status, after: pendingWrites }); })()`));
check("실패 응답이어도 수가 줄어든다", failed502.status === 502 && failed502.after === 0, failed502);
const rejected = JSON.parse(await js(`(async () => { let error = null; try { await fetch("http://127.0.0.1:9/nowhere", { method: "POST" }); } catch (e) { error = e.name; } return JSON.stringify({ error, after: pendingWrites }); })()`));
check("요청 자체가 실패해도(연결 안 됨) 오류를 그대로 전하고 수가 줄어든다", rejected.error === "TypeError" && rejected.after === 0, rejected);

console.log("--- 하루 메모 ---");
await js(`dayMemoInput.focus()`); await type("닫기 직전 하루 메모");
check("(준비) 아직 서버에 없다 (저장 대기 중)", (await memoOnServer()) !== "닫기 직전 하루 메모");
const took = await closeLikePython();
check("저장 대기 중인 하루 메모가 서버에 저장된다", (await memoOnServer()) === "닫기 직전 하루 메모", await memoOnServer());
check("0.5초 안에 끝난다", took !== null && took < 500, took);

await js(`dayMemoInput.focus()`); await type(" 그리고 더");
await rule(`method=PUT&path=/api/day-memo&ms=800&count=1`);
await js(`prepareToClose()`);
check("저장이 느리면 그동안 쓰기 수가 남아 있다 (닫기를 기다린다)", (await js(`pendingWrites`)) >= 1);
const slow = await closeLikePython();
check("느린 저장도 끝난 뒤에야 수가 0이 된다", slow !== null && (await memoOnServer()) === "닫기 직전 하루 메모 그리고 더", await memoOnServer());
await rule();

// 칸을 벗어나서 저장하는 것과 다른 길: 커서가 칸에 없어도 저장 대기(또는 실패 뒤 다시 시도 대기) 중이면 저장한다
await js(`dayMemoInput.blur()`); await sleep(300);
await js(`dayMemoInput.value = "커서 없이 대기 중인 메모"; dayMemoInput.dispatchEvent(new Event("input"))`);
await closeLikePython();
check("커서가 칸에 없어도 저장 대기 중인 하루 메모가 저장된다", (await memoOnServer()) === "커서 없이 대기 중인 메모", await memoOnServer());

console.log("--- 입력 칸에 쓰는 중 (포커스가 남아 있는 칸은 벗어나게 해서 저장한다) ---");
const projectId = (await api("/api/projects", "POST", { name: "닫기 카드" })).data.id;
await api("/api/tasks", "POST", { content: "이름 고칠 단계", projectId });
await api("/api/tasks", "POST", { content: "메모 쓸 할 일", date: today });
await js(`document.querySelector('[data-tab="projects"]').click()`); await sleep(900);
const card = `document.querySelector('.project-card[data-project-id="${projectId}"]')`;
await js(`(() => { const c = ${card}; (c.querySelector(".project-memo") || c.querySelector(".project-memo-add")).click(); })()`);
await type("닫기 직전 프로젝트 메모");
await closeLikePython();
const project = () => api("/api/projects").then((r) => r.data.find((p) => p.id === projectId));
check("쓰는 중인 프로젝트 메모가 저장된다", (await project()).memo === "닫기 직전 프로젝트 메모", (await project()).memo);

await js(`(() => { const row = [...${card}.querySelectorAll(".task-row")].find((l) => l.querySelector(".task-content").textContent === "이름 고칠 단계"); row.querySelector(".task-content").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
await sleep(100);
await js(`document.execCommand("selectAll")`); await type("고친 단계 이름");
await closeLikePython();
await sleep(300);
const stepNames = (await js(`[...${card}.querySelectorAll(".task-row .task-content")].map((e) => e.textContent).join("|")`));
check("고치는 중인 단계 이름이 저장된다", stepNames.includes("고친 단계 이름"), stepNames);

await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1200);
await js(`(() => { const row = [...document.querySelectorAll("#today-tasks .task-row")].find((l) => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === "메모 쓸 할 일"); row.querySelector(".task-memo-button").click(); })()`);
await type("닫기 직전 할 일 메모");
await closeLikePython();
const taskMemo = (await api("/api/tasks?date=" + today)).data.tasks.find((t) => t.content === "메모 쓸 할 일").memo;
check("쓰는 중인 할 일 메모가 저장된다", taskMemo === "닫기 직전 할 일 메모", taskMemo);

await js(`(() => { const b = [...document.querySelectorAll("#timeline-grid .tl-event")].find((x) => /메모 없는/.test(x.textContent)); b.click(); })()`);
check("(준비) 일정의 작은 창이 열렸다", await waitFor(() => js(`!!document.getElementById("tl-pop-memo")`)));
await js(`document.getElementById("tl-pop-memo").focus()`); await type("닫기 직전 일정 메모");
await closeLikePython();
const state = (await api("/__test/state")).data.events["메모 없는 일정|me@test"];
check("쓰는 중인 일정 메모(작은 창)가 저장되고 창이 닫힌다", state.description === "닫기 직전 일정 메모" && !(await js(`!!document.getElementById("tl-pop-memo")`)), state);

console.log("--- 노트 ---");
await js(`document.querySelector('[data-tab="notes"]').click()`); await sleep(1200);
await js(`openNote("닫기.md")`);
check("(준비) 노트를 열었다", await waitFor(() => js(`note.path === "닫기.md"`)));
await sleep(300);
await js(`notesText.value = "닫기 직전 노트"; notesText.dispatchEvent(new Event("input"))`);
await closeLikePython();
check("저장 대기 중인 노트가 저장된다", readNote() === "닫기 직전 노트", readNote());

// keepalive 요청은 내용이 64KB를 넘으면 브라우저가 거절한다. 닫기 전 저장은 창을 열어 둔 채 하므로 큰 노트도 저장되어야 한다
const big = "큰 노트 ".repeat(9000);
await js(`notesText.value = ${JSON.stringify(big)}; notesText.dispatchEvent(new Event("input"))`);
await closeLikePython();
check("큰 노트(64KB 넘음)도 저장된다", readNote() === big, readNote().length);

await rule(`method=PUT&path=/api/notes/content&ms=500&count=1`);
await js(`notesText.value = "앞 저장"; notesText.dispatchEvent(new Event("input")); saveNote(); notesText.value = "앞 저장 뒤에 더 쓴 글"; notesText.dispatchEvent(new Event("input"))`);
await closeLikePython();
check("저장하는 중에 더 쓴 글은 앞 저장이 끝난 뒤 이어서 저장된다", readNote() === "앞 저장 뒤에 더 쓴 글", readNote());
await rule();

await js(`note.conflict = true; note.dirty = true; notesText.value = "충돌 때 쓴 글"`);
await closeLikePython();
check("충돌 중인 노트는 덮어쓰지 않는다", readNote() === "앞 저장 뒤에 더 쓴 글", readNote());
await js(`note.conflict = false; note.dirty = false`);

console.log("--- 남은 것이 없을 때, 오류가 날 때 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1800);
await js(`window.__writes = 0; { const f = window.fetch; window.fetch = function (u, o) { if (o && o.method && o.method !== "GET") window.__writes++; return f.apply(window, arguments); }; } 0`);
await closeLikePython();
check("쓸 것이 없으면 아무 요청도 보내지 않는다", (await js(`window.__writes`)) === 0, await js(`window.__writes`));

await js(`window.closeTimelinePopover = function () { throw new Error("시험용 오류"); }`);
await js(`dayMemoInput.focus()`); await type(" 오류 뒤에도");
const threw = await js(`(() => { try { prepareToClose(); return "ok"; } catch (e) { return e.message; } })()`);
await closeLikePython();
check("중간 단계가 오류를 내도 멈추지 않고 나머지를 저장한다", threw === "ok" && (await memoOnServer()).endsWith("오류 뒤에도"), threw);

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
} finally {
  fs.rmSync(vault, { recursive: true, force: true });
}
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
