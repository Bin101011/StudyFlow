# 프로젝트 메모 API 테스트 (임시 DB, Flask 테스트 클라이언트. 실제 DB/Google은 건드리지 않는다)
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

# ----- 옛 DB(memo 칸이 없는 projects 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, deadline TEXT, color TEXT NOT NULL, progress_mode TEXT NOT NULL DEFAULT 'auto', manual_percent INTEGER NOT NULL DEFAULT 0)")
con.execute("INSERT INTO projects (name, color) VALUES ('옛 프로젝트', '#4a7cff')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM projects")
check("옛 DB: init_db가 memo 칸을 덧붙이고 기존 프로젝트의 메모는 빈 글자", len(rows) == 1 and rows[0]["memo"] == "" and rows[0]["name"] == "옛 프로젝트", rows)
database.init_db()
check("init_db를 다시 불러도 오류가 없다(이미 있는 칸은 건드리지 않는다)", True)
database.DB_PATH = saved_path
database.init_db()

c = app.app.test_client()
post = lambda url, body: c.post(url, json=body)
patch = lambda url, body: c.patch(url, json=body)

r = post("/api/projects", {"name": "메모 프로젝트", "memo": "  제출 형식: PDF\n연락처: 교수님  "})
p = r.get_json()
check("메모와 함께 만들면 201, 앞뒤 공백/줄바꿈은 정리된다", r.status_code == 201 and p["memo"] == "제출 형식: PDF\n연락처: 교수님", p)
r2 = post("/api/projects", {"name": "메모 없는 프로젝트"})
p2 = r2.get_json()
check("메모를 안 보내면 빈 글자", r2.status_code == 201 and p2["memo"] == "", p2)

lst = c.get("/api/projects").get_json()
by_id = {x["id"]: x for x in lst}
check("목록에 memo가 들어 있다", by_id[p["id"]]["memo"] == "제출 형식: PDF\n연락처: 교수님" and by_id[p2["id"]]["memo"] == "")

r = patch("/api/projects/%d" % p2["id"], {"memo": "나중에 쓴 메모"})
check("메모만 PATCH로 고칠 수 있다", r.status_code == 200 and [x for x in c.get("/api/projects").get_json() if x["id"] == p2["id"]][0]["memo"] == "나중에 쓴 메모", r.get_json())
check("메모만 고쳐도 이름/색/진행률은 그대로", [x for x in c.get("/api/projects").get_json() if x["id"] == p2["id"]][0]["name"] == "메모 없는 프로젝트")
r = patch("/api/projects/%d" % p2["id"], {"memo": "  \n "})
check("공백뿐인 메모는 지운 것(빈 글자)", [x for x in c.get("/api/projects").get_json() if x["id"] == p2["id"]][0]["memo"] == "")
r = patch("/api/projects/%d" % p2["id"], {"name": "이름만 바꿈"})
check("메모를 안 보낸 PATCH는 메모를 건드리지 않는다", [x for x in c.get("/api/projects").get_json() if x["id"] == p["id"]][0]["memo"] == "제출 형식: PDF\n연락처: 교수님" and r.status_code == 200)
check("메모가 글자가 아니면 400", patch("/api/projects/%d" % p["id"], {"memo": 5}).status_code == 400 and post("/api/projects", {"name": "x", "memo": ["a"]}).status_code == 400)
check("메모가 너무 길면 400", patch("/api/projects/%d" % p["id"], {"memo": "가" * 5001}).status_code == 400 and post("/api/projects", {"name": "x", "memo": "가" * 5001}).status_code == 400)
check("메모는 5000자까지 허용", patch("/api/projects/%d" % p["id"], {"memo": "가" * 5000}).status_code == 200)
check("메모에 HTML 글자가 있어도 그대로 저장(화면이 textContent로 보여준다)", patch("/api/projects/%d" % p["id"], {"memo": "<b>굵게</b> & <script>x</script>"}).status_code == 200 and [x for x in c.get("/api/projects").get_json() if x["id"] == p["id"]][0]["memo"] == "<b>굵게</b> & <script>x</script>")
r = patch("/api/projects/%d" % p["id"], {"memo": "", "name": "메모 지우며 이름 바꿈", "color": "#112233"})
q = [x for x in c.get("/api/projects").get_json() if x["id"] == p["id"]][0]
check("수정 창처럼 여러 값과 함께 보내도 된다(메모 비움)", r.status_code == 200 and q["memo"] == "" and q["name"] == "메모 지우며 이름 바꿈" and q["color"] == "#112233", q)
print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
