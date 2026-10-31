// 일정 메모 / 하루 메모 화면 테스트 (헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번)
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9388;
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "edge_m_"))}`, "--window-size=1400,900", "--no-first-run", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const jsErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") { const s = JSON.stringify(d.params.exceptionDetails); if (!/chrome-extension|Receiving end does not exist/.test(s)) jsErrors.push(s.slice(0, 400)); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error("시간 초과: " + method)); } }, 20000); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
const shot = async (name) => { if (!outDir) return; const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64")); };
const type = (text) => send("Input.insertText", { text });
const T0 = Date.now(); let failed = 0;
const check = (n, ok, x = "") => { if (!ok) failed++; console.log(((Date.now() - T0) / 1000).toFixed(0) + "s " + (ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  [" + (typeof x === "string" ? x : JSON.stringify(x)) + "]")); };
const api = async (url, method = "GET", body) => { const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };
const state = async () => (await api("/__test/state")).data;
const memoOf = async (title) => { const s = await state(); const k = Object.keys(s.events).find((x) => x.startsWith(title + "|")); return k ? s.events[k].description : undefined; };

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
// 서버가 막 떠서 첫 요청이 느릴 수 있으니, 일정 줄이 나타날 때까지 최대 15초 기다린다
for (let i = 0; i < 30; i++) { if ((await js(`document.querySelectorAll("#timeline-grid .tl-event").length`)) > 0) break; await sleep(500); }
await sleep(300);

const htmlBefore = await memoOf("HTML 설명 일정");
// ===== E. 캘린더 탭: 툴팁 / 수정 창 / 복사 =====
console.log("--- E. 캘린더 탭 ---");
await js(`document.querySelector('[data-tab="calendar"]').click()`); await sleep(2500);
const tip = await js(`(() => { const e = calendar.getEvents().find(x => x.title === "학생회 팀장 회의"); return describeEvent(e); })()`);
check("툴팁(describeEvent)에 메모가 붙는다", /학생회 팀장 회의\n\n가져갈 물품/.test(tip), tip);
const domTip = await js(`(() => { const el = [...document.querySelectorAll(".fc-event")].find(x => (x.title || "").includes("학생회")); return el ? el.title : null; })()`);
check("달력 위 일정에 마우스를 올리면 메모가 툴팁으로 뜬다(title 속성)", domTip && domTip.includes("가져갈 물품"), domTip);

// 수정 창: 메모 칸이 채워지고, 고치면 저장
await js(`openEditDialog({ event: calendar.getEvents().find(x => x.title === "학생회 팀장 회의") })`);
await sleep(300);
const dlgMemo = await js(`document.getElementById("event-memo").value`);
check("수정 창의 메모 칸에 기존 메모가 들어 있다", dlgMemo === "가져갈 물품: 노트북, 포스터 2장\n3 < 5 이고 a<b", dlgMemo);
await shot("e_dialog.png");
await js(`document.getElementById("event-memo").value = "수정 창에서 바꾼 메모"`);
await js(`document.getElementById("event-save").click()`); await sleep(1500);
check("수정 창에서 메모를 바꾸면 저장된다", (await memoOf("학생회 팀장 회의")) === "수정 창에서 바꾼 메모", await memoOf("학생회 팀장 회의"));

// 메모를 안 건드리고 저장하면 description을 보내지 않는다
const before = (await state()).patches.length;
await js(`openEditDialog({ event: calendar.getEvents().find(x => x.title === "HTML 설명 일정") })`); await sleep(300);
await js(`document.getElementById("event-title").value = "HTML 설명 일정"; document.getElementById("event-save").click()`); await sleep(1500);
const patches = (await state()).patches.slice(before);
check("메모를 안 고치고 저장하면 description을 보내지 않는다 (HTML 서식 보존)", patches.length === 1 && patches[0].description === null && (await memoOf("HTML 설명 일정")) === htmlBefore, patches);

// 새 일정 + 메모
await js(`showEventDialog({ title: "", allDay: false, startDate: toDateText(new Date()), startTime: "20:00", endDate: toDateText(new Date()), endTime: "21:00" })`);
await sleep(200);
check("새 일정 창의 메모 칸은 비어 있다", (await js(`document.getElementById("event-memo").value`)) === "");
await js(`document.getElementById("event-title").value = "새 일정"; document.getElementById("event-memo").value = "새로 만들면서 쓴 메모"; document.getElementById("event-save").click()`); await sleep(1500);
check("새 일정을 메모와 함께 만든다", (await memoOf("새 일정")) === "새로 만들면서 쓴 메모", await memoOf("새 일정"));

// 복사/붙여넣기
const tomorrow = await js(`addDaysToText(toDateText(new Date()), 1)`);
await js(`hoveredEvent = calendar.getEvents().find(x => x.title === "학생회 팀장 회의"); copyHoveredEvent(); hoveredDate = ${JSON.stringify(tomorrow)};`);
await js(`pasteCopiedEvent()`); await sleep(1500);
const st = await state();
const copies = Object.entries(st.events).filter(([k, v]) => k.startsWith("학생회 팀장 회의|") && v.start.dateTime && v.start.dateTime.startsWith(tomorrow));
check("복사해 붙여넣은 일정에도 메모가 따라간다", copies.length === 1 && copies[0][1].description === "수정 창에서 바꾼 메모", copies);

// 드래그(시간 변경)는 메모를 건드리지 않는다
const tp = await api("/api/events/" + st.events["학생회 팀장 회의|me@test"].id, "PATCH", { calendarId: "me@test", allDay: false, start: `${tomorrow}T17:00:00+09:00`, end: `${tomorrow}T18:00:00+09:00` });
check("시간만 고치는 요청(드래그)은 메모를 그대로 둔다", tp.status === 200 && (await memoOf("학생회 팀장 회의")) === "수정 창에서 바꾼 메모");

// ===== F. 서버 입력 검사 =====
console.log("--- F. 서버 검사 ---");
const id1 = st.events["학생회 팀장 회의|me@test"].id;
check("PATCH: 고칠 내용이 없으면 400", (await api("/api/events/" + id1, "PATCH", { calendarId: "me@test" })).status === 400);
check("PATCH: 시간 일부만 보내면 400", (await api("/api/events/" + id1, "PATCH", { calendarId: "me@test", start: "2026-10-28T10:00" })).status === 400);
check("PATCH: 메모가 글자가 아니면 400", (await api("/api/events/" + id1, "PATCH", { calendarId: "me@test", description: 5 })).status === 400);
check("PATCH: 메모가 너무 길면 400", (await api("/api/events/" + id1, "PATCH", { calendarId: "me@test", description: "가".repeat(8001) })).status === 400);
check("POST: 메모가 너무 길면 400", (await api("/api/events", "POST", { calendarId: "me@test", title: "x", allDay: true, start: "2026-10-30", end: "2026-10-31", description: "가".repeat(8001) })).status === 400);
check("메모는 8000자까지 허용", (await api("/api/events/" + id1, "PATCH", { calendarId: "me@test", description: "가".repeat(8000) })).status === 200);
await api("/api/events/" + id1, "PATCH", { calendarId: "me@test", description: "수정 창에서 바꾼 메모" });

// ===== G. 하루 메모 =====
console.log("--- G. 하루 메모 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(2000);
const today = await js(`viewedDate`);
const DM = `document.getElementById("day-memo")`;
check("하루 메모 칸이 열려 있다(불러온 뒤 활성)", (await js(`${DM}.disabled`)) === false && (await js(`${DM}.value`)) === "");
await js(`${DM}.focus()`);
await type("오늘 장볼 것: 우유\n계란");
check("입력 중 상태 글자", (await js(`document.getElementById("day-memo-status").textContent`)) === "수정 중…");
await sleep(1900);
check("입력을 멈추고 1초 뒤 저장 + '저장됨'", (await api("/api/day-memo?date=" + today)).data.content === "오늘 장볼 것: 우유\n계란" && (await js(`document.getElementById("day-memo-status").textContent`)) === "저장됨");
await shot("g_daymemo.png");

// 새로 불러와도 남아 있다 (DB에 저장됨)
await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(2000);
check("새로고침해도 하루 메모가 남아 있다", (await js(`${DM}.value`)) === "오늘 장볼 것: 우유\n계란");

// 쓰자마자 날짜를 넘겨도 저장된다
await js(`${DM}.focus()`);
await type("\n추가한 줄");
await js(`document.getElementById("day-next").click()`);   // 1초를 기다리지 않고 바로 다음 날로
await sleep(1200);
const tomorrowText = await js(`viewedDate`);
check("쓰자마자 날짜를 넘겨도 원래 날짜에 저장된다", (await api("/api/day-memo?date=" + today)).data.content === "오늘 장볼 것: 우유\n계란\n추가한 줄", (await api("/api/day-memo?date=" + today)).data);
check("다음 날의 메모 칸은 비어 있다", (await js(`${DM}.value`)) === "" && (await js(`${DM}.disabled`)) === false);
// 다음 날에 쓰고 빠르게 앞뒤로 넘기기
await js(`${DM}.focus()`);
await type("내일 메모");
await js(`document.getElementById("day-prev").click(); document.getElementById("day-next").click();`);
await sleep(1500);
check("빠르게 앞뒤로 넘겨도 내일 메모가 저장되고 다시 보인다", (await api("/api/day-memo?date=" + tomorrowText)).data.content === "내일 메모" && (await js(`${DM}.value`)) === "내일 메모", { api: (await api("/api/day-memo?date=" + tomorrowText)).data, ui: await js(`${DM}.value`) });
// 방향키는 글자 이동에만 쓰이고 날짜를 넘기지 않는다
await js(`${DM}.focus()`);
await js(`${DM}.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))`);
await sleep(300);
check("메모 칸에서 ←/→ 키는 날짜를 넘기지 않는다", (await js(`viewedDate`)) === tomorrowText);
// 비우면 지워진다
await js(`${DM}.value = ""; ${DM}.dispatchEvent(new Event("input", { bubbles: true })); ${DM}.blur();`);
await sleep(800);
check("모두 지우면 메모가 삭제된다", (await api("/api/day-memo?date=" + tomorrowText)).data.content === "");

// 서버 검사
check("day-memo: 잘못된 날짜 GET 400", (await api("/api/day-memo?date=abc")).status === 400);
check("day-memo: 잘못된 날짜 PUT 400", (await api("/api/day-memo", "PUT", { date: "2026-13-40", content: "x" })).status === 400);
check("day-memo: content가 글자가 아니면 400", (await api("/api/day-memo", "PUT", { date: today, content: 5 })).status === 400);
check("day-memo: 너무 길면 400", (await api("/api/day-memo", "PUT", { date: today, content: "가".repeat(20001) })).status === 400);
check("day-memo: content 없으면 400", (await api("/api/day-memo", "PUT", { date: today })).status === 400);
check("day-memo: 공백뿐인 내용은 지움", (await api("/api/day-memo", "PUT", { date: "2026-12-25", content: "  \n " })).status === 200 && (await api("/api/day-memo?date=2026-12-25")).data.content === "");

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
