# 날짜를 다루는 파이썬 기본 도구
import datetime

# 환경 변수(프로그램을 켤 때 전달된 값)를 읽는 도구
import os

# 글자가 정해진 모양인지 검사하는 도구(정규식). 색이 "#rrggbb" 모양인지 확인하는 데 쓴다
import re

# 여러 요청이 동시에 오더라도 한 번에 하나씩만 처리하도록 줄 세우는 도구(Lock)
import threading

# 시간을 재는 도구. 캘린더 목록을 기억해둔 지 얼마나 됐는지 계산하는 데 쓴다
import time

# 웹 주소를 분해해서 http/https인지 확인하는 도구, 그리고 주소를 컴퓨터의 기본 브라우저로 여는 도구 (노트 안의 링크용)
import urllib.parse
import webbrowser

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

# 일정을 달 단위로 기억해두고, Google에서 바뀐 게 있는지 확인하는 도구 (event_cache.py)
import event_cache

# 화면 설정값을 settings.json에 읽고 쓰는 함수들
import settings_store
# Obsidian vault의 노트(.md 파일)를 읽고 쓰는 함수들
import notes_store

# 할 일을 studyflow.db에 읽고 쓰는 함수들
import database

# Flask 앱(서버) 하나를 만든다. __name__은 "이 파일이 어디 있는지" 알려주는 값이다
app = Flask(__name__)

# 할 일 테이블이 없으면 만든다. 서버가 켜질 때 한 번 실행된다
database.init_db()

# 파일(HTML, JS, CSS)을 고쳤는데 창에는 예전 모습이 남아 있는 일이 없도록 한다.
# no-cache: "저장해둔 파일을 그냥 쓰지 말고, 쓰기 전에 서버에 바뀌었는지 물어봐라"는 뜻이다.
# (안 바뀌었으면 서버가 304로 짧게 답해서 느려지지 않는다)
app.config["TEMPLATES_AUTO_RELOAD"] = True  # HTML 템플릿도 고치면 서버를 껐다 켜지 않아도 다시 읽는다


@app.after_request
def disable_browser_cache(response):
    response.headers["Cache-Control"] = "no-cache"
    return response

# 로그인 정보(creds)를 준비하는 동안 다른 요청이 끼어들지 못하게 하는 열쇠.
# 동시에 여러 요청이 token.json을 읽고 쓰면 파일이 꼬일 수 있어서 필요하다
_creds_lock = threading.Lock()

# 캘린더 목록을 기억해두는 곳(캐시). 목록은 거의 안 바뀌므로 매번 Google에 묻지 않는다
_calendar_cache = {"data": None, "time": 0}
_calendar_lock = threading.Lock()
CALENDAR_CACHE_SECONDS = 600  # 10분이 지나면 목록을 다시 가져온다

# 일정을 기억해두는 상자. 이미 본 달은 Google에 다시 묻지 않고, 바뀐 게 있을 때만 새로 받는다
event_store = event_cache.EventCache()

# 1분마다 Google에 "바뀐 게 있나?" 묻는다. 폰에서 바꾼 일정이 길어도 1~2분 안에 보이게 하는 주기다
SYNC_INTERVAL_SECONDS = 60

# "#" 다음에 16진수(0-9, a-f) 6글자. 예: #9fc6e7
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

# 일정을 가져오는 작업자(스레드) 8명을 미리 만들어 계속 살려둔다.
# 요청 때마다 새로 만들면 그때마다 Google 연결도 새로 만들어야 해서 느리다
_pool = ThreadPoolExecutor(max_workers=8)

# 화면이 기다리지 않는 뒤쪽 일(바뀐 게 있는지 확인, 앞뒤 달 미리 받기)을 하는 작업자 2명.
# 위의 8명과 따로 두어서, 뒤쪽 일 때문에 사용자가 누른 동작이 늦어지지 않게 한다
_background_pool = ThreadPoolExecutor(max_workers=2)

# 스레드마다 따로 보관하는 저장 공간. 각 작업자가 자기 Google 연결을 여기에 담아둔다
_thread_data = threading.local()


def get_creds():
    """로그인 정보를 돌려준다. 한 번에 한 요청만 들어오도록 열쇠를 쓴다."""
    # with lock: 열쇠를 잡고 이 블록을 실행하고, 끝나면 자동으로 열쇠를 돌려준다
    with _creds_lock:
        return google_calendar.get_credentials()


def get_calendar_list():
    """캘린더 목록을 돌려준다. 최근에 가져온 게 있으면 Google에 묻지 않고 그걸 쓴다.
    인터넷이 끊겨서 못 가져오면, 파일에 저장해둔 지난번 목록을 대신 쓴다."""
    with _calendar_lock:
        age = time.time() - _calendar_cache["time"]  # 마지막으로 가져온 지 몇 초 지났는지
        if _calendar_cache["data"] is None or age > CALENDAR_CACHE_SECONDS:
            try:
                service = google_calendar.build_service(get_creds())
                calendars = google_calendar.get_calendars(service)
            except Exception as error:
                # 대신 쓸 지난번 목록이 있으면 그걸 쓰고, 1분 뒤에 다시 시도한다. 아무것도 없으면 오류를 그대로 올린다
                saved = _calendar_cache["data"] or event_store.saved_calendars()
                if saved is None:
                    raise
                print(f"[캘린더 목록] 새로 받지 못해 지난번 목록을 씁니다: {error}")
                if not isinstance(error, HttpError):
                    event_store.mark_offline()
                _calendar_cache["data"] = saved
                _calendar_cache["time"] = time.time() - CALENDAR_CACHE_SECONDS + 60
                return saved
            _calendar_cache["data"] = calendars
            _calendar_cache["time"] = time.time()
            event_store.save_calendars(calendars)  # 인터넷이 끊겼을 때를 위해 파일에도 남겨둔다
            event_store.mark_online()
        return _calendar_cache["data"]


def get_thread_service():
    """지금 실행 중인 스레드 전용 Google 연결을 돌려준다. 없으면 한 번 만들고, 이후엔 재사용한다."""
    service = getattr(_thread_data, "service", None)
    if service is None:
        # 로그인 정보는 연결을 새로 만들 때만 꺼낸다. (일정이 이미 기억되어 있으면 로그인 정보 없이도 보여줄 수 있다)
        service = google_calendar.build_service(get_creds())
        _thread_data.service = service
    return service


def can_edit(calendar):
    """이 캘린더에 일정을 쓸 수 있는지 알려준다. accessRole이 owner(소유자)나 writer(편집자)면 쓸 수 있다."""
    return calendar.get("accessRole") in ("owner", "writer")


def fetch_calendar_events(calendar, start, end):
    """캘린더 하나의 일정을 가져와서 FullCalendar 형식의 리스트로 돌려준다."""
    try:
        # 기억해둔 일정이 있으면 그걸 쓰고, 없을 때만 Google에 묻는다 (event_cache.py).
        # get_thread_service를 함수 그대로 넘기는 이유: Google 연결(service)은 여러 스레드가 함께 쓰면 SSL 오류가 나서,
        # 실제로 Google에 묻는 순간에 "그 스레드 전용 연결"을 꺼내 쓰게 하려는 것이다
        events = event_store.events_in_range(calendar["id"], start, end, get_thread_service)
    except HttpError as error:
        # 캘린더 하나가 오류(예: 404)를 내도 전체가 실패하지 않게, 그 캘린더만 건너뛴다
        print(f"[건너뜀] '{calendar['summary']}' 캘린더의 일정을 못 가져왔습니다: {error.resp.status}")
        return []

    color = calendar.get("backgroundColor", "#3788d8")  # 일정 색 = 캘린더 색
    editable = can_edit(calendar)
    # 기억해둔 일정에는 id, 제목, 시작, 끝만 있다. 캘린더에 따라 정해지는 값들을 보낼 때 붙인다
    return [{
        **event,
        "color": color,
        "calendarId": calendar["id"],  # 나중에 체크박스로 캘린더별 숨기기에 쓴다
        "editable": editable,  # False면 FullCalendar가 드래그를 막아준다
        "canEdit": editable,  # 클릭했을 때 수정 창을 열어도 되는지 app.js가 확인하는 용도
    } for event in events]


def prefetch_one(calendar_id, months):
    """일정을 미리 받아서 기억해둔다. 뒤에서 하는 일이라 실패해도 조용히 넘어간다."""
    try:
        event_store.load_months(calendar_id, months, get_thread_service)
    except Exception:
        pass


def prefetch_neighbors(calendars, months):
    """보고 있는 기간의 바로 앞 달과 뒤 달을 뒤에서 미리 받아둔다. 다음에 달을 넘길 때 바로 보이게 하려는 것이다."""
    if not months or not event_store.online:
        return
    targets = [event_cache.previous_month(*months[0]), event_cache.next_month(*months[-1])]
    for calendar in calendars:
        for target in targets:
            if not event_store.has_fresh(calendar["id"], target):
                _background_pool.submit(prefetch_one, calendar["id"], [target])


def warm_up():
    """프로그램을 켤 때 미리 로그인, 캘린더 목록, 작업자 8명의 Google 연결을 준비해둔다.
    이걸 안 하면 처음 달력을 열 때 이 준비 때문에 약 3초가 걸린다."""
    try:
        calendars = get_calendar_list()
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
            service = get_thread_service()
            calendar = calendars[i % len(calendars)]
            google_calendar.get_events(service, calendar["id"], today, tomorrow)

        # list(...): map은 결과를 꺼내야 실제로 끝까지 실행되므로 리스트로 만들어 기다린다
        list(_pool.map(prepare, range(8)))
    except Exception as error:
        # 준비에 실패해도 프로그램은 계속 돈다. 그냥 첫 로딩이 느려질 뿐이다
        print(f"[준비 실패] 미리 연결하지 못했습니다: {error}")


# ---------- 자동 동기화 ----------

# 같은 오류 메시지를 1분마다 반복해서 찍지 않으려고, 이미 알린 (캘린더, 오류 번호)를 기억해둔다
_reported_errors = set()


def check_one(calendar):
    """캘린더 하나에 "마지막으로 확인한 뒤 바뀐 게 있나?" 묻고 결과를 글자로 돌려준다.
    "changed"(바뀜), "same"(그대로), "skipped"(바뀐 것을 확인할 수 없는 캘린더라 묻지 않음),
    "offline"(인터넷 문제), "error"(Google이 거절)"""
    try:
        changed = event_store.check_calendar(calendar["id"], get_thread_service)
        if changed is None:
            return "skipped"
        return "changed" if changed else "same"
    except HttpError as error:
        marker = (calendar["id"], error.resp.status)
        if marker not in _reported_errors:
            _reported_errors.add(marker)
            print(f"[동기화 건너뜀] '{calendar['summary']}' 캘린더를 확인하지 못했습니다: {error.resp.status}")
        return "error"
    except Exception:
        # HttpError가 아닌 오류는 대부분 인터넷 문제다. 상태 표시는 아래에서 한 번에 처리한다
        return "offline"


def run_sync_cycle():
    """모든 캘린더를 한 번 확인한다. 다른 곳(폰 등)에서 바뀐 게 있으면 화면이 알아차리도록 알린다.
    어떤 오류가 나도 예외를 던지지 않는다. (반복 작업이 중간에 멈추면 안 되므로)"""
    try:
        calendars = get_calendar_list()
        # 작업자 2명이 캘린더들을 나눠서 확인한다
        outcomes = list(_background_pool.map(check_one, calendars))
    except Exception as error:
        print(f"[동기화 실패] {error}")
        event_store.mark_offline()
        return

    if "changed" in outcomes:
        event_store.bump_version()
    if "changed" in outcomes or "same" in outcomes:
        event_store.mark_synced()
    elif "offline" in outcomes:
        event_store.mark_offline()
    event_store.save(force=True)


def prefetch_around_today():
    """이번 달과 앞뒤 달의 일정을 미리 받아둔다. 프로그램을 켠 직후 달을 넘겨도 바로 보이게 하려는 것이다."""
    today = datetime.date.today()
    this_month = (today.year, today.month)
    months = [event_cache.previous_month(*this_month), this_month, event_cache.next_month(*this_month)]
    try:
        for calendar in get_calendar_list():
            _background_pool.submit(prefetch_one, calendar["id"], months)
    except Exception as error:
        print(f"[미리 받기 실패] {error}")


def sync_loop():
    """1분마다 run_sync_cycle을 되풀이한다. 프로그램이 켜져 있는 동안 계속 돈다."""
    first = True
    while True:
        run_sync_cycle()
        if first:
            first = False
            prefetch_around_today()
        time.sleep(SYNC_INTERVAL_SECONDS)


def start_background_tasks():
    """프로그램을 켤 때 뒤에서 할 일 두 가지를 시작한다. 창이 뜨는 것을 막지 않는다.
    daemon=True: 창을 닫으면 이 작업이 남아 있어도 프로그램이 같이 끝나게 한다"""
    threading.Thread(target=warm_up, daemon=True).start()
    threading.Thread(target=sync_loop, daemon=True).start()


# 누군가 주소 "/"(맨 첫 페이지)로 접속하면 바로 아래 함수를 실행해라
@app.route("/")
def index():
    # templates 폴더의 index.html을 읽어서 돌려준다. 그 내용이 브라우저 화면에 표시된다
    return render_template("index.html")


# 주소 "/api/calendars"로 요청이 오면 캘린더 목록을 JSON으로 돌려준다
@app.route("/api/calendars")
def api_calendars():
    try:
        calendars = get_calendar_list()
    except Exception as error:
        print(f"[캘린더 목록 실패] {error}")
        return jsonify({"error": "캘린더 목록을 불러오지 못했습니다. 인터넷 연결을 확인하세요."}), 502

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

    try:
        # 캘린더 목록은 요청 하나당 한 번만 준비한다
        calendars = get_calendar_list()

        # 모든 캘린더를 작업자들에게 나눠줘서 동시에 조회한다.
        # 하나씩 기다리면 (0.3초 × 8개) 걸리던 것이 가장 느린 하나만큼(약 0.3초)으로 줄어든다
        # _pool.map: 캘린더마다 fetch_calendar_events를 실행하고, 결과를 캘린더 순서대로 모아준다
        # (기억해둔 일정이 있으면 Google에 묻지 않으므로 훨씬 빠르다)
        per_calendar = list(_pool.map(
            lambda calendar: fetch_calendar_events(calendar, start, end),
            calendars,
        ))
    except Exception as error:
        # 인터넷이 끊겼고 기억해둔 일정도 없는 경우 등. 화면이 이유를 보여줄 수 있게 알려준다
        print(f"[일정 불러오기 실패] {error}")
        return jsonify({"error": "Google Calendar에서 일정을 불러오지 못했습니다. 인터넷 연결을 확인하세요."}), 502

    # [[A의 일정들], [B의 일정들], ...] 형태를 [A의 일정, ..., B의 일정, ...]로 한 줄로 펼친다
    result = [event for events in per_calendar for event in events]

    # 응답을 돌려준 뒤 쓸 수 있도록, 앞뒤 달은 뒤에서 미리 받아둔다
    prefetch_neighbors(calendars, event_cache.months_between(start, end))
    return jsonify(result)


# 동기화 상태: 화면이 15초마다 물어본다. version이 달라졌으면 다른 곳에서 일정이 바뀐 것이니 화면이 일정을 다시 불러온다.
# lastSync는 마지막으로 동기화에 성공한 시각(초 단위 숫자), online이 False면 지금 Google에 연결할 수 없는 상태다
@app.route("/api/sync-status")
def api_sync_status():
    return jsonify(event_store.status())


# 새로고침 버튼: 기억해둔 일정을 모두 "오래된 일정"으로 만들어서, 화면이 일정을 Google에서 새로 받게 한다.
# 인터넷이 끊겨 있으면 기억해둔 일정을 그대로 두고 상태만 알려준다 (지우면 보여줄 것이 사라지기 때문)
@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    _calendar_cache["time"] = 0  # 캘린더 목록(색, 새로 생긴 캘린더)도 다시 받게 한다
    run_sync_cycle()  # 지금 연결이 되는지, 바뀐 게 있는지 확인한다
    if event_store.online:
        try:
            event_store.invalidate_all([calendar["id"] for calendar in get_calendar_list()])
        except Exception as error:
            print(f"[새로고침 실패] {error}")
    return jsonify(event_store.status())


def missing_key(data, keys):
    """data에 없는 키가 있으면 '요청이 잘못됐다'는 뜻의 400 응답을 만들어 돌려준다. 다 있으면 None."""
    for key in keys:
        if key not in data:
            return jsonify({"error": f"'{key}' 값이 없습니다."}), 400
    return None


def run_google_write(failure_message, operation, calendar_id=None):
    """Google에 쓰는 일(추가/수정/삭제/캘린더 색 변경)을 작업자 스레드에서 실행한다.
    성공하면 None, 실패하면 화면에 보여줄 오류 응답을 돌려준다.
    failure_message: 실패했을 때 화면에 보여줄 문장 (예: "일정을 추가하지 못했습니다.")
    operation: service를 받아서 Google 요청을 보내는 함수
    calendar_id: 일정이 바뀌는 캘린더. 성공하면 그 캘린더에 기억해둔 일정을 오래된 것으로 바꾼다 (색 변경은 필요 없다)"""

    def job():
        # 작업자 스레드 안에서 실행되므로, 그 스레드 전용 Google 연결을 쓴다
        return operation(get_thread_service())

    try:
        # _pool.submit(...).result(): 작업자 한 명에게 일을 시키고 끝날 때까지 기다린다
        _pool.submit(job).result()
    except HttpError as error:
        # Google이 거절했을 때(권한 없음, 잘못된 값 등). 화면이 오류를 보여줄 수 있게 이유를 담아 보낸다
        print(f"[Google 쓰기 실패] {failure_message} {error}")
        message = f"Google에 {failure_message}"
        if error.resp.status == 403:
            # 403: 권한이 없다는 뜻. 읽기 전용 캘린더이거나, 로그인할 때 받은 권한이 모자란 경우다
            message += " (권한이 부족합니다. 프로그램을 껐다 켜서 Google 로그인을 다시 해보세요.)"
        return jsonify({"error": message}), 502
    except Exception as error:
        # HttpError가 아닌 오류는 대부분 인터넷 문제다 (연결 끊김, 시간 초과 등)
        print(f"[Google 쓰기 실패] {failure_message} {error}")
        return jsonify({"error": f"Google에 {failure_message} (인터넷 연결을 확인하세요.)"}), 502

    if calendar_id is not None:
        # 이 캘린더에 기억해둔 일정은 이제 틀린 내용이다. 화면이 곧바로 일정을 다시 불러오므로, 응답을 보내기 전에 먼저 표시해둔다
        event_store.invalidate(calendar_id)
        # 이 변화를 "다른 곳에서 바뀐 것"으로 오해하지 않도록, 뒤에서 책갈피(syncToken)를 앞으로 옮겨둔다
        _background_pool.submit(event_store.absorb_own_write, calendar_id, get_thread_service)
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

    error_response = run_google_write("일정을 추가하지 못했습니다.", lambda service: google_calendar.create_event(
        service, data["calendarId"], data["title"], data["allDay"], data["start"], data["end"]
    ), data["calendarId"])
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

    error_response = run_google_write("일정을 수정하지 못했습니다.", lambda service: google_calendar.update_event(
        service, data["calendarId"], event_id, data["allDay"], data["start"], data["end"],
        title=data.get("title"),
    ), data["calendarId"])
    if error_response:
        return error_response

    return jsonify({"ok": True})


# DELETE: 일정을 지운다. 어느 캘린더의 일정인지는 주소 뒤(?calendarId=...)로 받는다
@app.route("/api/events/<event_id>", methods=["DELETE"])
def api_delete_event(event_id):
    calendar_id = request.args.get("calendarId")
    if not calendar_id:
        return jsonify({"error": "'calendarId' 값이 없습니다."}), 400

    error_response = run_google_write("일정을 삭제하지 못했습니다.", lambda service: google_calendar.delete_event(
        service, calendar_id, event_id
    ), calendar_id)
    if error_response:
        return error_response

    return jsonify({"ok": True})


# 캘린더 색 바꾸기: Google의 "내 캘린더 목록"에서 이 캘린더의 색을 바꾼다 (폰, 웹에도 똑같이 반영된다)
# 캘린더 id에는 @, # 같은 글자가 들어 있어서 주소에 넣지 않고 body로 받는다
@app.route("/api/calendar-color", methods=["PATCH"])
def api_calendar_color():
    data = request.get_json()
    error_response = missing_key(data, ("calendarId", "color"))
    if error_response:
        return error_response

    # 색은 "#rrggbb" 모양(예: #9fc6e7)이어야 한다
    color = data["color"]
    if not isinstance(color, str) or not COLOR_PATTERN.match(color):
        return jsonify({"error": "색은 #rrggbb 형식이어야 합니다."}), 400
    color = color.lower()

    error_response = run_google_write("캘린더 색을 바꾸지 못했습니다.", lambda service: google_calendar.set_calendar_color(
        service, data["calendarId"], color
    ))
    if error_response:
        return error_response

    # 기억해둔 캘린더 목록(캐시)의 색도 새 색으로 바꿔서, 이후에 불러오는 일정도 새 색으로 그려지게 한다
    with _calendar_lock:
        for calendar in _calendar_cache["data"] or []:
            if calendar["id"] == data["calendarId"]:
                calendar["backgroundColor"] = color
                calendar["foregroundColor"] = google_calendar.text_color_for(color)

    return jsonify({"ok": True})


# 설정 읽기: 저장된 값(values)과 슬라이더 정의(sliders)를 함께 돌려준다.
# 화면은 sliders를 보고 슬라이더를 만들고, values로 현재 위치를 맞춘다
@app.route("/api/settings")
def api_get_settings():
    return jsonify({
        "values": settings_store.load_settings(),
        "sliders": settings_store.SLIDER_DEFINITIONS,
        "pomodoroSliders": settings_store.POMODORO_SLIDER_DEFINITIONS,
    })


# 설정 저장: 화면이 보낸 값을 정리(범위 밖 값 보정)해서 저장하고, 실제로 저장된 값을 돌려준다.
# PUT은 "이 자리의 내용을 통째로 이걸로 바꿔라"라는 뜻의 HTTP 메서드다
@app.route("/api/settings", methods=["PUT"])
def api_save_settings():
    saved = settings_store.save_settings(request.get_json())
    return jsonify(saved)


# ---------- 노트 (Obsidian vault) ----------

def vault_path():
    """설정 탭에 적힌 Obsidian vault 폴더 경로 (안 정했으면 빈 글자)"""
    return settings_store.load_settings()[settings_store.VAULT_PATH_KEY]


def note_error_response(error):
    """NoteError를 화면이 이해하는 응답으로 바꾼다. 충돌이면 지금 파일의 수정 시각(mtime)도 함께 알려준다."""
    body = {"error": str(error)}
    if isinstance(error, notes_store.NoteConflict):
        body["conflict"] = True
        body["mtime"] = error.mtime
    return jsonify(body), error.status


# 노트 목록. vault를 아직 안 정했거나 폴더를 못 찾는 것은 "오류 상태"가 아니라 화면이 안내를 보여줄 정상 응답(200)으로 준다
@app.route("/api/notes")
def api_list_notes():
    path = vault_path()
    if not path:
        return jsonify({"configured": False, "notes": []})
    try:
        notes, truncated = notes_store.list_notes(path)
    except notes_store.NoteError as error:
        return jsonify({"configured": True, "error": str(error), "notes": []})
    return jsonify({"configured": True, "vault": path, "notes": notes, "truncated": truncated})


# 노트 한 개 읽기: ?path=폴더/이름.md
@app.route("/api/notes/content")
def api_read_note():
    try:
        return jsonify(notes_store.read_note(vault_path(), request.args.get("path", "")))
    except notes_store.NoteError as error:
        return note_error_response(error)


# 노트 수정 시각만 확인 (Obsidian에서 바뀌었는지 보려고 화면이 몇 초마다 부른다)
@app.route("/api/notes/stat")
def api_stat_note():
    try:
        return jsonify({"mtime": notes_store.stat_note(vault_path(), request.args.get("path", ""))})
    except notes_store.NoteError as error:
        return note_error_response(error)


# 노트 저장. baseMtime은 화면이 노트를 읽었을 때 받은 수정 시각이다 (그 사이에 파일이 바뀌었으면 409로 거절한다)
@app.route("/api/notes/content", methods=["PUT"])
def api_save_note():
    data = request.get_json(silent=True) or {}
    error_response = missing_key(data, ("path", "content", "baseMtime"))
    if error_response:
        return error_response
    try:
        mtime = notes_store.save_note(vault_path(), data["path"], data["content"], data["baseMtime"])
    except notes_store.NoteError as error:
        return note_error_response(error)
    return jsonify({"mtime": mtime})


# 새 노트 만들기 (POST)
@app.route("/api/notes", methods=["POST"])
def api_create_note():
    data = request.get_json(silent=True) or {}
    error_response = missing_key(data, ("path",))
    if error_response:
        return error_response
    try:
        created = notes_store.create_note(vault_path(), data["path"])
    except notes_store.NoteError as error:
        return note_error_response(error)
    return jsonify(created), 201


# 노트 안의 웹 주소(링크)를 눌렀을 때 이 창 대신 컴퓨터의 기본 브라우저로 연다.
# 이 창 안에서 이동해 버리면 StudyFlow 화면이 사라지기 때문이다. http/https 주소만 연다
@app.route("/api/open-external", methods=["POST"])
def api_open_external():
    data = request.get_json(silent=True) or {}
    url = data.get("url")
    if not isinstance(url, str) or urllib.parse.urlparse(url).scheme not in ("http", "https"):
        return jsonify({"error": "웹 주소(http, https)만 열 수 있습니다."}), 400
    webbrowser.open(url)
    return jsonify({"ok": True})


def valid_date(text):
    """'2026-10-19' 모양의 진짜 날짜인지 확인한다. 맞으면 True."""
    try:
        datetime.date.fromisoformat(text)
        return isinstance(text, str) and len(text) == 10
    except (TypeError, ValueError):
        return False


# 할 일 목록: 그 날짜의 할 일(tasks)과, 그 날짜 이전에 잡혀 있는데 끝내지 못한 할 일(overdue)을 함께 돌려준다.
# 날짜는 화면이 이 컴퓨터의 "오늘"을 계산해서 ?date=2026-10-19 로 보낸다
@app.route("/api/tasks")
def api_get_tasks():
    date = request.args.get("date", "")
    if not valid_date(date):
        return jsonify({"error": "'date'는 2026-10-19 같은 날짜여야 합니다."}), 400
    return jsonify({
        "tasks": database.list_tasks(date),
        "overdue": database.list_overdue_tasks(date),
    })


# 우선순위 탭(12단계)에 보여줄, 아직 안 끝낸 모든 할 일. importance/urgency가 null이면 "평가 안 함"이다
@app.route("/api/priority-tasks")
def api_get_priority_tasks():
    return jsonify(database.list_open_tasks())


# 중요도와 긴급도의 범위. 우선순위 탭의 7×7 칸이 -3~3이다
PRIORITY_MIN, PRIORITY_MAX = -database.PRIORITY_LIMIT, database.PRIORITY_LIMIT


def parse_priority(data):
    """화면이 보낸 importance, urgency를 검사한다. 둘은 항상 함께 와야 하고, 둘 다 -3~3의 정수이거나(평가함)
    둘 다 null이다(평가 취소). 맞으면 ({"importance": .., "urgency": ..}, None), 틀리면 (None, 오류 응답)."""
    if "importance" not in data or "urgency" not in data:
        return None, (jsonify({"error": "중요도와 긴급도를 함께 보내야 합니다."}), 400)
    values = (data["importance"], data["urgency"])
    if all(v is None for v in values):
        return {"importance": None, "urgency": None}, None
    # bool은 파이썬에서 정수의 한 종류라서 따로 거른다
    if not all(isinstance(v, int) and not isinstance(v, bool) and PRIORITY_MIN <= v <= PRIORITY_MAX for v in values):
        return None, (jsonify({"error": f"중요도와 긴급도는 {PRIORITY_MIN}~{PRIORITY_MAX} 사이의 정수이거나 둘 다 비어 있어야 합니다."}), 400)
    return {"importance": values[0], "urgency": values[1]}, None


# 캘린더 탭에 날짜별로 보여줄 할 일: ?start=2026-10-01&end=2026-11-12 (start 이상, end 미만).
# 돌려주는 모양은 {"2026-10-27": [할 일, 할 일, ...], ...}이고 할 일이 없는 날짜는 빠진다.
# 한 번에 너무 긴 기간을 요구하지 못하게 막는다(월간 보기가 42일이라 넉넉하게 100일)
MAX_TASK_DAYS_RANGE = 100


@app.route("/api/task-days")
def api_task_days():
    start = request.args.get("start", "")
    end = request.args.get("end", "")
    if not valid_date(start) or not valid_date(end):
        return jsonify({"error": "'start'와 'end'는 2026-10-19 같은 날짜여야 합니다."}), 400
    span = (datetime.date.fromisoformat(end) - datetime.date.fromisoformat(start)).days
    if span <= 0 or span > MAX_TASK_DAYS_RANGE:
        return jsonify({"error": f"기간은 1일 이상 {MAX_TASK_DAYS_RANGE}일 이하여야 합니다."}), 400

    days = {}
    for task in database.list_tasks_between(start, end):
        days.setdefault(task["date"], []).append(task)
    return jsonify(days)


# 할 일 추가 (POST)
@app.route("/api/tasks", methods=["POST"])
def api_create_task():
    data = request.get_json()
    error_response = missing_key(data, ("content",))
    if error_response:
        return error_response

    content = str(data["content"]).strip()
    if not content:
        return jsonify({"error": "할 일 내용을 입력하세요."}), 400

    # date(날짜), projectId(연결할 프로젝트), parentId(상위 단계)는 없어도 된다
    date = data.get("date")
    project_id = data.get("projectId")
    parent_id = data.get("parentId")
    if date is not None and not valid_date(date):
        return jsonify({"error": "'date'는 2026-10-19 같은 날짜여야 합니다."}), 400

    if parent_id is not None:
        # 하위 단계로 만들 때: 상위 단계는 "프로젝트에 연결된 단계"여야 하고, 그 자신이 하위 단계이면 안 된다
        # (하위 단계의 하위 단계는 만들지 않는다. 한 겹까지만 지원한다)
        parent = database.get_task(parent_id) if isinstance(parent_id, int) else None
        if not parent or parent["project_id"] is None:
            return jsonify({"error": "그 상위 단계를 찾을 수 없습니다."}), 400
        if parent["parent_id"] is not None:
            return jsonify({"error": "하위 단계 아래에는 더 만들 수 없습니다."}), 400
        project_id = parent["project_id"]  # 하위 단계는 상위 단계와 같은 프로젝트에 속한다
    elif project_id is not None and (not isinstance(project_id, int) or not database.get_project(project_id)):
        return jsonify({"error": "그 프로젝트를 찾을 수 없습니다."}), 400

    # 날짜도 프로젝트도 없으면 어디에도 보이지 않는 할 일이 되므로 막는다
    if date is None and project_id is None:
        return jsonify({"error": "날짜가 없는 할 일은 프로젝트에 연결해야 합니다."}), 400

    # 만들어진 할 일(번호 포함)을 돌려준다. 201: "새로 만들어졌다"
    return jsonify(database.add_task(content, date, project_id, parent_id)), 201


# 할 일 일부 수정 (PATCH): 체크 표시(done), 날짜 이동(date), 내용 고치기(content). 보낸 것만 바꾼다
@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
def api_update_task(task_id):
    data = request.get_json()
    changes = {}

    if "done" in data:
        changes["done"] = 1 if data["done"] else 0  # true/false를 SQLite에 저장하는 1/0으로 바꾼다
    if "date" in data:
        if data["date"] is None:
            # 날짜를 빼는 것("오늘에서 빼기"). 프로젝트에 연결된 할 일만 가능하다.
            # 프로젝트에도 연결되지 않은 할 일의 날짜를 빼면 어디에서도 보이지 않게 되기 때문이다
            task = database.get_task(task_id)
            if not task:
                return jsonify({"error": "그 할 일을 찾을 수 없습니다."}), 404
            if task["project_id"] is None:
                return jsonify({"error": "프로젝트에 연결되지 않은 할 일은 날짜를 뺄 수 없습니다."}), 400
            changes["date"] = None
        elif not valid_date(data["date"]):
            return jsonify({"error": "'date'는 2026-10-19 같은 날짜여야 합니다."}), 400
        else:
            changes["date"] = data["date"]
    if "deadline" in data:
        deadline = data["deadline"] or None  # 빈 값은 "마감일 없음"
        if deadline is not None and not valid_date(deadline):
            return jsonify({"error": "마감일은 2026-12-31 같은 날짜여야 합니다."}), 400
        changes["deadline"] = deadline
    if "content" in data:
        content = str(data["content"]).strip()
        if not content:
            return jsonify({"error": "할 일 내용을 입력하세요."}), 400
        changes["content"] = content
    if "importance" in data or "urgency" in data:
        priority, error_response = parse_priority(data)
        if error_response:
            return error_response
        changes.update(priority)

    if not changes:
        return jsonify({"error": "바꿀 값이 없습니다."}), 400
    if not database.update_task(task_id, changes):
        return jsonify({"error": "그 할 일을 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# 할 일 삭제 (DELETE)
@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def api_delete_task(task_id):
    if not database.delete_task(task_id):
        return jsonify({"error": "그 할 일을 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# ---------- 프로젝트 ----------

# 새 프로젝트에 색을 따로 고르지 않았을 때 차례대로 쓰는 색들
PROJECT_COLORS = ["#4a7cff", "#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#1098ad", "#f08c00"]


def build_step_tree(tasks):
    """프로젝트의 할 일들(평평한 리스트)을 "단계 → 하위 단계" 모양으로 묶는다.
    위쪽 단계들만 리스트로 돌려주고, 각 단계의 children에 그 하위 단계들이 들어 있다.
    하위 단계가 있는 단계는 제목 역할이라서, 자기 체크 상태 대신 "하위 단계를 모두 끝냈는가"를 done으로 알려준다.
    (이 값은 계산한 것이고 DB에 저장하지 않는다. 하위 단계를 체크하면 상위 단계는 저절로 따라 바뀐다)"""
    children_of = {}
    top_steps = []
    for task in tasks:
        if task["parent_id"] is None:
            top_steps.append(task)
        else:
            children_of.setdefault(task["parent_id"], []).append(task)

    for step in top_steps:
        step["children"] = children_of.get(step["id"], [])
        if step["children"]:
            step["done"] = 1 if all(child["done"] for child in step["children"]) else 0
    # 상위 단계의 done이 계산으로 바뀌었을 수 있으므로, 안 끝낸 것이 위로 오게 다시 정렬한다
    top_steps.sort(key=lambda step: (step["done"], step["id"]))
    return top_steps


def project_json(project, tasks):
    """DB에서 꺼낸 프로젝트 한 줄과 그 프로젝트의 단계들(build_step_tree가 묶은 것)을, 화면에 보낼 모양으로 바꾼다.
    진행률(percent)은 여기서 계산한다:
    - 직접(manual): 저장해둔 값을 그대로
    - 자동(auto): 끝낸 할 일 ÷ 전체 할 일. 할 일이 하나도 없으면 0%"""
    if project["progress_mode"] == "manual":
        percent = project["manual_percent"]
    elif project["total"] > 0:
        # 반올림한 퍼센트. (끝낸 수 × 100 ÷ 전체)를 정수로 반올림하는 식이다
        percent = (project["done_count"] * 200 + project["total"]) // (2 * project["total"])
    else:
        percent = 0

    return {
        "id": project["id"],
        "name": project["name"],
        "deadline": project["deadline"],
        "color": project["color"],
        "progressMode": project["progress_mode"],
        "manualPercent": project["manual_percent"],
        "folderId": project["folder_id"],
        "total": project["total"],
        "doneCount": project["done_count"],
        "percent": percent,
        "tasks": tasks,
    }


def parse_project_fields(data):
    """화면이 보낸 프로젝트 값을 검사해서, DB 칸 이름 → 값 딕셔너리로 바꿔 돌려준다. 보낸 값만 담는다.
    잘못된 값이 있으면 (None, 오류 응답)을 돌려준다."""
    fields = {}

    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            return None, (jsonify({"error": "프로젝트 이름을 입력하세요."}), 400)
        fields["name"] = name

    if "deadline" in data:
        deadline = data["deadline"] or None  # 빈 글자("")는 "마감일 없음"으로 본다
        if deadline is not None and not valid_date(deadline):
            return None, (jsonify({"error": "마감일은 2026-12-31 같은 날짜여야 합니다."}), 400)
        fields["deadline"] = deadline

    if "color" in data:
        color = data["color"]
        if not isinstance(color, str) or not COLOR_PATTERN.match(color):
            return None, (jsonify({"error": "색은 #rrggbb 형식이어야 합니다."}), 400)
        fields["color"] = color.lower()

    if "progressMode" in data:
        if data["progressMode"] not in ("auto", "manual"):
            return None, (jsonify({"error": "진행률 방식은 auto 또는 manual이어야 합니다."}), 400)
        fields["progress_mode"] = data["progressMode"]

    if "folderId" in data:
        folder_id = data["folderId"]
        # null이면 "폴더 없음". 숫자면 실제로 있는 폴더여야 한다 (bool은 파이썬에서 정수의 한 종류라서 따로 거른다)
        if folder_id is not None and (isinstance(folder_id, bool) or not isinstance(folder_id, int) or not database.get_folder(folder_id)):
            return None, (jsonify({"error": "그 폴더를 찾을 수 없습니다."}), 400)
        fields["folder_id"] = folder_id

    if "manualPercent" in data:
        try:
            # 0~100 밖의 값은 안쪽으로 맞춘다
            fields["manual_percent"] = max(0, min(100, int(data["manualPercent"])))
        except (TypeError, ValueError):
            return None, (jsonify({"error": "진행률은 숫자여야 합니다."}), 400)

    return fields, None


# 프로젝트 목록: 마감일이 가까운 순서. 각 프로젝트에 진행률과 연결된 할 일(단계)들이 함께 들어 있다
@app.route("/api/projects")
def api_get_projects():
    # 할 일을 프로젝트 번호별로 묶어둔다. 예: {1: [할 일, 할 일], 2: [할 일]}
    tasks_by_project = {}
    for task in database.list_project_tasks():
        tasks_by_project.setdefault(task["project_id"], []).append(task)

    return jsonify([
        project_json(project, build_step_tree(tasks_by_project.get(project["id"], [])))
        for project in database.list_projects()
    ])


# 프로젝트 추가 (POST)
@app.route("/api/projects", methods=["POST"])
def api_create_project():
    data = request.get_json()
    fields, error_response = parse_project_fields(data)
    if error_response:
        return error_response
    if "name" not in fields:
        return jsonify({"error": "'name' 값이 없습니다."}), 400

    # 안 보낸 값은 기본값을 쓴다. 색은 이미 있는 프로젝트 수를 이용해 팔레트에서 차례로 고른다
    color = fields.get("color") or PROJECT_COLORS[len(database.list_projects()) % len(PROJECT_COLORS)]
    project = database.add_project(
        fields["name"],
        fields.get("deadline"),
        color,
        fields.get("progress_mode", "auto"),
        fields.get("manual_percent", 0),
        fields.get("folder_id"),
    )
    return jsonify(project), 201


# 프로젝트 일부 수정 (PATCH): 이름, 마감일, 색, 진행률 방식, 직접 입력한 %. 보낸 것만 바꾼다
@app.route("/api/projects/<int:project_id>", methods=["PATCH"])
def api_update_project(project_id):
    fields, error_response = parse_project_fields(request.get_json())
    if error_response:
        return error_response
    if not fields:
        return jsonify({"error": "바꿀 값이 없습니다."}), 400
    if not database.update_project(project_id, fields):
        return jsonify({"error": "그 프로젝트를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# 프로젝트 삭제 (DELETE): 날짜 없는 단계는 함께 지워지고, 날짜 있는 할 일은 연결만 끊긴다
@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
def api_delete_project(project_id):
    if not database.delete_project(project_id):
        return jsonify({"error": "그 프로젝트를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# ---------- 프로젝트 폴더 ----------

MAX_FOLDER_NAME_LENGTH = 60


def parse_folder_fields(data):
    """화면이 보낸 폴더 값을 검사해서, DB 칸 이름 → 값 딕셔너리로 바꿔 돌려준다. 보낸 값만 담는다.
    잘못된 값이 있으면 (None, 오류 응답)을 돌려준다."""
    fields = {}
    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            return None, (jsonify({"error": "폴더 이름을 입력하세요."}), 400)
        if len(name) > MAX_FOLDER_NAME_LENGTH:
            return None, (jsonify({"error": f"폴더 이름은 {MAX_FOLDER_NAME_LENGTH}글자 이하여야 합니다."}), 400)
        fields["name"] = name
    if "collapsed" in data:
        if not isinstance(data["collapsed"], bool):
            return None, (jsonify({"error": "'collapsed'는 true 또는 false여야 합니다."}), 400)
        fields["collapsed"] = 1 if data["collapsed"] else 0  # SQLite에는 true/false 대신 1/0으로 저장한다
    return fields, None


def folder_json(folder):
    return {
        "id": folder["id"],
        "name": folder["name"],
        "collapsed": bool(folder["collapsed"]),
        "projectCount": folder.get("project_count", 0),
    }


# 폴더 목록 (만든 순서). 각 폴더에 든 프로젝트 수와 접힘 여부가 들어 있다
@app.route("/api/folders")
def api_get_folders():
    return jsonify([folder_json(folder) for folder in database.list_folders()])


# 폴더 만들기 (POST)
@app.route("/api/folders", methods=["POST"])
def api_create_folder():
    fields, error_response = parse_folder_fields(request.get_json(silent=True) or {})
    if error_response:
        return error_response
    if "name" not in fields:
        return jsonify({"error": "'name' 값이 없습니다."}), 400
    return jsonify(folder_json(database.add_folder(fields["name"]))), 201


# 폴더 이름 바꾸기, 접기/펴기 (PATCH). 보낸 것만 바꾼다
@app.route("/api/folders/<int:folder_id>", methods=["PATCH"])
def api_update_folder(folder_id):
    fields, error_response = parse_folder_fields(request.get_json(silent=True) or {})
    if error_response:
        return error_response
    if not fields:
        return jsonify({"error": "바꿀 값이 없습니다."}), 400
    if not database.update_folder(folder_id, fields):
        return jsonify({"error": "그 폴더를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# 폴더 지우기 (DELETE): 안의 프로젝트는 지워지지 않고 "폴더 없음"으로 나온다
@app.route("/api/folders/<int:folder_id>", methods=["DELETE"])
def api_delete_folder(folder_id):
    if not database.delete_folder(folder_id):
        return jsonify({"error": "그 폴더를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# ---------- D-day ----------

MAX_DDAY_NAME_LENGTH = 100


def parse_dday_fields(data):
    """화면이 보낸 D-day 값을 검사해서, DB 칸 이름 → 값 딕셔너리로 바꿔 돌려준다. 보낸 값만 담는다.
    잘못된 값이 있으면 (None, 오류 응답)을 돌려준다."""
    fields = {}

    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            return None, (jsonify({"error": "D-day 이름을 입력하세요."}), 400)
        if len(name) > MAX_DDAY_NAME_LENGTH:
            return None, (jsonify({"error": f"이름은 {MAX_DDAY_NAME_LENGTH}자 이내로 적어주세요."}), 400)
        fields["name"] = name

    if "date" in data:
        if not valid_date(data["date"]):
            return None, (jsonify({"error": "날짜는 2026-12-10 같은 모양이어야 합니다."}), 400)
        fields["date"] = data["date"]

    if "color" in data:
        color = data["color"]
        if not isinstance(color, str) or not COLOR_PATTERN.match(color):
            return None, (jsonify({"error": "색은 #rrggbb 형식이어야 합니다."}), 400)
        fields["color"] = color.lower()

    return fields, None


# D-day 목록: 날짜가 빠른 순서. 화면이 오늘 기준으로 "남은 날", "지난 날"로 나눠 보여준다
@app.route("/api/ddays")
def api_get_ddays():
    return jsonify(database.list_ddays())


# D-day 추가 (POST): 이름과 날짜는 꼭 있어야 한다. 색을 안 보내면 이미 있는 개수에 맞춰 팔레트에서 차례로 고른다
@app.route("/api/ddays", methods=["POST"])
def api_create_dday():
    data = request.get_json()
    error_response = missing_key(data, ("name", "date"))
    if error_response:
        return error_response
    fields, error_response = parse_dday_fields(data)
    if error_response:
        return error_response

    color = fields.get("color") or PROJECT_COLORS[len(database.list_ddays()) % len(PROJECT_COLORS)]
    return jsonify(database.add_dday(fields["name"], fields["date"], color)), 201


# D-day 일부 수정 (PATCH): 이름, 날짜, 색. 보낸 것만 바꾼다
@app.route("/api/ddays/<int:dday_id>", methods=["PATCH"])
def api_update_dday(dday_id):
    fields, error_response = parse_dday_fields(request.get_json())
    if error_response:
        return error_response
    if not fields:
        return jsonify({"error": "바꿀 값이 없습니다."}), 400
    if not database.update_dday(dday_id, fields):
        return jsonify({"error": "그 D-day를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# D-day 삭제 (DELETE)
@app.route("/api/ddays/<int:dday_id>", methods=["DELETE"])
def api_delete_dday(dday_id):
    if not database.delete_dday(dday_id):
        return jsonify({"error": "그 D-day를 찾을 수 없습니다."}), 404
    return jsonify({"ok": True})


# 이 파일을 직접 실행했을 때만 서버를 켠다
if __name__ == "__main__":
    # 브라우저에서 개발용으로 열 때도 자동 동기화가 돌게 한다. (창으로 실행하는 main.py도 같은 함수를 부른다)
    # debug=True일 때 서버가 두 번 켜지는데(자동 재시작용), 그중 실제로 일하는 쪽에서만 시작한다
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_background_tasks()
    # debug=True: 코드를 고치면 서버가 자동으로 다시 시작되고, 오류가 나면 자세히 보여준다
    app.run(debug=True)
