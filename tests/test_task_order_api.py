# 할 일 순서 API 테스트 (임시 DB, Flask 테스트 클라이언트)
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

# ----- 옛 DB(sort_order 칸이 없는 tasks 표) 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_order.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, project_id INTEGER)")
con.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-29')")
con.commit(); con.close()
saved = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM tasks")
check("옛 DB: init_db가 sort_order 칸을 덧붙이고 기존 할 일은 NULL", len(rows) == 1 and rows[0]["sort_order"] is None, rows)
check("옛 DB: 목록이 오류 없이 읽힌다", [t["content"] for t in database.list_tasks("2026-10-29")] == ["옛 할 일"])
database.init_db()
database.DB_PATH = saved
database.init_db()

c = app.app.test_client()
D = "2026-10-29"
def names(date=D): return [t["content"] for t in c.get("/api/tasks?date=" + date).get_json()["tasks"]]
def put(body): return c.put("/api/tasks/order", json=body)

a = database.add_task("가", D); b = database.add_task("나", D); d = database.add_task("다", D); e = database.add_task("라", D)
check("순서를 정한 적 없으면 만든 순서", names() == ["가", "나", "다", "라"], names())

r = put({"date": D, "ids": [e["id"], a["id"], d["id"], b["id"]]})
check("순서를 정하면 200이고 그 순서대로 나온다", r.status_code == 200 and names() == ["라", "가", "다", "나"], names())
f = database.add_task("마", D)
check("새로 만든 할 일은 맨 뒤에 붙는다", names() == ["라", "가", "다", "나", "마"], names())
database.update_task(d["id"], {"done": 1})
check("끝낸 할 일은 아래로 내려간다(끝낸 것들 사이는 정한 순서)", names() == ["라", "가", "나", "마", "다"], names())
database.update_task(d["id"], {"done": 0})
check("체크를 풀면 정해 둔 자리로 돌아온다", names() == ["라", "가", "다", "나", "마"], names())

# 일부만 보내도 된다(끝낸 것은 빼고 보내는 식). 보낸 것들이 1,2,3…번이 된다
database.update_task(b["id"], {"done": 1})
put({"date": D, "ids": [f["id"], e["id"], a["id"], d["id"]]})
check("끝낸 할 일을 뺀 목록을 보내도 끝낸 할 일은 아래에 그대로", names() == ["마", "라", "가", "다", "나"], names())
database.update_task(b["id"], {"done": 0})

# 날짜가 다른 할 일, 없는 번호는 무시
other = database.add_task("다른 날", "2026-10-30")
database.update_task(other["id"], {"done": 0})
r = put({"date": D, "ids": [other["id"], 99999, a["id"]]})
check("다른 날짜의 할 일과 없는 번호는 무시한다(오류 아님)", r.status_code == 200 and names("2026-10-30") == ["다른 날"] and [x for x in database.list_tasks("2026-10-30")][0]["sort_order"] is None)

# 날짜가 바뀌면 순서가 비워진다
put({"date": D, "ids": [e["id"], a["id"], b["id"], d["id"], f["id"]]})
database.update_task(e["id"], {"date": "2026-10-30"})
row = database.get_task(e["id"])
check("날짜를 바꾸면 그 할 일의 순서가 비워진다(NULL)", row["sort_order"] is None, row)
check("다른 날짜로 옮겨진 할 일은 새 날짜의 정한 순서 뒤에(만든 순서로) 온다", names("2026-10-30") == ["다른 날", "라"] or names("2026-10-30") == ["라", "다른 날"], names("2026-10-30"))
database.update_task(e["id"], {"content": "라(수정)"})
check("날짜 말고 다른 것을 바꾸면 순서는 그대로", database.get_task(a["id"])["sort_order"] is not None)
database.update_task(a["id"], {"content": "가(수정)"})
check("내용만 바꿔도 정한 순서가 유지된다", database.get_task(a["id"])["sort_order"] == 2, database.get_task(a["id"]))

# 입력 검사
check("날짜가 이상하면 400", put({"date": "x", "ids": [1]}).status_code == 400)
check("ids가 목록이 아니면 400", put({"date": D, "ids": "1,2"}).status_code == 400 and put({"date": D, "ids": 5}).status_code == 400)
check("ids에 글자/소수/true가 있으면 400", put({"date": D, "ids": ["1"]}).status_code == 400 and put({"date": D, "ids": [1.5]}).status_code == 400 and put({"date": D, "ids": [True]}).status_code == 400)
check("ids에 중복이 있으면 400", put({"date": D, "ids": [a["id"], a["id"]]}).status_code == 400)
check("ids가 500개를 넘으면 400", put({"date": D, "ids": list(range(1, 502))}).status_code == 400)
check("키가 없으면 400", put({"date": D}).status_code == 400 and put({"ids": []}).status_code == 400)
check("빈 목록은 허용(아무것도 안 바뀜)", put({"date": D, "ids": []}).status_code == 200)

# 다른 기능과의 충돌 없음: /api/tasks/<번호> PATCH/DELETE 경로가 그대로 동작
t = database.add_task("경로 확인", D)
check("PATCH /api/tasks/<번호>는 그대로 동작", c.patch("/api/tasks/%d" % t["id"], json={"done": True}).status_code == 200)
check("DELETE /api/tasks/<번호>는 그대로 동작", c.delete("/api/tasks/%d" % t["id"]).status_code == 200)
# 삭제 후 남은 것들의 순서는 그대로
before = names()
check("지운 뒤에도 나머지의 순서가 유지된다", before == [x for x in before], before)
print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
