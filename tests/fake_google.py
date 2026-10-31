"""가짜 Google Calendar. 실제 Google에 아무것도 보내지 않고, google_calendar 모듈의 함수들을 바꿔 끼운다."""
import datetime
import os
import sys
import tempfile
import threading

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 프로젝트 폴더 (tests 폴더의 한 칸 위)
sys.path.insert(0, PROJECT)

import google_calendar  # noqa: E402
import database  # noqa: E402
import settings_store  # noqa: E402

TMP = tempfile.mkdtemp(prefix="studyflow_test_")
# 실제 DB / 설정 파일을 건드리지 않도록, app을 가져오기 전에 임시 위치로 바꾼다
database.DB_PATH = os.path.join(TMP, "test.db")
settings_store.SETTINGS_PATH = os.path.join(TMP, "settings.json")


class OfflineError(OSError):
    pass


class FakeGoogle:
    def __init__(self):
        self.lock = threading.Lock()
        self.offline = False
        self.calendars = [
            {"id": "me@test", "summary": "개인", "backgroundColor": "#4a7cff", "accessRole": "owner", "primary": True, "timeZone": "Asia/Seoul"},
            {"id": "proj@test", "summary": "프로젝트", "backgroundColor": "#2f9e44", "accessRole": "owner"},
            {"id": "holiday@test", "summary": "공휴일", "backgroundColor": "#d6336c", "accessRole": "reader"},
        ]
        self.events = {c["id"]: {} for c in self.calendars}   # {캘린더: {id: 일정}}
        self.changelog = {c["id"]: [] for c in self.calendars}  # 변경 기록 (번호 = 길이)
        self.expired = set()  # 만료된 토큰들
        self.calls = {"get_events": 0, "list_changes": 0, "get_calendars": 0}
        self.next_id = 1
        self.token_counter = 0
        self.created = set()  # 이 앱이 만든 캘린더 id들
        self.last_time_zone = None

    def reset_calls(self):
        for k in self.calls:
            self.calls[k] = 0

    def _check(self):
        if self.offline:
            raise OfflineError("network down")

    # ----- 테스트에서 "다른 곳(폰)에서 바꿈"을 흉내 -----
    def add_event(self, calendar_id, title, start, end, description=None):
        with self.lock:
            event_id = f"e{self.next_id}"
            self.next_id += 1
            if len(start) == 10:
                event = {"id": event_id, "summary": title, "start": {"date": start}, "end": {"date": end}}
            else:
                event = {"id": event_id, "summary": title, "start": {"dateTime": start}, "end": {"dateTime": end}}
            if description:
                event["description"] = description
            self.events[calendar_id][event_id] = event
            self.changelog[calendar_id].append(event_id)
            return event_id

    def remove_event(self, calendar_id, event_id):
        with self.lock:
            self.events[calendar_id].pop(event_id, None)
            self.changelog[calendar_id].append(event_id)

    # ----- google_calendar 함수 대체 -----
    def get_calendars(self, service):
        self._check()
        self.calls["get_calendars"] += 1
        return [dict(c) for c in self.calendars]

    def get_events(self, service, calendar_id, start, end):
        self._check()
        self.calls["get_events"] += 1
        import event_cache
        window_start, window_end = event_cache.date_window(start, end)
        with self.lock:
            return [
                e for e in self.events[calendar_id].values()
                if event_cache.overlaps(event_cache.simplify_event(e), window_start, window_end)
            ]

    def list_changes(self, service, calendar_id, sync_token=None):
        self._check()
        self.calls["list_changes"] += 1
        with self.lock:
            head = len(self.changelog[calendar_id])
            self.token_counter += 1
            new_token = f"{calendar_id}:{head}:{self.token_counter}"  # 발급할 때마다 다른 글자
            if sync_token is None:
                return 0, new_token
            # 공휴일 캘린더는 실제 Google처럼 새 책갈피도 곧바로 거절한다
            if sync_token in self.expired or calendar_id == "holiday@test":
                raise google_calendar.SyncTokenExpired()
            _, number, _ = sync_token.rsplit(":", 2)
            return head - int(number), new_token

    def create_event(self, service, calendar_id, title, all_day, start, end, description=None):
        self._check()
        self.calls["create_event"] = self.calls.get("create_event", 0) + 1
        return self.add_event(calendar_id, title, start, end, description)

    def update_event(self, service, calendar_id, event_id, all_day=None, start=None, end=None, title=None, description=None):
        self._check()
        with self.lock:
            event = self.events[calendar_id][event_id]
            self.patches = getattr(self, "patches", [])
            self.patches.append({"event": event_id, "start": start, "title": title, "description": description})
            if title is not None:
                event["summary"] = title
            if start is not None:
                key = "date" if all_day else "dateTime"
                event["start"] = {key: start}
                event["end"] = {key: end}
            if description is not None:
                if description == "":
                    event.pop("description", None)
                else:
                    event["description"] = description
            self.changelog[calendar_id].append(event_id)
            return event

    def delete_event(self, service, calendar_id, event_id):
        self._check()
        self.remove_event(calendar_id, event_id)

    def move_event(self, service, calendar_id, event_id, destination):
        self._check()
        with self.lock:
            if event_id not in self.events.get(calendar_id, {}):
                raise self._http_error(404, "Not Found")
            if getattr(self, "move_fail", False):
                raise self._http_error(400, "Cannot move")
            event = self.events[calendar_id].pop(event_id)
            self.events[destination][event_id] = event
            self.changelog[calendar_id].append(event_id)
            self.changelog[destination].append(event_id)
            self.calls["move_event"] = self.calls.get("move_event", 0) + 1
            return event

    # ----- 캘린더 만들기/지우기/목록에서 빼기 -----
    def create_calendar(self, service, name, time_zone=None):
        self._check()
        with self.lock:
            calendar_id = f"made{len(self.created) + 1}@test"
            calendar = {"id": calendar_id, "summary": name, "backgroundColor": "#9fc6e7", "accessRole": "owner", "timeZone": time_zone}
            self.calendars.append(calendar)
            self.events[calendar_id] = {}
            self.changelog[calendar_id] = []
            self.created.add(calendar_id)
            self.calls["create_calendar"] = self.calls.get("create_calendar", 0) + 1
            self.last_time_zone = time_zone
            return dict(calendar)

    def _http_error(self, status, text):
        import httplib2
        from googleapiclient.errors import HttpError
        return HttpError(httplib2.Response({"status": status}), text.encode("utf-8"))

    def delete_calendar(self, service, calendar_id):
        self._check()
        with self.lock:
            # 실제 Google처럼, calendar.app.created 권한으로는 이 앱이 만든 캘린더만 지울 수 있다
            if calendar_id not in self.created:
                raise self._http_error(403, "Forbidden")
            self.calendars = [c for c in self.calendars if c["id"] != calendar_id]
            self.events.pop(calendar_id, None)
            self.changelog.pop(calendar_id, None)
            self.created.discard(calendar_id)

    def unsubscribe_calendar(self, service, calendar_id):
        self._check()
        with self.lock:
            self.calendars = [c for c in self.calendars if c["id"] != calendar_id]
            self.events.pop(calendar_id, None)
            self.changelog.pop(calendar_id, None)

    def set_calendar_color(self, service, calendar_id, color):
        self._check()
        with self.lock:
            for calendar in self.calendars:
                if calendar["id"] == calendar_id:
                    calendar["backgroundColor"] = color


def install():
    fake = FakeGoogle()
    google_calendar.get_credentials = lambda: object()
    google_calendar.build_service = lambda creds: object()
    google_calendar.get_calendars = fake.get_calendars
    google_calendar.get_events = fake.get_events
    google_calendar.list_changes = fake.list_changes
    google_calendar.create_event = fake.create_event
    google_calendar.update_event = fake.update_event
    google_calendar.delete_event = fake.delete_event
    google_calendar.move_event = fake.move_event
    google_calendar.create_calendar = fake.create_calendar
    google_calendar.delete_calendar = fake.delete_calendar
    google_calendar.unsubscribe_calendar = fake.unsubscribe_calendar
    google_calendar.set_calendar_color = fake.set_calendar_color
    return fake
