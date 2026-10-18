# 날짜를 다루는 파이썬 기본 도구
import datetime

# 여러 요청이 동시에 오더라도 한 번에 하나씩만 처리하도록 줄 세우는 도구(Lock)
import threading

# 시간을 재는 도구. 캘린더 목록을 기억해둔 지 얼마나 됐는지 계산하는 데 쓴다
import time

# 여러 일을 동시에 시키는 도구. 캘린더 8개를 한꺼번에 조회하는 데 쓴다
from concurrent.futures import ThreadPoolExecutor

# Google API가 돌려주는 오류(404 등)를 잡기 위해 가져온다
from googleapiclient.errors import HttpError

# Flask 라이브러리에서 필요한 도구들을 가져온다
# jsonify: 파이썬 데이터(리스트, 딕셔너리)를 JSON 글자로 바꿔 돌려주는 도구
# request: 화면이 보낸 요청의 내용(주소 뒤의 값 등)을 꺼내는 도구
from flask import Flask, jsonify, render_template, request

# google_calendar.py에서 만들어둔 함수들을 가져온다
import google_calendar

# Flask 앱(서버) 하나를 만든다. __name__은 "이 파일이 어디 있는지" 알려주는 값이다
app = Flask(__name__)

# 로그인 정보(creds)를 준비하는 동안 다른 요청이 끼어들지 못하게 하는 열쇠.
# 동시에 여러 요청이 token.json을 읽고 쓰면 파일이 꼬일 수 있어서 필요하다
_creds_lock = threading.Lock()

# 캘린더 목록을 기억해두는 곳(캐시). 목록은 거의 안 바뀌므로 매번 Google에 묻지 않는다
_calendar_cache = {"data": None, "time": 0}
_calendar_lock = threading.Lock()
CALENDAR_CACHE_SECONDS = 600  # 10분이 지나면 목록을 다시 가져온다

# 일정을 가져오는 작업자(스레드) 8명을 미리 만들어 계속 살려둔다.
# 요청 때마다 새로 만들면 그때마다 Google 연결도 새로 만들어야 해서 느리다
_pool = ThreadPoolExecutor(max_workers=8)

# 스레드마다 따로 보관하는 저장 공간. 각 작업자가 자기 Google 연결을 여기에 담아둔다
_thread_data = threading.local()


def get_creds():
    """로그인 정보를 돌려준다. 한 번에 한 요청만 들어오도록 열쇠를 쓴다."""
    # with lock: 열쇠를 잡고 이 블록을 실행하고, 끝나면 자동으로 열쇠를 돌려준다
    with _creds_lock:
        return google_calendar.get_credentials()


def get_calendar_list(creds):
    """캘린더 목록을 돌려준다. 최근에 가져온 게 있으면 Google에 묻지 않고 그걸 쓴다."""
    with _calendar_lock:
        age = time.time() - _calendar_cache["time"]  # 마지막으로 가져온 지 몇 초 지났는지
        if _calendar_cache["data"] is None or age > CALENDAR_CACHE_SECONDS:
            service = google_calendar.build_service(creds)
            _calendar_cache["data"] = google_calendar.get_calendars(service)
            _calendar_cache["time"] = time.time()
        return _calendar_cache["data"]


def get_thread_service(creds):
    """지금 실행 중인 스레드 전용 Google 연결을 돌려준다. 없으면 한 번 만들고, 이후엔 재사용한다."""
    service = getattr(_thread_data, "service", None)
    if service is None:
        service = google_calendar.build_service(creds)
        _thread_data.service = service
    return service


def can_edit(calendar):
    """이 캘린더에 일정을 쓸 수 있는지 알려준다. accessRole이 owner(소유자)나 writer(편집자)면 쓸 수 있다."""
    return calendar.get("accessRole") in ("owner", "writer")


def fetch_calendar_events(creds, calendar, start, end):
    """캘린더 하나의 일정을 가져와서 FullCalendar 형식의 리스트로 돌려준다."""
    # Google 연결(service)은 여러 스레드가 함께 쓰면 SSL 오류가 난다.
    # 그래서 스레드마다 자기만의 연결을 쓴다. 연결을 새로 만들 때 시간이 오래 걸리므로(약 1.5초),
    # 한 번 만든 연결을 그 스레드가 계속 재사용한다
    service = get_thread_service(creds)

    try:
        events = google_calendar.get_events(service, calendar["id"], start, end)
    except HttpError as error:
        # 캘린더 하나가 오류(예: 404)를 내도 전체가 실패하지 않게, 그 캘린더만 건너뛴다
        print(f"[건너뜀] '{calendar['summary']}' 캘린더의 일정을 못 가져왔습니다: {error.resp.status}")
        return []

    result = []
    for event in events:
        # 종일 일정은 "date", 시간 있는 일정은 "dateTime"에 시각이 들어 있다
        # 둘 중 있는 쪽을 꺼내면 FullCalendar가 알아서 종일/시간 일정을 구분한다
        event_start = event["start"].get("dateTime") or event["start"]["date"]
        event_end = event["end"].get("dateTime") or event["end"]["date"]

        result.append({
            "id": event["id"],
            "title": event.get("summary", "제목 없음"),
            "start": event_start,
            "end": event_end,
            "color": calendar.get("backgroundColor", "#3788d8"),  # 일정 색 = 캘린더 색
            "calendarId": calendar["id"],  # 나중에 체크박스로 캘린더별 숨기기에 쓴다
            "editable": can_edit(calendar),  # False면 FullCalendar가 드래그를 막아준다
            "canEdit": can_edit(calendar),  # 클릭했을 때 수정 창을 열어도 되는지 app.js가 확인하는 용도
        })
    return result


def warm_up():
    """프로그램을 켤 때 미리 로그인, 캘린더 목록, 작업자 8명의 Google 연결을 준비해둔다.
    이걸 안 하면 처음 달력을 열 때 이 준비 때문에 약 3초가 걸린다."""
    try:
        creds = get_creds()
        calendars = get_calendar_list(creds)
        if not calendars:
            return

        today = datetime.date.today()
        tomorrow = today + datetime.timedelta(days=1)
        # Barrier: 작업자 8명이 모두 모일 때까지 서로 기다리게 하는 장치.
        # 이게 없으면 빠른 작업자 한 명이 일을 몰아서 해버려서, 나머지 작업자의 연결은 준비되지 않는다
        barrier = threading.Barrier(8)

        def prepare(i):
            barrier.wait()  # 8명이 모두 도착할 때까지 기다린다
            # 연결은 실제로 요청을 한 번 보내봐야 완성된다. 오늘 하루치 일정을 가볍게 조회한다
            service = get_thread_service(creds)
            calendar = calendars[i % len(calendars)]
            google_calendar.get_events(service, calendar["id"], today, tomorrow)

        # list(...): map은 결과를 꺼내야 실제로 끝까지 실행되므로 리스트로 만들어 기다린다
        list(_pool.map(prepare, range(8)))
    except Exception as error:
        # 준비에 실패해도 프로그램은 계속 돈다. 그냥 첫 로딩이 느려질 뿐이다
        print(f"[준비 실패] 미리 연결하지 못했습니다: {error}")


# 누군가 주소 "/"(맨 첫 페이지)로 접속하면 바로 아래 함수를 실행해라
@app.route("/")
def index():
    # templates 폴더의 index.html을 읽어서 돌려준다. 그 내용이 브라우저 화면에 표시된다
    return render_template("index.html")


# 주소 "/api/calendars"로 요청이 오면 캘린더 목록을 JSON으로 돌려준다
@app.route("/api/calendars")
def api_calendars():
    calendars = get_calendar_list(get_creds())

    # Google이 주는 정보는 너무 많으므로, 화면에 필요한 것만 골라서 새 리스트로 만든다
    result = []
    for calendar in calendars:
        result.append({
            "id": calendar["id"],  # 캘린더 고유 번호
            "name": calendar["summary"],  # 캘린더 이름
            "color": calendar.get("backgroundColor", "#3788d8"),  # Google에서 정한 색. 없으면 기본 파랑
            "canEdit": can_edit(calendar),  # 일정을 추가/수정할 수 있는 캘린더인가 (공휴일 캘린더 등은 False)
            "primary": calendar.get("primary", False),  # 내 기본 캘린더인가
        })
    return jsonify(result)


# 주소 "/api/events"로 요청이 오면 일정들을 JSON으로 돌려준다
# FullCalendar는 보이는 기간을 주소 뒤에 붙여서 보낸다. 예: /api/events?start=2026-10-01&end=2026-11-01
@app.route("/api/events")
def api_events():
    # request.args: 주소의 "?" 뒤에 붙은 값들. 거기서 start, end를 꺼낸다
    # FullCalendar는 "2026-10-01T00:00:00+09:00" 같은 긴 글자를 보내므로,
    # 앞 10글자("2026-10-01")만 잘라서 날짜(date)로 바꾼다
    start = datetime.date.fromisoformat(request.args["start"][:10])
    end = datetime.date.fromisoformat(request.args["end"][:10])

    # 로그인 정보와 캘린더 목록은 요청 하나당 한 번만 준비한다
    creds = get_creds()
    calendars = get_calendar_list(creds)

    # 모든 캘린더를 작업자들에게 나눠줘서 동시에 조회한다.
    # 하나씩 기다리면 (0.3초 × 8개) 걸리던 것이 가장 느린 하나만큼(약 0.3초)으로 줄어든다
    # _pool.map: 캘린더마다 fetch_calendar_events를 실행하고, 결과를 캘린더 순서대로 모아준다
    per_calendar = _pool.map(
        lambda calendar: fetch_calendar_events(creds, calendar, start, end),
        calendars,
    )
    # [[A의 일정들], [B의 일정들], ...] 형태를 [A의 일정, ..., B의 일정, ...]로 한 줄로 펼친다
    result = [event for events in per_calendar for event in events]

    return jsonify(result)


def missing_key(data, keys):
    """data에 없는 키가 있으면 '요청이 잘못됐다'는 뜻의 400 응답을 만들어 돌려준다. 다 있으면 None."""
    for key in keys:
        if key not in data:
            return jsonify({"error": f"'{key}' 값이 없습니다."}), 400
    return None


def run_google_write(action, operation):
    """Google에 쓰는 일(추가/수정/삭제)을 작업자 스레드에서 실행한다.
    성공하면 None, Google이 거절하면 화면에 보여줄 오류 응답을 돌려준다.
    operation: service를 받아서 Google 요청을 보내는 함수"""
    creds = get_creds()

    def job():
        # 작업자 스레드 안에서 실행되므로, 그 스레드 전용 Google 연결을 쓴다
        return operation(get_thread_service(creds))

    try:
        # _pool.submit(...).result(): 작업자 한 명에게 일을 시키고 끝날 때까지 기다린다
        _pool.submit(job).result()
    except HttpError as error:
        # Google이 거절했을 때(권한 없음, 잘못된 값 등). 화면이 오류를 보여줄 수 있게 이유를 담아 보낸다
        print(f"[일정 {action} 실패] {error}")
        return jsonify({"error": f"Google에 일정을 {action}하지 못했습니다."}), 502
    return None


# 같은 주소 "/api/events"라도 POST 요청이 오면 "일정 새로 만들기"로 처리한다.
# GET은 가져오기, POST는 만들기. 메서드가 다르면 같은 주소로도 서로 다른 함수가 실행된다
@app.route("/api/events", methods=["POST"])
def api_create_event():
    # request.get_json(): 화면이 body에 담아 보낸 JSON 글자를 파이썬 딕셔너리로 바꿔 꺼낸다
    data = request.get_json()
    error_response = missing_key(data, ("calendarId", "title", "allDay", "start", "end"))
    if error_response:
        return error_response

    error_response = run_google_write("추가", lambda service: google_calendar.create_event(
        service, data["calendarId"], data["title"], data["allDay"], data["start"], data["end"]
    ))
    if error_response:
        return error_response

    # 201: "새로 만들어졌다"는 뜻의 성공 번호
    return jsonify({"ok": True}), 201


# 주소에 일정 번호가 붙은 "/api/events/<event_id>"는 일정 하나를 가리킨다.
# <event_id> 자리에 온 글자가 함수의 event_id 값으로 들어온다.
# PATCH: 일정의 일부(제목, 시간)만 고친다. 제목을 안 보내면 제목은 그대로 둔다 (드래그할 때)
@app.route("/api/events/<event_id>", methods=["PATCH"])
def api_update_event(event_id):
    data = request.get_json()
    error_response = missing_key(data, ("calendarId", "allDay", "start", "end"))
    if error_response:
        return error_response

    error_response = run_google_write("수정", lambda service: google_calendar.update_event(
        service, data["calendarId"], event_id, data["allDay"], data["start"], data["end"],
        title=data.get("title"),
    ))
    if error_response:
        return error_response

    return jsonify({"ok": True})


# DELETE: 일정을 지운다. 어느 캘린더의 일정인지는 주소 뒤(?calendarId=...)로 받는다
@app.route("/api/events/<event_id>", methods=["DELETE"])
def api_delete_event(event_id):
    calendar_id = request.args.get("calendarId")
    if not calendar_id:
        return jsonify({"error": "'calendarId' 값이 없습니다."}), 400

    error_response = run_google_write("삭제", lambda service: google_calendar.delete_event(
        service, calendar_id, event_id
    ))
    if error_response:
        return error_response

    return jsonify({"ok": True})


# 이 파일을 직접 실행했을 때만 서버를 켠다
if __name__ == "__main__":
    # debug=True: 코드를 고치면 서버가 자동으로 다시 시작되고, 오류가 나면 자세히 보여준다
    app.run(debug=True)
