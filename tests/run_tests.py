"""tests 폴더의 서버 쪽(API) 시험을 모두 돌리고 파일별 결과를 한 줄씩 보여준다.

실행 (프로젝트 폴더에서):
    .venv\\Scripts\\python.exe tests\\run_tests.py            전부
    .venv\\Scripts\\python.exe tests\\run_tests.py inbox      이름에 'inbox'가 들어간 것만

시험은 가짜 Google과 임시 DB로 돌아가서 진짜 Google, studyflow.db, settings.json을 건드리지 않는다.
화면 시험(tests/browser)은 따로 돌린다. tests/README.md를 보자."""
import os
import subprocess
import sys

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TESTS_DIR)


def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else ""
    names = sorted(n for n in os.listdir(TESTS_DIR) if n.startswith("test_") and n.endswith(".py") and keyword in n)
    if not names:
        print("돌릴 시험이 없습니다:", keyword)
        return 1

    # 시험 출력이 한글이라, 자식 프로세스도 UTF-8로 말하게 한다
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONPATH": PROJECT_DIR}
    total_pass = total_fail = 0
    bad_files = []
    for name in names:
        result = subprocess.run([sys.executable, os.path.join(TESTS_DIR, name)], cwd=PROJECT_DIR, env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        lines = result.stdout.splitlines()
        passed = sum(1 for line in lines if line.startswith("PASS"))
        failed = sum(1 for line in lines if line.startswith("FAIL"))
        # 실패 줄이 없어도 중간에 오류로 죽었다면(종료 번호가 0이 아님) 실패로 센다
        crashed = result.returncode != 0 and failed == 0
        ok = failed == 0 and not crashed
        print(f"{'OK  ' if ok else 'FAIL'} {name:34} PASS={passed:<4} FAIL={failed}" + ("  (오류로 중단됨)" if crashed else ""))
        for line in lines:
            if line.startswith("FAIL"):
                print("      ", line)
        if crashed:
            print("      ", (result.stderr.strip().splitlines() or ["(오류 내용 없음)"])[-1])
        total_pass += passed
        total_fail += failed
        if not ok:
            bad_files.append(name)

    print(f"\n합계: PASS {total_pass}, FAIL {total_fail}, 문제 있는 파일 {len(bad_files)}개 / {len(names)}개")
    return 1 if bad_files else 0


if __name__ == "__main__":
    sys.exit(main())
