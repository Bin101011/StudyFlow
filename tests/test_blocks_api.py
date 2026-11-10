# 시간표 계획 블록 API 테스트 (임시 DB, Flask 테스트 클라이언트. 실제 DB/Google은 건드리지 않는다)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import app, database
database.init_db()
c = app.app.test_client()
failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))
def post(url, body): return c.post(url, json=body)
def patch(url, body): return c.patch(url, json=body)

D = "2026-10-28"
r = post("/api/time-blocks", {"date": D, "start": 600, "end": 660, "title": "  토익 공부  "})
b = r.get_json()
check("만들기 201 + 제목 공백 정리", r.status_code == 201 and b["title"] == "토익 공부" and b["start"] == 600 and b["end"] == 660 and b["taskId"] is None, b)
check("목록에 나온다", [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()] == [b["id"]])
check("다른 날짜 목록은 비어 있다", c.get("/api/time-blocks?date=2026-10-29").get_json() == [])

# 입력 검사
check("잘못된 날짜 400", post("/api/time-blocks", {"date": "x", "start": 0, "end": 60, "title": "a"}).status_code == 400)
check("끝이 시작보다 빠르면 400", post("/api/time-blocks", {"date": D, "start": 600, "end": 600, "title": "a"}).status_code == 400)
check("5분 미만 400", post("/api/time-blocks", {"date": D, "start": 600, "end": 603, "title": "a"}).status_code == 400)
check("1440 넘으면 400", post("/api/time-blocks", {"date": D, "start": 1400, "end": 1441, "title": "a"}).status_code == 400)
check("음수 400", post("/api/time-blocks", {"date": D, "start": -5, "end": 60, "title": "a"}).status_code == 400)
check("소수/글자 시각 400", post("/api/time-blocks", {"date": D, "start": 1.5, "end": 60, "title": "a"}).status_code == 400 and post("/api/time-blocks", {"date": D, "start": "0", "end": 60, "title": "a"}).status_code == 400)
check("True는 숫자가 아니다 400", post("/api/time-blocks", {"date": D, "start": True, "end": 60, "title": "a"}).status_code == 400)
check("제목 없으면 400", post("/api/time-blocks", {"date": D, "start": 0, "end": 60}).status_code == 400 and post("/api/time-blocks", {"date": D, "start": 0, "end": 60, "title": "   "}).status_code == 400)
check("제목이 너무 길면 400", post("/api/time-blocks", {"date": D, "start": 0, "end": 60, "title": "가" * 201}).status_code == 400)
check("자정 끝(1440)까지 허용", post("/api/time-blocks", {"date": D, "start": 1380, "end": 1440, "title": "밤"}).status_code == 201)
check("키 빠지면 400", post("/api/time-blocks", {"date": D, "start": 0}).status_code == 400)

# 할 일 연결
t = database.add_task("발표 자료 만들기", D)
r = post("/api/time-blocks", {"date": D, "start": 990, "end": 1110, "taskId": t["id"], "title": "무시됨"})
lb = r.get_json()
check("할 일 연결: 제목은 할 일 이름, taskId, 완료 아님", r.status_code == 201 and lb["title"] == "발표 자료 만들기" and lb["taskId"] == t["id"] and lb["taskDone"] is False, lb)
check("없는 할 일 404", post("/api/time-blocks", {"date": D, "start": 0, "end": 60, "taskId": 99999}).status_code == 404)
check("taskId가 글자면 404", post("/api/time-blocks", {"date": D, "start": 0, "end": 60, "taskId": "1"}).status_code == 404)
database.update_task(t["id"], {"done": 1})
check("할 일을 끝내면 블록의 taskDone이 true", [x for x in c.get("/api/time-blocks?date=" + D).get_json() if x["id"] == lb["id"]][0]["taskDone"] is True)
database.update_task(t["id"], {"content": "발표 자료 완성하기"})
check("할 일 이름을 바꾸면 블록 제목도 따라간다", [x for x in c.get("/api/time-blocks?date=" + D).get_json() if x["id"] == lb["id"]][0]["title"] == "발표 자료 완성하기")
database.delete_task(t["id"])
check("할 일을 지우면 그 할 일의 계획 블록도 함께 지워진다", lb["id"] not in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()])
check("연결 없는 일반 블록은 그대로 남는다", b["id"] in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()])

# 하위 단계: 상위 단계를 지우면 하위 단계의 블록도 지워진다
parent = database.add_task("상위 단계", D)
child = database.add_task("하위 단계", D, None, parent["id"])
cb = post("/api/time-blocks", {"date": D, "start": 300, "end": 360, "taskId": child["id"]}).get_json()
database.delete_task(parent["id"])
check("상위 단계를 지우면 하위 단계의 블록도 지워진다", cb["id"] not in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()])

# 프로젝트: 날짜 없는 단계가 함께 지워질 때 그 블록도 지워지고, 날짜 있는 할 일은 (프로젝트 연결만 끊기고) 블록도 남는다
proj = database.add_project("프로젝트", None, "#4a7cff", "auto", 0)
step_nodate = database.add_task("날짜 없는 단계", None, proj["id"])
step_dated = database.add_task("날짜 있는 단계", D, proj["id"])
nb = post("/api/time-blocks", {"date": D, "start": 400, "end": 460, "taskId": step_nodate["id"]}).get_json()
db_ = post("/api/time-blocks", {"date": D, "start": 500, "end": 560, "taskId": step_dated["id"]}).get_json()
database.delete_project(proj["id"])
ids = [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()]
check("프로젝트를 지우면 함께 지워지는 날짜 없는 단계의 블록도 지워진다", nb["id"] not in ids)
check("프로젝트를 지워도 남는 날짜 있는 할 일의 블록은 남는다", db_["id"] in ids)

# 옛 동작으로 남은 "연결 끊긴 블록"은 init_db가 정리한다
database.run("INSERT INTO time_blocks (date, start_min, end_min, title, task_id) VALUES (?, 700, 760, '고아', 99999)", (D,))
check("정리 전에는 고아 블록이 있다", any(x["title"] == "고아" for x in c.get("/api/time-blocks?date=" + D).get_json()))
database.init_db()
check("init_db가 연결 끊긴 블록을 정리한다", not any(x["title"] == "고아" for x in c.get("/api/time-blocks?date=" + D).get_json()))
check("정리는 일반 블록과 살아 있는 연결을 건드리지 않는다", b["id"] in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()] and db_["id"] in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()])

# 할 일의 날짜가 바뀌면 다른 날짜의 계획 블록은 지워진다
def block_ids(date): return [x["id"] for x in c.get("/api/time-blocks?date=" + date).get_json()]
mv = database.add_task("날짜 바꿀 할 일", D)
mb = post("/api/time-blocks", {"date": D, "start": 800, "end": 860, "taskId": mv["id"]}).get_json()
c.patch("/api/tasks/%d" % mv["id"], json={"date": D})
check("같은 날짜로 다시 정하면 블록은 그대로", mb["id"] in block_ids(D))
c.patch("/api/tasks/%d" % mv["id"], json={"done": True})
check("날짜 말고 다른 것을 바꿔도 블록은 그대로", mb["id"] in block_ids(D))
r = c.patch("/api/tasks/%d" % mv["id"], json={"date": "2026-10-29"})
check("다른 날짜로 옮기면(내일로) 원래 날짜의 블록이 지워진다", r.status_code == 200 and mb["id"] not in block_ids(D), r.get_json())
mv2 = database.add_task("날짜 뺄 할 일", D)
mb2 = post("/api/time-blocks", {"date": D, "start": 900, "end": 960, "taskId": mv2["id"]}).get_json()
mb2b = post("/api/time-blocks", {"date": "2026-10-30", "start": 900, "end": 960, "taskId": mv2["id"]}).get_json()
c.patch("/api/tasks/%d" % mv2["id"], json={"date": None})
check("날짜를 비우면(목록으로, 빼기) 그 할 일의 모든 날짜의 블록이 지워진다", mb2["id"] not in block_ids(D) and mb2b["id"] not in block_ids("2026-10-30"))
mv3 = database.add_task("다른 할 일", D)
mb3 = post("/api/time-blocks", {"date": D, "start": 1000, "end": 1060, "taskId": mv3["id"]}).get_json()
mv4 = database.add_task("옮길 할 일", D)
c.patch("/api/tasks/%d" % mv4["id"], json={"date": "2026-11-01"})
check("다른 할 일의 블록과 연결 없는 블록은 건드리지 않는다", mb3["id"] in block_ids(D) and b["id"] in block_ids(D))

# 수정
r = patch("/api/time-blocks/%d" % b["id"], {"start": 615})
check("시작만 고치기(끝과 합쳐서 검사)", r.status_code == 200 and r.get_json()["start"] == 615 and r.get_json()["end"] == 660, r.get_json())
check("시작만 보내서 끝보다 늦어지면 400", patch("/api/time-blocks/%d" % b["id"], {"start": 700}).status_code == 400)
check("제목 고치기", patch("/api/time-blocks/%d" % b["id"], {"title": " 새 제목 "}).get_json()["title"] == "새 제목")
check("빈 제목 400", patch("/api/time-blocks/%d" % b["id"], {"title": " "}).status_code == 400)
check("고칠 내용 없으면 400", patch("/api/time-blocks/%d" % b["id"], {}).status_code == 400)
check("날짜는 PATCH로 못 바꾼다(무시)", patch("/api/time-blocks/%d" % b["id"], {"title": "x", "date": "2030-01-01"}).get_json()["date"] == D)
check("없는 블록 PATCH 404", patch("/api/time-blocks/99999", {"title": "x"}).status_code == 404)

# 삭제
check("삭제 200", c.delete("/api/time-blocks/%d" % b["id"]).status_code == 200)
check("지운 블록은 목록에 없다", b["id"] not in [x["id"] for x in c.get("/api/time-blocks?date=" + D).get_json()])
check("없는 블록 삭제 404", c.delete("/api/time-blocks/%d" % b["id"]).status_code == 404)
check("GET 잘못된 날짜 400", c.get("/api/time-blocks?date=abc").status_code == 400)
# [할 일로 만들기]: 할 일과 연결되지 않은 계획 → 그날의 할 일(번호 없음)을 만들고 연결한다
M = "2026-11-20"
free = post("/api/time-blocks", {"date": M, "start": 720, "end": 780, "title": "점심"}).get_json()
r = c.post("/api/time-blocks/%d/make-task" % free["id"])
made = r.get_json()
check("할 일로 만들기 201 + 블록이 새 할 일과 연결됨", r.status_code == 201 and made["block"]["taskId"] == made["taskId"] and made["block"]["title"] == "점심", made)
check("블록의 시간과 날짜는 그대로", made["block"]["start"] == 720 and made["block"]["end"] == 780 and made["block"]["date"] == M, made)
new_task = database.get_task(made["taskId"])
check("새 할 일: 계획의 이름·날짜, 프로젝트 없음, 번호 없음, 안 끝냄", new_task["content"] == "점심" and new_task["date"] == M and new_task["project_id"] is None and new_task["no_rank"] == 1 and new_task["done"] == 0, new_task)
database.add_task("먼저 있던 할 일", M)
check("그날 할 일 목록에 나온다(정한 순서 없음 → 만든 순서)", [t["content"] for t in c.get("/api/tasks?date=" + M).get_json()["tasks"]] == ["점심", "먼저 있던 할 일"])
count = database.run("SELECT COUNT(*) AS n FROM tasks")[0][0]["n"]
r = c.post("/api/time-blocks/%d/make-task" % free["id"])
check("이미 연결된 계획은 409, 할 일이 또 생기지 않는다", r.status_code == 409 and database.run("SELECT COUNT(*) AS n FROM tasks")[0][0]["n"] == count, r.get_json())
check("없는 블록 404", c.post("/api/time-blocks/99999/make-task").status_code == 404)
# 연결 뒤의 동작은 기존 연결 계획과 같다
patch("/api/tasks/%d" % made["taskId"], {"content": "점심 먹기"})
check("할 일 이름을 바꾸면 계획 제목도 따라 바뀐다", c.get("/api/time-blocks?date=" + M).get_json()[0]["title"] == "점심 먹기")
c.delete("/api/time-blocks/%d" % free["id"])
check("계획을 지워도 할 일은 남는다", database.get_task(made["taskId"]) is not None)
free2 = post("/api/time-blocks", {"date": M, "start": 900, "end": 960, "title": "산책"}).get_json()
t2 = c.post("/api/time-blocks/%d/make-task" % free2["id"]).get_json()["taskId"]
patch("/api/tasks/%d" % t2, {"date": "2026-11-21"})
check("할 일을 다른 날로 옮기면 계획이 사라진다", all(b["id"] != free2["id"] for b in c.get("/api/time-blocks?date=" + M).get_json()))
# 거래(트랜잭션): 연결 단계에서 실패하면 할 일도 만들어지지 않는다. UPDATE time_blocks를 막는 임시 장치(트리거)로 실패를 만든다
free3 = post("/api/time-blocks", {"date": M, "start": 1000, "end": 1030, "title": "실패 확인"}).get_json()
count = database.run("SELECT COUNT(*) AS n FROM tasks")[0][0]["n"]
database.run("CREATE TRIGGER block_link_fail BEFORE UPDATE OF task_id ON time_blocks BEGIN SELECT RAISE(ABORT, 'test'); END")
raised = False
try:
    database.make_task_from_time_block(free3["id"])
except Exception:
    raised = True
database.run("DROP TRIGGER block_link_fail")
check("연결에 실패하면 오류가 나고 할 일도 남지 않는다(반쪽 없음)", raised and database.run("SELECT COUNT(*) AS n FROM tasks")[0][0]["n"] == count and database.get_time_block(free3["id"])["task_id"] is None)
check("그 뒤 다시 누르면 정상으로 만들어진다", c.post("/api/time-blocks/%d/make-task" % free3["id"]).status_code == 201)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
