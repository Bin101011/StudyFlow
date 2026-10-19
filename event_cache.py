# 일정을 "달 단위"로 기억해두고(캐시), Google에서 바뀐 게 있는지 확인(동기화)하는 파일.
#
# 왜 필요한가: Google에 일정을 물어보는 데는 한 번에 최소 0.3초가 걸려서, 달을 넘길 때마다 물어보면 느리다.
# 그래서 한 번 받은 일정을 기억해두고, "Google에서 바뀐 게 있을 때만" 다시 받는다.
# 바뀐 게 있는지는 syncToken(책갈피)으로 1분마다 가볍게 확인한다.

import datetime
import json
import os
import threading
import time

from googleapiclient.errors import HttpError

import google_calendar

# 기억해둔 일정을 파일에도 저장해두는 곳. 프로그램을 껐다 켜도 남아 있고, 인터넷이 끊겼을 때 이걸 보여준다
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(BASE_DIR, "events_cache.json")
FILE_VERSION = 1  # 저장 형식이 바뀌면 올린다. 번호가 다른 옛 파일은 읽지 않고 버린다

# 마지막으로 "바뀐 게 있나?" 확인에 성공한 지 이 시간(초)이 지났으면, 기억해둔 일정을 그냥 믿지 않고 다시 확인한다.
# 동기화가 멈췄는데 오래된 일정을 계속 보여주는 일을 막는 안전장치다
CHECK_FRESH_SECONDS = 600
UNSYNCABLE_REFRESH_SECONDS = 1800  # 변경 확인이 안 되는 캘린더는 이 시간(30분)마다 일정을 새로 받는다
SAVE_INTERVAL_SECONDS = 5  # 파일 저장은 너무 자주 하지 않는다
KEEP_MONTHS = 24  # 오늘에서 이 개월 수보다 멀리 떨어진 달의 일정은 저장 파일에서 버린다


# ---------- 날짜 계산 도우미 ----------

def month_key(year, month):
    """(2026, 10) → "2026-10". 저장할 때 달의 이름표로 쓴다."""
    return f"{year:04d}-{month:02d}"


def next_month(year, month):
    return (year + 1, 1) if month == 12 else (year, month + 1)


def previous_month(year, month):
    return (year - 1, 12) if month == 1 else (year, month - 1)


def month_range(year, month):
    """그 달의 1일(포함) ~ 다음 달 1일(미포함)."""
    next_year, next_month_number = next_month(year, month)
    return datetime.date(year, month, 1), datetime.date(next_year, next_month_number, 1)


def months_between(start, end):
    """start(포함) ~ end(미포함) 사이에 걸치는 달들을 [(연, 월), ...]로 돌려준다."""
    months = []
    year, month = start.year, start.month
    last_day = end - datetime.timedelta(days=1)
    # 튜플끼리의 비교는 앞 칸(연)부터 차례로 비교한다. (2026, 9) <= (2026, 10)
    while (year, month) <= (last_day.year, last_day.month):
        months.append((year, month))
        year, month = next_month(year, month)
    return months


def to_datetime(text):
    """일정의 시작/끝 글자를 시간대가 붙은 datetime으로 바꾼다. 비교하려면 모양을 통일해야 한다."""
    if len(text) == 10:
        # 종일 일정은 "2026-10-19"처럼 날짜만 있다. 그날 0시로 본다
        return datetime.datetime.combine(datetime.date.fromisoformat(text), datetime.time.min).astimezone()
    value = datetime.datetime.fromisoformat(text)
    # 시간대가 없는 값이면 이 컴퓨터의 시간대로 본다
    return value if value.tzinfo else value.astimezone()


def overlaps(event, window_start, window_end):
    """일정이 window_start ~ window_end 기간과 겹치는지. 겹치는 부분이 조금이라도 있으면 True."""
    start = to_datetime(event["start"])
    end = to_datetime(event["end"])
    # 길이가 0인 일정(시작 = 끝)은 시작이 기간 안에 있을 때만 겹친 것으로 본다
    return start < window_end and (end > window_start or start >= window_start)


def date_window(start, end):
    """날짜 두 개(start 포함, end 미포함)를 비교용 datetime 두 개로 바꾼다."""
    return (
        datetime.datetime.combine(start, datetime.time.min).astimezone(),
        datetime.datetime.combine(end, datetime.time.min).astimezone(),
    )


def simplify_event(event):
    """Google이 주는 일정에서 화면에 필요한 네 가지(id, 제목, 시작, 끝)만 남긴다.
    색 같은 캘린더 정보는 일정마다 붙이지 않고 보낼 때 붙인다. 그래야 캘린더 색을 바꿔도 캐시를 고칠 필요가 없다."""
    return {
        "id": event["id"],
        "title": event.get("summary", "제목 없음"),
        # 종일 일정은 "date", 시간 있는 일정은 "dateTime"에 시각이 들어 있다
        "start": event["start"].get("dateTime") or event["start"]["date"],
        "end": event["end"].get("dateTime") or event["end"]["date"],
    }


# ---------- 캐시 본체 ----------

class EventCache:
    """일정을 (캘린더, 달) 단위로 기억해두는 상자.

    기억해둔 일정(entry)이 "믿어도 되는" 조건은 두 가지다:
      1) 최근에 "Google에서 바뀐 게 있나?" 확인에 성공했다 (checked_at)
      2) 그 일정을 받아온 시각(fetched)이, 이 캘린더에서 마지막으로 변화가 감지된 시각(valid_since)보다 나중이다
    조건을 못 채운 일정은 "오래된 일정"이다. 새로 받아오지만, 인터넷이 끊겼을 때는 대신 보여주려고 지우지 않고 남겨둔다.
    """

    def __init__(self, path=CACHE_PATH):
        self.path = path
        # RLock: 같은 스레드가 열쇠를 두 번 잡아도 괜찮은 열쇠. 여러 요청이 동시에 이 상자를 건드리므로 필요하다
        self._lock = threading.RLock()
        self._file_lock = threading.Lock()  # 파일에 쓰는 동안 다른 스레드가 같은 파일에 쓰지 못하게 한다

        self._months = {}       # {캘린더 id: {"2026-10": {"events": [...], "fetched": 받아온 시각}}}
        self._tokens = {}       # {캘린더 id: syncToken}
        self._valid_since = {}  # {캘린더 id: 이 시각 이전에 받아온 일정은 믿지 않는다}
        self._checked_at = {}   # {캘린더 id: 마지막으로 확인에 성공한 시각}. 켤 때마다 비어 있다 (확인부터 해야 믿는다)
        self._calendars = None  # 캘린더 목록. 인터넷이 끊겼을 때를 위해 같이 저장한다
        # 변경 확인(syncToken)을 지원하지 않는 캘린더들 (공휴일 캘린더 등). 켤 때마다 다시 알아낸다
        self._unsyncable = set()

        self._last_sync = None  # 마지막으로 동기화에 성공한 시각
        self._online = True
        self._version = 0       # 다른 곳(폰 등)에서 일정이 바뀐 것을 감지할 때마다 올라가는 번호. 화면이 이 번호로 변화를 안다
        self._dirty = False     # 저장하지 않은 변화가 있는가
        self._last_save = 0.0
        self._load()

    # ----- 상태 -----

    def status(self):
        """화면에 보여줄 동기화 상태."""
        with self._lock:
            return {"version": self._version, "lastSync": self._last_sync, "online": self._online}

    @property
    def online(self):
        return self._online

    def bump_version(self):
        """"일정이 바뀌었다"고 화면에 알린다. 화면은 번호가 달라진 것을 보고 일정을 다시 불러온다."""
        with self._lock:
            self._version += 1

    def mark_online(self):
        with self._lock:
            if not self._online:
                print("[온라인] 인터넷 연결이 돌아왔습니다.")
            self._online = True

    def mark_offline(self):
        with self._lock:
            if self._online:
                print("[오프라인] Google에 연결할 수 없습니다. 마지막으로 받은 일정을 보여줍니다.")
            self._online = False

    def mark_synced(self):
        """동기화에 성공했다. 지금이 "마지막 동기화 시각"이 된다."""
        with self._lock:
            self.mark_online()
            self._last_sync = time.time()
            self._dirty = True

    # ----- 캘린더 목록 (오프라인 대비) -----

    def save_calendars(self, calendars):
        with self._lock:
            self._calendars = calendars
            self._dirty = True

    def saved_calendars(self):
        with self._lock:
            return self._calendars

    # ----- 믿어도 되는지 -----

    def _is_fresh(self, calendar_id, entry):
        checked = self._checked_at.get(calendar_id, 0)
        return (
            time.time() - checked < CHECK_FRESH_SECONDS
            and entry["fetched"] >= self._valid_since.get(calendar_id, 0)
        )

    def has_fresh(self, calendar_id, year_month):
        """이 캘린더의 이 달 일정을 믿고 쓸 수 있는 상태로 기억해두었는가."""
        with self._lock:
            entry = self._months.get(calendar_id, {}).get(month_key(*year_month))
            return entry is not None and self._is_fresh(calendar_id, entry)

    def invalidate(self, calendar_id):
        """이 캘린더에 기억해둔 일정을 모두 "오래된 일정"으로 만든다. 다음에 필요할 때 Google에서 새로 받는다."""
        with self._lock:
            self._valid_since[calendar_id] = time.time()
            self._dirty = True

    def invalidate_all(self, calendar_ids):
        for calendar_id in calendar_ids:
            self.invalidate(calendar_id)

    # ----- 일정 읽기 -----

    def load_months(self, calendar_id, months, get_service):
        """캘린더 하나의 여러 달 일정을 {(연, 월): [일정, ...]} 모양으로 돌려준다.
        믿을 수 있게 기억해둔 달은 그대로 쓰고, 나머지는 Google에 한 번에 물어서 받아온다.
        get_service: 지금 스레드가 쓸 Google 연결(service)을 돌려주는 함수"""
        result = {}
        needed = []  # 새로 받아와야 하는 달들 (오래된 것 포함)
        stale = {}   # 오래됐지만 기억은 해둔 달들. 받아오기에 실패했을 때 대신 보여준다

        with self._lock:
            entries = self._months.get(calendar_id, {})
            for year_month in months:
                entry = entries.get(month_key(*year_month))
                if entry is not None and self._is_fresh(calendar_id, entry):
                    result[year_month] = entry["events"]
                else:
                    needed.append(year_month)
                    if entry is not None:
                        stale[year_month] = entry["events"]
            offline = not self._online

        if not needed:
            return result
        if offline and len(stale) == len(needed):
            # 인터넷이 끊겨 있고 대신 보여줄 것도 다 있으면, 괜히 Google에 물어보지 않는다
            result.update(stale)
            return result

        # 받아오기 전에 시각을 적어둔다. 받는 도중에 바뀐 내용을 놓치지 않으려면 "시작한 시각"을 기준으로 해야 한다
        started = time.time()
        # 필요한 달들이 이어져 있으니 처음 달 1일 ~ 마지막 달 끝을 한 번의 요청으로 받는다
        first_day = month_range(*needed[0])[0]
        end_day = month_range(*needed[-1])[1]
        try:
            raw_events = google_calendar.get_events(get_service(), calendar_id, first_day, end_day)
        except Exception as error:
            # HttpError는 Google이 거절한 것이고, 그 밖의 오류는 대부분 인터넷 문제다
            if not isinstance(error, HttpError):
                self.mark_offline()
            if len(stale) == len(needed):
                print(f"[기억해둔 일정 사용] 일정을 새로 받지 못했습니다: {error}")
                result.update(stale)
                return result
            raise

        self.mark_online()
        events = [simplify_event(raw) for raw in raw_events]
        with self._lock:
            entries = self._months.setdefault(calendar_id, {})
            for year_month in needed:
                window_start, window_end = date_window(*month_range(*year_month))
                # 두 달에 걸친 일정은 두 달 모두에 들어간다
                month_events = [event for event in events if overlaps(event, window_start, window_end)]
                key = month_key(*year_month)
                old = entries.get(key)
                # 더 늦게 시작한 요청이 이미 최신 일정을 넣어뒀다면 덮어쓰지 않는다
                if old is None or old["fetched"] <= started:
                    entries[key] = {"events": month_events, "fetched": started}
                result[year_month] = month_events
            self._dirty = True
        self.save()
        return result

    def events_in_range(self, calendar_id, start, end, get_service):
        """캘린더 하나의 start(포함) ~ end(미포함) 기간의 일정들을 돌려준다."""
        by_month = self.load_months(calendar_id, months_between(start, end), get_service)
        window_start, window_end = date_window(start, end)

        seen = set()  # 두 달에 걸친 일정이 중복으로 나오지 않게, 이미 담은 일정의 id를 기억한다
        events = []
        for month_events in by_month.values():
            for event in month_events:
                if event["id"] not in seen and overlaps(event, window_start, window_end):
                    seen.add(event["id"])
                    events.append(event)
        return events

    # ----- 바뀐 게 있는지 확인 (동기화) -----

    def check_calendar(self, calendar_id, get_service):
        """Google에 "마지막으로 확인한 뒤 이 캘린더에서 바뀐 게 있나?" 묻는다.
        바뀐 게 있으면 True, 그대로면 False, 이 캘린더는 바뀐 것을 확인할 수 없어서 묻지 않았으면 None을 돌려준다.
        바뀌었다면 기억해둔 일정을 "오래된 일정"으로 바꿔서 다음에 새로 받게 한다."""
        with self._lock:
            if calendar_id in self._unsyncable:
                return self._refresh_by_time(calendar_id)
            token = self._tokens.get(calendar_id)
        service = get_service()

        changed = False  # 바뀐 게 있어서 화면이 다시 불러와야 하는가
        reset = False    # 기억해둔 일정을 더는 믿을 수 없게 됐는가
        if token is not None:
            try:
                count, new_token = google_calendar.list_changes(service, calendar_id, token)
                changed = reset = count > 0
            except google_calendar.SyncTokenExpired:
                # 책갈피가 너무 오래됨. 무엇이 바뀌었는지 알 수 없으니 바뀐 것으로 보고 처음부터 다시 시작한다
                print(f"[동기화 다시 시작] syncToken이 만료되었습니다: {calendar_id}")
                token = None
                changed = True

        if token is None:
            # 처음이거나 책갈피가 만료됨: 일정을 한 번 훑어서 새 책갈피만 받는다.
            # 그 사이에 바뀐 것은 알 수 없으므로, 이전에 받아둔 일정은 믿지 않는다
            _, new_token = google_calendar.list_changes(service, calendar_id)
            reset = True
            try:
                # 방금 받은 새 책갈피를 곧바로 한 번 써본다. 공휴일 같은 공개 캘린더는 새 책갈피도 바로 거절(410)하는데,
                # 이런 캘린더를 "만료됐다"고만 보면 1분마다 "바뀌었다"는 알림이 끝없이 반복되기 때문이다
                _, new_token = google_calendar.list_changes(service, calendar_id, new_token)
            except google_calendar.SyncTokenExpired:
                with self._lock:
                    self._unsyncable.add(calendar_id)
                    self._tokens.pop(calendar_id, None)
                    self._dirty = True
                    print(f"[동기화 방식 변경] 이 캘린더는 변경 확인을 지원하지 않아 {UNSYNCABLE_REFRESH_SECONDS // 60}분마다 "
                          f"일정을 새로 받습니다: {calendar_id}")
                    return self._refresh_by_time(calendar_id)

        now = time.time()  # 확인이 "끝난" 시각. 이보다 먼저 받은 일정은 바뀐 걸 놓쳤을 수 있다
        with self._lock:
            self._tokens[calendar_id] = new_token
            self._checked_at[calendar_id] = now
            if reset:
                self._valid_since[calendar_id] = now
            self._dirty = True
        return changed

    def _refresh_by_time(self, calendar_id):
        """변경 확인을 지원하지 않는 캘린더(공휴일 등)의 확인. Google에 묻지 않고, 일정을 받은 지 일정 시간이 지나면
        오래된 일정으로 바꿔서 다음에 새로 받게 한다. 바뀐 것을 알 수 없으므로 None을 돌려준다. (열쇠를 잡은 채로 부른다)"""
        now = time.time()
        self._checked_at[calendar_id] = now
        if now - self._valid_since.get(calendar_id, 0) > UNSYNCABLE_REFRESH_SECONDS:
            self._valid_since[calendar_id] = now
            self._dirty = True
        return None

    def absorb_own_write(self, calendar_id, get_service):
        """StudyFlow가 직접 일정을 바꾼 뒤에 부른다. 이 변화를 "다른 곳에서 바뀐 것"으로 오해하지 않도록
        책갈피를 앞으로 옮겨둔다. (오해하면 화면이 불필요하게 한 번 더 일정을 불러온다)"""
        self.invalidate(calendar_id)
        try:
            self.check_calendar(calendar_id, get_service)
        except Exception as error:
            print(f"[동기화 확인 실패] {calendar_id}: {error}")

    # ----- 파일 저장 / 읽기 -----

    def save(self, force=False):
        """저장하지 않은 변화가 있으면 파일에 쓴다. force가 아니면 너무 자주 쓰지 않는다."""
        # 파일 열쇠를 먼저 잡고 그 안에서 내용을 만들어야, 오래된 내용이 새 내용을 덮어쓰지 않는다
        with self._file_lock:
            with self._lock:
                if not self._dirty:
                    return
                if not force and time.time() - self._last_save < SAVE_INTERVAL_SECONDS:
                    return
                self._prune_old_months()
                text = json.dumps({
                    "version": FILE_VERSION,
                    "lastSync": self._last_sync,
                    "calendars": self._calendars,
                    "tokens": self._tokens,
                    "validSince": self._valid_since,
                    "months": self._months,
                }, ensure_ascii=False)
                self._dirty = False
                self._last_save = time.time()

            # 임시 파일에 먼저 쓰고 한 번에 바꿔치기(os.replace)한다. 쓰다가 꺼져도 기존 파일이 망가지지 않는다
            temp_path = self.path + ".tmp"
            try:
                with open(temp_path, "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(temp_path, self.path)
            except OSError as error:
                print(f"[일정 저장 실패] {error}")

    def _prune_old_months(self):
        """오늘에서 너무 먼 달의 일정은 버려서 파일이 계속 커지지 않게 한다."""
        today = datetime.date.today()
        current = today.year * 12 + today.month
        for entries in self._months.values():
            for key in list(entries):
                year, month = (int(part) for part in key.split("-"))
                if abs(year * 12 + month - current) > KEEP_MONTHS:
                    del entries[key]

    def _load(self):
        """저장해둔 파일이 있으면 읽어온다. 없거나 망가졌으면 빈 상태로 시작한다."""
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("version") != FILE_VERSION:
                return
            months = data["months"]
            tokens = data["tokens"]
            valid_since = data["validSince"]
            calendars = data["calendars"]
            last_sync = data["lastSync"]
            # 모양이 맞는지 가볍게 확인한다. 틀리면 아래 except로 빠져서 빈 상태로 시작한다
            assert isinstance(months, dict) and isinstance(tokens, dict) and isinstance(valid_since, dict)
            assert calendars is None or isinstance(calendars, list)
            for entries in months.values():
                for entry in entries.values():
                    assert isinstance(entry["events"], list) and isinstance(entry["fetched"], (int, float))
        except (OSError, ValueError, KeyError, TypeError, AttributeError, AssertionError):
            return

        self._months = months
        self._tokens = tokens
        self._valid_since = valid_since
        self._calendars = calendars
        self._last_sync = last_sync if isinstance(last_sync, (int, float)) else None
