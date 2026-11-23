# MCP 서버(mcp_server.py) 시험: 가짜 Google + 임시 DB로 진짜 StudyFlow 서버를 띄우고,
# Claudian이 하는 것과 똑같이 mcp_server.py를 따로 켜서(stdio) 도구를 불러 본다. 진짜 connection.json과 내 데이터는 건드리지 않는다
import asyncio
import datetime
import json
import os
import sys
import threading
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake = fake_google.install()
# 진짜 %LOCALAPPDATA%\StudyFlow\connection.json 대신 임시 폴더의 파일을 쓴다 (켜져 있는 진짜 StudyFlow의 주소를 덮어쓰지 않게)
CONNECTION_FILE = os.path.join(fake_google.TMP, "connection.json")
os.environ["STUDYFLOW_CONNECTION_FILE"] = CONNECTION_FILE

import app  # noqa: E402
import database  # noqa: E402
import event_cache  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402
from mcp import Client  # noqa: E402
from mcp.client.stdio import StdioServerParameters  # noqa: E402

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
database.init_db()
today = datetime.date.today()
iso = lambda n: (today + datetime.timedelta(days=n)).isoformat()  # noqa: E731

project = database.add_project("기말 프로젝트", iso(21), "#4a7cff", "auto", 0)
step = database.add_task("발표 자료 만들기", iso(0), project["id"])
plain = database.add_task("LC 파트 풀기", iso(0))
database.add_task("여권 사진 찍기", None)
old = database.add_task("지난 일 마무리", iso(-2))
database.add_time_block(iso(0), 9 * 60, 10 * 60 + 30, "수학 공부", None)
fake.add_event("me@test", "팀 회의", f"{iso(0)}T15:00:00+09:00", f"{iso(0)}T16:00:00+09:00")
fake.add_event("me@test", "내일 일정", f"{iso(1)}T09:00:00+09:00", f"{iso(1)}T10:00:00+09:00")

# 진짜 StudyFlow처럼: 켤 때 주소 파일을 적게 하고, 빈 번호(포트 0 = 아무 빈 번호)로 서버를 연다
app.app.config["WRITE_CONNECTION_FILE"] = True
http_server = make_server("127.0.0.1", 0, app.app, threaded=True)
threading.Thread(target=http_server.serve_forever, daemon=True).start()
base_url = f"http://127.0.0.1:{http_server.server_port}/"

check("첫 요청 전에는 주소 파일이 없다", not os.path.exists(CONNECTION_FILE))
urllib.request.urlopen(base_url + "api/sync-status").read()
with open(CONNECTION_FILE, encoding="utf-8") as file:
    saved = json.load(file)
check("첫 요청이 오면 내 주소를 connection.json에 적는다", saved.get("url") == base_url, str(saved))


def local_version():
    return json.loads(urllib.request.urlopen(base_url + "api/sync-status").read())["localVersion"]


async def run_tools():
    params = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mcp_server.py")],
        env={"STUDYFLOW_CONNECTION_FILE": CONNECTION_FILE},
    )
    async with Client(params) as client:
        tools = await client.list_tools()
        names = sorted(tool.name for tool in tools.tools)
        check("도구 6개가 보인다", names == sorted(["today_status", "schedule", "inbox", "projects", "set_task_done", "add_task"]), str(names))

        async def call(name, arguments=None):
            result = await client.call_tool(name, arguments or {})
            text = result.content[0].text if result.content else ""
            if result.is_error:
                return None, text
            data = result.structured_content
            if data is None:
                data = json.loads(text)  # 구조화된 결과가 없으면 글자(JSON)로 온다
            # 리스트를 돌려주는 도구는 {"result": [...]}로 감싸서 올 수 있다
            if isinstance(data, dict) and set(data) == {"result"}:
                data = data["result"]
            return data, None

        version_before = local_version()
        data, error = await call("today_status")
        check("today_status 오류 없음", error is None, error)
        contents = [task["content"] for task in data["tasks"]]
        check("오늘 할 일 2개", sorted(contents) == sorted(["발표 자료 만들기", "LC 파트 풀기"]), str(contents))
        check("프로젝트 이름이 붙는다", any(t.get("project") == "기말 프로젝트" for t in data["tasks"]), str(data["tasks"]))
        check("밀린 할 일", [t["content"] for t in data["overdue"]] == ["지난 일 마무리"], str(data["overdue"]))
        check("시간표 블록은 시:분 글자", data["timeBlocks"] == [{"start": "09:00", "end": "10:30", "title": "수학 공부"}], str(data["timeBlocks"]))
        check("오늘의 Google 일정", [e["title"] for e in data["events"]] == ["팀 회의"], str(data["events"]))
        check("일정에 캘린더 이름", data["events"] and data["events"][0]["calendar"] not in (None, "me@test"), str(data["events"]))
        check("완료 0/2", data["doneCount"] == 0 and data["totalCount"] == 2, str(data))
        check("읽기만 하면 localVersion이 그대로", local_version() == version_before)

        data, error = await call("set_task_done", {"task_id": plain["id"]})
        check("set_task_done 성공", error is None and data["done"] is True, error)
        check("체크하면 localVersion이 오른다 (화면이 다시 불러온다)", local_version() == version_before + 1)
        data, _ = await call("today_status")
        check("체크가 오늘 현황에 반영", data["doneCount"] == 1, str(data))

        data, error = await call("set_task_done", {"task_id": 999999})
        check("없는 할 일은 StudyFlow의 이유를 그대로 전한다", data is None and "찾을 수 없습니다" in (error or ""), error)

        data, error = await call("add_task", {"content": "단어 50개 외우기", "date": iso(1)})
        check("add_task: 내일 할 일", error is None and data["content"] == "단어 50개 외우기" and data["date"] == iso(1), str(error or data))
        data, error = await call("add_task", {"content": "  "})
        check("빈 내용은 거절", data is None and "내용" in (error or ""), error)
        data, error = await call("add_task", {"content": "x", "date": "11월 23일"})
        check("잘못된 날짜는 거절", data is None and "날짜" in (error or ""), error)

        data, error = await call("schedule", {"start": iso(0), "end": iso(2)})
        check("schedule 오류 없음", error is None, error)
        tomorrow = data["days"].get(iso(1), {})
        check("schedule: 내일의 할 일과 일정", [t["content"] for t in tomorrow.get("tasks", [])] == ["단어 50개 외우기"]
              and [e["title"] for e in tomorrow.get("events", [])] == ["내일 일정"], str(data))
        data, error = await call("schedule", {"start": iso(0), "end": iso(40)})
        check("schedule: 31일 넘는 기간은 거절", data is None and "31일" in (error or ""), error)

        data, error = await call("inbox")
        check("inbox", error is None and [t["content"] for t in data["tasks"]] == ["여권 사진 찍기"], str(error or data))
        data, error = await call("projects")
        first = data["projects"][0] if data else {}
        check("projects: 진행률과 단계", error is None and first["name"] == "기말 프로젝트" and first["steps"][0]["content"] == "발표 자료 만들기"
              and first["percent"] == 0, str(error or data))

        # 숨긴 캘린더의 일정은 Claude에게도 안 보인다 (StudyFlow 화면과 같게)
        client_app = app.app.test_client()
        client_app.put("/api/settings", json={"hiddenCalendarIds": ["me@test"]})
        data, _ = await call("today_status")
        check("숨긴 캘린더의 일정은 빠진다", data["events"] == [], str(data["events"]))

        # StudyFlow를 끄면: 남아 있는 주소로 연결이 안 되므로 켜 달라고 알린다
        http_server.shutdown()
        http_server.server_close()
        data, error = await call("today_status")
        check("StudyFlow가 꺼져 있으면 켜 달라고 알린다", data is None and "켜져 있는지" in (error or ""), error)

        os.remove(CONNECTION_FILE)
        data, error = await call("inbox")
        check("주소 파일이 없으면 한 번 켜 달라고 알린다", data is None and "한 번 켜" in (error or ""), error)


asyncio.run(run_tools())

print(f"\n{len(failures)} failed" if failures else "\nall passed")
sys.exit(1 if failures else 0)
