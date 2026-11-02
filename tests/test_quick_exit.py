"""창을 닫으면 프로그램이 바로 끝나는지 (docs/review-2026-11.md의 N25).

뒤쪽 작업자(Google 동기화 확인, 앞뒤 달 미리 받기)가 Google 재시도 중이면, 창을 닫은 뒤에도 프로그램이 그 일을 마칠 때까지
3~4초 더 살아 있었다(측정). 그동안 두 번 켜기 방지 잠금이 풀리지 않아서, 닫고 1초 뒤에 다시 켜면 창이 그만큼 늦게 떴다.
작업자들이 오래 걸리는 일을 하는 중에 프로그램을 끝내게 해서, 바로 끝나는지 잰다. 화면 요청(노트 저장 등)은 여전히 끝까지 기다리는지도 본다.
"""
import os
import subprocess
import sys
import time

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TESTS_DIR)
sys.path.insert(0, PROJECT_DIR)
sys.path.insert(0, TESTS_DIR)
import fake_google  # noqa: E402  (이 파일에서도 app을 불러오므로 DB와 설정 위치를 먼저 임시로 바꾼다)

fake_google.install()
import app  # noqa: E402

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def run_and_time(code):
    """새 파이썬 프로세스에서 app을 불러온 뒤 code를 실행하고, 프로세스가 끝나기까지 걸린 시간과 출력을 돌려준다."""
    script = (
        "import sys, time, threading; sys.path.insert(0, %r); sys.path.insert(0, %r)\n"
        "import fake_google; fake_google.install()\n"
        "import app\n%s\nprint('END', flush=True)\n" % (PROJECT_DIR, TESTS_DIR, code)
    )
    started = time.time()
    result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, cwd=PROJECT_DIR,
                            env={**os.environ, "PYTHONUTF8": "1"})
    return time.time() - started, result.stdout + result.stderr


# 1) 파이썬을 켜고 app을 불러오는 데만 드는 시간 (비교 기준)
base, out = run_and_time("pass")
print(f"     (app을 불러오고 끝나기까지 {base:.2f}초)")
check("시험 준비: app을 불러오는 프로세스가 정상으로 끝난다", "END" in out, out[-300:])

# 2) 뒤쪽 작업자가 오래 걸리는 일(10초)을 하는 중에 끝내기 = 창을 닫았을 때 Google 재시도가 진행 중인 상황
took, out = run_and_time("app._background_pool.submit(time.sleep, 10); time.sleep(0.3)")
print(f"     (뒤쪽 작업자가 일하는 중에 끝내기: {took:.2f}초)")
check("뒤쪽 작업자(동기화 확인·미리 받기)가 일하는 중이어도 기다리지 않고 바로 끝난다", "END" in out and took < base + 3, f"{took:.1f}초 {out[-300:]}")

# 3) 화면 요청용 작업자도 같다 (화면을 열자마자 닫아서 일정 불러오기가 진행 중인 상황)
took, out = run_and_time("app._pool.submit(time.sleep, 10); time.sleep(0.3)")
print(f"     (요청용 작업자가 일하는 중에 끝내기: {took:.2f}초)")
check("요청용 작업자가 일하는 중이어도 기다리지 않고 바로 끝난다", "END" in out and took < base + 3, f"{took:.1f}초 {out[-300:]}")

# 4) 화면 요청을 처리하는 스레드(데몬 아님)는 여전히 끝까지 기다린다: 창을 닫는 순간 보낸 노트·메모 저장이 끊기면 안 된다.
#    요청 스레드가 작업자에게 일을 시키고 결과를 기다리는 경우(Google에 일정 쓰기)도 끝까지 처리되는지 본다
took, out = run_and_time(
    "def request_thread():\n"
    "    value = app._pool.submit(lambda: (time.sleep(1.5), 'written')[1]).result()\n"
    "    print('REQUEST', value, flush=True)\n"
    "threading.Thread(target=request_thread).start(); time.sleep(0.2)"
)
check("화면 요청 스레드가 작업자의 결과를 기다리는 중이면 그 일은 끝까지 처리된다(Google 쓰기 등)", "REQUEST written" in out, out[-300:])

# 5) 파이썬의 종료 뒤처리가 느린 경우. pywebview가 쓰는 .NET 연결 도구(pythonnet)는 종료 때 .NET을 "완전 종료"하는 함수를 등록하는데,
#    진짜 앱에서 창 정리 뒤 3~6초가 걸렸다(측정, Google 오류 없음). 그 느린 뒤처리를 10초짜리 atexit 함수로 흉내 낸다
SLOW_ATEXIT = "import atexit; atexit.register(time.sleep, 10)"
took, out = run_and_time(SLOW_ATEXIT)
print(f"     (느린 종료 뒤처리를 그대로 기다리면: {took:.2f}초)")
took, out = run_and_time(
    SLOW_ATEXIT + "\n"
    "import single_instance\n"
    "print('END', flush=True)\n"
    "single_instance.exit_now()"
)
print(f"     (exit_now로 끝내면: {took:.2f}초)")
check("느린 종료 뒤처리가 있어도 exit_now는 바로 끝낸다", "END" in out and took < base + 3, f"{took:.1f}초 {out[-300:]}")

# 6) exit_now 전에 화면 요청 스레드(데몬 아님)는 끝까지 기다린다: 창을 닫는 순간 보낸 노트·메모 저장이 끊기면 안 된다
took, out = run_and_time(
    "import single_instance\n"
    "def request_thread():\n"
    "    time.sleep(1.5); print('SAVED', flush=True)\n"
    "threading.Thread(target=request_thread, name='요청').start()\n"
    "app._background_pool.submit(time.sleep, 30)\n"
    "left = single_instance.wait_for_other_threads(timeout=5)\n"
    "print('LEFT', left, flush=True)\n"
    "single_instance.exit_now()"
)
check("요청 스레드가 하던 저장은 끝까지 기다린다", "SAVED" in out and "LEFT []" in out, out[-300:])
check("데몬 작업자(30초 일)는 기다리지 않는다", took < base + 4, f"{took:.1f}초")

took, out = run_and_time(
    "import single_instance\n"
    "threading.Thread(target=time.sleep, args=(60,), name='멈춘 요청').start()\n"
    "left = single_instance.wait_for_other_threads(timeout=1)\n"
    "print('LEFT', left, flush=True)\n"
    "single_instance.exit_now()"
)
check("끝나지 않는 요청은 정해진 시간만 기다리고, 그 이름을 알려 준 뒤 끝낸다", "LEFT ['멈춘 요청']" in out and took < base + 4, f"{took:.1f}초 {out[-300:]}")

# 7) 작업자 묶음이 예전처럼 동작한다 (결과 순서, 오류 전달)
check("map은 넣은 순서대로 결과를 준다", list(app._pool.map(lambda x: x * 2, [3, 1, 2])) == [6, 2, 4])
future = app._background_pool.submit(lambda: 1 / 0)
try:
    future.result(timeout=5)
    check("작업 중 오류는 result()에서 다시 난다", False)
except ZeroDivisionError:
    check("작업 중 오류는 result()에서 다시 난다", True)
check("오류가 난 뒤에도 작업자가 계속 일한다", app._background_pool.submit(lambda: "ok").result(timeout=5) == "ok")

print("\n실패 없음" if not failures else f"\n실패 {len(failures)}개: {failures}")
sys.exit(1 if failures else 0)
