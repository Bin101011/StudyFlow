// 노트 읽기 화면의 안전장치(marked + DOMPurify) 시험 (헤드리스 Edge를 CDP로 조종, 가짜 Google 서버 5057번)
// - static/lib/purify.min.js가 실제로 불려 오는지, 평소 노트가 서식대로 보이는지, 공격 문장이 실행되지 않는지를 실제 앱 화면에서 본다
// - DOMPurify를 새 버전으로 바꿀 때마다 돌려서 달라진 곳이 없는지 확인한다
// - 임시 vault 폴더를 Temp에 만들어 쓰고 끝나면 지운다. 시험 서버는 설정을 임시 폴더로 돌려 놓아서 내 진짜 설정과 노트는 안 건드린다
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const BASE = "http://127.0.0.1:5057";
const PORT = 9412;
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");  // tests/browser의 두 단계 위 = 프로젝트 폴더
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
const api = async (url, method = "GET", body) => { const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };

// ----- 시험용 vault 만들기 -----
const vault = fs.mkdtempSync(path.join(os.tmpdir(), "studyflow_vault_"));
const normalNote = [
  "# 제목", "",
  "**굵게** *기울임* ~~취소선~~ `코드` ==형광펜== [[위키링크]] [구글](https://example.com/)", "",
  "| 이름 | 값 |", "|---|---|", "| a | 1 |", "",
  "- [ ] 할 일", "- [x] 한 일", "",
  "> 인용문", "",
  "<details><summary>펼치기</summary>", "", "안쪽 내용", "", "</details>", "",
  "<kbd>Ctrl</kbd> + <kbd>C</kbd>", "",
  "![그림](img/a.png)", "",
  "```js", "const s = '<script>alert(1)</script>';", "```", "",
].join("\n");
fs.writeFileSync(path.join(vault, "평소.md"), normalNote, "utf8");
// 공격 문장들. 실행되면 window.__fired가 올라가도록 만들어 두었다
const attacks = {
  "script 태그": "<script>window.__fired++</script>",
  "img onerror": "<img src=x onerror=\"window.__fired++\">",
  "svg onload": "<svg onload=\"window.__fired++\"></svg>",
  "a javascript:": "<a href=\"javascript:window.__fired++\">클릭</a>",
  "마크다운 javascript 링크": "[클릭](javascript:window.__fired++)",
  "iframe srcdoc": "<iframe srcdoc=\"<script>parent.__fired++</script>\"></iframe>",
  "object/embed": "<object data=\"javascript:window.__fired++\"></object><embed src=\"javascript:window.__fired++\">",
  "form action": "<form action=\"javascript:window.__fired++\"><button>x</button></form>",
  "style 안 스크립트": "<style>*{background:url(javascript:window.__fired++)}</style>",
  "body onload": "<body onload=\"window.__fired++\">",
  "input autofocus": "<input autofocus onfocus=\"window.__fired++\">",
  "details ontoggle": "<details open ontoggle=\"window.__fired++\"><summary>x</summary></details>",
  "video onerror": "<video src=x onerror=\"window.__fired++\"></video>",
  "svg animate": "<svg><animate onbegin=\"window.__fired++\" attributeName=x dur=1s></svg>",
  "math mXSS": "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=x onerror=window.__fired++&gt;\">",
  "noscript mXSS": "<noscript><p title=\"</noscript><img src=x onerror=window.__fired++>\">",
  "svg style mXSS": "<svg></p><style><a id=\"</style><img src=1 onerror=window.__fired++>\">",
  "selectedcontent": "<select><button><selectedcontent></selectedcontent></button><option selected=javascript:1><img src=x onerror=window.__fired++>x</option></select>",
  "meta/base/link": "<meta http-equiv=\"refresh\" content=\"0;url=javascript:window.__fired++\"><base href=\"javascript:window.__fired++//\"><link rel=stylesheet href=\"javascript:1\">",
  "data: 링크": "<a href=\"data:text/html,<script>window.__fired++</script>\">x</a>",
  "template": "<template><img src=x onerror=window.__fired++></template>",
  "깨진 태그": "<<script>window.__fired++//<</script>",
  "대소문자/따옴표 속임수": "<IMG SRC=x ONERROR=\"window.__fired++\"><img/src=x/onerror=window.__fired++>",
};
const attackFiles = Object.keys(attacks).map((name, i) => ({ name, file: "공격" + String(i + 1).padStart(2, "0") + ".md" }));
for (const a of attackFiles) { fs.writeFileSync(path.join(vault, a.file), "# " + a.name + "\n\n" + attacks[a.name] + "\n\n뒤따르는 평범한 글\n", "utf8"); }

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}); await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(document, "hidden", { get: () => false });` });

  // 시험 서버의 설정에 vault 폴더를 알려 주고, 화면을 새로 연다
  const current = (await api("/api/settings")).data.values;
  const saved = await api("/api/settings", "PUT", { ...current, vaultPath: vault });
  check("(준비) 시험 vault 폴더가 설정에 저장되었다", saved.status === 200 && saved.data.vaultPath === vault, saved);
  await send("Page.navigate", { url: BASE + "/" }); await sleep(3000);
  await js(`document.querySelector('[data-tab="notes"]').click()`); await sleep(1500);

  console.log("--- 불러온 라이브러리 ---");
  const fileHeader = fs.readFileSync(path.join(PROJECT, "static", "lib", "purify.min.js"), "utf8").slice(0, 200);
  const fileVersion = (/DOMPurify (\d+\.\d+\.\d+)/.exec(fileHeader) || [])[1];
  const pageVersion = await js(`typeof DOMPurify === "undefined" ? null : DOMPurify.version`);
  check("화면에서 DOMPurify가 불려 왔고 static/lib/purify.min.js와 같은 버전이다 (" + fileVersion + ")", Boolean(fileVersion) && pageVersion === fileVersion, [fileVersion, pageVersion]);
  check("DOMPurify가 지원되는 브라우저로 인식한다 (isSupported)", (await js(`DOMPurify.isSupported`)) === true);
  check("marked도 불려 왔다", (await js(`typeof marked`)) === "object" || (await js(`typeof marked`)) === "function");

  console.log("--- 평소 노트는 서식대로 보인다 ---");
  await js(`window.__fired = 0; openNote("평소.md")`);
  const opened = await (async () => { for (let i = 0; i < 40; i++) { if (await js(`!!document.querySelector("#notes-read h1")`)) return true; await sleep(150); } return false; })();
  check("노트를 열었고 읽기 화면에 제목(h1)이 보인다", opened);
  const q = (selector) => js(`document.querySelectorAll(${JSON.stringify("#notes-read " + selector)}).length`);
  const text = (selector) => js(`(document.querySelector(${JSON.stringify("#notes-read " + selector)}) || {}).textContent`);
  check("제목 글자가 맞다", (await text("h1")) === "제목", await text("h1"));
  check("굵게/기울임/취소선/코드가 각각 태그로 보인다", (await q("strong")) === 1 && (await q("em")) === 1 && (await q("del")) === 1 && (await q("p code")) === 1);
  check("형광펜(==글자==)이 mark로 보인다", (await text("mark")) === "형광펜", await text("mark"));
  check("웹 링크가 a 태그로 남아 있다", (await js(`document.querySelector('#notes-read a[href="https://example.com/"]') !== null`)) === true);
  check("[[위키링크]] 글자가 화면에 있다", (await js(`document.getElementById("notes-read").textContent.includes("위키링크")`)) === true);
  check("표가 보인다 (머리 1줄, 몸 1줄)", (await q("table thead tr")) === 1 && (await q("table tbody tr")) === 1);
  check("체크박스 2개, 그중 1개는 체크됨, 눌러서 바꿀 수 없다(disabled)", (await q('input[type="checkbox"]')) === 2 && (await q('input[type="checkbox"]:checked')) === 1 && (await q('input[type="checkbox"]:not([disabled])')) === 0);
  check("인용문(blockquote)이 보인다", (await q("blockquote")) === 1);
  check("details/summary가 보인다", (await q("details > summary")) === 1 && (await text("details > summary")) === "펼치기");
  check("kbd 태그 2개가 남아 있다", (await q("kbd")) === 2);
  check("이미지가 img 태그로 남아 있다", (await js(`document.querySelector('#notes-read img') && document.querySelector('#notes-read img').getAttribute("src")`)) === "img/a.png");
  check("코드 블록 안의 <script>는 글자 그대로 보이고 실제 script는 없다", (await text("pre code")).includes("<script>alert(1)</script>") && (await q("script")) === 0, await text("pre code"));
  check("평소 노트를 여는 동안 코드가 실행되지 않았다", (await js(`window.__fired`)) === 0);

  console.log("--- 공격 문장은 실행되지 않고 위험한 태그/속성이 남지 않는다 ---");
  const dangerous = `(() => {
    const bad = [];
    // form, style, template은 DOMPurify가 기본으로 허용하는 태그라서 목록에 넣지 않는다 (위험한 속성만 지운다. 아래에서 속성을 따로 본다)
    const banned = ["script", "iframe", "object", "embed", "meta", "base", "link", "frame", "frameset"];
    for (const el of document.getElementById("notes-read").querySelectorAll("*")) {
      const tag = el.tagName.toLowerCase();
      if (banned.includes(tag)) bad.push("<" + tag + ">");
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) bad.push(tag + "@" + a.name);
        if (/^\\s*(javascript|vbscript):/i.test(a.value)) bad.push(tag + "@" + a.name + "=" + a.value.slice(0, 25));
        if (tag === "a" && /^\\s*data:/i.test(a.value)) bad.push("a@" + a.name + "=data:");
      }
    }
    return bad;
  })()`;
  for (const a of attackFiles) {
    await js(`window.__fired = 0; openNote(${JSON.stringify(a.file)})`);
    // 열렸는지는 제목(h1)이 이 공격 이름으로 바뀐 것으로 안다
    let shown = false;
    for (let i = 0; i < 40; i++) { if ((await js(`(document.querySelector("#notes-read h1") || {}).textContent`)) === a.name) { shown = true; break; } await sleep(100); }
    await sleep(300);  // 늦게 실행되는 코드(이미지 오류 등)를 기다린다
    const bad = await js(dangerous);
    const fired = await js(`window.__fired`);
    // (일부 공격 문장은 HTML 해석을 망가뜨려서 뒤따르는 글을 삼키기도 하므로, 뒤의 글이 보이는지는 조건에 넣지 않는다)
    check("[" + a.name + "] 실행 안 됨, 위험한 태그/속성 없음", shown && fired === 0 && bad.length === 0, { shown, fired, bad });
  }

  check("자바스크립트 오류 없음", jsErrors.length === 0, jsErrors.join(" | "));
} finally {
  fs.rmSync(vault, { recursive: true, force: true });
}
console.log(failed ? `\n실패 ${failed}개` : "\n모두 통과");
ws.close(); edge.kill(); process.exit(failed ? 1 : 0);
