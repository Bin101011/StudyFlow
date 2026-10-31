import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake_google.install()
import app  # noqa: E402
import database  # noqa: E402

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


p = database.add_project("프로젝트", "2026-12-01", "#4a7cff", "auto", 0)
a = database.add_task("할 일 A", "2026-10-20")
b = database.add_task("프로젝트 단계", None, p["id"])
c = database.add_task("하위 단계", None, p["id"], b["id"])
d = database.add_task("끝낸 일", "2026-10-20")
database.update_task(d["id"], {"done": 1})
e = database.add_task("먼 미래", "2027-05-01")

tasks = client.get("/api/priority-tasks").get_json()
names = sorted(t["content"] for t in tasks)
check("안 끝낸 큰 단위만(하위 단계는 상위 단계로 묶임), 날짜 무관", names == sorted(["할 일 A", "프로젝트 단계", "먼 미래"]), str(names))
check("처음엔 모두 평가 안 함(null)", all(t["importance"] is None and t["urgency"] is None for t in tasks))
sub = next(t for t in tasks if t["content"] == "프로젝트 단계")
check("프로젝트 이름, 색, 하위 단계 개수가 따라옴", sub["project_name"] == "프로젝트" and sub["project_color"] == "#4a7cff" and sub["child_total"] == 1 and sub["child_done"] == 0)

patch = lambda tid, body: client.patch(f"/api/tasks/{tid}", json=body)
r = patch(a["id"], {"importance": 3, "urgency": -2})
t = database.get_task(a["id"])
check("평가 저장", r.status_code == 200 and t["importance"] == 3 and t["urgency"] == -2)
r = patch(a["id"], {"importance": -3, "urgency": 3})
t = database.get_task(a["id"])
check("경계값 -3, 3 허용", r.status_code == 200 and t["importance"] == -3 and t["urgency"] == 3)
r = patch(a["id"], {"importance": 0, "urgency": 0})
check("0, 0(가운데)도 평가로 인정 (null과 구별)", database.get_task(a["id"])["importance"] == 0 and database.get_task(a["id"])["urgency"] == 0)
tasks = client.get("/api/priority-tasks").get_json()
check("0은 평가한 것으로 JSON에 0으로 나옴", next(x for x in tasks if x["id"] == a["id"])["importance"] == 0)

bad = [
    ({"importance": 4, "urgency": 0}, "범위 초과"),
    ({"importance": 5, "urgency": 0}, "예전 범위 값(5)"),
    ({"importance": 0, "urgency": -4}, "범위 미달"),
    ({"importance": 1.5, "urgency": 0}, "소수"),
    ({"importance": "3", "urgency": 0}, "글자"),
    ({"importance": True, "urgency": 0}, "bool"),
    ({"importance": 3}, "한쪽만"),
    ({"urgency": 3}, "한쪽만(긴급)"),
    ({"importance": 3, "urgency": None}, "한쪽만 null"),
]
for body, label in bad:
    r = patch(a["id"], body)
    check(f"거절: {label}", r.status_code == 400 and "error" in r.get_json(), f"{r.status_code}")
check("거절된 요청은 값을 바꾸지 않음", database.get_task(a["id"])["importance"] == 0)

r = patch(a["id"], {"importance": None, "urgency": None})
t = database.get_task(a["id"])
check("둘 다 null이면 평가 취소", r.status_code == 200 and t["importance"] is None and t["urgency"] is None)
r = patch(a["id"], {"content": "이름만 수정", "importance": 2, "urgency": 2})
check("다른 칸과 함께 보내도 됨", r.status_code == 200 and database.get_task(a["id"])["content"] == "이름만 수정" and database.get_task(a["id"])["importance"] == 2)
r = patch(9999, {"importance": 1, "urgency": 1})
check("없는 할 일은 404", r.status_code == 404)

# 체크하면 우선순위 목록에서 사라지고, 평가는 남는다
patch(a["id"], {"done": True})
tasks = client.get("/api/priority-tasks").get_json()
check("끝낸 일은 목록에서 빠짐", all(x["id"] != a["id"] for x in tasks))
patch(a["id"], {"done": False})
check("되살리면 이전 평가 그대로", next(x for x in client.get("/api/priority-tasks").get_json() if x["id"] == a["id"])["importance"] == 2)

# ---- 하위 단계는 상위 단계 하나로 묶인다 (책 읽기 > 1장, 2장, 3장)
book = database.add_task("책 읽기", None, p["id"])
chs = [database.add_task(f"{i}장", None, p["id"], book["id"]) for i in (1, 2, 3)]
database.update_task(chs[1]["id"], {"deadline": "2026-11-05"})
database.update_task(chs[2]["id"], {"deadline": "2026-11-01"})
tasks = client.get("/api/priority-tasks").get_json()
names = [t["content"] for t in tasks]
check("1장, 2장, 3장은 따로 안 나오고 '책 읽기' 하나만", "책 읽기" in names and not any(n.endswith("장") for n in names), str(names))
bt = next(t for t in tasks if t["content"] == "책 읽기")
check("하위 단계 개수(child_total/child_done)", bt["child_total"] == 3 and bt["child_done"] == 0, str(bt))
check("마감일 없는 상위 단계는 안 끝낸 하위 단계 중 가장 빠른 마감일을 씀", bt["deadline"] == "2026-11-01", str(bt["deadline"]))
database.update_task(book["id"], {"deadline": "2026-12-01"})
check("상위 단계 자신의 마감일이 있으면 그것이 우선", next(t for t in client.get("/api/priority-tasks").get_json() if t["content"] == "책 읽기")["deadline"] == "2026-12-01")
database.update_task(book["id"], {"deadline": None})

patch(chs[2]["id"], {"done": True})
bt = next(t for t in client.get("/api/priority-tasks").get_json() if t["content"] == "책 읽기")
check("하위 단계 하나를 끝내면 진행도 1/3, 마감일은 남은 것 중 가장 빠른 것", bt["child_done"] == 1 and bt["deadline"] == "2026-11-05", str(bt))
r = patch(book["id"], {"importance": 2, "urgency": 1})
bt = next(t for t in client.get("/api/priority-tasks").get_json() if t["content"] == "책 읽기")
check("평가는 상위 단계에 붙음", r.status_code == 200 and bt["importance"] == 2 and bt["urgency"] == 1)
database.run("UPDATE tasks SET importance = 3, urgency = 3 WHERE id = ?", (chs[0]["id"],))
check("하위 단계에 남아 있는 옛 평가는 목록에 나오지 않음", not any(t["content"] == "1장" for t in client.get("/api/priority-tasks").get_json()))
patch(chs[0]["id"], {"done": True}); patch(chs[1]["id"], {"done": True})
check("하위 단계를 모두 끝내면 상위 단계도 목록에서 사라짐", not any(t["content"] == "책 읽기" for t in client.get("/api/priority-tasks").get_json()))
patch(chs[1]["id"], {"done": False})
check("하나라도 되돌리면 다시 나타남(평가 유지)", next((t for t in client.get("/api/priority-tasks").get_json() if t["content"] == "책 읽기"), {}).get("importance") == 2)

# 상위 단계를 완료하면 남은 하위 단계도 함께 끝남
book2 = database.add_task("논문 쓰기", None, p["id"])
kids = [database.add_task(f"{name}", None, p["id"], book2["id"]) for name in ("초안", "수정", "제출")]
patch(kids[0]["id"], {"done": True})
r = patch(book2["id"], {"done": True})
rows = {k["content"]: database.get_task(k["id"]) for k in kids}
check("상위 단계 완료 → 남은 하위 단계가 모두 완료로", r.status_code == 200 and all(v["done"] == 1 for v in rows.values()), str({k: v["done"] for k, v in rows.items()}))
check("새로 끝난 하위 단계에는 완료 시각이 기록됨", rows["수정"]["done_at"] is not None and rows["제출"]["done_at"] is not None)
check("원래 끝나 있던 하위 단계의 완료 시각은 그대로", rows["초안"]["done_at"] == database.get_task(kids[0]["id"])["done_at"])
check("다 끝난 상위 단계는 목록에서 사라짐", not any(t["content"] == "논문 쓰기" for t in client.get("/api/priority-tasks").get_json()))
# 하위 단계가 없는 할 일을 끝내도 다른 것에는 영향 없음
solo = database.add_task("혼자인 단계", None, p["id"])
other = database.add_task("다른 단계", None, p["id"])
patch(solo["id"], {"done": True})
check("하위 없는 단계 완료는 다른 단계에 영향 없음", database.get_task(other["id"])["done"] == 0 and database.get_task(solo["id"])["done"] == 1)
# 다른 프로젝트의 하위 단계는 건드리지 않음
p2 = database.add_project("다른 프로젝트", None, "#2f9e44", "auto", 0)
pb = database.add_task("다른 책", None, p2["id"])
pc = database.add_task("다른 장", None, p2["id"], pb["id"])
patch(book["id"], {"done": True})
check("완료 일괄 처리는 그 상위 단계의 하위 단계에만 적용", database.get_task(pc["id"])["done"] == 0)
# 날짜 있는 평범한 할 일도 그대로 나옴(프로젝트 없음)
check("프로젝트 없는 평범한 할 일도 여전히 나옴", any(t["content"] == "먼 미래" and t["project_name"] is None and t["child_total"] == 0 for t in client.get("/api/priority-tasks").get_json()))

# 옛 DB(importance/urgency 칸이 없는 DB)에서도 마이그레이션
old = os.path.join(fake_google.TMP, "old2.db")
conn = sqlite3.connect(old)
conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, project_id INTEGER)")
conn.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-19')")
conn.commit(); conn.close()
database.DB_PATH = old
database.init_db()
cols = [c["name"] for c in database.run("PRAGMA table_info(tasks)")[0]]
check("옛 DB에 importance, urgency 칸 추가됨", "importance" in cols and "urgency" in cols)
row = database.run("SELECT importance, urgency FROM tasks")[0][0]
check("옛 할 일은 평가 안 한 상태", row["importance"] is None and row["urgency"] is None)
database.init_db()
check("init_db 두 번 불러도 안전", True)

# -5~5 시절에 저장된 값은 새 범위(-3~3) 안으로 맞춰진다
old3 = os.path.join(fake_google.TMP, "old3.db")
database.DB_PATH = old3
database.init_db()
x = database.add_task("예전 평가", "2026-10-20")
y = database.add_task("범위 안 평가", "2026-10-20")
z = database.add_task("평가 안 함", "2026-10-20")
database.run("UPDATE tasks SET importance = 5, urgency = -5 WHERE id = ?", (x["id"],))
database.run("UPDATE tasks SET importance = 2, urgency = -1 WHERE id = ?", (y["id"],))
database.init_db()
gx, gy, gz = database.get_task(x["id"]), database.get_task(y["id"]), database.get_task(z["id"])
check("예전 범위 밖 값은 끝값으로 맞춰짐 (5→3, -5→-3)", gx["importance"] == 3 and gx["urgency"] == -3, str((gx["importance"], gx["urgency"])))
check("범위 안 값은 그대로", gy["importance"] == 2 and gy["urgency"] == -1)
check("평가 안 한 할 일은 그대로 NULL", gz["importance"] is None and gz["urgency"] is None)

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
