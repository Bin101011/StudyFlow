import datetime
import os.path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# 이 파일이 있는 폴더. 어디서 실행하든 credentials.json, token.json을 이 폴더에서 찾기 위함
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(BASE_DIR, "credentials.json")  # Google에서 받은 앱 신분증
TOKEN_PATH = os.path.join(BASE_DIR, "token.json")  # 로그인 결과를 저장하는 파일

# 앱이 요청할 권한(스코프). Google Cloud 콘솔에 등록한 두 개와 같아야 한다
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",  # 일정 읽기/쓰기
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",  # 캘린더 목록 읽기
]


def get_credentials():
    """로그인 정보(creds)를 돌려준다. 저장된 게 있으면 재사용하고, 없으면 브라우저로 로그인한다."""
    creds = None

    # 1) 이전에 로그인해서 저장해둔 token.json이 있으면 읽어온다
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    # 2) 없거나, 있어도 쓸 수 없는 상태라면 새로 준비한다
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            # 입장권(access token)만 만료됐다면, 재발급용 열쇠(refresh token)로 조용히 갱신
            creds.refresh(Request())
        else:
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


def get_service():
    """로그인 정보로 Google Calendar API를 호출할 수 있는 service 객체를 만든다."""
    creds = get_credentials()
    # "calendar" API의 "v3" 버전을 쓰겠다는 뜻
    return build("calendar", "v3", credentials=creds)


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

    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,  # 반복 일정을 하나씩 풀어서 가져옴 (아래 정렬에 필요)
        orderBy="startTime",  # 시작 시각 순서로 정렬
    ).execute()
    return result.get("items", [])


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
