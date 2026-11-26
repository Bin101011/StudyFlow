// 하루 메모 서식 시험 (2026-11-20): Ctrl+B 굵게, Ctrl+I 기울임, Ctrl+5 취소선, 저장 형식(html/text), 옛 메모, 위험한 내용 거르기,
// 붙여넣기·끌어다 놓기는 글자만, 비우기, 날짜 넘김과 되돌리기, 잠금, 한글 조합, 글자 수 한계. 헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번.
// 진짜 앱(pywebview)처럼 body에 글자 선택 금지 CSS를 넣고 시험한다. 확장 프로그램을 끄고 띄운다 (이유는 tests/README.md의 "알려진 함정")
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const outDir = process.argv[2];
const BASE = "http://127.0.0.1:5057";
const PORT = 9433;
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
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; }
const rule = (q = "") => fetch(BASE + "/__test/rule" + (q ? "?" + q : ""));

// Ctrl(+Shift) 조합 키. code는 키의 자리(KeyB, Digit5, Numpad5 …), vk는 윈도우 키 번호
const VK = { KeyB: 66, KeyI: 73, KeyU: 85, KeyZ: 90, Digit5: 53, Numpad5: 101, KeyA: 65 };
async function ctrl(code, { shift = false, key } = {}) {
  const k = key || (code.startsWith("Key") ? code.slice(3).toLowerCase() : "5");
  const modifiers = 2 | (shift ? 8 : 0);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers, key: k, code, windowsVirtualKeyCode: VK[code] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, key: k, code, windowsVirtualKeyCode: VK[code] });
  await sleep(60);
}
async function press(keyName, code, vk) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: vk });
  if (keyName === "Enter") await send("Input.dispatchKeyEvent", { type: "char", key: "Enter", code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk });
  await sleep(60);
}
const type = (text) => send("Input.insertText", { text });

const DM = "document.getElementById('day-memo')";
const html = () => js(`${DM}.innerHTML`);
const text = () => js(`${DM}.innerText`);
// 서버에 저장된 html을 화면에 보이는 글자(innerText)로 바꿔서 비교한다 (태그 모양이 아니라 보이는 내용을 본다)
const textOf = (h) => js(`(() => { const d = document.createElement("div"); d.style.whiteSpace = "pre-wrap"; d.innerHTML = DOMPurify.sanitize(${JSON.stringify(h)}); document.body.appendChild(d); const t = d.innerText; d.remove(); return t; })()`);
const server = async (date) => (await api("/api/day-memo?date=" + date)).data;
// 칸의 글자 중 word를 고른다 (마우스로 고른 것과 같다)
const selectWord = (word) => js(`(() => { const el = ${DM}; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.data.indexOf(${JSON.stringify(word)}); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } return false; })()`);
const caretEnd = () => js(`(() => { const r = document.createRange(); r.selectNodeContents(${DM}); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
// word를 감싼 서식 태그들 (예: ["B"], ["I"], ["STRIKE"])
const tagsOf = (word) => js(`(() => { const el = ${DM}; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { if (n.data.includes(${JSON.stringify(word)})) { const tags = []; for (let p = n.parentNode; p && p !== el; p = p.parentNode) tags.push(p.tagName); return JSON.stringify(tags.filter(t => !["DIV", "P", "BR"].includes(t)).sort()); } } return null; })()`).then((s) => (s ? JSON.parse(s) : null));
const memoRect = () => js(`JSON.stringify(${DM}.getBoundingClientRect())`).then(JSON.parse);
async function goDay(d) { await js(`showDay(${JSON.stringify(d)})`); await waitFor(async () => (await js(`viewedDate === ${JSON.stringify(d)} && ${DM}.isContentEditable`)), 6000); await sleep(200); }
async function clickMemo() { const r = await memoRect(); await click(r.x + r.width - 20, r.y + r.height - 15); await sleep(150); }

// 진짜 앱(pywebview)은 body에 "글자 선택 금지 + 화살표 커서" CSS를 넣는다(webview/js/customize.js). 같은 조건에서 시험한다
await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });
  document.addEventListener("DOMContentLoaded", () => { const css = document.createElement("style"); css.textContent = "body {-webkit-user-select: none; user-select: none; cursor: default;}"; document.head.appendChild(css); });` });
await send("Page.navigate", { url: BASE + "/" }); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`${DM}.isContentEditable`)), 15000);
const today = await js(`viewedDate`);
const plusDays = (n) => js(`(() => { const d = new Date(${JSON.stringify(today)} + "T12:00:00"); d.setDate(d.getDate() + ${n}); return toDateText(d); })()`);
const D1 = await plusDays(40), D2 = await plusDays(41), D3 = await plusDays(42), D4 = await plusDays(43), D5 = await plusDays(44), D6 = await plusDays(45);

// ===== A. 실제 앱과 같은 조건 =====
console.log("--- A. 칸의 기본 ---");
check("(준비) body는 글자 선택 금지(pywebview와 같은 조건)", (await js(`getComputedStyle(document.body).userSelect`)) === "none");
await goDay(D1);
check("메모 칸은 서식 칸(contenteditable)이고 쓸 수 있다", (await js(`${DM}.isContentEditable && !${DM}.classList.contains("disabled")`)) === true);
check("메모 칸과 안쪽 글자는 글자를 고를 수 있고 커서는 I 모양", (await js(`getComputedStyle(${DM}).userSelect + "/" + getComputedStyle(${DM}).cursor`)) === "text/text");
check("비어 있으면 예시 글자가 보인다", (await js(`${DM}.classList.contains("empty") && getComputedStyle(${DM}, "::before").content`)) === '"이 날의 메모를 자유롭게 적으세요"');
await clickMemo();
check("마우스로 누르면 커서가 칸에 들어간다", (await js(`document.activeElement === ${DM}`)) === true);
await type("시작 굵게 기울 취소 끝");
check("글을 쓰면 예시 글자가 사라진다", (await js(`${DM}.classList.contains("empty")`)) === false);
check("상태 글자 '수정 중…'", (await js(`document.getElementById("day-memo-status").textContent`)) === "수정 중…");

// ===== B. 단축키 =====
console.log("--- B. 단축키 ---");
await selectWord("굵게"); await ctrl("KeyB");
check("Ctrl+B: 고른 글자가 굵게(<b>)", JSON.stringify(await tagsOf("굵게")) === '["B"]', await html());
await selectWord("기울"); await ctrl("KeyI");
check("Ctrl+I: 고른 글자가 기울임(<i>)", JSON.stringify(await tagsOf("기울")) === '["I"]', await html());
await selectWord("취소"); await ctrl("Digit5");
check("Ctrl+5: 고른 글자가 취소선(<strike>)", JSON.stringify(await tagsOf("취소")) === '["STRIKE"]', await html());
check("취소선은 화면에서도 줄이 그어진다", (await js(`(() => { const s = ${DM}.querySelector("strike, s"); return getComputedStyle(s).textDecorationLine; })()`)) === "line-through");
check("굵게는 글자 굵기 700", (await js(`getComputedStyle(${DM}.querySelector("b")).fontWeight`)) === "700");
await selectWord("취소"); await ctrl("Numpad5");
check("숫자 패드의 Ctrl+5로 다시 누르면 취소선이 풀린다", JSON.stringify(await tagsOf("취소")) === "[]", await html());
await selectWord("굵게"); await ctrl("KeyB");
check("Ctrl+B를 다시 누르면 굵게가 풀린다", JSON.stringify(await tagsOf("굵게")) === "[]", await html());
await ctrl("KeyB");
check("(다시 굵게)", JSON.stringify(await tagsOf("굵게")) === '["B"]', await html());

// 고른 글자 없이 켜고 쓰기
await caretEnd(); await ctrl("KeyB"); await type(" 진하게"); await ctrl("KeyB"); await type(" 보통");
check("고른 것 없이 Ctrl+B를 켜고 쓰면 그 글자가 굵다", JSON.stringify(await tagsOf("진하게")) === '["B"]', await html());
check("다시 Ctrl+B로 끄고 쓰면 보통 글자", JSON.stringify(await tagsOf("보통")) === "[]", await html());

let before = await html();
await selectWord("시작"); await ctrl("KeyU");
check("Ctrl+U(밑줄)는 아무 일도 안 한다(저장되지 않는 서식이라 막음)", (await html()) === before && !(await js(`!!${DM}.querySelector("u")`)), await html());
await selectWord("시작"); await ctrl("KeyB", { shift: true });
check("Ctrl+Shift+B는 서식을 바꾸지 않는다", (await html()) === before, await html());
await caretEnd();

// 저장
await sleep(1500);
let sv = await server(D1);
check("1초 뒤 html 형식으로 저장된다(굵게·기울임 태그 포함)", sv.format === "html" && /<b>[^<]*굵게/.test(sv.content) && /<i>기울<\/i>/.test(sv.content), sv);
check("'저장됨'", (await js(`document.getElementById("day-memo-status").textContent`)) === "저장됨");

// 칸 안의 되돌리기(Ctrl+Z): 브라우저의 글자 되돌리기만 하고 오늘 탭의 되돌리기(계획·할 일)는 건드리지 않는다
const undoBefore = await js(`undoStack.length`);
before = await html();
await type("X");
await ctrl("KeyZ");
check("메모 칸에서 Ctrl+Z는 방금 쓴 글자만 되돌린다", (await html()) === before, [before, await html()]);
check("오늘 탭의 되돌리기 기록은 그대로", (await js(`undoStack.length`)) === undoBefore);

// Enter로 줄바꿈
await caretEnd(); await press("Enter", "Enter", 13); await type("둘째 줄");
check("Enter로 줄이 바뀐다", (await text()).split("\n").filter(Boolean).pop() === "둘째 줄", await text());
// 띄어쓰기 여러 번
await type("  두 칸");
check("띄어쓰기를 여러 번 해도 그대로", (await text()).includes("둘째 줄  두 칸"), await text());
await js(`${DM}.blur()`); await sleep(800);

// 다시 열어도 서식이 그대로
const shownBefore = await text();
await send("Page.reload"); await sleep(3500);
await js(`document.querySelector('[data-tab="today"]').click()`);
await waitFor(async () => (await js(`${DM}.isContentEditable`)), 15000);
await goDay(D1);
check("새로 열어도 글과 줄이 그대로", (await text()) === shownBefore, [shownBefore, await text()]);
check("새로 열어도 굵게·기울임이 그대로", JSON.stringify(await tagsOf("굵게")) === '["B"]' && JSON.stringify(await tagsOf("기울")) === '["I"]', await html());
await sleep(1500);
check("열어서 보기만 하면 다시 저장하지 않는다", (await js(`document.getElementById("day-memo-status").textContent`)) === "");

// 마우스로 끌어서 글자 고르기 (진짜 앱의 글자 선택 금지 CSS 아래에서도 되는지)
{
  const r = JSON.parse(await js(`(() => { const el = ${DM}; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.data.indexOf("시작"); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 2); const b = r.getBoundingClientRect(); return JSON.stringify({ x1: b.left + 1, x2: b.right - 1, y: b.top + b.height / 2 }); } } })()`));
  await drag(r.x1, r.y, r.x2, r.y, 6); await sleep(150);
  check("마우스로 끌어서 글자를 고를 수 있다", (await js(`String(getSelection())`)).length >= 1 && (await js(`document.activeElement === ${DM}`)), await js(`String(getSelection())`));
  await ctrl("KeyI");
  check("마우스로 고른 글자에 Ctrl+I", (await tagsOf("시")).includes("I"), await html());
  await ctrl("KeyZ");
  check("(되돌리기)", !(await tagsOf("시")).includes("I"), await html());
}

// ===== C. 옛 메모(서식 기능 전, format text) =====
console.log("--- C. 옛 메모 ---");
const OLD = "옛 메모 <b>꺾쇠</b> & 기호\n둘째 줄\n\n넷째 줄";
await api("/api/day-memo", "PUT", { date: D2, content: OLD });
check("(준비) format을 안 보내면 text로 저장된다", (await server(D2)).format === "text");
await goDay(D2);
check("옛 메모는 글자 그대로 보인다(꺾쇠도 글자, 줄바꿈 그대로)", (await text()) === OLD && !(await js(`!!${DM}.querySelector("b")`)), [await text(), await html()]);
await js(`${DM}.focus()`); await sleep(300); await js(`${DM}.blur()`); await sleep(1500);
sv = await server(D2);
check("보기만 하고 나오면 옛 메모를 다시 저장하지 않는다(그대로 text)", sv.format === "text" && sv.content === OLD, sv);
await js(`${DM}.focus()`);
check("커서를 넣으면(Tab 등) 글의 끝에 간다", (await js(`(() => { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(${DM}); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString().length; })()`)) === (await js(`${DM}.textContent.length`)));
// 커서 자리 기억: 가운데에 커서를 두고 나갔다가 (Tab 등으로) 다시 들어오면 그 자리에서 이어진다 (textarea와 같다)
await selectWord("둘째"); await js(`getSelection().collapseToStart()`);
await js(`${DM}.blur()`); await sleep(200); await js(`${DM}.focus()`);
await type("[");
check("나갔다 다시 들어오면 나가기 전 커서 자리에서 이어 쓴다", (await text()).includes("\n[둘째 줄"), await text());
await ctrl("KeyZ");
// 마우스로 누르면 누른 자리 (첫 줄의 맨 앞을 누른다)
await js(`${DM}.blur()`); await sleep(200);
{ const r = await memoRect(); await click(r.x + 11, r.y + 12); await sleep(150); }
await type("@");
check("마우스로 누르면 누른 자리(맨 앞)에 커서가 간다", (await text()).startsWith("@옛 메모"), await text());
await ctrl("KeyZ");
await caretEnd();
await type(" 덧붙임");
await js(`${DM}.blur()`); await sleep(800);
sv = await server(D2);
check("고치면 html로 저장되고, 꺾쇠는 글자로 남는다", sv.format === "html" && (await textOf(sv.content)) === OLD + " 덧붙임", sv);
await goDay(D3); await goDay(D2);
check("다시 열어도 글자 그대로(꺾쇠가 서식이 되지 않는다)", (await text()) === OLD + " 덧붙임" && !(await js(`!!${DM}.querySelector("b")`)), await text());

// ===== D. 위험한 내용 거르기 =====
console.log("--- D. 거르기 ---");
await api("/api/day-memo", "PUT", { date: D3, format: "html", content: `<img src=x onerror="window.__xss=1">악성<script>window.__xss=2<\/script><span style="color:red">빨강</span><b onclick="window.__xss=3" style="font-size:40px">굵</b><a href="javascript:window.__xss=4">링크</a><iframe src="/"></iframe>` });
await goDay(D3);
await sleep(400);
check("스크립트·onerror가 실행되지 않는다", (await js(`String(window.__xss)`)) === "undefined");
check("허용하지 않는 태그(img, script, span, a, iframe)는 없다", (await js(`${DM}.querySelectorAll("img, script, span, a, iframe").length`)) === 0, await html());
check("허용하는 태그의 속성(onclick, style)도 지운다", (await js(`${DM}.querySelector("b").attributes.length`)) === 0, await html());
check("글자는 남는다(악성빨강굵링크)", (await text()) === "악성빨강굵링크", await text());
await js(`${DM}.querySelector("b") && ${DM}.querySelector("b").click()`);
check("굵은 글자를 눌러도 실행되지 않는다", (await js(`String(window.__xss)`)) === "undefined");

// 노트 탭도 같은 DOMPurify를 쓴다. 메모를 거른 뒤에도 노트용 기본 거르기(링크·그림 허용)가 그대로인지
check("메모의 거르기 설정이 노트 탭의 거르기에 남지 않는다(링크·그림은 노트에서 그대로)", (await js(`(() => { const out = DOMPurify.sanitize('<a href="https://example.com">a</a><img src="x.png"><span>s</span>'); return out.includes("<a ") && out.includes("<img") && out.includes("<span>"); })()`)) === true);
// 붙여넣기: 서식은 빼고 글자만
await js(`${DM}.focus()`); await caretEnd();
await js(`(() => { const dt = new DataTransfer(); dt.setData("text/html", '<b style="color:red">붙인</b> <img src=x onerror="window.__xss=5">'); dt.setData("text/plain", "붙인 글자\\r\\n다음 줄"); ${DM}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return 1; })()`);
check("붙여넣기는 글자만 들어간다(굵게·색·그림 없음, \\r\\n은 줄바꿈 하나)", (await text()).endsWith("붙인 글자\n다음 줄") && (await js(`${DM}.querySelectorAll("b").length`)) === 1 && (await js(`${DM}.querySelectorAll("img").length`)) === 0 && (await js(`String(window.__xss)`)) === "undefined", [await text(), await html()]);
await ctrl("KeyZ");
check("붙여넣기도 Ctrl+Z로 되돌린다", !(await text()).includes("붙인 글자"), await text());
// 밖에서 끌어다 놓기: 글자만
await js(`(() => { const dt = new DataTransfer(); dt.setData("text/html", "<i>끌어온</i>"); dt.setData("text/plain", "끌어온 글"); const r = ${DM}.getBoundingClientRect(); ${DM}.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: r.right - 15, clientY: r.bottom - 12, bubbles: true, cancelable: true })); return 1; })()`);
check("밖에서 끌어다 놓은 것은 글자만 들어간다", (await text()).includes("끌어온 글") && (await js(`${DM}.querySelectorAll("i").length`)) === 0, [await text(), await html()]);
await js(`(() => { const dt = new DataTransfer(); const r = ${DM}.getBoundingClientRect(); const e = new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 12, bubbles: true, cancelable: true }); ${DM}.dispatchEvent(e); window.__dropPrevented = e.defaultPrevented; return 1; })()`);
check("글자가 없는 것(파일 등)을 놓으면 받지 않는다(브라우저가 파일을 열지 않게 막는다)", (await js(`window.__dropPrevented`)) === true);
await js(`${DM}.blur()`); await sleep(800);
sv = await server(D3);
check("거른 내용만 저장된다(img·script·onclick 없음)", !/<img|<script|onclick|onerror|style=|<span|<a |<iframe/i.test(sv.content) && sv.format === "html", sv);

// ===== E. 비우면 지워진다 =====
console.log("--- E. 비우기 ---");
await js(`${DM}.focus()`); await ctrl("KeyA", { key: "a" });
await press("Backspace", "Backspace", 8);
check("모두 지우면 예시 글자가 다시 보인다", (await js(`${DM}.classList.contains("empty")`)) === true, await html());
await js(`${DM}.blur()`); await sleep(800);
check("모두 지우면 메모가 삭제된다", (await server(D3)).content === "", await server(D3));
// 서식만 남은 빈 칸(굵게 켜고 띄어쓰기만)도 지운다
await js(`${DM}.focus()`); await ctrl("KeyB"); await type("   "); await js(`${DM}.blur()`); await sleep(800);
check("띄어쓰기뿐이면 저장하지 않는다(메모 없음)", (await server(D3)).content === "", await server(D3));

// ===== F. 날짜 넘김과 되돌리기 =====
console.log("--- F. 날짜 넘김 ---");
await goDay(D4);
await js(`${DM}.focus()`); await type("넷째 날 글");
await js(`document.getElementById("day-next").click()`);
await waitFor(async () => (await js(`viewedDate === ${JSON.stringify(D5)} && ${DM}.isContentEditable`)), 6000); await sleep(300);
check("다음 날 칸은 비어 있다", (await text()).trim() === "", await text());
check("넘기기 전에 쓴 글은 그날에 저장된다", (await textOf((await server(D4)).content)) === "넷째 날 글", await server(D4));
await js(`${DM}.focus()`);
await ctrl("KeyZ"); await sleep(200); await ctrl("KeyZ"); await sleep(200);
check("다른 날로 넘긴 뒤 Ctrl+Z를 눌러도 앞 날의 글이 이 칸에 돌아오지 않는다", (await text()).trim() === "", [await text(), await html()]);
await js(`${DM}.blur()`); await sleep(800);
check("다음 날에는 아무것도 저장되지 않는다", (await server(D5)).content === "", await server(D5));
check("앞 날의 메모는 그대로", (await textOf((await server(D4)).content)) === "넷째 날 글", await server(D4));
// 방향키: 메모 칸에서는 날짜를 넘기지 않는다 (진짜 키 입력)
await goDay(D4); await js(`${DM}.focus()`);
await press("ArrowLeft", "ArrowLeft", 37); await press("ArrowRight", "ArrowRight", 39);
check("메모 칸에서 ←/→는 날짜를 넘기지 않는다", (await js(`viewedDate`)) === D4);
await js(`${DM}.blur()`);

// 불러오는 동안은 잠겨 있다
await rule(`method=GET&path=/api/day-memo&ms=1500&count=1`);
await js(`showDay(${JSON.stringify(D6)})`); await sleep(300);
check("불러오는 동안 칸이 잠긴다(쓸 수 없음, 회색)", (await js(`!${DM}.isContentEditable && ${DM}.classList.contains("disabled") && ${DM}.getAttribute("aria-disabled") === "true"`)) === true);
await js(`${DM}.focus()`); await type("잠긴 칸");
check("잠긴 칸에는 글이 들어가지 않는다", !(await text()).includes("잠긴 칸"), await text());
check("다 불러오면 다시 쓸 수 있다", await waitFor(async () => (await js(`${DM}.isContentEditable && !${DM}.classList.contains("disabled")`)), 4000));
await rule();
await js(`document.activeElement && document.activeElement.blur()`);

// ===== G. 한글 조합 중 단축키 =====
console.log("--- G. 한글 조합 ---");
await js(`${DM}.focus()`);
await send("Input.imeSetComposition", { text: "가", selectionStart: 1, selectionEnd: 1 });
await ctrl("KeyB");
await send("Input.insertText", { text: "가" });
await sleep(200);
check("한글 조합 중에 Ctrl+B를 눌러도 글자가 한 번만 들어가고 칸이 멀쩡하다", (await text()).replace(/\s/g, "") === "가" && (await js(`${DM}.isContentEditable`)), [await text(), await html()]);
await type("나");
check("그 뒤로도 계속 쓸 수 있다", (await text()).replace(/\s/g, "").startsWith("가") && (await text()).includes("나"), await text());
await js(`${DM}.blur()`); await sleep(800);
check("조합 시험 글이 저장된다", (await textOf((await server(D6)).content)).replace(/\s/g, "").includes("가"), await server(D6));

// ===== H. 글자 수 한계 =====
console.log("--- H. 글자 수 한계 ---");
await js(`${DM}.focus(); ${DM}.textContent = "가".repeat(19995); ${DM}.dispatchEvent(new Event("input"));`);
await caretEnd();
await type("123456");
check("한계(20000자)를 넘게 쓰면 들어가지 않는다", (await js(`${DM}.textContent.length`)) === 19995, await js(`${DM}.textContent.length`));
await type("12345");
check("한계까지는 들어간다(20000자)", (await js(`${DM}.textContent.length`)) === 20000, await js(`${DM}.textContent.length`));
await js(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", "넘침"); ${DM}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return 1; })()`);
check("한계를 넘는 붙여넣기도 들어가지 않는다", (await js(`${DM}.textContent.length`)) === 20000);
await js(`${DM}.blur()`); await sleep(900);
check("20000자 메모가 저장된다", (await textOf((await server(D6)).content)).length === 20000, (await server(D6)).content.length);
await js(`${DM}.focus(); ${DM}.textContent = ""; ${DM}.dispatchEvent(new Event("input")); ${DM}.blur();`); await sleep(800);

// ===== I. 서버 =====
console.log("--- I. 서버 ---");
check("서버: format이 text/html이 아니면 400", (await api("/api/day-memo", "PUT", { date: D6, content: "x", format: "md" })).status === 400);
check("서버: html은 <br>만 있으면 지운다", (await api("/api/day-memo", "PUT", { date: D6, content: "<br><div><br></div>&nbsp;", format: "html" })).status === 200 && (await server(D6)).content === "");

await shot("richmemo.png");
check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
