// 프로젝트 보관(2026-11-24) 화면 시험 (헤드리스 Edge를 CDP로 조종, 실제 마우스 입력, pro_server.py 5057번)
// 수정 창의 [보관]/[보관 풀기], 안 끝낸 단계가 있으면 두 번 눌러야 보관, 맨 아래 "끝난 프로젝트" 구역(처음엔 접힘),
// 폴더 요약과 오늘 탭 프로젝트 고르는 칸에서 빠지는지, 지난(오늘) 할 일의 프로젝트 이름표가 남는지, 끌기와의 관계
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9401;
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
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && buttons === 0 ? "none" : "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1 });
async function click(x, y) { await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); }
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
// 요소를 화면 가운데로 스크롤한 뒤 그 가운데를 진짜 마우스로 누른다. 사람처럼 마우스를 먼저 올리고 나서 누른다:
// 카드에 마우스가 올라가면 [+ 메모] 버튼이 나타나 카드 높이가 바뀌어서, 마우스를 옮기기 전에 잰 자리는 틀릴 수 있다.
// 목록 맨 아래 카드는 가운데까지 올라오지 않아서 화면 아래쪽 알림(toast)에 가려질 수 있다. 가려져 있으면 알림이 사라질 때까지 기다린다
async function clickEl(expr) {
  const where = () => js(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, covered: !(hit && (hit === el || el.contains(hit))) }; })()`);
  let r = await where();
  if (!r) throw new Error("누를 요소가 없음: " + expr);
  for (let i = 0; i < 30; i++) {
    await mouse("mouseMoved", r.x, r.y, 0); await sleep(200);
    const again = await where();
    if (!again.covered && Math.abs(again.x - r.x) < 1 && Math.abs(again.y - r.y) < 1) break;
    r = again;
  }
  if (r.covered) throw new Error("다른 것에 가려져서 누를 수 없음: " + expr);
  await mouse("mousePressed", r.x, r.y); await mouse("mouseReleased", r.x, r.y); await sleep(350);
}

await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);

// 오늘 날짜는 브라우저의 오늘로 정한다 (시험 날짜를 고정하지 않는다)
const today = await js(`toDateText(new Date())`);
const projects = (await api("/api/projects")).data;
const WORD = projects.find((p) => p.name === "영어 단어");
const READ = projects.find((p) => p.name === "영어 독서");
// "영어 단어"(폴더 '공부' 안)에 오늘 할 일 하나와 날짜 없는 단계 하나를 붙인다. 둘 다 안 끝냄 → 안 끝낸 단계 2개
await api("/api/tasks", "POST", { content: "단어 시험", date: today, projectId: WORD.id });
await api("/api/tasks", "POST", { content: "단어 남은 것", date: null, projectId: WORD.id });

const card = (name) => `[...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name").textContent === ${JSON.stringify(name)})`;
const folderSection = `document.querySelector('.folder-section[data-folder-id]')`;
const archivedSection = `document.querySelector(".archived-section")`;
const selectNames = () => js(`[...document.getElementById("task-project").options].map(o => o.textContent)`);
const apiProject = async (pid) => (await api("/api/projects")).data.find((p) => p.id === pid);

console.log("--- 보관하기 ---");
await js(`document.querySelector('[data-tab="projects"]').click()`);
await waitFor(async () => (await js(`document.querySelectorAll(".project-card").length`)) > 0, 15000);
await js(`loadProjects()`); await sleep(900);
check("처음에는 '끝난 프로젝트' 구역이 없다", await js(`${archivedSection} === null`));
check("처음에는 오늘 탭 프로젝트 고르는 칸에 '영어 단어'가 있다", (await selectNames()).includes("영어 단어"), await selectNames());
const summaryBefore = await js(`${folderSection}.querySelector(".folder-summary").textContent`);
check("폴더 요약: 프로젝트 4개", /프로젝트 4개/.test(summaryBefore), summaryBefore);

await clickEl(`${card("영어 단어")}.querySelector(".project-card-head button")`);
check("수정 창에 [보관] 버튼이 보인다", await js(`document.getElementById("project-dialog").open && !document.getElementById("project-archive").hidden && document.getElementById("project-archive").textContent === "보관"`));
await clickEl(`document.getElementById("project-archive")`);
const armed = await js(`document.getElementById("project-archive").textContent`);
check("안 끝낸 단계가 있으면 한 번 눌러서는 보관하지 않고 개수를 묻는다", armed === "안 끝낸 단계 2개 · 그래도 보관?" && await js(`document.getElementById("project-dialog").open`), armed);
check("아직 서버에는 보관되지 않았다", (await apiProject(WORD.id)).archived === false);
await clickEl(`document.getElementById("project-archive")`);
check("두 번째로 누르면 창이 닫히고 보관된다", await waitFor(async () => (await apiProject(WORD.id)).archived === true) && !(await js(`document.getElementById("project-dialog").open`)));
await sleep(700);
check("보관했다는 알림이 나온다", /끝난 프로젝트로 보관했습니다/.test(await js(`document.getElementById("toast").textContent`)), await js(`document.getElementById("toast").textContent`));
check("보관한 카드는 폴더에서 빠진다", await js(`${folderSection}.querySelectorAll(".project-card").length === 3 && ![...${folderSection}.querySelectorAll(".project-name")].some(n => n.textContent === "영어 단어")`));
const summaryAfter = await js(`${folderSection}.querySelector(".folder-summary").textContent`);
check("폴더 요약에서도 빠진다: 프로젝트 3개", /프로젝트 3개/.test(summaryAfter), summaryAfter);
check("맨 아래에 '끝난 프로젝트' 구역이 생기고 처음엔 접혀 있다(카드 안 보임)",
  await js(`(() => { const s = ${archivedSection}; return !!s && s === document.getElementById("project-list").lastElementChild && s.classList.contains("collapsed") && s.querySelectorAll(".project-card").length === 0; })()`));
const archHead = await js(`${archivedSection}.querySelector(".folder-head").textContent`);
check("구역 머리글: '끝난 프로젝트', '1개'", /끝난 프로젝트/.test(archHead) && /1개/.test(archHead), archHead);
check("오늘 탭 프로젝트 고르는 칸에서 '영어 단어'가 빠진다", !(await selectNames()).includes("영어 단어") && (await selectNames()).includes("영어 듣기"), await selectNames());

await clickEl(`${archivedSection}.querySelector(".folder-head")`);
check("머리글을 누르면 펼쳐져서 보관한 카드가 보인다", await js(`!${archivedSection}.classList.contains("collapsed") && ${archivedSection}.querySelectorAll(".project-card.archived").length === 1`));
check("보관한 카드는 끌 수 없다(draggable 아님)", await js(`!${card("영어 단어")}.classList.contains("draggable")`));
check("보관한 카드에도 단계는 그대로 보인다", await js(`${card("영어 단어")}.querySelectorAll("li.task-row").length === 2`));
if (outDir) { await js(`${archivedSection}.scrollIntoView({ block: "start" })`); await mouse("mouseMoved", 5, 5, 0); await sleep(300); }
await shot("ar_archived_open.png");
await clickEl(`${archivedSection}.querySelector(".folder-head")`);
check("다시 누르면 접힌다", await js(`${archivedSection}.classList.contains("collapsed")`));

console.log("--- 오늘 탭의 이름표 ---");
await js(`document.querySelector('[data-tab="today"]').click()`); await sleep(1500);
const chip = await js(`(() => { const li = [...document.querySelectorAll(".task-row")].find(l => l.querySelector(".task-content") && l.querySelector(".task-content").textContent === "단어 시험"); return li && li.querySelector(".project-chip") ? li.querySelector(".project-chip").textContent : null; })()`);
check("보관한 프로젝트의 오늘 할 일에도 프로젝트 이름표가 남는다", chip === "영어 단어", chip);
await js(`document.querySelector('[data-tab="projects"]').click()`); await sleep(1200);

console.log("--- 끌기와 '끝난 프로젝트' 구역 ---");
// 폴더 밖 프로젝트를 모두 보관하면 '폴더 없음' 구역이 사라진다. 다른 둘('정렬 프로젝트', '다른 프로젝트')은 서버로 보관해 두고,
// '영어 독서'는 화면에서 보관한다. 안 끝낸 단계가 없으니 한 번에 보관된다
const OTHERS = projects.filter((p) => p.name === "정렬 프로젝트" || p.name === "다른 프로젝트");
for (const p of OTHERS) await api("/api/projects/" + p.id, "PATCH", { archived: true });
await js(`loadProjects()`); await sleep(900);
await clickEl(`${card("영어 독서")}.querySelector(".project-card-head button")`);
await clickEl(`document.getElementById("project-archive")`);
check("안 끝낸 단계가 없으면 한 번에 보관된다", await waitFor(async () => (await apiProject(READ.id)).archived === true));
await sleep(700);
check("'폴더 없음' 구역이 없어지고, 끝난 프로젝트는 4개", await js(`document.querySelector(".folder-section.loose") === null && /4개/.test(${archivedSection}.querySelector(".folder-head").textContent)`), await js(`${archivedSection}.querySelector(".folder-head").textContent`));
// 폴더 안 카드를 끌기 시작하면 '폴더 없음' 임시 구역이 '끝난 프로젝트' 위에 생긴다. '끝난 프로젝트' 위에 놓으면 아무 일도 없다
const MATH = projects.find((p) => p.name === "수학 미적분");
const hp = await js(`(() => { const h = ${card("수학 미적분")}.querySelector(".project-name"); h.scrollIntoView({ block: "center" }); const b = h.getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 }; })()`);
await sleep(200);
await mouse("mouseMoved", hp.x, hp.y, 0); await mouse("mousePressed", hp.x, hp.y);
for (let i = 1; i <= 4; i++) await mouse("mouseMoved", hp.x + i * 5, hp.y + i * 5, 1);
await sleep(200);
check("끄는 동안 '폴더 없음' 임시 구역이 '끝난 프로젝트' 바로 위에 생긴다", await js(`(() => { const z = document.querySelector(".temp-zone"); return !!z && z.nextElementSibling === ${archivedSection}; })()`));
const ap = await js(`(() => { const h = ${archivedSection}.querySelector(".folder-head"); h.scrollIntoView({ block: "center" }); const b = h.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; })()`);
await sleep(200);
for (let i = 1; i <= 8; i++) await mouse("mouseMoved", hp.x + (ap.x - hp.x) * i / 8, hp.y + (ap.y - hp.y) * i / 8, 1);
await sleep(150);
check("'끝난 프로젝트' 구역은 놓을 곳으로 강조되지 않는다", await js(`!${archivedSection}.classList.contains("drop-hover")`));
await mouse("mouseReleased", ap.x, ap.y); await sleep(800);
const math = await apiProject(MATH.id);
check("'끝난 프로젝트'에 놓아도 폴더와 보관 상태가 그대로", math.folderId === MATH.folderId && math.archived === false, math);

console.log("--- 보관 풀기 ---");
await clickEl(`${archivedSection}.querySelector(".folder-head")`);
await clickEl(`${card("영어 단어")}.querySelector(".project-card-head button")`);
check("보관한 프로젝트의 수정 창에서는 [보관 풀기]", await js(`document.getElementById("project-archive").textContent === "보관 풀기"`));
await clickEl(`document.getElementById("project-archive")`);
check("[보관 풀기]는 한 번에 풀린다", await waitFor(async () => (await apiProject(WORD.id)).archived === false));
await sleep(700);
check("원래 폴더('공부')로 돌아온다", await js(`[...${folderSection}.querySelectorAll(".project-name")].some(n => n.textContent === "영어 단어") && !${card("영어 단어")}.classList.contains("archived")`));
check("고르는 칸에도 다시 나온다", (await selectNames()).includes("영어 단어"), await selectNames());
check("끝난 프로젝트는 3개 남는다", await js(`/3개/.test(${archivedSection}.querySelector(".folder-head").textContent)`));
await clickEl(`${card("영어 독서")}.querySelector(".project-card-head button")`);
await clickEl(`document.getElementById("project-archive")`);
await sleep(700);
const listShape = () => js(`[...document.getElementById("project-list").children].map(s => s.className + ":" + [...s.querySelectorAll(".project-name")].map(n => n.textContent).join(","))`);
check("폴더 밖 프로젝트를 풀면 '폴더 없음' 구역이 그 자리(끝난 프로젝트 위)에 돌아온다", await waitFor(() => js(`(() => { const l = document.querySelector(".folder-section.loose"); return !!l && l.nextElementSibling === ${archivedSection}; })()`), 3000),
  [await listShape(), (await apiProject(READ.id)).archived, await js(`document.getElementById("project-dialog").open`), await js(`document.getElementById("project-archive").textContent`)]);
for (const p of OTHERS) await api("/api/projects/" + p.id, "PATCH", { archived: false });
await js(`loadProjects()`); await sleep(900);
check("마지막 것까지 풀면 '끝난 프로젝트' 구역이 사라진다", await js(`${archivedSection} === null && document.querySelectorAll(".project-card.archived").length === 0`));

console.log("--- 새 프로젝트 창 ---");
await js(`openProjectDialog(null)`); await sleep(300);
check("새 프로젝트 창에는 [보관] 버튼이 없다", await js(`document.getElementById("project-archive").hidden`));
await js(`document.getElementById("project-cancel").click()`);

check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
