# 프로젝트 보관(2026-11-24) API 테스트 (임시 DB, Flask 테스트 클라이언트. 실제 DB/Google은 건드리지 않는다)
# 보관 = 끝난 프로젝트를 지우지 않고 치워 두기. 지난 할 일의 프로젝트 이름표와 색이 남는지, 우선순위 탭에서는 빠지는지 본다
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

# ----- 옛 DB(archived 칸이 없는 projects 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_archive.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, deadline TEXT, color TEXT NOT NULL, progress_mode TEXT NOT NULL DEFAULT 'auto', manual_percent INTEGER NOT NULL DEFAULT 0)")
con.execute("INSERT INTO projects (name, color) VALUES ('옛 프로젝트', '#4a7cff')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM projects")
check("옛 DB: init_db가 archived 칸을 덧붙이고 기존 프로젝트는 0(보관 안 함)", len(rows) == 1 and rows[0]["archived"] == 0 and rows[0]["name"] == "옛 프로젝트", rows)
database.init_db()
check("init_db를 다시 불러도 오류가 없다", True)
database.DB_PATH = saved_path
database.init_db()

c = app.app.test_client()
get_project = lambda pid: [x for x in c.get("/api/projects").get_json() if x["id"] == pid][0]

folder = c.post("/api/folders", json={"name": "학교"}).get_json()
p = c.post("/api/projects", json={"name": "끝난 과제", "color": "#e8590c", "folderId": folder["id"], "deadline": "2026-11-01"}).get_json()
other = c.post("/api/projects", json={"name": "진행 중", "color": "#2f9e44"}).get_json()

check("새 프로젝트는 보관 안 됨(archived false)", get_project(p["id"])["archived"] is False and get_project(other["id"])["archived"] is False)

# 날짜 있는 할 일(지난 기록), 날짜 없는 안 끝낸 단계, 끝낸 단계, 다른 프로젝트의 단계
dated = database.add_task("과제 제출", "2026-10-30", p["id"])
database.update_task(dated["id"], {"done": 1})
open_step = database.add_task("남은 정리", None, p["id"])
done_step = database.add_task("끝낸 단계", None, p["id"])
database.update_task(done_step["id"], {"done": 1})
other_step = database.add_task("다른 프로젝트 단계", None, other["id"])
loose = database.add_task("프로젝트 없는 일", None)

r = c.patch("/api/projects/%d" % p["id"], json={"archived": True})
check("archived: true로 보관하면 200", r.status_code == 200, r.get_json())
q = get_project(p["id"])
check("보관하면 목록에 archived true", q["archived"] is True, q)
check("보관해도 이름·색·폴더·마감일은 그대로", q["name"] == "끝난 과제" and q["color"] == "#e8590c" and q["folderId"] == folder["id"] and q["deadline"] == "2026-11-01", q)
# 단계 3개: 날짜 있는 "과제 제출"(끝냄)도 프로젝트에 연결된 단계로 센다
check("보관해도 단계들은 그대로 남는다(지우지 않음)", len(q["tasks"]) == 3 and q["total"] == 3 and q["doneCount"] == 2, q)
check("다른 프로젝트는 영향 없음", get_project(other["id"])["archived"] is False)

day = c.get("/api/tasks?date=2026-10-30").get_json()["tasks"]
row = [t for t in day if t["id"] == dated["id"]]
check("보관한 프로젝트의 지난 할 일에 프로젝트 이름과 색이 남는다(삭제와의 차이)",
      len(row) == 1 and row[0]["project_name"] == "끝난 과제" and row[0]["project_color"] == "#e8590c", row)
days = c.get("/api/task-days?start=2026-10-01&end=2026-11-01")
check("캘린더 탭의 날짜별 목록도 그대로 불러온다", days.status_code == 200, days.get_json())

prio_ids = [t["id"] for t in c.get("/api/priority-tasks").get_json()]
check("우선순위 탭: 보관한 프로젝트의 안 끝낸 단계는 빠진다", open_step["id"] not in prio_ids, prio_ids)
check("우선순위 탭: 다른 프로젝트 단계와 프로젝트 없는 일은 그대로 나온다", other_step["id"] in prio_ids and loose["id"] in prio_ids, prio_ids)

r = c.patch("/api/projects/%d" % p["id"], json={"archived": False})
q = get_project(p["id"])
check("archived: false로 보관을 풀면 원래 폴더 그대로", r.status_code == 200 and q["archived"] is False and q["folderId"] == folder["id"], q)
prio_ids = [t["id"] for t in c.get("/api/priority-tasks").get_json()]
check("보관을 풀면 우선순위 탭에 단계가 다시 나온다", open_step["id"] in prio_ids, prio_ids)

for bad in (1, 0, "true", None, [True]):
    r = c.patch("/api/projects/%d" % p["id"], json={"archived": bad})
    check("archived가 true/false가 아니면 400: %r" % (bad,), r.status_code == 400, r.get_json())
check("잘못된 값을 보내도 보관 상태는 그대로", get_project(p["id"])["archived"] is False)

r = c.patch("/api/projects/%d" % p["id"], json={"name": "이름만"})
check("archived를 안 보낸 PATCH는 보관 상태를 건드리지 않는다", r.status_code == 200 and get_project(p["id"])["archived"] is False)
c.patch("/api/projects/%d" % p["id"], json={"archived": True})
c.patch("/api/projects/%d" % p["id"], json={"memo": "메모"})
check("보관한 채로 다른 값을 고쳐도 보관은 유지", get_project(p["id"])["archived"] is True)

check("없는 프로젝트를 보관하면 404", c.patch("/api/projects/99999", json={"archived": True}).status_code == 404)

r = c.delete("/api/projects/%d" % p["id"])
check("보관한 프로젝트도 지울 수 있다", r.status_code == 200 and all(x["id"] != p["id"] for x in c.get("/api/projects").get_json()))

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
