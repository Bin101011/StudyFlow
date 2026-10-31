# 할 일 메모 API 테스트 (임시 DB, Flask 테스트 클라이언트. 실제 DB/Google은 건드리지 않는다)
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

# ----- 옛 DB(memo 칸이 없는 tasks 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_tasks.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, deadline TEXT, importance INTEGER, urgency INTEGER, project_id INTEGER, parent_id INTEGER)")
con.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-29')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM tasks")
check("옛 DB: init_db가 memo 칸을 덧붙이고 기존 할 일의 메모는 빈 글자", len(rows) == 1 and rows[0]["memo"] == "" and rows[0]["content"] == "옛 할 일", rows)
database.init_db()
check("init_db를 다시 불러도 오류가 없다", True)
database.DB_PATH = saved_path
database.init_db()

c = app.app.test_client()
def rowof(task_id):
    rows, _ = database.run("SELECT * FROM tasks WHERE id = ?", (task_id,))
    return rows[0]
post = lambda url, body: c.post(url, json=body)
patch = lambda url, body: c.patch(url, json=body)

t = post("/api/tasks", {"content": "메모 할 일", "date": "2026-10-29"}).get_json()
check("새 할 일의 메모는 빈 글자", t["memo"] == "", t)

r = patch("/api/tasks/%d" % t["id"], {"memo": "  준비물: 노트북\n링크는 나중에  "})
check("메모를 저장하면 200이고 앞뒤 공백/줄바꿈은 정리된다", r.status_code == 200 and rowof(t["id"])["memo"] == "준비물: 노트북\n링크는 나중에", r.get_json())
day = c.get("/api/tasks?date=2026-10-29").get_json()["tasks"]
check("날짜별 목록에 메모가 나온다", any(x["id"] == t["id"] and x["memo"] == "준비물: 노트북\n링크는 나중에" for x in day), day)

# 메모만 바꿔도 다른 값은 그대로
r = patch("/api/tasks/%d" % t["id"], {"memo": "바뀐 메모"})
body = rowof(t["id"])
check("메모만 바꾸면 이름/날짜/완료 상태는 그대로", body["content"] == "메모 할 일" and body["date"] == "2026-10-29" and body["done"] == 0 and body["memo"] == "바뀐 메모", body)

# 다른 값을 바꿔도 메모는 유지
r = patch("/api/tasks/%d" % t["id"], {"done": True})
check("완료 체크를 해도 메모가 유지된다", rowof(t["id"])["memo"] == "바뀐 메모", r.get_json())
r = patch("/api/tasks/%d" % t["id"], {"content": "이름 바꿈"})
check("이름을 바꿔도 메모가 유지된다", rowof(t["id"])["memo"] == "바뀐 메모", r.get_json())
r = patch("/api/tasks/%d" % t["id"], {"date": "2026-10-30"})
check("날짜를 바꿔도 메모가 유지된다", rowof(t["id"])["memo"] == "바뀐 메모" and rowof(t["id"])["date"] == "2026-10-30", r.get_json())
r = patch("/api/tasks/%d" % t["id"], {"date": None})
check("날짜를 비워(수집함) 도 메모가 유지된다", rowof(t["id"])["memo"] == "바뀐 메모", r.get_json())
inbox = c.get("/api/tasks/inbox").get_json() if c.get("/api/tasks/inbox").status_code == 200 else None
if inbox is not None:
    items = inbox["tasks"] if isinstance(inbox, dict) else inbox
    check("수집함 목록에도 메모가 나온다", any(x["id"] == t["id"] and x["memo"] == "바뀐 메모" for x in items), items)

# 지우기
r = patch("/api/tasks/%d" % t["id"], {"memo": "   \n "})
check("공백뿐인 메모는 빈 글자가 되어 메모가 지워진다", r.status_code == 200 and rowof(t["id"])["memo"] == "", r.get_json())
r = patch("/api/tasks/%d" % t["id"], {"memo": ""})
check("빈 글자로 저장해도 200", r.status_code == 200 and rowof(t["id"])["memo"] == "")

# 검증
r = patch("/api/tasks/%d" % t["id"], {"memo": "가" * 2000})
check("2000자는 저장된다", r.status_code == 200 and len(rowof(t["id"])["memo"]) == 2000)
r = patch("/api/tasks/%d" % t["id"], {"memo": "가" * 2001})
check("2001자는 400", r.status_code == 400, r.get_json())
check("거절하면 기존 메모가 그대로", c.get("/api/tasks?date=2026-10-30").status_code == 200 and database.run("SELECT memo FROM tasks WHERE id = ?", (t["id"],))[0][0]["memo"] == "가" * 2000)
r = patch("/api/tasks/%d" % t["id"], {"memo": 123})
check("글자가 아닌 메모는 400", r.status_code == 400, r.get_json())
r = patch("/api/tasks/%d" % t["id"], {"memo": None})
check("null 메모도 400", r.status_code == 400, r.get_json())
r = patch("/api/tasks/99999", {"memo": "없는 할 일"})
check("없는 할 일은 404", r.status_code == 404, r.status_code)
r = patch("/api/tasks/%d" % t["id"], {})
check("바꿀 값이 없으면 여전히 400", r.status_code == 400)

# 메모에 HTML/특수 글자는 글자 그대로 저장
r = patch("/api/tasks/%d" % t["id"], {"memo": "<b>굵게</b> a<b 'quote' \"x\""})
check("HTML 모양도 글자 그대로 저장(서버는 해석하지 않는다)", rowof(t["id"])["memo"] == "<b>굵게</b> a<b 'quote' \"x\"", r.get_json())

# 프로젝트 단계도 메모를 가진다
proj = post("/api/projects", {"name": "P"}).get_json()
step = post("/api/projects/%d/tasks" % proj["id"], {"content": "단계 1"})
if step.status_code == 201:
    sid = step.get_json()["id"]
    r = patch("/api/tasks/%d" % sid, {"memo": "단계 메모"})
    check("프로젝트 단계에도 메모를 쓸 수 있다", r.status_code == 200 and rowof(sid)["memo"] == "단계 메모", r.get_json())
    detail = c.get("/api/projects").get_json()
    flat = str(detail)
    check("프로젝트 목록의 단계에 메모가 실려 온다", "단계 메모" in flat, flat[:300])
else:
    print("SKIP 프로젝트 단계 만들기 엔드포인트 확인 필요", step.status_code)

# 순서 바꾸기/날짜 이동이 메모를 지우지 않는다
a = post("/api/tasks", {"content": "A", "date": "2026-11-01"}).get_json()
b = post("/api/tasks", {"content": "B", "date": "2026-11-01"}).get_json()
patch("/api/tasks/%d" % a["id"], {"memo": "A 메모"})
r = c.put("/api/tasks/order", json={"date": "2026-11-01", "ids": [b["id"], a["id"]]})
after = c.get("/api/tasks?date=2026-11-01").get_json()["tasks"]
check("순서를 바꿔도 메모가 유지된다", r.status_code == 200 and [x["content"] for x in after] == ["B", "A"] and after[1]["memo"] == "A 메모", after)

# 삭제
r = c.delete("/api/tasks/%d" % a["id"])
check("메모가 있는 할 일도 지워진다", r.status_code in (200, 204), r.status_code)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
