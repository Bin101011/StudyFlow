import os
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


def post(path, body):
    return client.post(path, json=body)


def patch(path, body):
    return client.patch(path, json=body)


proj = database.add_project("프로젝트", "2026-12-01", "#4a7cff", "auto", 0)

# ===== 날짜도 프로젝트도 없는 할 일을 만들 수 있다 =====
r = post("/api/tasks", {"content": "영어 숙제", "date": None, "projectId": None})
check("날짜도 프로젝트도 없는 할 일이 만들어짐(201)", r.status_code == 201, f"{r.status_code} {r.get_json()}")
a = r.get_json()
check("date, project_id가 null", a["date"] is None and a["project_id"] is None)
r = post("/api/tasks", {"content": "날짜 키 자체가 없음"})
check("date 키가 없어도 만들어짐", r.status_code == 201, str(r.get_json()))
b = r.get_json()
check("빈 내용은 여전히 거절", post("/api/tasks", {"content": "   "}).status_code == 400)

# ===== 수집함 목록 =====
dated = database.add_task("날짜 있는 할 일", "2026-10-27")
step = database.add_task("프로젝트 단계(날짜 없음)", None, proj["id"])
done_inbox = database.add_task("끝낸 수집함 할 일", None)
database.update_task(done_inbox["id"], {"done": 1})
r = client.get("/api/inbox")
names = [t["content"] for t in r.get_json()]
check("GET /api/inbox 200", r.status_code == 200)
check("날짜 없고 프로젝트 없는 안 끝낸 할 일만, 만든 순서로", names == ["영어 숙제", "날짜 키 자체가 없음"], str(names))
check("날짜 있는 것, 프로젝트 단계, 끝낸 것은 나오지 않음", all(n not in names for n in ["날짜 있는 할 일", "프로젝트 단계(날짜 없음)", "끝낸 수집함 할 일"]))

# ===== 날짜 정하기 =====
r = patch(f"/api/tasks/{a['id']}", {"date": "2026-10-30"})
check("날짜를 정하면 200", r.status_code == 200, str(r.get_json()))
check("정한 뒤 수집함에서 빠짐", [t["content"] for t in client.get("/api/inbox").get_json()] == ["날짜 키 자체가 없음"])
check("그 날짜의 할 일 목록에 나옴", any(t["content"] == "영어 숙제" for t in client.get("/api/tasks", query_string={"date": "2026-10-30"}).get_json()["tasks"]))
check("캘린더 할 일 요약에도 잡힘", any(t["content"] == "영어 숙제" for t in client.get("/api/task-days", query_string={"start": "2026-10-30", "end": "2026-10-31"}).get_json().get("2026-10-30", [])))

# ===== 날짜를 다시 빼면 수집함으로 돌아온다(나중으로 미루기) =====
r = patch(f"/api/tasks/{a['id']}", {"date": None})
check("프로젝트 없는 할 일도 날짜를 뺄 수 있음(예전에는 400)", r.status_code == 200, f"{r.status_code} {r.get_json()}")
check("빼면 수집함으로 돌아옴(만든 순서 유지)", [t["content"] for t in client.get("/api/inbox").get_json()] == ["영어 숙제", "날짜 키 자체가 없음"])
check("없는 할 일의 날짜 빼기는 404", patch("/api/tasks/999999", {"date": None}).status_code == 404)
check("이상한 날짜는 여전히 400", patch(f"/api/tasks/{a['id']}", {"date": "내일"}).status_code == 400)

# ===== 프로젝트 단계는 예전처럼 =====
r = patch(f"/api/tasks/{step['id']}", {"date": "2026-10-28"})
check("프로젝트 단계에 날짜를 정해도 수집함에는 안 나옴", r.status_code == 200 and all("프로젝트 단계" not in t["content"] for t in client.get("/api/inbox").get_json()))
r = patch(f"/api/tasks/{step['id']}", {"date": None})
check("프로젝트 단계의 날짜 빼기도 그대로 동작(수집함에는 안 나옴)", r.status_code == 200 and all("프로젝트 단계" not in t["content"] for t in client.get("/api/inbox").get_json()))

# ===== 끝내기/지우기 =====
patch(f"/api/tasks/{b['id']}", {"done": True})
check("수집함 할 일을 끝내면 목록에서 빠짐", [t["content"] for t in client.get("/api/inbox").get_json()] == ["영어 숙제"])
r = client.delete(f"/api/tasks/{a['id']}")
check("지우면 목록에서 빠짐", r.status_code == 200 and client.get("/api/inbox").get_json() == [])

# ===== 우선순위 탭에도 수집함 할 일이 나온다(평가 가능) =====
c = post("/api/tasks", {"content": "수집함 중요한 일"}).get_json()
check("우선순위 탭 목록에 수집함 할 일이 보임", any(t["id"] == c["id"] for t in client.get("/api/priority-tasks").get_json()))
r = patch(f"/api/tasks/{c['id']}", {"importance": 3, "urgency": 2})
check("수집함 할 일도 중요도/긴급도를 평가할 수 있음", r.status_code == 200)
check("평가해도 수집함에는 그대로 있음(날짜는 별개)", any(t["id"] == c["id"] for t in client.get("/api/inbox").get_json()))

# ===== 프로젝트 지울 때: 수집함 할 일은 영향 없음 =====
database.delete_project(proj["id"])
check("프로젝트를 지워도 수집함 할 일은 그대로", any(t["id"] == c["id"] for t in client.get("/api/inbox").get_json()))

# ===== 오늘 탭의 밀린 할 일 =====
ov = post("/api/tasks", {"content": "밀린 일", "date": "2020-01-01"}).get_json()
tasks = client.get("/api/tasks", query_string={"date": "2026-10-27"}).get_json()
check("날짜 없는 수집함 할 일은 밀린 할 일에 안 나옴", all(t["id"] != c["id"] for t in tasks["overdue"]) and any(t["id"] == ov["id"] for t in tasks["overdue"]))

print("\n실패 없음" if not failures else f"\n실패 {len(failures)}개: {failures}")
sys.exit(1 if failures else 0)
