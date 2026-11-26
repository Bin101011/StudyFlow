# 하루 메모 API 시험 (2026-11-20, 서식 메모). 임시 DB와 Flask 시험 클라이언트를 쓴다. 진짜 DB와 Google은 건드리지 않는다
import os, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import app, database

failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))

# ----- 옛 DB(format 칸이 없는 day_memos 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_day_memos.db")
if os.path.exists(old_path):
    os.remove(old_path)
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE day_memos (date TEXT PRIMARY KEY, content TEXT NOT NULL)")
con.execute("INSERT INTO day_memos (date, content) VALUES ('2026-10-29', '옛 메모 <b>꺾쇠</b>\n둘째 줄')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM day_memos")
check("옛 DB: init_db가 format 칸을 덧붙이고 기존 메모는 text, 내용은 그대로", len(rows) == 1 and rows[0]["format"] == "text" and rows[0]["content"] == "옛 메모 <b>꺾쇠</b>\n둘째 줄", rows)
database.init_db()
rows, _ = database.run("SELECT * FROM day_memos")
check("init_db를 다시 불러도 오류 없이 그대로", len(rows) == 1 and rows[0]["format"] == "text", rows)
check("get_day_memo는 (내용, 형식)", database.get_day_memo("2026-10-29") == ("옛 메모 <b>꺾쇠</b>\n둘째 줄", "text"))
database.DB_PATH = saved_path
database.init_db()

c = app.app.test_client()
D = "2031-04-01"
get = lambda d=D: c.get("/api/day-memo?date=" + d)
put = lambda body: c.put("/api/day-memo", json=body)

# ----- 읽기 -----
r = get()
check("없는 날: 빈 글자, 형식 text", r.status_code == 200 and r.get_json() == {"date": D, "content": "", "format": "text"}, r.get_json())

# ----- format을 안 보내면 text (서식 기능 전과 같은 요청) -----
check("format 없이 저장 200", put({"date": D, "content": "그냥 글 <b>"}).status_code == 200)
check("format 없이 저장하면 text로 읽힌다", get().get_json() == {"date": D, "content": "그냥 글 <b>", "format": "text"}, get().get_json())

# ----- html -----
H = "보통 <b>굵게</b> <i>기울임</i> <strike>취소</strike><br>둘째 줄"
check("html 저장 200", put({"date": D, "content": H, "format": "html"}).status_code == 200)
check("html은 그대로 저장되고 형식이 html", get().get_json() == {"date": D, "content": H, "format": "html"}, get().get_json())
check("text로 다시 저장하면 형식도 text로 바뀐다", put({"date": D, "content": "글자", "format": "text"}).status_code == 200 and get().get_json()["format"] == "text")

# ----- 틀린 format -----
for bad in ("md", "", "HTML", None, 5, ["html"], {"a": 1}, True):
    r = put({"date": D, "content": "x", "format": bad})
    check("format %r는 400" % (bad,), r.status_code == 400, r.get_json())
check("틀린 format이면 저장하지 않는다(그대로 '글자')", get().get_json()["content"] == "글자")

# ----- 길이 한계: text는 20000자, html은 태그만큼 길어지므로 100000자 -----
check("text 20000자는 된다", put({"date": D, "content": "가" * 20000}).status_code == 200)
check("text 20001자는 400", put({"date": D, "content": "가" * 20001}).status_code == 400)
check("html 100000자는 된다", put({"date": D, "content": "<b>" + "가" * 99993 + "</b>", "format": "html"}).status_code == 200)
check("html 100001자는 400", put({"date": D, "content": "가" * 100001, "format": "html"}).status_code == 400)
r = put({"date": D, "content": "가" * 100001, "format": "html"})
check("한계 넘음 안내는 보이는 글자 기준(20000자)으로 말한다", "20000" in r.get_json()["error"], r.get_json())

# ----- 비우기: 보이는 글자가 없으면 지운다 -----
for empty in ("", "   ", "<br>", "<div><br></div>", "<b> </b>", "&nbsp;", "<p>&#160;</p>\n"):
    put({"date": D, "content": "있음", "format": "html"})
    r = put({"date": D, "content": empty, "format": "html"})
    check("html %r는 지운다" % empty, r.status_code == 200 and get().get_json() == {"date": D, "content": "", "format": "text"}, get().get_json())
put({"date": D, "content": "있음", "format": "html"})
put({"date": D, "content": "  \n ", "format": "text"})
check("text 공백뿐이면 지운다(예전과 같다)", get().get_json()["content"] == "")
check("글자 하나라도 있으면 남긴다", put({"date": D, "content": "<b>가</b>", "format": "html"}).status_code == 200 and get().get_json()["content"] == "<b>가</b>")
check("꺾쇠 글자(&lt;)만 있어도 글자로 본다", put({"date": D, "content": "&lt;", "format": "html"}).status_code == 200 and get().get_json()["content"] == "&lt;")

# ----- 예전 검사들 -----
check("잘못된 날짜 GET 400", c.get("/api/day-memo?date=abc").status_code == 400)
check("잘못된 날짜 PUT 400", put({"date": "2026-13-40", "content": "x"}).status_code == 400)
check("content가 글자가 아니면 400", put({"date": D, "content": 5, "format": "html"}).status_code == 400)
check("content 없으면 400", put({"date": D, "format": "html"}).status_code == 400)
check("다른 날의 메모와 섞이지 않는다", put({"date": "2031-04-02", "content": "다음 날", "format": "html"}).status_code == 200 and get().get_json()["content"] == "&lt;" and get("2031-04-02").get_json()["content"] == "다음 날")

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
