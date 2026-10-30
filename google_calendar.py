import datetime
import http.client
import json
import os.path
import time
import uuid

import google_auth_httplib2
import httplib2
from google.auth.exceptions import RefreshError, TransportError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Google에 요청을 보내고 최대 몇 초까지 기다릴지. 인터넷이 불안정할 때 프로그램이 무한정 멈춰 있지 않게 한다
REQUEST_TIMEOUT_SECONDS = 30

# 연결이 이만큼(초) 놀았으면 이미 끊겼을 수 있다고 보고, 다음 요청 때 새 연결을 연다 (아래 ResilientHttp 설명 참고)
IDLE_RECONNECT_SECONDS = 15

# 연결 오류가 났을 때 새 연결로 다시 시도하기 전에 기다리는 시간(초). 항목 수만큼 다시 시도한다 (처음 시도 + 2번)
RETRY_DELAYS = (0.3, 1.0)


class SyncTokenExpired(Exception):
    """syncToken이 너무 오래되어 Google이 더는 인정하지 않을 때(410 오류)."""

# 이 파일이 있는 폴더. 어디서 실행하든 credentials.json, token.json을 이 폴더에서 찾기 위함
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(BASE_DIR, "credentials.json")  # Google에서 받은 앱 신분증
TOKEN_PATH = os.path.join(BASE_DIR, "token.json")  # 로그인 결과를 저장하는 파일

# 앱이 요청할 권한(스코프). Google Cloud 콘솔에 등록한 세 개와 같아야 한다
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",  # 일정 읽기/쓰기
    "https://www.googleapis.com/auth/calendar.calendarlist",  # 캘린더 목록 읽기/쓰기 (캘린더 색 변경, 목록에서 빼기에 필요)
    # StudyFlow가 만든 보조 캘린더를 만들고 지우는 권한. "이 앱이 만든 캘린더"로 범위가 한정되어 있어서,
    # 다른 앱이나 내가 Google Calendar에서 직접 만든 캘린더는 이 권한으로 지울 수 없다 (실수로 소중한 캘린더를 지우는 일을 막아 준다)
    "https://www.googleapis.com/auth/calendar.app.created",
]


def has_all_scopes():
    """token.json에 저장된 권한 목록이 지금 필요한 권한(SCOPES)을 모두 포함하는지 확인한다."""
    try:
        with open(TOKEN_PATH, encoding="utf-8") as token_file:
            saved_scopes = set(json.load(token_file).get("scopes") or [])
    except (OSError, ValueError):
        return False
    return set(SCOPES) <= saved_scopes  # <= : 앞의 집합이 뒤의 집합에 모두 들어 있는가


def get_credentials():
    """로그인 정보(creds)를 돌려준다. 저장된 게 있으면 재사용하고, 없으면 브라우저로 로그인한다."""
    creds = None

    # 1) 이전에 로그인해서 저장해둔 token.json이 있으면 읽어온다
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        # 새 기능 때문에 필요한 권한이 늘었다면, 예전 로그인으로는 부족하다. 새로 로그인하게 한다
        if not has_all_scopes():
            creds = None

    # 2) 없거나, 있어도 쓸 수 없는 상태라면 새로 준비한다
    if not creds or not creds.valid:
        refreshed = False
        if creds and creds.expired and creds.refresh_token:
            # 입장권(access token)만 만료됐다면, 재발급용 열쇠(refresh token)로 조용히 갱신
            for attempt in range(len(RETRY_DELAYS) + 1):
                try:
                    creds.refresh(Request())
                    refreshed = True
                except RefreshError:
                    # 열쇠 자체가 만료되거나 취소된 경우(예: OAuth 동의 화면이 Testing이면 7일마다 만료).
                    # 인터넷이 끊긴 것(TransportError)과는 다른 오류이므로, 이때만 다시 로그인한다
                    print("[로그인 만료] Google 로그인을 다시 해야 합니다. 브라우저가 열립니다.")
                except TransportError:
                    # 인터넷이 잠깐 흔들린 경우(주소를 못 찾음 등). 몇 번 다시 해 보고, 그래도 안 되면 오류를 그대로 올린다 (오프라인 처리)
                    if attempt == len(RETRY_DELAYS):
                        raise
                    time.sleep(RETRY_DELAYS[attempt])
                    continue
                break

        if not refreshed:
            # 처음이거나 갱신도 불가능하면, 브라우저를 열어 사용자가 직접 로그인
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)

        # 3) 다음 실행 때 다시 로그인하지 않도록 결과를 파일에 저장
        with open(TOKEN_PATH, "w", encoding="utf-8") as token_file:
            token_file.write(creds.to_json())

    return creds


def get_week_range():
    # 1단계: 오늘 날짜
    today = datetime.date.today()

    # 2~3단계: 이번 주 월요일
    monday = today - datetime.timedelta(days=today.weekday())

    # 4단계: 다음 주 월요일
    next_monday = monday + datetime.timedelta(weeks=1)

    return monday, next_monday


def is_connection_error(error):
    """Google에 요청을 보내다 난 오류가 "연결이 끊겼다/찾지 못했다" 종류인지 알려준다. 이런 오류는 새 연결로 다시 시도해 볼 만하다.
    - OSError: 연결이 강제로 끊김(WinError 10053/10054), 연결 거부, SSL 오류 등. 파이썬에서는 모두 OSError의 한 종류다
    - HTTPException: 서버가 응답 도중 연결을 닫음 등
    - ServerNotFoundError: 주소(DNS)를 찾지 못함. 와이파이가 잠깐 흔들릴 때 나온다
    제한 시간 초과(TimeoutError)는 뺀다. 다시 하면 또 30초를 기다리게 되기 때문이다."""
    if isinstance(error, TimeoutError):
        return False
    return isinstance(error, (OSError, http.client.HTTPException, httplib2.ServerNotFoundError))


class ResilientHttp(httplib2.Http):
    """끊긴 연결 때문에 요청이 실패하는 일을 줄이는 통신 부품. httplib2.Http를 이렇게 고쳤다.

    왜 필요한가: httplib2는 한 번 연 연결을 계속 재사용한다(빠르려고). 그런데 한동안 놀던 연결은 공유기, 방화벽, 보안 프로그램, Google 쪽에서
    소리 없이 끊어 버린다. 앱은 그걸 모르고 그 연결로 요청을 보내고, 그러면 [WinError 10053/10054] 오류가 난다.
    httplib2는 이 오류를 다시 시도하지 않고 그대로 던지므로 화면에는 "인터넷 연결을 확인하세요"가 뜬다. 와이파이는 멀쩡한데도 말이다.

    그래서 두 가지를 한다:
    1) 예방: 마지막 사용 후 IDLE_RECONNECT_SECONDS(15초)가 넘었으면, 요청 전에 놀던 연결을 닫고 새로 연다.
    2) 치료: 그래도 연결 오류가 나면 연결을 모두 닫고 새 연결로 다시 시도한다 (RETRY_DELAYS만큼 기다리며 최대 2번 더).
    인터넷이 정말로 끊겨 있으면 몇 초 뒤에 똑같이 실패한다."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_used = time.monotonic()

    def request(self, *args, **kwargs):
        if time.monotonic() - self._last_used > IDLE_RECONNECT_SECONDS:
            self.close()  # 놀던 연결은 이미 끊겼을 수 있다. 닫아 두면 아래 요청이 새 연결을 연다
        for attempt in range(len(RETRY_DELAYS) + 1):
            try:
                result = super().request(*args, **kwargs)
            except Exception as error:
                if not is_connection_error(error) or attempt == len(RETRY_DELAYS):
                    raise
                print(f"[연결 재시도] {time.strftime('%m-%d %H:%M:%S')} 연결이 끊겨 새 연결로 다시 시도합니다 ({attempt + 1}/{len(RETRY_DELAYS)}): {error}")
                self.close()
                time.sleep(RETRY_DELAYS[attempt])
            else:
                self._last_used = time.monotonic()
                return result


def build_service(creds):
    """이미 있는 로그인 정보(creds)로 service 객체를 만든다. 파일을 읽지 않아 빠르다."""
    # 로그인 정보(creds)를 붙여서 요청을 보내는 통로를 직접 만들고, 응답을 기다리는 시간에 제한(30초)을 둔다.
    # 통로 맨 아래는 끊긴 연결을 알아서 새로 여는 ResilientHttp다
    http = google_auth_httplib2.AuthorizedHttp(creds, http=ResilientHttp(timeout=REQUEST_TIMEOUT_SECONDS))
    # "calendar" API의 "v3" 버전을 쓰겠다는 뜻
    return build("calendar", "v3", http=http)


def get_service():
    """로그인 정보를 준비한 뒤 service 객체를 만든다."""
    return build_service(get_credentials())


def get_calendars(service):
    """내 캘린더 목록(개인 일정, 휴일 등)을 리스트로 돌려준다."""
    result = service.calendarList().list().execute()
    # 결과는 딕셔너리이고, 캘린더들은 "items" 키 안에 들어 있다. 없으면 빈 리스트
    return result.get("items", [])


def get_events(service, calendar_id, start, end):
    """캘린더 하나에서 start(포함) ~ end(미포함) 사이의 일정을 리스트로 돌려준다."""
    # Google API는 날짜만이 아니라 "시각 + 시간대"까지 있는 형식을 요구한다.
    # 날짜에 0시를 붙이고(combine), 이 컴퓨터의 시간대를 붙인 뒤(astimezone), 글자로 바꾼다(isoformat)
    time_min = datetime.datetime.combine(start, datetime.time.min).astimezone().isoformat()
    time_max = datetime.datetime.combine(end, datetime.time.min).astimezone().isoformat()

    events = []
    page_token = None
    while True:
        result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,  # 반복 일정을 하나씩 풀어서 가져옴 (아래 정렬에 필요)
            orderBy="startTime",  # 시작 시각 순서로 정렬
            maxResults=2500,  # 한 번에 받을 수 있는 최대 개수. 기본값(250)이면 일정이 많은 달이 잘린다
            pageToken=page_token,  # 결과가 한 번에 안 담기면 Google이 "다음 쪽 번호"를 주는데, 그걸 넘겨서 이어 받는다
        ).execute()
        events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            return events


def list_changes(service, calendar_id, sync_token=None):
    """"지난번에 확인한 뒤로 바뀐 일정이 있나?"를 Google에 묻는다. (바뀐 일정 개수, 새 syncToken)을 돌려준다.

    syncToken은 "여기까지 확인했음"이라는 책갈피다. 이 책갈피를 내밀면 Google이 그 뒤에 추가, 수정, 삭제된
    일정만 알려준다. 일정 내용은 필요 없고 "바뀌었는지"만 알면 되므로 id만 받아서 가볍게 확인한다.
    sync_token이 None이면 "처음 동기화"다. 일정을 전부 훑어서(내용은 받지 않는다) 첫 책갈피만 받아온다.
    책갈피가 너무 오래되면 Google이 410 오류를 내고, 이때는 SyncTokenExpired를 던진다."""
    count = 0
    page_token = None
    while True:
        try:
            result = service.events().list(
                calendarId=calendar_id,
                syncToken=sync_token,
                pageToken=page_token,
                maxResults=2500,
                fields="nextPageToken,nextSyncToken,items(id)",  # 필요한 항목만 받아서 응답을 작게 한다
            ).execute()
        except HttpError as error:
            if error.resp.status == 410:
                raise SyncTokenExpired() from error
            raise
        count += len(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            return count, result["nextSyncToken"]


def to_local_datetime(text):
    """'2026-10-18T09:00' 같은 글자를 '2026-10-18T09:00:00+09:00'처럼 시간대가 붙은 글자로 바꾼다."""
    # fromisoformat: 글자 → datetime. 시간대가 없는 값이면 astimezone()이 이 컴퓨터의 시간대를 붙여준다
    return datetime.datetime.fromisoformat(text).astimezone().isoformat()


def build_time_fields(all_day, start, end):
    """일정의 시작/끝을 Google이 요구하는 모양의 딕셔너리로 만든다.
    start, end는 FullCalendar와 같은 규칙이다. 종일 일정은 '2026-10-18' 형식이고 end는 포함하지 않는 날짜다.
    (하루짜리 종일 일정이면 end는 다음 날)"""
    if all_day:
        # 종일 일정은 "date"에 날짜만 넣는다
        return {"start": {"date": start}, "end": {"date": end}}
    # 시간 있는 일정은 "dateTime"에 시간대가 붙은 시각을 넣는다
    return {
        "start": {"dateTime": to_local_datetime(start)},
        "end": {"dateTime": to_local_datetime(end)},
    }


def create_event(service, calendar_id, title, all_day, start, end, description=None):
    """캘린더에 일정 하나를 새로 만들고, Google이 돌려준 일정 정보를 그대로 돌려준다.
    description은 일정의 메모(Google Calendar의 "설명" 칸)다. 없으면 보내지 않는다."""
    # 일정 번호를 우리가 미리 정해서 보낸다. 연결이 끊겨서 같은 요청을 다시 보내게 되었을 때, 첫 요청이 사실은 Google에 도착해 있었다면
    # 같은 번호가 이미 있다고(409) 알려 주므로, 일정이 두 개 만들어지지 않는다. (번호는 영문 소문자와 숫자만 쓸 수 있어서 uuid의 16진수 글자를 쓴다)
    event_id = uuid.uuid4().hex
    body = {"id": event_id, "summary": title, **build_time_fields(all_day, start, end)}
    if description:
        body["description"] = description

    # insert: 새 일정을 만든다. 이게 HTTP의 POST 요청에 해당한다
    try:
        return service.events().insert(calendarId=calendar_id, body=body).execute()
    except HttpError as error:
        if error.resp.status == 409:
            # 다시 보낸 요청이 거절된 것 = 처음 요청이 성공했다는 뜻이다. 만들어진 일정을 그대로 가져와서 성공으로 처리한다
            return service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        raise


def update_event(service, calendar_id, event_id, all_day=None, start=None, end=None, title=None, description=None):
    """일정의 시간, 제목, 메모 중 값이 주어진 것만 고친다. None인 것은 건드리지 않는다.
    (드래그할 때는 시간만, 메모를 고칠 때는 메모만 오고, 수정 창에서는 여러 개가 함께 온다.)
    description을 빈 글자("")로 주면 메모를 지운다. start가 있으면 all_day와 end도 있어야 한다."""
    body = {}

    if start is not None:
        body = build_time_fields(all_day, start, end)
        # 종일 ↔ 시간 있는 일정으로 바뀔 때, 반대쪽 값("date" 또는 "dateTime")이 남아 있으면 Google이 거절한다.
        # PATCH에서는 값을 None(JSON의 null)으로 보내면 그 값을 지우라는 뜻이다
        stale_key = "dateTime" if all_day else "date"
        body["start"][stale_key] = None
        body["end"][stale_key] = None

    if title is not None:
        body["summary"] = title
    if description is not None:
        body["description"] = description

    # patch: 보낸 항목만 고친다. 이게 HTTP의 PATCH 요청에 해당한다
    return service.events().patch(calendarId=calendar_id, eventId=event_id, body=body).execute()


def text_color_for(background):
    """배경색(#rrggbb) 위에 놓을 글자색으로 검은색 또는 흰색 중 더 잘 보이는 쪽을 돌려준다."""
    red, green, blue = (int(background[i:i + 2], 16) for i in (1, 3, 5))
    # 사람 눈이 느끼는 밝기 공식. 밝은 배경이면 검은 글자, 어두운 배경이면 흰 글자
    brightness = 0.299 * red + 0.587 * green + 0.114 * blue
    return "#000000" if brightness > 150 else "#ffffff"


def set_calendar_color(service, calendar_id, color):
    """내 캘린더 목록에서 이 캘린더의 색을 바꾼다. color는 '#rrggbb' 형식이다.
    이 색은 Google Calendar 웹과 폰 앱에서도 똑같이 바뀐다."""
    body = {"backgroundColor": color, "foregroundColor": text_color_for(color)}
    # colorRgbFormat=True: 정해진 색 번호 대신 #rrggbb 값을 직접 쓰겠다는 표시다
    return service.calendarList().patch(
        calendarId=calendar_id, body=body, colorRgbFormat=True
    ).execute()


def move_event(service, calendar_id, event_id, destination_calendar_id):
    """일정을 다른 캘린더로 옮긴다 (일정 번호는 그대로이고, 원래 캘린더에서 없어지고 새 캘린더에 생긴다).
    Google은 보통 일정만 옮기게 한다. 반복 일정의 일부, 생일 같은 특별한 일정은 거절한다(오류가 난다)."""
    return service.events().move(
        calendarId=calendar_id, eventId=event_id, destination=destination_calendar_id
    ).execute()


def create_calendar(service, name, time_zone=None):
    """새 보조 캘린더를 만들고, Google이 돌려준 캘린더 정보(id 포함)를 돌려준다. 만든 캘린더는 내 캘린더 목록에 저절로 들어간다.
    time_zone(예: "Asia/Seoul")을 안 주면 Google이 정하는데, 내 기본 캘린더와 같은 시간대를 쓰는 편이 일정 시각이 어긋나지 않는다."""
    body = {"summary": name}
    if time_zone:
        body["timeZone"] = time_zone
    return service.calendars().insert(body=body).execute()


def delete_calendar(service, calendar_id):
    """캘린더를 **완전히 지운다**(그 안의 일정도 모두, 폰과 웹에서도 사라지고 되돌릴 수 없다).
    StudyFlow가 만든 캘린더만 지울 수 있다(calendar.app.created 권한). 다른 캘린더는 Google이 403으로 거절한다."""
    service.calendars().delete(calendarId=calendar_id).execute()


def unsubscribe_calendar(service, calendar_id):
    """내 캘린더 목록에서 이 캘린더를 뺀다. 캘린더와 그 안의 일정은 지워지지 않아서(공휴일, 공유받은 캘린더 등) Google Calendar에서 다시 추가할 수 있다."""
    service.calendarList().delete(calendarId=calendar_id).execute()


def delete_event(service, calendar_id, event_id):
    """일정 하나를 지운다. 이게 HTTP의 DELETE 요청에 해당한다."""
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
    except HttpError as error:
        # 404/410: 이미 없는 일정이다. 연결이 끊겨서 지우기를 다시 보냈을 때, 처음 요청이 이미 지웠다면 이렇게 된다. 목적은 이뤄졌으니 성공으로 본다
        if error.resp.status not in (404, 410):
            raise


def format_event(event):
    """일정 하나를 '10-18 14:00 - 제목' 형태의 글자로 만든다."""
    # 1단계: 제목 꺼내기
    title = event.get("summary", "제목 없음")

    # 2단계: 시작 정보 꺼내기
    start = event["start"]

    # 3단계: 시간이 있는 일정인지 종일 일정인지 구분해서 time_text 만들기
    if "dateTime" in start:
        dt = datetime.datetime.fromisoformat(start["dateTime"])   # 글자 → datetime
        time_text = dt.strftime("%m-%d %H:%M")
    else:
        time_text = start["date"][5:] + " 종일"

    return f"{time_text} - {title}"


# 확인용: 파일을 직접 실행했을 때만 동작
if __name__ == "__main__":
    service = get_service()
    monday, next_monday = get_week_range()
    print(f"이번 주: {monday} ~ {next_monday} (다음 주 월요일 전까지)")

    for calendar in get_calendars(service):
        print(f"[{calendar['summary']}]")
        for event in get_events(service, calendar["id"], monday, next_monday):
            print("  ", format_event(event))
