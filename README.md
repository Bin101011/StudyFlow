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
- [Python](https://www.python.org/downloads/) **3.11 이상** (3.10 이하는 필요한 라이브러리가 설치되지 않습니다. 개발과 시험은 3.14로 했습니다. 설치할 때 **"Add python.exe to PATH"** 에 체크하세요.)
- Google 계정
- 이 프로젝트 폴더. GitHub 페이지의 초록색 **Code → Download ZIP** 으로 받아 압축을 풀거나, Git이 있으면 `git clone https://github.com/Bin101011/StudyFlow.git` 을 쓰세요.

## 설치

**PowerShell을 프로젝트 폴더에서 엽니다.** 탐색기에서 프로젝트 폴더(이 README가 있는 폴더)를 열고, 위쪽 주소 표시줄을 한 번 눌러 글자를 지운 뒤 `powershell`을 입력하고 Enter를 누르세요. 그 폴더에서 열린 파란 창이 PowerShell입니다. (Windows 11에서는 폴더 안 빈 곳을 오른쪽 클릭 → **터미널에서 열기**도 됩니다.)

먼저 Python이 제대로 설치됐는지 확인합니다.

```powershell
python --version
```

`Python 3.14.3`처럼 버전이 나오면 됩니다. Microsoft Store가 열리거나 오류가 나면 Python이 설치되지 않았거나 설치할 때 **"Add python.exe to PATH"** 에 체크하지 않은 것입니다. Python을 다시 설치하세요.

그다음 아래를 차례로 실행합니다. 두 번째 줄은 라이브러리를 내려받느라 1~2분쯤 걸립니다.

```powershell
# 1) 이 프로젝트 전용 파이썬 환경(.venv)을 만든다
python -m venv .venv

# 2) 필요한 라이브러리를 그 환경에 설치한다
.venv\Scripts\python -m pip install -r requirements.txt
```

## Google 연결하기 (처음 한 번)

> **중요:** StudyFlow는 여러분의 Google Calendar에 접근해야 합니다. 그러려면 여러분 **본인의 Google Cloud 프로젝트**에서 만든 `credentials.json` 파일이 필요합니다. 이 파일은 저장소에 없고, 다른 사람과 나눠서도 안 됩니다. 무료이고, 사용량은 무료 한도에 한참 못 미칩니다.

Google 화면은 가끔 바뀌어서 메뉴 이름이 조금 다를 수 있습니다. 아래 메뉴 이름은 Google 공식 안내(2026년 11월 확인)를 따랐고, 화면이 영어라면 괄호 안의 영어 이름을 찾으세요.

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속해 Google 계정으로 로그인합니다.
2. 맨 위 프로젝트 선택 칸 → **새 프로젝트**를 눌러 이름(예: `StudyFlow`)을 정하고 만듭니다. 만든 뒤 그 프로젝트가 선택되어 있는지 확인합니다.
3. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**에서 `Google Calendar API`를 검색해 **사용**을 누릅니다.
4. **동의 화면**을 만들고, 테스트 사용자와 권한을 추가합니다. 왼쪽 메뉴(☰)의 **Google 인증 플랫폼**(Google Auth Platform. 안 보이면 위쪽 검색칸에 입력)에서 **세 가지를 차례로** 합니다. **마법사를 끝내는 것만으로는 부족합니다. 4-2와 4-3은 마법사가 끝난 뒤 다른 메뉴에서 따로 해야 합니다.**
   1. **마법사로 만들기**: **브랜딩**(Branding)에서 처음이면 **시작하기**(Get started)를 누릅니다. 앱 이름(예: `StudyFlow`)과 본인 이메일 → **잠재고객**(Audience) 단계에서 **외부**(External) → **연락처 정보** 단계에 본인 이메일 → **완료** 단계에서 "Google API 서비스: 사용자 데이터 정책에 동의합니다"에 체크 → **계속** → **만들기**.
   2. **테스트 사용자 추가**: 왼쪽 메뉴 **잠재고객**(Audience. 화면에 따라 '대상'으로 보이기도 합니다) → **테스트 사용자**(Test users) 아래의 **사용자 추가**(Add users)에 **본인의 Google 이메일**을 넣고 **저장**합니다. (이걸 빼먹으면 로그인할 때 "액세스 차단됨"이 뜹니다.)
   3. **권한(범위, Scopes) 추가**: 왼쪽 메뉴 **데이터 액세스**(Data Access) → **범위 추가 또는 삭제**(Add or remove scopes)에서 아래 세 개를 고르고 **저장**합니다. 목록에서 찾기 어려우면 화면 아래쪽 직접 입력 칸에 주소를 그대로 붙여 넣고 추가하세요.
      - `https://www.googleapis.com/auth/calendar.events`
      - `https://www.googleapis.com/auth/calendar.calendarlist`
      - `https://www.googleapis.com/auth/calendar.app.created`
5. **클라이언트 ID**를 만듭니다. 왼쪽 메뉴 **Google 인증 플랫폼 → 클라이언트**(Clients) → **클라이언트 만들기**(Create client) → **애플리케이션 유형**은 **데스크톱 앱**(Desktop app)으로 하고, 이름은 아무거나(예: `StudyFlow`) 적은 뒤 **만들기**를 누릅니다. (이 메뉴가 안 보이는 옛 화면에서는 **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**에서 같은 일을 합니다.)
6. **만들자마자 나오는 창에서 바로** JSON 파일을 내려받습니다(창에 있는 **JSON 다운로드** 버튼 또는 다운로드 아이콘). Google은 클라이언트 보안 비밀을 **만들 때 한 번만** 보고 받을 수 있게 하므로, 창을 닫기 전에 받으세요. (놓쳤다면 클라이언트를 새로 만들면 됩니다.) 받은 파일 이름을 `credentials.json`으로 바꿔 **프로젝트 폴더(이 README가 있는 곳)** 에 넣습니다.

> **파일 이름이 `credentials.json.json`이 되기 쉽습니다.** Windows 탐색기는 기본으로 `.json` 같은 확장자를 숨깁니다. 그 상태에서 이름을 `credentials.json`이라고 적으면 실제 이름은 `credentials.json.json`이 되어 StudyFlow가 파일을 못 찾습니다. 탐색기 위쪽 **보기 → 표시 → 파일 확장명**을 켜고 이름을 확인하세요.

> **7일마다 다시 로그인하게 되는 경우:** OAuth 동의 화면이 "테스트" 상태이면 Google이 로그인을 7일마다 만료시킵니다. 번거로우면 **Google 인증 플랫폼 → 잠재고객**(Audience)에서 **앱 게시**(Publish app) 버튼을 눌러 게시 상태를 **In production**(프로덕션)으로 바꾸세요. 그러면 "확인되지 않은 앱" 경고가 뜨는데, 본인이 만든 앱이므로 아래 "처음 실행"에서 설명하는 대로 넘어가면 됩니다.

## 실행

```powershell
.venv\Scripts\python main.py
```

처음 실행하면 StudyFlow 창이 뜨고, 잠시 뒤 브라우저가 열려 Google 로그인과 권한 허용을 묻습니다. 허용하면 `token.json`이 만들어지고, 그다음부터는 자동으로 로그인됩니다.

- **"Google에서 확인하지 않은 앱" 경고가 뜰 수 있습니다.** 본인이 만든 앱이므로 **고급**을 눌러 나오는 **"…(안전하지 않음)(으)로 이동"** (또는 **계속**)을 누르세요. 화면 문구는 조금 다를 수 있습니다.
- **권한 허용 화면에서 모든 항목에 체크가 되어 있는지 확인하고** 계속하세요. 하나라도 빼면 "권한이 부족하다"는 오류가 나거나 로그인 화면이 계속 다시 뜹니다.
- 로그인을 끝내기 전까지는 StudyFlow 창의 달력이 비어 있거나 불러오는 중일 수 있습니다. 브라우저에서 로그인을 끝내세요.

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
| `settings.broken-날짜.json` | `settings.json`이 깨졌을 때(정전 등) StudyFlow가 옆에 옮겨 둔 옛 파일. 평소에는 없고, 생기면 화면에 알림이 나옵니다. 필요 없으면 지워도 됩니다 |
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
| 창은 뜨는데 왼쪽 캘린더 목록 칸에 "`credentials.json` 파일이 없습니다…"가 보임 (오른쪽 위에는 "오프라인"도 뜸) | 6번 단계의 파일이 프로젝트 폴더(`main.py`가 있는 곳)에 `credentials.json`이라는 이름으로 있는지 확인하세요. `credentials.json.json`이 아닌지도 보세요(위의 파일 이름 안내). 고친 뒤 StudyFlow를 껐다 켜세요. |
| "`credentials.json` 파일을 읽을 수 없습니다…" | 파일은 있지만 내용이 올바르지 않은 것입니다. 5번 단계에서 애플리케이션 유형을 **데스크톱 앱**으로 만들었는지 확인하고, 6번 단계의 JSON을 다시 받아 바꿔 넣으세요. |
| 로그인할 때 "액세스 차단됨" | 4-2단계에서 본인 이메일을 **테스트 사용자**에 추가했는지 확인하세요. (마법사를 끝낸 것만으로는 추가되지 않습니다.) |
| 갑자기 로그인 화면이 다시 뜸 | 동의 화면이 "테스트" 상태라서 7일이 지난 것입니다. 다시 로그인하면 되고, 위의 "앱 게시"로 막을 수 있습니다. |
| "권한이 부족하다"는 오류 | `token.json`을 지우고 다시 실행해서 새로 로그인하세요. 4-3단계의 권한 세 개가 모두 등록되어 있어야 하고, 로그인할 때 권한 허용 화면에서 모든 항목에 체크해야 합니다. |
| 바로가기로 켰는데 창이 안 뜸 | 프로젝트 폴더의 `studyflow.log` 마지막 줄을 확인하세요. |
| 와이파이는 되는데 "인터넷 연결을 확인하세요"가 가끔 뜸 | 놀던 연결이 끊긴 경우 프로그램이 새 연결로 알아서 다시 시도합니다. 그래도 계속 뜨면 `studyflow.log`에서 `[연결 재시도]`와 그 뒤의 오류(`WinError 10053/10054`는 공유기나 보안 프로그램이 연결을 끊은 것, `NameResolutionError`는 DNS 문제)를 확인하세요. |
| 화면이 예전 모습 그대로임 | 프로그램을 완전히 닫았다가 다시 켜세요. |
| "StudyFlow가 이미 켜져 있습니다"가 뜸 | StudyFlow는 한 번에 하나만 켜집니다. 작업 표시줄에 창이 있는지 보세요. 방금 닫았다면 몇 초 뒤에 다시 켜세요. 창이 없는데도 계속 뜨면 작업 관리자에서 `pythonw.exe`(또는 `python.exe`)를 끝내세요. |

## 만든 방식

화면은 HTML/CSS/JavaScript, 로직은 Python(Flask), 창은 pywebview, 저장은 SQLite입니다. 캘린더 화면은 [FullCalendar](https://fullcalendar.io/), 노트는 [marked](https://marked.js.org/)와 [DOMPurify](https://github.com/cure53/DOMPurify)를 씁니다. 글꼴은 Google Sans Flex와 Noto Sans KR(둘 다 SIL Open Font License)이고, 각 라이선스 파일은 `static/` 폴더에 함께 들어 있습니다.

만든 과정과 설계 결정은 [PLAN.md](PLAN.md)에 기록되어 있고, 화면별 설명([docs/screens.md](docs/screens.md))과 Google Calendar 연동([docs/google-calendar.md](docs/google-calendar.md)), 기능별 구현 기록([docs/feature-notes.md](docs/feature-notes.md))은 `docs/` 폴더에 나눠 두었습니다. (Claude Code와 함께 단계별로 만들었습니다.)

기능을 고친 뒤 예전 기능이 망가지지 않았는지 확인하는 자동 시험은 [tests/README.md](tests/README.md)에 있습니다. (`.venv\Scripts\python tests\run_tests.py` 한 줄이면 서버 쪽 시험이 모두 돌아갑니다.)

## 라이선스

[MIT License](LICENSE)입니다. 자유롭게 쓰고 고치고 나눠도 되지만, 저작권 표시와 라이선스 문구는 남겨 주세요. `static/lib/`와 `static/fonts/`에 들어 있는 외부 라이브러리와 글꼴은 각자의 라이선스를 따릅니다.
