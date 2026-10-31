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


r = client.get("/api/ddays")
check("처음엔 빈 목록", r.status_code == 200 and r.get_json() == [])

r = client.post("/api/ddays", json={"name": "  기말고사  ", "date": "2026-12-10"})
d1 = r.get_json()
check("추가 201, 이름 앞뒤 공백 제거, 색 자동", r.status_code == 201 and d1["name"] == "기말고사" and d1["color"].startswith("#"), str(d1))
r = client.post("/api/ddays", json={"name": "토익", "date": "2026-11-15", "color": "#E8590C"})
d2 = r.get_json()
check("색 대문자는 소문자로 저장", d2["color"] == "#e8590c", d2["color"])
r = client.post("/api/ddays", json={"name": "자격증", "date": "2027-02-01"})
d3 = r.get_json()
check("색을 안 보내면 개수에 따라 다른 색", len({d1["color"], d3["color"]}) == 2, f'{d1["color"]} {d3["color"]}')

names = [d["name"] for d in client.get("/api/ddays").get_json()]
check("날짜가 빠른 순서로 정렬", names == ["토익", "기말고사", "자격증"], str(names))

# 잘못된 입력
bad = [
    ({"name": "", "date": "2026-12-10"}, "빈 이름"),
    ({"name": "   ", "date": "2026-12-10"}, "공백 이름"),
    ({"name": "x" * 101, "date": "2026-12-10"}, "너무 긴 이름"),
    ({"name": "시험", "date": "2026-13-45"}, "없는 날짜"),
    ({"name": "시험", "date": "내일"}, "글자 날짜"),
    ({"name": "시험", "date": 20261210}, "숫자 날짜"),
    ({"name": "시험", "date": "2026-12-10", "color": "red"}, "잘못된 색"),
    ({"name": "시험"}, "날짜 없음"),
    ({"date": "2026-12-10"}, "이름 없음"),
]
for body, label in bad:
    r = client.post("/api/ddays", json=body)
    check(f"거절: {label}", r.status_code == 400 and "error" in r.get_json(), f"{r.status_code} {r.get_json()}")
check("거절된 입력은 저장되지 않음", len(client.get("/api/ddays").get_json()) == 3)

# 수정
r = client.patch(f"/api/ddays/{d1['id']}", json={"date": "2026-12-20"})
check("날짜만 수정", r.status_code == 200 and database.get_dday(d1["id"])["date"] == "2026-12-20" and database.get_dday(d1["id"])["name"] == "기말고사")
r = client.patch(f"/api/ddays/{d1['id']}", json={"name": "기말고사(수정)", "color": "#2f9e44"})
check("이름과 색 수정", database.get_dday(d1["id"])["name"] == "기말고사(수정)" and database.get_dday(d1["id"])["color"] == "#2f9e44")
r = client.patch(f"/api/ddays/{d1['id']}", json={})
check("바꿀 값 없으면 400", r.status_code == 400)
r = client.patch(f"/api/ddays/{d1['id']}", json={"date": "엉터리"})
check("수정도 날짜 검사", r.status_code == 400 and database.get_dday(d1["id"])["date"] == "2026-12-20")
r = client.patch("/api/ddays/9999", json={"name": "없는 것"})
check("없는 번호 수정은 404", r.status_code == 404)
r = client.patch(f"/api/ddays/{d1['id']}", json={"id": 777, "name": "새이름"})
check("허용되지 않은 칸(id)은 무시", database.get_dday(d1["id"]) is not None and database.get_dday(777) is None)

# SQL 인젝션 시도는 그냥 글자로 저장된다
r = client.post("/api/ddays", json={"name": "'); DROP TABLE ddays; --", "date": "2026-12-10"})
check("SQL 인젝션 글자는 이름으로만 저장", r.status_code == 201 and len(client.get("/api/ddays").get_json()) == 4)

# 삭제
r = client.delete(f"/api/ddays/{d2['id']}")
check("삭제 200", r.status_code == 200 and database.get_dday(d2["id"]) is None)
r = client.delete(f"/api/ddays/{d2['id']}")
check("이미 지운 것은 404", r.status_code == 404)

# 기존 DB(ddays 표가 없는 옛 DB)에서도 init_db가 표를 만들어주는지
old_path = os.path.join(fake_google.TMP, "old.db")
conn = sqlite3.connect(old_path)
conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, project_id INTEGER)")
conn.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-19')")
conn.commit(); conn.close()
database.DB_PATH = old_path
database.init_db()
tables = [row["name"] for row in database.run("SELECT name FROM sqlite_master WHERE type='table'")[0]]
check("옛 DB에도 ddays 표 생김", "ddays" in tables, str(tables))
check("옛 DB의 기존 할 일은 그대로", database.run("SELECT content FROM tasks")[0][0]["content"] == "옛 할 일")
database.init_db()
check("init_db를 두 번 불러도 안전", True)

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
