# StudyFlow

Google Calendar와 양방향으로 연동되는 **Windows용 데스크톱 플래너**입니다.
일정은 Google Calendar와 똑같이 맞춰지고, 그 위에 할 일, 장기 프로젝트, 우선순위 매트릭스, 노트, Pomodoro 타이머를 더했습니다.

## 기능

| 탭 | 하는 일 |
| --- | --- |
| 캘린더 | 월간/주간/일간 보기. 일정 추가·수정·삭제·드래그·복사(Ctrl+C/V)가 Google Calendar에 바로 반영됩니다. 캘린더 만들기와 색 바꾸기, 날짜별 할 일 요약도 됩니다. 월간 보기는 6줄 또는 7줄(월말에 다음 달 2주까지 미리 보기)을 설정에서 고를 수 있습니다. |
| 오늘 | **시간표**(그날의 Google 일정과 "몇 시부터 몇 시까지 무엇을 하겠다"는 내 계획을 24시간 눈금에 함께 보여 줍니다. 빈 곳을 끌어서 계획을 만들고, 할 일을 끌어다 놓아도 계획이 됩니다. 터치패드로 두 손가락을 벌리면 확대되고, 많이 확대하면 5분 단위로 맞출 수 있습니다), 오늘 할 일(끌어서 "첫 번째로 할 것" 순서를 정하고 1, 2, 3… 번호가 붙습니다), 작은 달력, 날짜를 아직 정하지 않은 할 일 목록. 할 일마다 줄 아래에 짧은 메모를 붙일 수 있습니다. 일정에 짧은 메모(Google 일정의 설명 칸에 저장)를 붙이고, 그날의 자유 메모도 적을 수 있습니다. |
| 프로젝트 | 장기 프로젝트의 진행률을 progress bar로 봅니다. 단계와 하위 단계(끌어서 순서 바꾸기, 정하지 않으면 마감일 순), 마감일, 폴더로 정리, 끌어다 놓기, 카드에 바로 쓰는 메모. 새 프로젝트는 같은 폴더의 이름이 비슷한(앞 낱말이 같은) 프로젝트의 색으로 시작하고, 이미 쓰는 색을 동그라미로 골라 쓸 수 있습니다 |
| 우선순위 | 할 일을 중요도(세로) × 긴급도(가로) 7×7 칸에 끌어다 놓는 Eisenhower 매트릭스 |
| 노트 | Obsidian vault 폴더의 `.md` 노트를 보고 고칩니다. 고친 내용은 Obsidian에서도 그대로 보입니다. (선택 기능) |
| 설정 | 글자 크기, 칸 크기, 글자 간격, 기본 캘린더, Pomodoro 시간 등 |

상단 바에는 Pomodoro 타이머(집중 25분 / 휴식 5분)가 있습니다. 폰이나 웹에서 바꾼 일정은 1~2분 안에 자동으로 반영됩니다. 인터넷이 끊기면 마지막으로 받은 일정을 보여 줍니다.

## 준비물

- Windows 10 또는 11 (창을 띄우는 데 Edge WebView2를 씁니다. 최신 Windows에는 이미 들어 있습니다.)
- [Python](https://www.python.org/downloads/) (개발은 3.14로 했습니다. 설치할 때 **"Add python.exe to PATH"** 에 체크하세요.)
- Google 계정
- 이 프로젝트 폴더. GitHub 페이지의 초록색 **Code → Download ZIP** 으로 받아 압축을 풀거나, Git이 있으면 `git clone https://github.com/Bin101011/StudyFlow.git` 을 쓰세요.

## 설치

PowerShell을 열고 프로젝트 폴더로 이동한 뒤 아래를 차례로 실행합니다.

```powershell
# 1) 이 프로젝트 전용 파이썬 환경(.venv)을 만든다
python -m venv .venv

# 2) 필요한 라이브러리를 그 환경에 설치한다
.venv\Scripts\python -m pip install -r requirements.txt
```

## Google 연결하기 (처음 한 번)

> **중요:** StudyFlow는 여러분의 Google Calendar에 접근해야 합니다. 그러려면 여러분 **본인의 Google Cloud 프로젝트**에서 만든 `credentials.json` 파일이 필요합니다. 이 파일은 저장소에 없고, 다른 사람과 나눠서도 안 됩니다. 무료이고, 사용량은 무료 한도에 한참 못 미칩니다.

Google 화면은 가끔 바뀌어서 메뉴 이름이 조금 다를 수 있습니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속해 Google 계정으로 로그인합니다.
2. 맨 위 프로젝트 선택 칸 → **새 프로젝트**를 눌러 이름(예: `StudyFlow`)을 정하고 만듭니다. 만든 뒤 그 프로젝트가 선택되어 있는지 확인합니다.
3. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**에서 `Google Calendar API`를 검색해 **사용**을 누릅니다.
4. **OAuth 동의 화면**(또는 *Google Auth Platform*)을 설정합니다.
   - 사용자 유형은 **외부**를 고르고, 앱 이름(예: `StudyFlow`)과 본인 이메일을 적습니다.
   - **테스트 사용자**에 본인의 Google 이메일을 추가합니다. (이걸 빼먹으면 로그인할 때 "액세스 차단됨"이 뜹니다.)
   - 권한(범위, Scopes) 추가 칸에는 아래 세 개를 넣습니다. 목록에서 찾기 어려우면 주소를 그대로 붙여 넣으세요.
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.calendarlist`
     - `https://www.googleapis.com/auth/calendar.app.created`
5. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**를 누르고, 애플리케이션 유형을 **데스크톱 앱**으로 만듭니다.
6. 만든 뒤 나오는 **JSON 다운로드**를 누르고, 받은 파일 이름을 `credentials.json`으로 바꿔 **프로젝트 폴더(이 README가 있는 곳)** 에 넣습니다.

> **7일마다 다시 로그인하게 되는 경우:** OAuth 동의 화면이 "테스트" 상태이면 Google이 로그인을 7일마다 만료시킵니다. 번거로우면 동의 화면에서 **앱 게시(In production)** 로 바꾸세요. 그러면 로그인할 때 "확인되지 않은 앱" 경고가 뜨는데, 본인이 만든 앱이므로 **고급 → 계속**을 누르면 됩니다.

## 실행

```powershell
.venv\Scripts\python main.py
```

처음 실행하면 브라우저가 열리고 Google 로그인과 권한 허용을 묻습니다. 허용하면 `token.json`이 만들어지고, 그다음부터는 자동으로 로그인됩니다.

### 바탕화면 바로가기 (선택)

터미널 없이 더블클릭으로 실행하려면 한 번만 실행하세요.

```powershell
powershell -ExecutionPolicy Bypass -File .\make_shortcut.ps1
```

바탕화면에 `StudyFlow` 바로가기가 생깁니다. 이 방식으로 실행하면 화면에 나오지 않는 메시지가 `studyflow.log` 파일에 기록되니, 문제가 생기면 그 파일을 보세요.

### 노트 탭 쓰기 (선택)

Obsidian을 쓴다면 **설정 탭 → 노트 (Obsidian)** 에 vault 폴더 경로(예: `C:\Users\이름\문서\Obsidian Vault`)를 적으세요. 쓰지 않으면 비워 두면 됩니다.

## 내 데이터는 어디에 있나요?

모두 **내 컴퓨터의 프로젝트 폴더 안**에만 저장되고, 외부 서버로 보내지 않습니다. (Google Calendar와 주고받는 일정은 Google에 있는 본인 계정의 데이터입니다.)

| 파일 | 내용 |
| --- | --- |
| `credentials.json` | Google 앱 신분증 (직접 만든 것) |
| `token.json` | Google 로그인 결과. 비밀번호와 같으니 남에게 주지 마세요. |
| `studyflow.db` | 할 일, 프로젝트, 우선순위 |
| `settings.json` | 설정 |
| `events_cache.json` | 오프라인용으로 기억해 둔 일정 |
| `notes_backup/` | 노트를 처음 고치기 전에 한 번씩 복사해 둔 백업 |
| `db_backup/` | `studyflow.db`를 하루에 한 번 복사해 둔 백업 (`studyflow-20261031.db`처럼 날짜 이름, 최근 14개만 남김) |

위 파일들은 `.gitignore`에 들어 있어서 Git에 올라가지 않습니다. 다른 컴퓨터로 옮기거나 백업하려면 `studyflow.db`와 `settings.json`을 복사하면 됩니다.

**`db_backup/`은 실수로 지웠거나 데이터가 이상해졌을 때를 위한 것**이라 같은 폴더 안에 있습니다. 폴더 전체를 잃어버리는 경우(디스크 고장 등)까지 막으려면 가끔 이 폴더를 USB나 클라우드에 복사해 두세요. 되돌리려면 StudyFlow를 끄고, `db_backup`에서 원하는 날짜의 파일을 `studyflow.db`라는 이름으로 복사해 덮어쓴 뒤 다시 켜면 됩니다.

창 안의 브라우저가 쓰는 작업 폴더만 프로젝트 밖의 `%LOCALAPPDATA%\StudyFlow\webview_profile`에 있습니다. 내 데이터는 없고, 프로그램을 끌 때 지워지거나(못 지우면 다음에 같은 폴더를 다시 씁니다) 해서 늘어나지 않으니 신경 쓰지 않아도 됩니다.

> 이 저장소를 포크하거나 직접 수정해서 올릴 때도 `credentials.json`과 `token.json`은 **절대 GitHub에 올리지 마세요.**

## 문제가 생겼을 때

| 증상 | 확인할 것 |
| --- | --- |
| 실행하자마자 `credentials.json`을 찾을 수 없다는 오류 | 6번 단계의 파일이 프로젝트 폴더에 `credentials.json`이라는 이름으로 있는지 확인하세요. |
| 로그인할 때 "액세스 차단됨" | 4번 단계에서 본인 이메일을 **테스트 사용자**에 추가했는지 확인하세요. |
| 갑자기 로그인 화면이 다시 뜸 | 동의 화면이 "테스트" 상태라서 7일이 지난 것입니다. 다시 로그인하면 되고, 위의 "앱 게시"로 막을 수 있습니다. |
| "권한이 부족하다"는 오류 | `token.json`을 지우고 다시 실행해서 새로 로그인하세요. 4번 단계의 권한 세 개가 모두 등록되어 있어야 합니다. |
| 바로가기로 켰는데 창이 안 뜸 | 프로젝트 폴더의 `studyflow.log` 마지막 줄을 확인하세요. |
| 와이파이는 되는데 "인터넷 연결을 확인하세요"가 가끔 뜸 | 놀던 연결이 끊긴 경우 프로그램이 새 연결로 알아서 다시 시도합니다. 그래도 계속 뜨면 `studyflow.log`에서 `[연결 재시도]`와 그 뒤의 오류(`WinError 10053/10054`는 공유기나 보안 프로그램이 연결을 끊은 것, `NameResolutionError`는 DNS 문제)를 확인하세요. |
| 화면이 예전 모습 그대로임 | 프로그램을 완전히 닫았다가 다시 켜세요. |
| "StudyFlow가 이미 켜져 있습니다"가 뜸 | StudyFlow는 한 번에 하나만 켜집니다. 작업 표시줄에 창이 있는지 보세요. 방금 닫았다면 몇 초 뒤에 다시 켜세요. 창이 없는데도 계속 뜨면 작업 관리자에서 `pythonw.exe`(또는 `python.exe`)를 끝내세요. |

## 만든 방식

화면은 HTML/CSS/JavaScript, 로직은 Python(Flask), 창은 pywebview, 저장은 SQLite입니다. 캘린더 화면은 [FullCalendar](https://fullcalendar.io/), 노트는 [marked](https://marked.js.org/)와 [DOMPurify](https://github.com/cure53/DOMPurify)를 씁니다. 글꼴은 Google Sans Flex와 Noto Sans KR(둘 다 SIL Open Font License)이고, 각 라이선스 파일은 `static/` 폴더에 함께 들어 있습니다.

만든 과정과 설계 결정은 [PLAN.md](PLAN.md)에 자세히 기록되어 있습니다. (Claude Code와 함께 단계별로 만들었습니다.)

기능을 고친 뒤 예전 기능이 망가지지 않았는지 확인하는 자동 시험은 [tests/README.md](tests/README.md)에 있습니다. (`.venv\Scripts\python tests\run_tests.py` 한 줄이면 서버 쪽 시험이 모두 돌아갑니다.)

## 라이선스

[MIT License](LICENSE)입니다. 자유롭게 쓰고 고치고 나눠도 되지만, 저작권 표시와 라이선스 문구는 남겨 주세요. `static/lib/`와 `static/fonts/`에 들어 있는 외부 라이브러리와 글꼴은 각자의 라이선스를 따릅니다.
