# StudyFlow 시험

기능을 고친 뒤 **예전 기능이 망가지지 않았는지** 확인하는 자동 시험입니다. 전부 **가짜 Google**과 **임시 DB**로 돌아가서, 진짜 Google 계정과 내 `studyflow.db`, `settings.json`은 건드리지 않습니다.

모든 명령은 **프로젝트 폴더**(StudyFlow)에서 실행합니다.

## 1. 서버 시험 (빠름, 1분 안쪽)

```
.venv\Scripts\python.exe tests\run_tests.py            # 전부
.venv\Scripts\python.exe tests\run_tests.py inbox      # 이름에 inbox가 든 것만
```

파일마다 `PASS 개수 / FAIL 개수`를 한 줄로 보여주고, 하나라도 실패하면 종료 번호가 1입니다. 실패한 검사의 이름도 함께 나옵니다.

| 파일 | 확인하는 것 |
|---|---|
| `test_*_api.py` | 할 일, 프로젝트, 폴더, D-day, 시간표 블록, 메모, 순서 바꾸기, 우선순위, 캘린더 관리 등의 API |
| `test_sync.py` | 일정 기억(캐시)과 변경 확인(syncToken) 동기화 |
| `test_connection.py` | 끊긴 연결을 새 연결로 다시 시도하는 부분 (로컬 가짜 서버로 재현) |
| `test_db_indexes_backup.py` | DB 인덱스(할 일 9,000개에서의 속도)와 하루 한 번 DB 백업 |
| `test_single_instance.py` | StudyFlow를 두 번 켜지 못하게 하는 잠금 (프로세스를 실제로 여러 개 띄운다) |

`fake_google.py`가 가짜 Google입니다. 시험이 `app`을 가져오기 전에 DB와 설정 파일의 위치를 임시 폴더로 바꿔 둡니다. **새 시험 파일을 만들 때도 `import fake_google`을 `import app`보다 먼저 하세요.** 안 그러면 진짜 DB에 씁니다.

## 2. 화면 시험 (느림, 파일마다 1~3분)

실제 화면에서 마우스를 끌고 키보드를 치는 시험입니다. 눈에 안 보이는 Microsoft Edge를 직접 띄워서 조종합니다(CDP).

필요한 것: **Node.js**(`node --version`이 나오면 됩니다)와 Edge(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`).

```
.venv\Scripts\python.exe tests\browser\run_browser_test.py steps     # steps_test.mjs 하나
.venv\Scripts\python.exe tests\browser\run_browser_test.py all       # 전부 차례로 (10분쯤)
```

실행기가 시험마다 시험 서버(5057번 포트)를 새로 띄우고, 끝나면 끕니다. 이전 시험이 남긴 계획/메모가 있으면 엉뚱하게 실패하기 때문입니다.

| 시험 | 확인하는 것 | 서버 |
|---|---|---|
| `tl_test` | 오늘 탭 시간표 (만들기, 끌기, 겹침, 확대/축소, 할 일 끌어다 놓기) | `memo_server.py` |
| `steps_test` | 프로젝트 단계 순서 바꾸기, 새 프로젝트 색 | `pro_server.py` |
| `order_test` | 오늘 할 일 순서 바꾸기 | `memo_server.py` |
| `pmemo_test` / `tmemo_test` | 프로젝트 메모 / 할 일 메모 | `memo_server.py` |
| `memo_test_cal` | 달력의 일정 메모, 하루 메모 | `memo_server.py` |
| `month_test` | 월간 달력 6/7줄, 이전/다음 이동 | `memo_server.py` |
| `rollover_test` | 오늘 탭을 켜 둔 채 자정이 지났을 때 새 날짜로 넘어가기 | `memo_server.py` |
| `purify_test` | 노트 읽기 화면: 평소 마크다운이 서식대로 보이는지, 공격 문장(`<script>`, `onerror`, `javascript:` 링크 등 23개)이 실행되지 않는지. 임시 vault 폴더를 만들어 쓰고 끝나면 지운다. **`static/lib/`의 `marked`나 `DOMPurify`를 새 버전으로 바꿀 때마다 돌린다** | `memo_server.py` |

### 알려진 함정

- **같은 5057번 포트를 쓰는 시험을 동시에 돌리지 마세요.** 서로의 서버를 죽입니다.
- **마우스를 움직일 때마다 정확히 5초씩 걸리고 전체가 몇 배로 느리면**, 시험용 Edge 페이지가 "숨김" 상태(`document.visibilityState === "hidden"`)라서입니다. 앱 버그가 아닙니다. 시험 파일 머리말이 Edge를 띄울 때 `--disable-renderer-backgrounding` 등의 옵션을 주고 `Page.setWebLifecycleState`로 깨워서 해결해 두었으니, 새 화면 시험을 만들 때는 기존 시험의 머리말(1~16줄)을 그대로 쓰세요.
- 시험이 오류로 죽으면 시험용 Edge(`edge_t_`로 시작하는 임시 프로필)가 남아 있을 수 있습니다. 작업 관리자에서 `msedge`를 정리하세요.
- 마우스로 누를 줄은 **화면 안으로 스크롤한 뒤에** 위치를 재야 합니다. 프로젝트 카드는 마우스를 올리면 `[+ 메모]` 버튼 때문에 내용이 35px 내려오니, 먼저 마우스를 올려 둔 뒤에 재세요. 시간표를 스크롤하면 작은 창이 닫히므로 스크롤 직후 150ms 기다립니다.
- 이 PC의 Edge에는 광고 차단 확장 프로그램이 있어서 `Could not establish connection. Receiving end does not exist` 오류가 자바스크립트 오류 목록에 섞입니다. 시험이 이미 걸러냅니다.
- `tl_test`의 몇 검사(`포인터가 가리킨 시각이 제자리에 남는다`, `화면에 점선 계획 블록이 보인다`, `빈 제목으로 벗어나면…`)와 `test_sync.py`의 1건은 타이밍 때문에 가끔 흔들립니다. 한 번 더 돌려서 통과하면 문제가 아닙니다.
- 서버 시험은 시스템 파이썬이 아니라 `.venv\Scripts\python.exe`로 돌려야 합니다(라이브러리가 거기에 설치돼 있습니다).
