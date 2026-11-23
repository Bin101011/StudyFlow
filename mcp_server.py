"""StudyFlow MCP 서버: 옵시디언(Claudian) 안의 Claude가 StudyFlow의 할 일과 일정을 보고, 할 일을 체크하거나 추가하게 한다.

MCP(Model Context Protocol)란:
    Claude 같은 AI가 다른 프로그램의 기능을 "도구"로 불러 쓰게 해 주는 연결 규칙이다.
    이 파일의 @server.tool()이 붙은 함수 하나하나가 Claude에게 보이는 도구가 된다.
    Claude는 함수 이름, 설명(docstring), 매개변수의 타입을 보고 언제 어떤 도구를 부를지 스스로 정한다.

어떻게 연결되나:
    Claudian(Claude Code) ──(표준 입출력, stdio)──> 이 프로그램 ──(내 컴퓨터 안의 HTTP)──> 켜져 있는 StudyFlow
    - 이 프로그램은 Claudian이 필요할 때 직접 켠다. 사용자가 따로 켤 필요가 없다.
    - studyflow.db를 직접 건드리지 않고, 켜져 있는 StudyFlow의 /api/... 주소에 묻는다.
      그래야 Google 일정도 볼 수 있고, 하위 단계 계산 같은 규칙이 app.py 한 곳에서만 지켜진다.
    - StudyFlow의 주소는 켤 때마다 바뀌므로, StudyFlow가 적어 둔 connection.json(app_paths.connection_file)을 읽는다.
    - StudyFlow가 꺼져 있으면 "StudyFlow를 켜 주세요"라고 알린다.

stdio 주의: 표준 출력(print)은 Claude와 주고받는 통로라서, 이 파일에서는 print를 쓰면 안 된다(통신이 깨진다).
"""
import datetime
import json
import urllib.error
import urllib.parse
import urllib.request

# mcp 2.x의 서버 도구. (1.x에서는 FastMCP라는 이름이었다)
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import app_paths

server = MCPServer(
    name="studyflow",
    instructions=(
        "StudyFlow는 사용자가 쓰는 개인 플래너 앱이다. 할 일(날짜별), 시간표 계획 블록, 프로젝트, Google Calendar 일정을 담고 있다. "
        "사용자의 오늘 할 일이나 진행 상황을 물으면 today_status를 먼저 부른다. "
        "할 일을 체크하거나 추가하기 전에는, 사용자가 그렇게 해 달라고 했는지 확인한다. "
        "날짜는 모두 2026-11-23 같은 모양이고, 시각은 사용자 컴퓨터의 시간(한국 시간)이다."
    ),
)

# 이 표시를 보고 StudyFlow가 "Claude가 바꿨다"는 것을 알아채고 화면을 다시 불러온다 (app.py의 notice_change_from_mcp)
CLIENT_HEADER = {"X-StudyFlow-Client": "mcp"}
REQUEST_TIMEOUT_SECONDS = 10
EVENTS_TIMEOUT_SECONDS = 40   # Google에 묻는 요청은 StudyFlow 쪽 제한(30초)보다 조금 길게 기다린다
MAX_SCHEDULE_DAYS = 31


class StudyFlowError(ToolError):
    """Claude에게 그대로 보여 줄 오류. 무엇이 문제이고 어떻게 하면 되는지 적는다.
    ToolError를 물려받는 이유: mcp는 그 밖의 오류는 "도구 실행 중 오류"라고만 알리고 이유를 숨긴다(내부 정보가 새지 않게).
    ToolError는 "일부러 알리는 오류"라서 적은 글이 Claude에게 그대로 간다."""


# ---------- StudyFlow에 묻는 부분 ----------

def studyflow_url():
    """켜져 있는 StudyFlow의 주소(예: "http://127.0.0.1:52817/")를 connection.json에서 읽는다."""
    path = app_paths.connection_file()
    try:
        with open(path, encoding="utf-8") as file:
            url = json.load(file)["url"]
    except (OSError, ValueError, KeyError):
        raise StudyFlowError("StudyFlow의 주소를 찾을 수 없습니다. StudyFlow를 한 번 켜 주세요.")
    # 내 컴퓨터 안의 주소만 받는다. 파일이 이상하게 바뀌어 있어도 밖으로 요청을 보내지 않게 하려는 것이다
    host = urllib.parse.urlparse(url).hostname
    if host not in ("127.0.0.1", "localhost"):
        raise StudyFlowError("connection.json의 주소가 내 컴퓨터 주소가 아닙니다. StudyFlow를 다시 켜 주세요.")
    return url


def call(method, path, params=None, body=None, timeout=REQUEST_TIMEOUT_SECONDS):
    """StudyFlow의 API를 부르고, 받은 JSON을 파이썬 데이터로 돌려준다.
    method: "GET", "POST", "PATCH" 같은 요청 종류. path: "api/tasks" 같은 주소의 뒷부분. params: 주소의 ? 뒤에 붙일 값들"""
    url = studyflow_url() + path
    if params:
        # urlencode: {"date": "2026-11-23"}를 "date=2026-11-23"처럼 주소에 쓸 수 있는 글자로 바꾼다
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = dict(CLIENT_HEADER)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        # StudyFlow가 거절한 경우(400, 404 등). StudyFlow가 적어 보낸 이유를 그대로 전한다
        try:
            message = json.loads(error.read().decode("utf-8")).get("error")
        except ValueError:
            message = None
        raise StudyFlowError(message or f"StudyFlow가 요청을 거절했습니다 ({error.code}).")
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        # 주소 파일은 있지만 StudyFlow가 꺼져 있는 경우가 대부분이다 (마지막으로 켰던 주소가 남아 있다)
        raise StudyFlowError("StudyFlow에 연결할 수 없습니다. StudyFlow가 켜져 있는지 확인해 주세요.")


# ---------- 받은 데이터를 Claude가 읽기 쉬운 모양으로 줄이기 ----------

def minutes_to_text(minutes):
    """0시부터 몇 분째인지(990)를 "16:30" 글자로 바꾼다."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def simple_task(task):
    """할 일 한 줄에서 Claude에게 필요한 것만 고른다. 비어 있는 값은 뺀다."""
    result = {
        "id": task["id"],
        "content": task["content"],
        "done": bool(task["done"]),
        "date": task.get("date"),
        "deadline": task.get("deadline"),
        "project": task.get("project_name"),
        "parentStep": task.get("parent_content"),  # 하위 단계면, 어느 단계 아래의 일인지
        "memo": task.get("memo") or None,
        "doneAt": task.get("done_at"),
    }
    return {key: value for key, value in result.items() if value is not None}


def simple_event(event, calendar_names):
    """Google 일정 한 개를 줄인다. 시작/끝은 하루 종일 일정이면 "2026-11-23", 아니면 "2026-11-23T10:00:00+09:00" 모양이다."""
    return {
        "title": event.get("title", ""),
        "start": event.get("start"),
        "end": event.get("end"),
        "allDay": bool(event.get("allDay")) or len(str(event.get("start", ""))) == 10,
        "calendar": calendar_names.get(event.get("calendarId"), event.get("calendarId")),
    }


def load_events(start, end):
    """start 이상 end 미만 날짜의 Google 일정을 받는다. 숨겨 둔 캘린더(StudyFlow 설정)의 일정은 뺀다.
    Google에 연결할 수 없으면 일정 대신 이유를 돌려준다: (일정 리스트, 오류 글자 또는 None)"""
    try:
        events = call("GET", "api/events", {"start": start, "end": end}, timeout=EVENTS_TIMEOUT_SECONDS)
        calendars = call("GET", "api/calendars", timeout=EVENTS_TIMEOUT_SECONDS)
        settings = call("GET", "api/settings")
    except StudyFlowError as error:
        return [], str(error)
    # 설정은 {"values": {...저장된 값...}, "sliders": ...} 모양으로 온다
    hidden = set(settings.get("values", {}).get("hiddenCalendarIds") or [])
    names = {calendar["id"]: calendar["name"] for calendar in calendars}
    shown = [simple_event(event, names) for event in events if event.get("calendarId") not in hidden]
    shown.sort(key=lambda event: str(event["start"]))
    return shown, None


def check_date(text, name="date"):
    """날짜 글자가 2026-11-23 모양인지 확인하고 date로 바꿔 돌려준다."""
    try:
        return datetime.date.fromisoformat(text)
    except (TypeError, ValueError):
        raise StudyFlowError(f"'{name}'는 2026-11-23 같은 날짜여야 합니다.")


# ---------- Claude에게 보이는 도구들 ----------

@server.tool()
def today_status(date: str | None = None) -> dict:
    """하루의 현황을 돌려준다: 그날의 할 일(완료 여부 포함), 밀린 할 일(그 전에 잡혀 있었는데 못 끝낸 것),
    시간표에 적어 둔 계획 블록, 그날의 Google Calendar 일정.
    date를 비우면 오늘이다. 할 일의 id는 set_task_done에 쓴다."""
    day = check_date(date) if date else datetime.date.today()
    day_text = day.isoformat()
    tasks = call("GET", "api/tasks", {"date": day_text})
    blocks = call("GET", "api/time-blocks", {"date": day_text})
    events, events_error = load_events(day_text, (day + datetime.timedelta(days=1)).isoformat())

    task_list = [simple_task(task) for task in tasks["tasks"]]
    result = {
        "date": day_text,
        "now": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "doneCount": sum(1 for task in task_list if task["done"]),
        "totalCount": len(task_list),
        "tasks": task_list,
        "overdue": [simple_task(task) for task in tasks["overdue"]],
        "timeBlocks": [{
            "start": minutes_to_text(block["start"]),
            "end": minutes_to_text(block["end"]),
            "title": block["title"],
            **({"taskId": block["taskId"], "taskDone": block["taskDone"]} if block["taskId"] is not None else {}),
        } for block in blocks],
        "events": events,
    }
    if events_error:
        result["eventsError"] = events_error
    return result


@server.tool()
def schedule(start: str, end: str) -> dict:
    """기간(start 이상, end 미만. 최대 31일)의 날짜별 할 일과 Google Calendar 일정을 돌려준다.
    예: 이번 주를 보려면 start=월요일, end=다음 주 월요일. 할 일이나 일정이 없는 날짜는 빠진다."""
    start_day = check_date(start, "start")
    end_day = check_date(end, "end")
    span = (end_day - start_day).days
    if span <= 0 or span > MAX_SCHEDULE_DAYS:
        raise StudyFlowError(f"기간은 1일 이상 {MAX_SCHEDULE_DAYS}일 이하여야 합니다 (end는 포함하지 않습니다).")

    task_days = call("GET", "api/task-days", {"start": start, "end": end})
    events, events_error = load_events(start, end)

    days = {}
    for day_text, tasks in task_days.items():
        days.setdefault(day_text, {})["tasks"] = [simple_task(task) for task in tasks]
    for event in events:
        # 여러 날에 걸친 일정은 시작한 날에만 적는다 (끝 날짜는 event의 end에 있다)
        day_text = str(event["start"])[:10]
        days.setdefault(day_text, {}).setdefault("events", []).append(event)
    result = {"start": start, "end": end, "days": dict(sorted(days.items()))}
    if events_error:
        result["eventsError"] = events_error
    return result


# 리스트를 그대로 돌려주면 mcp가 항목마다 조각을 나눠 보내므로, {"tasks": [...]}처럼 한 덩어리(dict)로 감싸서 돌려준다
@server.tool()
def inbox() -> dict:
    """날짜도 프로젝트도 정하지 않은 채 적어 둔, 아직 안 끝낸 할 일 목록(수집함)."""
    return {"tasks": [simple_task(task) for task in call("GET", "api/inbox")]}


@server.tool()
def projects() -> dict:
    """프로젝트 목록: 이름, 마감일, 진행률(%), 그리고 단계(할 일)들. 하위 단계가 있는 단계는 children에 하위 단계가 있다.
    하위 단계가 있는 단계의 done은 "하위 단계를 모두 끝냈는가"로 계산된 값이다."""
    def simple_step(step):
        result = simple_task(step)
        if step.get("children"):
            result["children"] = [simple_task(child) for child in step["children"]]
        return result

    return {"projects": [{
        "id": project["id"],
        "name": project["name"],
        "deadline": project["deadline"],
        "percent": project["percent"],
        "doneCount": project["doneCount"],
        "total": project["total"],
        "steps": [simple_step(step) for step in project["tasks"]],
    } for project in call("GET", "api/projects")]}


@server.tool()
def set_task_done(task_id: int, done: bool = True) -> dict:
    """할 일을 끝낸 것으로 체크한다(done=false면 체크를 푼다). task_id는 today_status 등에서 받은 할 일의 id다.
    하위 단계가 있는 단계는 직접 체크하지 말고 하위 단계를 체크한다(상위 단계는 저절로 따라 바뀐다).
    StudyFlow 화면에는 15초 안에 반영된다."""
    call("PATCH", f"api/tasks/{task_id}", body={"done": done})
    return {"ok": True, "taskId": task_id, "done": done}


@server.tool()
def add_task(content: str, date: str | None = None, project_id: int | None = None) -> dict:
    """새 할 일을 만든다. date(예: 2026-11-23)를 주면 그날의 할 일이 되고, project_id를 주면 그 프로젝트의 단계가 된다.
    둘 다 비우면 수집함(날짜 없는 할 일 목록)에 들어간다. 만든 할 일을 돌려준다. StudyFlow 화면에는 15초 안에 반영된다."""
    if date is not None:
        check_date(date)
    body = {"content": content, "date": date, "projectId": project_id}
    return simple_task(call("POST", "api/tasks", body=body))


if __name__ == "__main__":
    # 표준 입출력(stdio)으로 Claude와 이야기한다. Claudian이 이 프로그램을 켜고 끈다
    server.run("stdio")
