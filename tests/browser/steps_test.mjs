// 오늘 탭 시간표 테스트 (헤드리스 Edge를 CDP로 조종, 실제 마우스/키보드 입력, 가짜 Google 서버 5057번)
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

console.log("--- 프로젝트 단계 순서 ---");
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card").length`)) > 0, 15000);
await sleep(600);
const NAME = "정렬 프로젝트";
const card = `[...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name").textContent === ${JSON.stringify(NAME)})`;
const topRows = `${card}.querySelectorAll(":scope > ul.today-list > li.task-row")`;
const tops = async () => js(`[...${topRows}].map(r => r.querySelector(".task-content").textContent)`);
const kids = async (parent) => js(`(() => { const top = [...${topRows}].find(r => r.querySelector(".task-content").textContent === ${JSON.stringify(parent)}); const w = top.nextElementSibling; return w && w.classList.contains("sub-wrapper") ? [...w.querySelectorAll("li.task-row")].map(r => r.querySelector(".task-content").textContent) : []; })()`);
const apiTops = async () => { const p = (await api("/api/projects")).data.find((x) => x.name === NAME); return p.tasks.map((s) => s.content); };
const apiKids = async (parent) => { const p = (await api("/api/projects")).data.find((x) => x.name === NAME); const s = p.tasks.find((x) => x.content === parent); return s.children.map((c) => c.content); };
await js(`${card}.scrollIntoView({ block: "start" })`); await sleep(300);
const hoverCard = async () => { const r = await js(`(() => { const b = ${card}.getBoundingClientRect(); return { x: b.right - 12, y: Math.min(Math.max(b.top + 40, 80), b.bottom - 20, innerHeight - 80) }; })()`); await mouse("mouseMoved", r.x, r.y, 0); await sleep(200); };
const rowPair = async (a, b) => {
  await hoverCard();
  await js(`[...${card}.querySelectorAll("li.task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(a)}).scrollIntoView({ block: "center" })`);
  await sleep(250);
  return b === undefined ? [await rowPos0(a)] : [await rowPos0(a), await rowPos0(b)];
};
const rowPos = async (title) => (await rowPair(title))[0];
const rowPos0 = (title) => js(`(() => { const r = [...${card}.querySelectorAll("li.task-row")].find(l => l.querySelector(".task-content").textContent === ${JSON.stringify(title)}); const c = r.querySelector(".task-content").getBoundingClientRect(); const b = r.getBoundingClientRect(); return { x: c.left + 20, y: c.top + c.height / 2, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; })()`);
const reloadProjects = async () => { await js(`loadProjects()`); await sleep(900); await js(`${card}.scrollIntoView({ block: "start" })`); await sleep(300); };
const lineInfo = () => js(`(() => { const l = ${card}.querySelector(".task-drop-line"); if (!l) return null; const r = l.getBoundingClientRect(); return { top: r.top, parent: l.parentElement.className }; })()`);

const D_TOPS = ["라 하위 있음 11/01", "다 11/05", "나 12/10", "가 마감 없음", "마 끝낸 단계"];
check("처음 순서: 마감일 빠른 순, 마감일 없는 것은 뒤, 끝낸 단계는 맨 아래", JSON.stringify(await tops()) === JSON.stringify(D_TOPS), await tops());
check("하위 단계도 마감일 순(11/20, 12/01, 없음)", JSON.stringify(await kids("라 하위 있음 11/01")) === JSON.stringify(["라-2 11/20", "라-1 12/01", "라-3 마감 없음"]), await kids("라 하위 있음 11/01"));
const draggable = JSON.parse(await js(`JSON.stringify([...${card}.querySelectorAll("li.task-row")].map(r => [r.querySelector(".task-content").textContent, r.classList.contains("task-draggable")]))`));
check("끝낸 단계만 끌 수 없고 나머지(맨 위/하위 단계)는 끌 수 있다", draggable.every(([t, d]) => d === !t.startsWith("마 ")), draggable);

// 1. 맨 아래 열린 단계("가")를 맨 위로
let [g, top] = await rowPair("가 마감 없음", "라 하위 있음 11/01");
await mouse("mouseMoved", g.x, g.y, 0); await mouse("mousePressed", g.x, g.y);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", g.x, g.y + (top.top + 3 - g.y) * i / 8, 1);
await sleep(200);
const ln = await lineInfo();
check("끄는 동안 맨 위 줄 위쪽에 파란 줄이 보인다", ln && Math.abs(ln.top - top.top) <= 3, [ln, top]);
check("끌고 있는 줄은 흐려지고 이름표(ghost)가 따라다닌다", await js(`!!document.querySelector(".task-ghost") && document.querySelector(".drag-source") !== null`));
await shot("st_drag.png");
await mouse("mouseReleased", g.x, top.top + 3);
check("놓으면 순서가 바뀐다: 가가 맨 위, 끝낸 단계는 그대로 맨 아래", await waitFor(async () => JSON.stringify(await tops()) === JSON.stringify(["가 마감 없음", "라 하위 있음 11/01", "다 11/05", "나 12/10", "마 끝낸 단계"]), 4000), await tops());
check("서버에 저장됐다", JSON.stringify(await apiTops()) === JSON.stringify(await tops()), [await apiTops(), await tops()]);
check("놓고 나면 파란 줄과 끌기 표시가 사라진다", await js(`!document.querySelector(".task-drop-line") && !document.querySelector(".task-ghost") && !document.querySelector(".drag-source")`));
await reloadProjects();
check("다시 불러와도 순서가 유지된다", (await tops())[0] === "가 마감 없음" && JSON.stringify(await tops()) === JSON.stringify(await apiTops()), await tops());

// 2. 하위 단계가 있는 단계("라")를 아래로: 하위 단계 묶음이 같이 따라간다
let [ra, na] = await rowPair("라 하위 있음 11/01", "나 12/10");
await drag(ra.x, ra.y, ra.x, na.bottom + 6, 10);
check("하위 단계가 있는 단계를 '나' 아래로 옮기면 그 순서가 된다", await waitFor(async () => JSON.stringify(await tops()) === JSON.stringify(["가 마감 없음", "다 11/05", "나 12/10", "라 하위 있음 11/01", "마 끝낸 단계"]), 4000), await tops());
check("옮겨도 하위 단계 묶음이 그 단계 바로 아래에 붙어 있다", JSON.stringify(await kids("라 하위 있음 11/01")) === JSON.stringify(["라-2 11/20", "라-1 12/01", "라-3 마감 없음"]), await kids("라 하위 있음 11/01"));
check("맨 위 순서를 바꿔도 하위 단계 순서는 그대로(서버)", JSON.stringify(await apiKids("라 하위 있음 11/01")) === JSON.stringify(["라-2 11/20", "라-1 12/01", "라-3 마감 없음"]));

// 3. 하위 단계끼리
let [k3, k2] = await rowPair("라-3 마감 없음", "라-2 11/20");
await drag(k3.x, k3.y, k3.x, k2.top + 3, 8);
check("하위 단계를 같은 묶음의 맨 위로 옮긴다", await waitFor(async () => JSON.stringify(await kids("라 하위 있음 11/01")) === JSON.stringify(["라-3 마감 없음", "라-2 11/20", "라-1 12/01"]), 4000), await kids("라 하위 있음 11/01"));
check("하위 단계 순서가 서버에 저장되고 맨 위 단계 순서는 그대로", JSON.stringify(await apiKids("라 하위 있음 11/01")) === JSON.stringify(["라-3 마감 없음", "라-2 11/20", "라-1 12/01"]) && JSON.stringify(await apiTops()) === JSON.stringify(["가 마감 없음", "다 11/05", "나 12/10", "라 하위 있음 11/01", "마 끝낸 단계"]));
await shot("st_kids.png");

// 4. 하위 단계를 맨 위 목록 쪽(묶음 밖)에 놓으면 아무 일도 없다
let [k1, ga] = await rowPair("라-1 12/01", "가 마감 없음");
await drag(k1.x, k1.y, ga.x, ga.y, 10); await sleep(700);
check("하위 단계를 맨 위 단계 목록으로 끌어도 옮겨지지 않는다(묶음 밖은 무시)", JSON.stringify(await kids("라 하위 있음 11/01")) === JSON.stringify(["라-3 마감 없음", "라-2 11/20", "라-1 12/01"]) && JSON.stringify(await tops()) === JSON.stringify(["가 마감 없음", "다 11/05", "나 12/10", "라 하위 있음 11/01", "마 끝낸 단계"]), [await kids("라 하위 있음 11/01"), await tops()]);

// 5. 놓을 곳이 아닌 데 놓기 / 다른 카드 / Esc / 같은 자리
ga = await rowPos("가 마감 없음");
await drag(ga.x, ga.y, 5, 5, 8); await sleep(600);
check("카드 밖(화면 구석)에 놓으면 아무 일도 없다", (await tops())[0] === "가 마감 없음" && JSON.stringify(await tops()) === JSON.stringify(await apiTops()));
const otherPos = await js(`(() => { const c = [...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name").textContent === "다른 프로젝트"); const r = c.querySelector("li.task-row").getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
await drag(ga.x, ga.y, otherPos.x, otherPos.y, 8); await sleep(600);
check("다른 프로젝트 카드에 놓으면 옮겨지지 않는다(두 카드의 단계가 그대로)", JSON.stringify(await tops()) === JSON.stringify(["가 마감 없음", "다 11/05", "나 12/10", "라 하위 있음 11/01", "마 끝낸 단계"]) && (await api("/api/projects")).data.find((p) => p.name === "다른 프로젝트").tasks.length === 2);
let da; [ga, da] = await rowPair("가 마감 없음", "다 11/05");
await mouse("mouseMoved", ga.x, ga.y, 0); await mouse("mousePressed", ga.x, ga.y);
for (let i = 1; i <= 6; i++) await mouse("mouseMoved", ga.x, ga.y + (da.bottom + 4 - ga.y) * i / 6, 1);
await key("Escape"); await sleep(200);
await mouse("mouseReleased", ga.x, da.bottom + 4); await sleep(600);
check("끄는 중 Esc는 취소: 순서가 그대로이고 표시도 사라진다", (await tops())[0] === "가 마감 없음" && await js(`!document.querySelector(".task-ghost") && !document.querySelector(".task-drop-line")`));
const callsBefore = (await api("/api/projects")).data.find((p) => p.name === NAME).tasks.map((s) => s.id).join(",");
ga = await rowPos("가 마감 없음");
await drag(ga.x, ga.y, ga.x, ga.y + 2, 6); await sleep(500);
check("제자리에 놓으면(순서가 같으면) 그대로", (await tops())[0] === "가 마감 없음" && (await api("/api/projects")).data.find((p) => p.name === NAME).tasks.map((s) => s.id).join(",") === callsBefore);

// 6. 클릭은 끌기가 아니다: 체크박스, 이름 두 번 클릭
ga = await rowPos("가 마감 없음");
await click(ga.x, ga.y); await sleep(300);
check("줄을 한 번 누르기만 하면 아무 일도 없다", (await tops())[0] === "가 마감 없음" && await js(`!document.querySelector(".task-ghost")`));

// 7. 순서를 정한 뒤 새 단계는 맨 뒤(끝낸 단계 앞), 끝내면 맨 아래로
await js(`(() => { const c = ${card}; const i = c.querySelector(":scope > .task-add input"); i.value = "바 새 단계"; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); })()`);
await key("Enter"); await sleep(1200);
check("순서를 정한 뒤 추가한 단계는 정한 단계들 뒤, 끝낸 단계 앞", JSON.stringify(await tops()) === JSON.stringify(["가 마감 없음", "다 11/05", "나 12/10", "라 하위 있음 11/01", "바 새 단계", "마 끝낸 단계"]), await tops());
await js(`[...${card}.querySelectorAll("li.task-row")].find(r => r.querySelector(".task-content").textContent === "다 11/05").querySelector("input[type=checkbox]").click()`); await sleep(1200);
check("끝낸 단계는 순서와 상관없이 맨 아래로 간다", (await tops()).slice(-2).includes("다 11/05") && (await tops())[0] === "가 마감 없음", await tops());
await js(`[...${card}.querySelectorAll("li.task-row")].find(r => r.querySelector(".task-content").textContent === "다 11/05").querySelector("input[type=checkbox]").click()`); await sleep(1200);

// 8. 오늘 탭의 끌기(기존 기능)는 여전히 된다 - 프로젝트 단계 끌기가 날짜를 건드리지 않는다
check("프로젝트 단계를 끌어도 날짜는 바뀌지 않는다(단계들의 date는 모두 null)", (await api("/api/projects")).data.find((p) => p.name === NAME).tasks.every((s) => s.date === null));

// 9. 다시 그려도 스크롤이 맨 위로 올라가지 않는다 (단계 끌기, 체크박스)
let [sc1, sc3] = await rowPair("라-1 12/01", "라-3 마감 없음");
await mouse("mouseMoved", sc1.x, sc1.y, 0); await mouse("mousePressed", sc1.x, sc1.y);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", sc1.x, sc1.y + (sc3.top + 3 - sc1.y) * i / 8, 1);
await sleep(300);
const y0 = await js(`scrollY`);   // 놓기 직전의 스크롤 위치 (끄는 동안 마우스가 카드 위를 지나며 생기는 변화는 빼고 잰다)
await mouse("mouseReleased", sc1.x, sc3.top + 3);
await waitFor(async () => (await kids("라 하위 있음 11/01"))[0] === "라-1 12/01", 4000);
await sleep(1000);
const y1 = await js(`scrollY`);
check("단계를 끌어서 순서를 바꿔도 스크롤 위치가 그대로다", y0 > 100 && Math.abs(y1 - y0) <= 2, [y0, y1]);
await hoverCard();
await js(`[...${card}.querySelectorAll("li.task-row")].find(r => r.querySelector(".task-content").textContent === "가 마감 없음").querySelector("input[type=checkbox]").click()`); await sleep(1200);
const y2 = await js(`scrollY`);
check("단계를 체크해도(다시 그려도) 스크롤 위치가 그대로다", Math.abs(y2 - y1) <= 2, [y1, y2]);
await js(`[...${card}.querySelectorAll("li.task-row")].find(r => r.querySelector(".task-content").textContent === "가 마감 없음").querySelector("input[type=checkbox]").click()`); await sleep(1200);

// 10. "마감일 순으로" 되돌리기
await reloadProjects();
const orderRow = () => js(`(() => { const r = ${card}.querySelector(".steps-order-row"); return r ? { text: r.textContent, button: !!r.querySelector("button") } : null; })()`);
const rowInfo = await orderRow();
check("순서를 직접 정한 카드에는 '직접 정한 순서' 안내와 [마감일 순으로] 버튼이 보인다", rowInfo && rowInfo.button && /직접 정한 순서/.test(rowInfo.text) && /마감일 순으로/.test(rowInfo.text), rowInfo);
check("순서를 정하지 않은 카드(다른 프로젝트)에는 그 줄이 없다", await js(`![...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name").textContent === "다른 프로젝트").querySelector(".steps-order-row")`));
await hoverCard();
await js(`${card}.querySelector(".steps-order-row button").scrollIntoView({ block: "center" })`); await sleep(200);
const resetPos = await js(`(() => { const r = ${card}.querySelector(".steps-order-row button").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await click(resetPos.x, resetPos.y); await sleep(1300);
check("[마감일 순으로]를 누르면 맨 위 단계가 마감일 순으로 돌아온다(끝낸 단계는 아래)", JSON.stringify(await tops()) === JSON.stringify(["라 하위 있음 11/01", "다 11/05", "나 12/10", "가 마감 없음", "바 새 단계", "마 끝낸 단계"]), await tops());
check("하위 단계도 마감일 순으로 돌아온다", JSON.stringify(await kids("라 하위 있음 11/01")) === JSON.stringify(["라-2 11/20", "라-1 12/01", "라-3 마감 없음"]), await kids("라 하위 있음 11/01"));
check("되돌리면 그 안내 줄이 사라진다", (await orderRow()) === null);
check("서버에도 반영됐다(step_order 모두 비움)", JSON.stringify(await apiTops()) === JSON.stringify(await tops()));
// 다시 끌면 안내 줄이 돌아온다
let [rr1, rr2] = await rowPair("바 새 단계", "라 하위 있음 11/01");
await drag(rr1.x, rr1.y, rr2.x, rr2.top + 3, 8);
await waitFor(async () => (await tops())[0] === "바 새 단계", 4000); await sleep(600);
check("다시 끌어서 순서를 정하면 안내 줄이 다시 나온다", (await orderRow()) !== null);

console.log("--- 프로젝트 색 ---");
const dlg = (sel) => js(`document.querySelector(${JSON.stringify(sel)})`);
const colorVal = () => js(`document.getElementById("project-color").value`);
const swatches = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#project-color-swatches .color-swatch")].map(b => ({ color: b.dataset.color, selected: b.classList.contains("selected"), title: b.title })))`));
const typeName = async (text) => { await js(`(() => { const i = document.getElementById("project-name"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); })()`); if (text) await type(text); await sleep(150); };
const FOLDER = await js(`foldersCache[0].id`);

// 새 프로젝트 창 (공부 폴더에서 만들기)
await js(`openProjectDialog(null, { folderId: ${FOLDER} })`); await sleep(400);
const sw0 = await swatches();
check("쓰는 색 줄이 보이고, 가장 많이 쓴 색(빨강 2개)이 맨 앞이다", await js(`!document.getElementById("project-swatch-row").hidden`) && sw0[0].color === "#ff0000" && /2개가 쓰는 색/.test(sw0[0].title), sw0);
check("동그라미는 쓰는 색마다 하나씩(빨강/초록/파랑/주황/파랑 보라 등 중복 없이)", new Set(sw0.map((s) => s.color)).size === sw0.length && sw0.length >= 4, sw0);
check("동그라미 설명에 그 색을 쓰는 프로젝트 이름이 들어 있다", /영어 단어/.test(sw0[0].title) && /영어 듣기/.test(sw0[0].title), sw0[0].title);
await shot("pc_dialog.png");
const before = await colorVal();
await typeName("영");
check("'영'만으로는 빨강이 아니다", (await colorVal()) !== "#ff0000", await colorVal());
await typeName("영어");
check("'영어'를 적으면 같은 폴더의 '영어 …' 프로젝트 색(빨강)이 된다", (await colorVal()) === "#ff0000" && (await swatches())[0].selected, [await colorVal(), await swatches()]);
await typeName("영어회화");
check("'영어회화'는 다른 낱말이라 빨강이 아니다", (await colorVal()) !== "#ff0000", await colorVal());
await typeName("영어 회화 문법");
check("'영어 회화 문법'은 앞 키워드가 '영어'라 빨강", (await colorVal()) === "#ff0000");
await typeName("수학 기하");
check("'수학 …'은 수학 프로젝트의 초록", (await colorVal()) === "#00aa00", await colorVal());
await typeName("역사 둘");
check("'역사 …'는 파랑", (await colorVal()) === "#0000ff", await colorVal());
await typeName("전혀 새로운");
check("같은 키워드가 없으면 팔레트 색(예: 7색 중 하나)", ["#4a7cff", "#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#1098ad", "#f08c00"].includes(await colorVal()), await colorVal());
// 폴더를 바꾸면 다시 계산
await typeName("영어 단어장");
await js(`(() => { const s = document.getElementById("project-folder"); s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(150);
check("폴더를 '폴더 없음'으로 바꾸면 그 폴더의 '영어 독서'(주황)를 따른다", (await colorVal()) === "#f08c00", await colorVal());
await js(`(() => { const s = document.getElementById("project-folder"); s.value = "${FOLDER}"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(150);
check("다시 공부 폴더로 바꾸면 빨강", (await colorVal()) === "#ff0000");
// 동그라미 누르기 = 색 고르기, 그 뒤에는 이름을 고쳐도 색이 안 바뀐다
const green = (await swatches()).find((s) => s.color === "#00aa00");
const gpos = await js(`(() => { const b = document.querySelector('#project-color-swatches .color-swatch[data-color="#00aa00"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
await click(gpos.x, gpos.y); await sleep(250);
check("동그라미를 누르면 그 색이 되고 동그라미에 선택 표시가 생긴다", (await colorVal()) === "#00aa00" && (await swatches()).find((s) => s.color === "#00aa00").selected && !(await swatches()).find((s) => s.color === "#ff0000").selected, [await colorVal(), await swatches()]);
await typeName("영어 또 다른");
check("직접 고른 색은 이름을 고쳐도 바뀌지 않는다", (await colorVal()) === "#00aa00", await colorVal());
await shot("pc_chosen.png");
// 저장
await js(`document.getElementById("project-save").click()`); await sleep(1500);
check("저장하면 고른 색으로 만들어진다", (await api("/api/projects")).data.some((p) => p.name === "영어 또 다른" && p.color === "#00aa00" && p.folderId === FOLDER), (await api("/api/projects")).data.map((p) => p.name + p.color));

// 색을 안 건드리고 저장하면 맞춰진 색으로 만들어진다
await js(`openProjectDialog(null, { folderId: ${FOLDER} })`); await sleep(400);
await typeName("영어 쓰기");
check("창을 다시 열면 이름이 비어 있고 선택이 초기화돼 있다(터치 안 함)", (await colorVal()) === "#ff0000");
await js(`document.getElementById("project-save").click()`); await sleep(1500);
check("색을 건드리지 않고 저장하면 맞춰진 색(빨강)으로 만들어진다", (await api("/api/projects")).data.some((p) => p.name === "영어 쓰기" && p.color === "#ff0000"));

// 수정 창: 색을 자동으로 바꾸지 않는다, 자기 자신은 동그라미에서 센 않는다
await js(`openProjectDialog(projectsCache.find(p => p.name === "수학 미적분"))`); await sleep(400);
check("수정 창은 원래 색(초록) 그대로 열린다", (await colorVal()) === "#00aa00");
await typeName("영어 수학 합체");
check("수정 창에서 이름을 바꿔도 색이 저절로 바뀌지 않는다", (await colorVal()) === "#00aa00", await colorVal());
const swEdit = await swatches();
check("수정 창의 동그라미에서 자기 자신만 쓰는 색(없음)은 빠진다/다른 프로젝트가 쓰는 색은 남는다", swEdit.some((s) => s.color === "#ff0000"), swEdit);
await js(`document.getElementById("project-cancel").click()`); await sleep(300);

// 동그라미가 하나도 없으면 줄이 숨겨진다
await js(`(() => { const saved = projectsCache; projectsCache = []; openProjectDialog(null); window.__rowHidden = document.getElementById("project-swatch-row").hidden; projectsCache = saved; document.getElementById("project-dialog").close(); })()`);
check("프로젝트가 하나도 없으면 '쓰는 색' 줄이 숨겨진다", await js(`window.__rowHidden`) === true);

console.log("--- D-day 쓰는 색 ---");
await api("/api/ddays", "POST", { name: "기말고사", date: "2026-12-20", color: "#123456" });
await api("/api/ddays", "POST", { name: "종강", date: "2026-12-22", color: "#ff0000" });
await js(`loadDdays()`); await sleep(800);
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(600);
await js(`openDdayDialog(null)`); await sleep(400);
const dsw = async () => JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#dday-color-swatches .color-swatch")].map(b => ({ color: b.dataset.color, selected: b.classList.contains("selected"), title: b.title })))`));
const d0 = await dsw();
check("D-day 창에도 '쓰는 색' 줄이 보인다", await js(`!document.getElementById("dday-swatch-row").hidden`) && d0.length >= 4, d0);
check("프로젝트가 쓰는 색(빨강)과 D-day가 쓰는 색이 모두 나온다", d0.some((s) => s.color === "#ff0000") && d0.some((s) => s.color === "#123456"), d0);
const red = d0.find((s) => s.color === "#ff0000");
check("가장 많이 쓴 색(빨강: 프로젝트 3개 + D-day 1개 = 4개)이 맨 앞이고, 설명은 이름 3개 + '외 1개'다", d0[0].color === "#ff0000" && /4개가 쓰는 색/.test(red.title) && /영어 단어/.test(red.title) && /외 1개/.test(red.title), red);
const dpos = await js(`(() => { const b = document.querySelector('#dday-color-swatches .color-swatch[data-color="#00aa00"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
await click(dpos.x, dpos.y); await sleep(250);
check("동그라미를 누르면 D-day의 색이 그 색이 되고 선택 표시가 생긴다", (await js(`document.getElementById("dday-color").value`)) === "#00aa00" && (await dsw()).find((s) => s.color === "#00aa00").selected, [await js(`document.getElementById("dday-color").value`), await dsw()]);
await js(`document.getElementById("dday-name").value = "중간고사"; document.getElementById("dday-date").value = "2026-12-01"; document.getElementById("dday-save").click()`); await sleep(1200);
check("저장하면 고른 색으로 D-day가 만들어진다", (await api("/api/ddays")).data.some((d) => d.name === "중간고사" && d.color === "#00aa00"), (await api("/api/ddays")).data);
await js(`openDdayDialog(ddaysCache.find(d => d.name === "기말고사"))`); await sleep(400);
const d1 = await dsw();
check("D-day 수정 창에서는 자기 색(#123456은 자기만 씀)이 동그라미에서 빠진다", !d1.some((s) => s.color === "#123456") && d1.some((s) => s.color === "#ff0000"), d1);
await js(`document.getElementById("dday-cancel").click()`); await sleep(300);
// 프로젝트 창에도 D-day 색이 나온다
await js(`document.querySelector('[data-tab="projects"]').click()`); await sleep(600);
await js(`openProjectDialog(null)`); await sleep(400);
const p1 = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll("#project-color-swatches .color-swatch")].map(b => ({ color: b.dataset.color, title: b.title })))`));
check("프로젝트 창의 '쓰는 색'에도 D-day가 쓰는 색(#123456)이 나온다", p1.some((s) => s.color === "#123456" && /기말고사 \(D-day\)/.test(s.title)), p1);
await js(`document.getElementById("project-cancel").click()`);

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
