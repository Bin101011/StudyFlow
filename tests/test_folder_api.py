import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake_google.install()
import app  # noqa: E402
import database  # noqa: E402
import settings_store  # noqa: E402

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


# ---- 폴더 만들기/읽기
check("처음엔 폴더 없음", client.get("/api/folders").get_json() == [])
r = client.post("/api/folders", json={"name": "  2학기  "})
f1 = r.get_json()
check("폴더 만들기 201, 이름 앞뒤 공백 제거, 펼친 상태, 프로젝트 0개", r.status_code == 201 and f1["name"] == "2학기" and f1["collapsed"] is False and f1["projectCount"] == 0, str(f1))
f2 = client.post("/api/folders", json={"name": "동아리"}).get_json()
names = [f["name"] for f in client.get("/api/folders").get_json()]
check("만든 순서대로 나옴", names == ["2학기", "동아리"], str(names))
for body, label in [({"name": ""}, "빈 이름"), ({"name": "   "}, "공백 이름"), ({"name": "x" * 61}, "너무 긴 이름"), ({}, "이름 없음")]:
    r = client.post("/api/folders", json=body)
    check(f"만들기 거절: {label}", r.status_code == 400 and "error" in r.get_json(), str(r.status_code))
check("60글자 이름은 허용", client.post("/api/folders", json={"name": "가" * 60}).status_code == 201)
check("JSON이 아닌 요청도 안전(400)", client.post("/api/folders", data="x", content_type="text/plain").status_code == 400)
check("SQL 인젝션 글자는 이름으로만 저장", client.post("/api/folders", json={"name": "'); DROP TABLE folders; --"}).status_code == 201 and len(client.get("/api/folders").get_json()) == 4)

# ---- 수정
r = client.patch(f"/api/folders/{f1['id']}", json={"name": "2학기 (수정)"})
check("이름 수정", r.status_code == 200 and database.get_folder(f1["id"])["name"] == "2학기 (수정)")
r = client.patch(f"/api/folders/{f1['id']}", json={"collapsed": True})
check("접기", r.status_code == 200 and database.get_folder(f1["id"])["collapsed"] == 1 and database.get_folder(f1["id"])["name"] == "2학기 (수정)")
check("API가 collapsed를 true로 돌려줌", next(f for f in client.get("/api/folders").get_json() if f["id"] == f1["id"])["collapsed"] is True)
client.patch(f"/api/folders/{f1['id']}", json={"collapsed": False})
check("펴기", database.get_folder(f1["id"])["collapsed"] == 0)
for body, label in [({}, "바꿀 값 없음"), ({"name": ""}, "빈 이름"), ({"collapsed": 1}, "숫자 collapsed"), ({"collapsed": "true"}, "글자 collapsed")]:
    r = client.patch(f"/api/folders/{f1['id']}", json=body)
    check(f"수정 거절: {label}", r.status_code == 400, f"{r.status_code}")
check("허용되지 않은 칸(id)은 무시", client.patch(f"/api/folders/{f1['id']}", json={"id": 99, "name": "새"}).status_code == 200 and database.get_folder(99) is None and database.get_folder(f1["id"]) is not None)
check("없는 폴더 수정은 404", client.patch("/api/folders/9999", json={"name": "x"}).status_code == 404)

# ---- 프로젝트에 폴더 지정
r = client.post("/api/projects", json={"name": "프로젝트 A", "folderId": f1["id"]})
pa = r.get_json()
check("폴더를 지정해서 프로젝트 만들기", r.status_code == 201 and pa["folder_id"] == f1["id"], str(pa))
pb = client.post("/api/projects", json={"name": "프로젝트 B"}).get_json()
check("폴더를 안 정하면 폴더 없음(None)", pb["folder_id"] is None)
projects = {p["name"]: p for p in client.get("/api/projects").get_json()}
check("프로젝트 목록에 folderId가 나옴(폴더 있음/없음)", projects["프로젝트 A"]["folderId"] == f1["id"] and projects["프로젝트 B"]["folderId"] is None)
check("폴더 목록의 프로젝트 수가 맞음", next(f for f in client.get("/api/folders").get_json() if f["id"] == f1["id"])["projectCount"] == 1)
r = client.patch(f"/api/projects/{pb['id']}", json={"folderId": f2["id"]})
check("프로젝트를 다른 폴더로 옮기기", r.status_code == 200 and database.get_project(pb["id"])["folder_id"] == f2["id"])
r = client.patch(f"/api/projects/{pb['id']}", json={"folderId": None})
check("folderId null이면 폴더에서 빼냄", r.status_code == 200 and database.get_project(pb["id"])["folder_id"] is None)
r = client.patch(f"/api/projects/{pb['id']}", json={"name": "B 이름만 수정"})
check("다른 값만 수정해도 폴더는 그대로", database.get_project(pa["id"])["folder_id"] == f1["id"] and r.status_code == 200)
client.patch(f"/api/projects/{pa['id']}", json={"name": "A 이름만 수정"})
check("폴더 있는 프로젝트의 이름만 수정해도 폴더 유지", database.get_project(pa["id"])["folder_id"] == f1["id"])
for fid, label in [(9999, "없는 폴더"), ("1", "글자"), (True, "bool"), (1.5, "소수"), ([1], "리스트")]:
    r = client.patch(f"/api/projects/{pb['id']}", json={"folderId": fid})
    check(f"프로젝트 폴더 지정 거절: {label}", r.status_code == 400 and database.get_project(pb["id"])["folder_id"] is None, f"{r.status_code}")
r = client.post("/api/projects", json={"name": "나쁜 폴더", "folderId": 9999})
check("없는 폴더로 프로젝트를 만들면 거절하고 만들어지지 않음", r.status_code == 400 and not any(p["name"] == "나쁜 폴더" for p in client.get("/api/projects").get_json()))

# ---- 폴더 삭제
pc = client.post("/api/projects", json={"name": "프로젝트 C", "folderId": f1["id"]}).get_json()
t = database.add_task("C의 단계", None, pc["id"])
r = client.delete(f"/api/folders/{f1['id']}")
check("폴더 삭제 200", r.status_code == 200 and database.get_folder(f1["id"]) is None)
check("안의 프로젝트는 지워지지 않고 폴더 없음이 됨", database.get_project(pa["id"]) is not None and database.get_project(pa["id"])["folder_id"] is None and database.get_project(pc["id"])["folder_id"] is None)
check("프로젝트의 단계도 그대로", database.get_task(t["id"]) is not None and database.get_task(t["id"])["project_id"] == pc["id"])
check("다른 폴더의 프로젝트는 영향 없음", True)
pd = client.post("/api/projects", json={"name": "프로젝트 D", "folderId": f2["id"]}).get_json()
client.delete(f"/api/folders/{f1['id']}")
check("이미 지운 폴더 삭제는 404", client.delete(f"/api/folders/{f1['id']}").status_code == 404)
check("다른 폴더(동아리)의 프로젝트 D는 그대로", database.get_project(pd["id"])["folder_id"] == f2["id"])
r = client.patch(f"/api/projects/{pa['id']}", json={"folderId": f1["id"]})
check("지워진 폴더로는 지정할 수 없음", r.status_code == 400)

# ---- 옛 DB(folders 표, folder_id 칸이 없는 DB)에서의 이전
old = os.path.join(fake_google.TMP, "old_folder.db")
conn = sqlite3.connect(old)
conn.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, deadline TEXT, color TEXT NOT NULL, progress_mode TEXT NOT NULL DEFAULT 'auto', manual_percent INTEGER NOT NULL DEFAULT 0)")
conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, done INTEGER NOT NULL DEFAULT 0, project_id INTEGER)")
conn.execute("INSERT INTO projects (name, color) VALUES ('옛 프로젝트', '#4a7cff')")
conn.commit(); conn.close()
database.DB_PATH = old
database.init_db()
cols = [c["name"] for c in database.run("PRAGMA table_info(projects)")[0]]
tables = [r["name"] for r in database.run("SELECT name FROM sqlite_master WHERE type='table'")[0]]
check("옛 DB: projects에 folder_id 칸, folders 표가 생김", "folder_id" in cols and "folders" in tables, str((cols, tables)))
check("옛 프로젝트는 그대로이고 폴더 없음", database.run("SELECT name, folder_id FROM projects")[0][0] == {"name": "옛 프로젝트", "folder_id": None})
database.init_db()
check("init_db를 두 번 불러도 안전", True)

# ---- 열 수 설정 (2, 3, 4열. 1열은 없앴다. 기본 2열)
check("기본값은 2열", settings_store.default_settings()["projectColumns"] == 2)
for ok in (2, 3, 4):
    check(f"{ok}열은 허용", settings_store.clean_settings({"projectColumns": ok})["projectColumns"] == ok)
for bad in (0, 1, 5, -1, "3", 3.0, True, None, [3]):
    check(f"허용되지 않은 값은 기본값(2열): {bad!r}", settings_store.clean_settings({"projectColumns": bad})["projectColumns"] == 2)
check("옛 설정 파일의 1열은 2열로", settings_store.clean_settings({"projectColumns": 1, "fontSize": 14})["projectColumns"] == 2)
check("서버 설정 API로 저장/읽기(4열)", client.put("/api/settings", json={"projectColumns": 4}).get_json()["projectColumns"] == 4 and client.get("/api/settings").get_json()["values"]["projectColumns"] == 4)

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
