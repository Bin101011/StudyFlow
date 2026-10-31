# 프로젝트 단계 순서(step_order)와 새 프로젝트 기본 색 API 테스트 (임시 DB, Flask 테스트 클라이언트)
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

# ----- 옛 DB(step_order 칸이 없는 tasks 표)에서 마이그레이션 -----
old_path = os.path.join(fake_google.TMP, "old_steps.db")
con = sqlite3.connect(old_path)
con.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, deadline TEXT, importance INTEGER, urgency INTEGER, project_id INTEGER, parent_id INTEGER)")
con.execute("INSERT INTO tasks (content) VALUES ('옛 단계')")
con.commit(); con.close()
saved_path = database.DB_PATH
database.DB_PATH = old_path
database.init_db()
rows, _ = database.run("SELECT * FROM tasks")
check("옛 DB: init_db가 step_order 칸을 덧붙이고 기존 값은 NULL", len(rows) == 1 and "step_order" in rows[0] and rows[0]["step_order"] is None, rows)
database.init_db()
check("init_db를 다시 불러도 오류가 없다", True)
database.DB_PATH = saved_path
database.init_db()

c = app.app.test_client()
post = lambda url, body: c.post(url, json=body)
patch = lambda url, body: c.patch(url, json=body)
put = lambda url, body: c.put(url, json=body)

def mk_project(name, **kw):
    return post("/api/projects", dict(name=name, **kw)).get_json()
def mk_step(project, content, parent=None, deadline=None):
    body = {"content": content}
    if parent is not None: body["parentId"] = parent
    else: body["projectId"] = project["id"]
    t = post("/api/tasks", body).get_json()
    if deadline: patch("/api/tasks/%d" % t["id"], {"deadline": deadline})
    return t
def steps_of(project_id, parent=None):
    projects = c.get("/api/projects").get_json()
    p = next(x for x in projects if x["id"] == project_id)
    if parent is None: return [s["content"] for s in p["tasks"]]
    return [ch["content"] for s in p["tasks"] if s["id"] == parent for ch in s["children"]]

# ===== 기본 정렬: 마감일 순 =====
P = mk_project("정렬 프로젝트")
a = mk_step(P, "A 마감 없음1")
b = mk_step(P, "B 12월", deadline="2026-12-10")
d = mk_step(P, "C 11월", deadline="2026-11-05")
e = mk_step(P, "D 마감 없음2")
f = mk_step(P, "E 11월 먼저", deadline="2026-11-01")
check("기본: 마감일 빠른 순, 마감일 없는 것은 뒤(만든 순서)", steps_of(P["id"]) == ["E 11월 먼저", "C 11월", "B 12월", "A 마감 없음1", "D 마감 없음2"], steps_of(P["id"]))
patch("/api/tasks/%d" % d["id"], {"done": True})
check("끝낸 단계는 마감일이 빨라도 맨 아래", steps_of(P["id"]) == ["E 11월 먼저", "B 12월", "A 마감 없음1", "D 마감 없음2", "C 11월"], steps_of(P["id"]))
patch("/api/tasks/%d" % d["id"], {"done": False})

# 같은 마감일이면 만든 순서
g = mk_step(P, "F 12월 같은날", deadline="2026-12-10")
check("마감일이 같으면 만든 순서", steps_of(P["id"]).index("B 12월") < steps_of(P["id"]).index("F 12월 같은날"))

# 하위 단계가 있는 단계: 자기 마감일이 없으면 안 끝낸 하위 단계의 가장 빠른 마감일을 쓴다
Q = mk_project("하위 프로젝트")
top1 = mk_step(Q, "상위1 (마감 없음, 하위 11/20)")
top2 = mk_step(Q, "상위2 (마감 11/10)", deadline="2026-11-10")
top3 = mk_step(Q, "상위3 (마감 없음, 하위 없음)")
mk_step(Q, "하위 1-a 12월", parent=top1["id"], deadline="2026-12-01")
c1b = mk_step(Q, "하위 1-b 11/20", parent=top1["id"], deadline="2026-11-20")
mk_step(Q, "하위 1-c 마감 없음", parent=top1["id"])
mk_step(Q, "하위 1-d 11/02", parent=top1["id"], deadline="2026-11-02")
check("하위 단계도 마감일 순", steps_of(Q["id"], top1["id"]) == ["하위 1-d 11/02", "하위 1-b 11/20", "하위 1-a 12월", "하위 1-c 마감 없음"], steps_of(Q["id"], top1["id"]))
check("상위 단계는 하위의 가장 빠른 마감일(11/02)로 정렬된다", steps_of(Q["id"])[:2] == ["상위1 (마감 없음, 하위 11/20)", "상위2 (마감 11/10)"], steps_of(Q["id"]))
d1 = next(ch for ch in next(s for s in c.get("/api/projects").get_json() if s["id"] == Q["id"])["tasks"][0]["children"] if ch["content"].startswith("하위 1-d"))
patch("/api/tasks/%d" % d1["id"], {"done": True})
check("끝낸 하위 단계의 마감일은 상위 정렬에 쓰지 않는다(다음 마감일 11/20로)", steps_of(Q["id"])[:2] == ["상위2 (마감 11/10)", "상위1 (마감 없음, 하위 11/20)"], steps_of(Q["id"]))

# ===== 순서 바꾸기 API =====
ids = {s["content"]: s["id"] for s in c.get("/api/projects").get_json()[0]["tasks"]} if False else None
def top_ids(pid):
    return [s["id"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == pid)["tasks"]]
before = top_ids(P["id"])
open_ids = [t for t in before if t != d["id"]]  # 전부 안 끝낸 상태라 그대로 사용
rev = list(reversed(before))
r = put("/api/projects/%d/steps/order" % P["id"], {"parentId": None, "ids": rev})
check("순서 바꾸기는 200", r.status_code == 200, r.get_json())
check("정한 순서대로 보인다(마감일 순서를 뒤집음)", top_ids(P["id"]) == rev, [top_ids(P["id"]), rev])
# 새 단계는 정한 것들 뒤
h = mk_step(P, "H 새 단계 (마감 아주 빠름)", deadline="2026-10-30")
check("정한 뒤에 만든 단계는 정한 단계들 뒤에 온다(마감일이 빨라도)", top_ids(P["id"])[:-1] == rev and top_ids(P["id"])[-1] == h["id"], top_ids(P["id"]))
# 일부만 보내기 + 끝낸 단계
patch("/api/tasks/%d" % rev[0], {"done": True})
check("끝낸 단계는 정한 순서가 있어도 맨 아래", top_ids(P["id"])[-1] == rev[0], top_ids(P["id"]))
patch("/api/tasks/%d" % rev[0], {"done": False})
# 하위 단계끼리
kids = [ch["id"] for ch in next(s for s in c.get("/api/projects").get_json() if s["id"] == Q["id"])["tasks"] if s["id"] == top1["id"]] if False else None
children = [ch["id"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == Q["id"])["tasks"] if s["id"] == top1["id"] for ch in s["children"]]
patch("/api/tasks/%d" % d1["id"], {"done": False})
children = [ch["id"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == Q["id"])["tasks"] if s["id"] == top1["id"] for ch in s["children"]]
rv = list(reversed(children))
r = put("/api/projects/%d/steps/order" % Q["id"], {"parentId": top1["id"], "ids": rv})
cur = [ch["id"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == Q["id"])["tasks"] if s["id"] == top1["id"] for ch in s["children"]]
check("하위 단계의 순서도 바꿀 수 있다", r.status_code == 200 and cur == rv, [r.status_code, cur, rv])
tops_q = [s["content"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == Q["id"])["tasks"]]
rows_q, _ = database.run("SELECT content, step_order FROM tasks WHERE project_id = ? AND parent_id IS NULL", (Q["id"],))
check("하위 단계 순서를 바꿔도 맨 위 단계들의 순서(step_order)는 건드리지 않는다", all(row["step_order"] is None for row in rows_q), rows_q)

# 다른 묶음의 번호는 무시
rows0, _ = database.run("SELECT id, step_order FROM tasks WHERE project_id = ? AND parent_id IS NULL", (Q["id"],))
before_orders = {row["id"]: row["step_order"] for row in rows0}
r = put("/api/projects/%d/steps/order" % Q["id"], {"parentId": None, "ids": children + [top2["id"]]})
rows1, _ = database.run("SELECT id, step_order FROM tasks WHERE id IN (%s)" % ",".join(str(i) for i in children), ())
check("맨 위 순서에 하위 단계 번호를 섞어 보내면 그 번호는 무시된다(하위 단계 순서가 안 바뀜)", r.status_code == 200 and all(row["step_order"] in range(1, 10) for row in rows1) and cur == [ch["id"] for s in next(x for x in c.get("/api/projects").get_json() if x["id"] == Q["id"])["tasks"] if s["id"] == top1["id"] for ch in s["children"]], rows1)
rows_children, _ = database.run("SELECT id, step_order FROM tasks WHERE parent_id = ?", (top1["id"],))
check("하위 단계의 step_order는 하위 순서 저장 때 정한 값 그대로", sorted(row["step_order"] for row in rows_children) == [1, 2, 3, 4], rows_children)
# 다른 프로젝트의 번호는 무시
orders_P, _ = database.run("SELECT id, step_order FROM tasks WHERE project_id = ?", (P["id"],))
r = put("/api/projects/%d/steps/order" % Q["id"], {"parentId": None, "ids": [row["id"] for row in orders_P]})
orders_P2, _ = database.run("SELECT id, step_order FROM tasks WHERE project_id = ?", (P["id"],))
check("다른 프로젝트의 단계 번호는 무시된다(그 프로젝트의 step_order가 그대로)", r.status_code == 200 and orders_P == orders_P2, [orders_P, orders_P2])

# 검증
check("없는 프로젝트는 404", put("/api/projects/99999/steps/order", {"parentId": None, "ids": []}).status_code == 404)
check("ids가 없으면 400", put("/api/projects/%d/steps/order" % P["id"], {"parentId": None}).status_code == 400)
check("ids가 목록이 아니면 400", put("/api/projects/%d/steps/order" % P["id"], {"ids": "1,2"}).status_code == 400)
check("ids에 중복이 있으면 400", put("/api/projects/%d/steps/order" % P["id"], {"ids": [1, 1]}).status_code == 400)
check("ids에 글자/참거짓이 있으면 400", put("/api/projects/%d/steps/order" % P["id"], {"ids": ["1"]}).status_code == 400 and put("/api/projects/%d/steps/order" % P["id"], {"ids": [True]}).status_code == 400)
check("ids가 너무 길면 400", put("/api/projects/%d/steps/order" % P["id"], {"ids": list(range(1, 600))}).status_code == 400)
check("parentId가 다른 프로젝트의 단계면 400", put("/api/projects/%d/steps/order" % P["id"], {"parentId": top1["id"], "ids": []}).status_code == 400)
check("parentId가 하위 단계면 400", put("/api/projects/%d/steps/order" % Q["id"], {"parentId": children[0], "ids": []}).status_code == 400)
check("parentId가 없는 번호면 400", put("/api/projects/%d/steps/order" % Q["id"], {"parentId": 99999, "ids": []}).status_code == 400)
check("빈 ids도 200(아무 것도 안 바뀜)", put("/api/projects/%d/steps/order" % P["id"], {"parentId": None, "ids": []}).status_code == 200)

# 순서가 날짜 이동/체크/메모/삭제와 상관없이 유지
before_P = top_ids(P["id"])
patch("/api/tasks/%d" % before_P[1], {"memo": "메모"})
patch("/api/tasks/%d" % before_P[1], {"date": "2026-11-11"})
check("메모/날짜를 바꿔도 단계 순서가 그대로", top_ids(P["id"]) == before_P, top_ids(P["id"]))
c.delete("/api/tasks/%d" % before_P[1])
check("단계를 지워도 나머지 순서가 그대로", top_ids(P["id"]) == [i for i in before_P if i != before_P[1]], top_ids(P["id"]))

# ===== 직접 정한 순서 지우기(마감일 순으로 되돌리기) =====
R = mk_project("되돌리기 프로젝트")
r_a = mk_step(R, "A 12월", deadline="2026-12-10")
r_b = mk_step(R, "B 11월", deadline="2026-11-05")
r_c = mk_step(R, "C 마감 없음")
r_k1 = mk_step(R, "K1 12월", parent=r_a["id"], deadline="2026-12-20")
r_k2 = mk_step(R, "K2 11월", parent=r_a["id"], deadline="2026-11-20")
default_tops = steps_of(R["id"])
default_kids = steps_of(R["id"], r_a["id"])
put("/api/projects/%d/steps/order" % R["id"], {"parentId": None, "ids": [r_c["id"], r_a["id"], r_b["id"]]})
put("/api/projects/%d/steps/order" % R["id"], {"parentId": r_a["id"], "ids": [r_k1["id"], r_k2["id"]]})
check("직접 정하면 마감일 순과 달라진다", steps_of(R["id"]) == ["C 마감 없음", "A 12월", "B 11월"] and steps_of(R["id"], r_a["id"]) == ["K1 12월", "K2 11월"], [steps_of(R["id"]), steps_of(R["id"], r_a["id"])])
other_before = top_ids(P["id"])
r = c.delete("/api/projects/%d/steps/order" % R["id"])
check("DELETE로 되돌리면 200", r.status_code == 200, r.get_json())
check("맨 위 단계와 하위 단계 모두 마감일 순으로 돌아온다", steps_of(R["id"]) == default_tops and steps_of(R["id"], r_a["id"]) == default_kids, [steps_of(R["id"]), steps_of(R["id"], r_a["id"])])
rows_r, _ = database.run("SELECT step_order FROM tasks WHERE project_id = ?", (R["id"],))
check("그 프로젝트의 step_order가 모두 NULL이 된다", all(row["step_order"] is None for row in rows_r), rows_r)
check("다른 프로젝트의 직접 정한 순서는 그대로다", top_ids(P["id"]) == other_before)
check("순서를 정한 적 없어도(이미 비어도) 200", c.delete("/api/projects/%d/steps/order" % R["id"]).status_code == 200)
check("없는 프로젝트는 404", c.delete("/api/projects/99999/steps/order").status_code == 404)

# ===== 새 프로젝트 기본 색 =====
folder1 = post("/api/folders", {"name": "공부"}).get_json()
folder2 = post("/api/folders", {"name": "취미"}).get_json()
RED = "#ff0000"
r1 = mk_project("영어 단어", folderId=folder1["id"], color=RED)
r2 = mk_project("영어 듣기", folderId=folder1["id"], color=RED)
mk_project("수학 미적분", folderId=folder1["id"], color="#00aa00")
mk_project("영어 독서", folderId=folder2["id"], color="#0000ff")
mk_project("영어 폴더없음")  # 폴더 없음 + 팔레트 색
def newc(name, folder=None, **kw):
    body = {"name": name}
    if folder is not None: body["folderId"] = folder
    body.update(kw)
    return post("/api/projects", body).get_json()["color"]
check("같은 폴더에 앞 키워드가 같은 프로젝트가 있으면 그 색", newc("영어 문법", folder1["id"]) == RED)
check("앞 키워드만 같으면 되고 뒤는 상관없다", newc("영어", folder1["id"]) == RED and newc("영어   많은 공백 문법 책", folder1["id"]) == RED)
mk_project("Math 기초", folderId=folder1["id"], color="#abcdef")
check("대소문자는 구분하지 않는다", newc("math 심화", folder1["id"]) == "#abcdef" and newc("MATH 응용", folder1["id"]) == "#abcdef")
check("다른 폴더의 같은 키워드는 그 폴더의 색(영어 독서 파랑)", newc("영어 회화", folder2["id"]) == "#0000ff")
check("키워드가 다르면 색을 따라가지 않는다(수학은 초록, 영어와 무관)", newc("수학 기하", folder1["id"]) == "#00aa00" and newc("과학 실험", folder1["id"]) not in (RED, "#00aa00"))
check("앞 키워드가 같아도 다른 낱말(영어회화)은 따르지 않는다", newc("영어회화", folder1["id"]) != RED)
check("폴더 없음끼리도 같은 폴더로 본다", newc("영어 새것") == [p for p in c.get("/api/projects").get_json() if p["name"] == "영어 폴더없음"][0]["color"])
check("폴더가 다르면(폴더 있음 vs 없음) 따르지 않는다", newc("영어 어휘", folder1["id"]) == RED and newc("영어 문법2") != RED)
check("색을 직접 보내면 그 색이 우선", newc("영어 직접", folder1["id"], color="#123456") == "#123456")
# 가장 많이 쓴 색 / 동률이면 최근
mk_project("역사 하나", folderId=folder2["id"], color="#111111")
mk_project("역사 둘", folderId=folder2["id"], color="#222222")
mk_project("역사 셋", folderId=folder2["id"], color="#222222")
check("색이 여럿이면 가장 많이 쓴 색(#222222가 둘)", newc("역사 넷", folder2["id"]) == "#222222")
# 동률: 만든 순서가 늦은 프로젝트의 색 (키워드마다 한 번씩만 물어야 한다. 물을 때마다 새 프로젝트가 생겨 개수가 바뀐다)
mk_project("지리 하나", folderId=folder2["id"], color="#111111")
mk_project("지리 둘", folderId=folder2["id"], color="#222222")
check("개수가 같으면 가장 최근 프로젝트의 색(지리 둘, #222222)", newc("지리 셋", folder2["id"]) == "#222222")
mk_project("음악 하나", folderId=folder2["id"], color="#222222")
mk_project("음악 둘", folderId=folder2["id"], color="#111111")
check("동률 반대 순서: 최근 것이 #111111이면 그 색", newc("음악 셋", folder2["id"]) == "#111111")
# 프로젝트 이름만 있는 경우(첫 프로젝트)는 팔레트
check("이름에 앞 키워드가 같은 게 없으면 팔레트 색(#rrggbb)", newc("전혀 새로운 주제", folder1["id"]).startswith("#"))
check("공백뿐/빈 이름은 만들 수 없다(400)", post("/api/projects", {"name": "   "}).status_code == 400)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
