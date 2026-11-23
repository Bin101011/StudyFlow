# 할 일의 걸리는 시간(duration_min) API 테스트 (임시 DB, Flask 테스트 클라이언트. 실제 DB/Google은 건드리지 않는다)
# "몇 시부터"는 정하지 않고 "15분 걸릴 것"만 적어 두는 값이다(2026-11-23)
import datetime, os, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import app, database

failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))

# ----- 옛 DB(duration_min 칸이 없는 tasks 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_tasks_duration.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, deadline TEXT, importance INTEGER, urgency INTEGER, project_id INTEGER, parent_id INTEGER)")
con.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-29')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM tasks")
check("옛 DB: init_db가 duration_min 칸을 덧붙이고 기존 할 일은 '안 정함'(NULL)", len(rows) == 1 and "duration_min" in rows[0] and rows[0]["duration_min"] is None and rows[0]["content"] == "옛 할 일", rows)
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

# 날짜는 "오늘로부터 30일 뒤"로 한다. 오늘로 고정하면 앞 시험에서 오늘 끝낸 할 일이 같은 목록에 섞여 나온다(다른 시험 파일의 교훈)
later = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()

t = post("/api/tasks", {"content": "영어 단어", "date": later}).get_json()
check("새 할 일의 걸리는 시간은 '안 정함'(NULL)", rowof(t["id"])["duration_min"] is None, rowof(t["id"]))

r = patch("/api/tasks/%d" % t["id"], {"duration_min": 15})
check("15분으로 정하면 200이고 저장된다", r.status_code == 200 and rowof(t["id"])["duration_min"] == 15, r.get_json())
day = c.get("/api/tasks?date=" + later).get_json()["tasks"]
check("날짜별 목록에 걸리는 시간이 나온다", any(x["id"] == t["id"] and x["duration_min"] == 15 for x in day), day)

# 다른 값을 바꿔도 걸리는 시간은 그대로
patch("/api/tasks/%d" % t["id"], {"content": "영어 단어 50개"})
patch("/api/tasks/%d" % t["id"], {"memo": "3과"})
patch("/api/tasks/%d" % t["id"], {"no_rank": True})
body = rowof(t["id"])
check("이름·메모·번호 빼기를 바꿔도 걸리는 시간은 그대로", body["duration_min"] == 15 and body["content"] == "영어 단어 50개" and body["memo"] == "3과" and body["no_rank"] == 1, body)
# 걸리는 시간만 바꾸면 다른 값은 그대로
patch("/api/tasks/%d" % t["id"], {"duration_min": 90})
body = rowof(t["id"])
check("걸리는 시간만 바꾸면 이름/날짜/완료/메모는 그대로", body["duration_min"] == 90 and body["content"] == "영어 단어 50개" and body["date"] == later and body["done"] == 0 and body["memo"] == "3과", body)

# 날짜를 옮기거나 수집함으로 보내도 남는다
later2 = (datetime.date.today() + datetime.timedelta(days=31)).isoformat()
patch("/api/tasks/%d" % t["id"], {"date": later2})
check("다른 날로 옮겨도 걸리는 시간이 남는다", rowof(t["id"])["duration_min"] == 90 and rowof(t["id"])["date"] == later2, rowof(t["id"]))
patch("/api/tasks/%d" % t["id"], {"date": None})
inbox = c.get("/api/inbox").get_json()
check("할 일 목록(수집함)에도 걸리는 시간이 나온다", any(x["id"] == t["id"] and x["duration_min"] == 90 for x in inbox), inbox)
patch("/api/tasks/%d" % t["id"], {"done": True})
check("끝내도 걸리는 시간이 남는다", rowof(t["id"])["duration_min"] == 90 and rowof(t["id"])["done"] == 1, rowof(t["id"]))

# 밀린 할 일에도 나온다 (어제 날짜의 안 끝낸 할 일)
yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
o = post("/api/tasks", {"content": "밀린 일", "date": yesterday}).get_json()
patch("/api/tasks/%d" % o["id"], {"duration_min": 30})
overdue = c.get("/api/tasks?date=" + datetime.date.today().isoformat()).get_json()["overdue"]
check("밀린 할 일 목록에도 걸리는 시간이 나온다", any(x["id"] == o["id"] and x["duration_min"] == 30 for x in overdue), overdue)

# null이면 지운다
r = patch("/api/tasks/%d" % o["id"], {"duration_min": None})
check("null을 보내면 '안 정함'으로 지운다", r.status_code == 200 and rowof(o["id"])["duration_min"] is None, r.get_json())

# 가장 짧은/긴 값은 받는다
r = patch("/api/tasks/%d" % o["id"], {"duration_min": 5})
check("5분(가장 짧은 값)은 받는다", r.status_code == 200 and rowof(o["id"])["duration_min"] == 5, r.get_json())
r = patch("/api/tasks/%d" % o["id"], {"duration_min": 720})
check("12시간(가장 긴 값)은 받는다", r.status_code == 200 and rowof(o["id"])["duration_min"] == 720, r.get_json())

# 틀린 값은 400이고 원래 값이 그대로 남는다
for bad in (4, 0, -15, 721, 15.5, "15", True, False, [15], {"m": 15}):
    r = patch("/api/tasks/%d" % o["id"], {"duration_min": bad})
    check("틀린 값 %r은 400이고 저장하지 않는다" % (bad,), r.status_code == 400 and rowof(o["id"])["duration_min"] == 720, (r.status_code, r.get_json(), rowof(o["id"])))
# 틀린 값과 다른 값을 같이 보내면 다른 값도 바꾸지 않는다
r = patch("/api/tasks/%d" % o["id"], {"content": "바뀌면 안 됨", "duration_min": 0})
check("틀린 걸리는 시간과 이름을 같이 보내면 이름도 그대로", r.status_code == 400 and rowof(o["id"])["content"] == "밀린 일", rowof(o["id"]))

r = patch("/api/tasks/999999", {"duration_min": 15})
check("없는 할 일은 404", r.status_code == 404, r.status_code)

# 순서를 바꿔도 남는다
a = post("/api/tasks", {"content": "A", "date": later}).get_json()
b = post("/api/tasks", {"content": "B", "date": later}).get_json()
patch("/api/tasks/%d" % a["id"], {"duration_min": 45})
r = c.put("/api/tasks/order", json={"date": later, "ids": [b["id"], a["id"]]})
after = c.get("/api/tasks?date=" + later).get_json()["tasks"]
check("순서를 바꿔도 걸리는 시간이 남는다", r.status_code == 200 and [x["content"] for x in after] == ["B", "A"] and after[1]["duration_min"] == 45, after)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
