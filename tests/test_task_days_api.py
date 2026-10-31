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


p = database.add_project("프로젝트", "2026-12-01", "#4a7cff", "auto", 0)
a1 = database.add_task("10/27 할 일 A", "2026-10-27")
a2 = database.add_task("10/27 할 일 B", "2026-10-27", p["id"])
a3 = database.add_task("10/27 끝낸 일", "2026-10-27")
database.update_task(a3["id"], {"done": 1})
b1 = database.add_task("10/29 할 일", "2026-10-29")
c1 = database.add_task("11/05 할 일", "2026-11-05")
nodate = database.add_task("날짜 없는 단계", None, p["id"])
parent = database.add_task("제목 역할 단계", "2026-10-28", p["id"])
child = database.add_task("그 하위 단계", "2026-10-28", p["id"], parent["id"])

r = client.get("/api/task-days", query_string={"start": "2026-10-25", "end": "2026-11-01"})
d = r.get_json()
check("200과 날짜별로 묶여 나옴", r.status_code == 200 and sorted(d.keys()) == ["2026-10-27", "2026-10-28", "2026-10-29"], str(sorted(d.keys())))
check("한 날짜에 든 할 일 개수(끝낸 것 포함)", len(d["2026-10-27"]) == 3)
check("안 끝낸 것이 먼저, 끝낸 것이 뒤(만든 순서)", [t["content"] for t in d["2026-10-27"]] == ["10/27 할 일 A", "10/27 할 일 B", "10/27 끝낸 일"], str([t["content"] for t in d["2026-10-27"]]))
check("done 값과 프로젝트 이름/색이 따라옴", d["2026-10-27"][2]["done"] == 1 and d["2026-10-27"][1]["project_name"] == "프로젝트" and d["2026-10-27"][1]["project_color"] == "#4a7cff" and d["2026-10-27"][0]["project_name"] is None)
check("하위 단계를 가진 단계(제목 역할)는 빠지고 하위 단계만 나옴", [t["content"] for t in d["2026-10-28"]] == ["그 하위 단계"], str(d["2026-10-28"]))
check("기간 밖(11/05)은 안 나옴, 날짜 없는 단계도 안 나옴", "2026-11-05" not in d and all("날짜 없는" not in t["content"] for ts in d.values() for t in ts))
check("end는 포함하지 않음(10/29 이전까지 요청하면 10/29는 빠짐)", "2026-10-29" not in client.get("/api/task-days", query_string={"start": "2026-10-25", "end": "2026-10-29"}).get_json())
check("start는 포함함", "2026-10-27" in client.get("/api/task-days", query_string={"start": "2026-10-27", "end": "2026-10-28"}).get_json())
check("할 일이 없는 기간은 빈 객체", client.get("/api/task-days", query_string={"start": "2027-01-01", "end": "2027-01-10"}).get_json() == {})

for qs, label in [({}, "값 없음"), ({"start": "2026-10-01"}, "end 없음"), ({"start": "내일", "end": "2026-10-10"}, "글자 날짜"), ({"start": "2026-13-01", "end": "2026-13-05"}, "없는 날짜"),
                  ({"start": "2026-10-10", "end": "2026-10-10"}, "빈 기간"), ({"start": "2026-10-10", "end": "2026-10-01"}, "거꾸로 된 기간"),
                  ({"start": "2026-01-01", "end": "2026-12-31"}, "너무 긴 기간(100일 초과)")]:
    r = client.get("/api/task-days", query_string=qs)
    check(f"거절: {label}", r.status_code == 400 and "error" in r.get_json(), f"{r.status_code}")
check("정확히 100일은 허용", client.get("/api/task-days", query_string={"start": "2026-10-01", "end": "2027-01-09"}).status_code == 200)
check("101일은 거절", client.get("/api/task-days", query_string={"start": "2026-10-01", "end": "2027-01-10"}).status_code == 400)
check("SQL 인젝션 글자는 날짜가 아니라서 거절", client.get("/api/task-days", query_string={"start": "2026-10-01'; DROP TABLE tasks;--", "end": "2026-10-05"}).status_code == 400 and database.get_task(a1["id"]) is not None)

# 끝내면 done이 바뀌어 보임
client.patch(f"/api/tasks/{a1['id']}", json={"done": True})
d = client.get("/api/task-days", query_string={"start": "2026-10-27", "end": "2026-10-28"}).get_json()
check("할 일을 끝내면 목록에서 끝낸 쪽으로 이동", [t["done"] for t in d["2026-10-27"]] == [0, 1, 1], str([(t["content"], t["done"]) for t in d["2026-10-27"]]))

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
