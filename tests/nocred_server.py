# credentials.json이 없는 상태의 시험 서버 (처음 설치한 친구가 6단계를 하기 전의 모습).
# 가짜 Google을 끼우지 않고 진짜 로그인 코드를 그대로 쓴다: 그 코드가 "파일이 없다"를 만나야 하기 때문이다.
# 파일 위치만 임시 폴더로 돌려 놓아서, 내 진짜 credentials.json / token.json / studyflow.db / settings.json은 건드리지 않는다.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (불러오기만 해도 DB와 설정 파일이 임시 폴더로 바뀐다. install()은 일부러 부르지 않는다)
import event_cache, app, database, google_calendar  # noqa: E402, E401

google_calendar.CREDENTIALS_PATH = os.path.join(fake_google.TMP, "credentials.json")  # 일부러 만들지 않는다
google_calendar.TOKEN_PATH = os.path.join(fake_google.TMP, "token.json")
app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
database.init_db()

# main.py처럼 뒤쪽 일(미리 연결, 자동 동기화)도 시작한다. 파일이 없어도 이것들이 앱을 망가뜨리지 않는지 같이 본다
app.start_background_tasks()
app.app.run(port=5057, threaded=True)
