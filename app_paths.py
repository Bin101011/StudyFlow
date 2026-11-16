# StudyFlow가 내 데이터(studyflow.db, settings.json, credentials.json, token.json 등)를 둘 폴더를 정한다.
#
# 왜 따로 파일로 뺐나:
# - 파이썬으로 실행할 때(python main.py)는 코드 파일이 있는 프로젝트 폴더에 데이터를 둔다 (원래 방식 그대로).
# - exe로 실행할 때(PyInstaller로 만든 StudyFlow.exe)는 코드가 exe 안에 묶여 있다. 이때 __file__은
#   exe 옆의 _internal 폴더(묶은 파일을 풀어 둔 곳)를 가리킨다. 거기에 데이터를 두면 exe를 새로 만들 때 지워진다.
#   그래서 exe로 실행할 때는 StudyFlow.exe가 있는 폴더에 데이터를 둔다. credentials.json도 exe 옆에 두면 된다.
import os
import sys


def data_dir():
    """내 데이터를 둘 폴더의 경로를 돌려준다."""
    # sys.frozen: PyInstaller로 만든 exe 안에서 실행 중일 때만 True로 정해지는 값
    if getattr(sys, "frozen", False):
        # sys.executable: 지금 실행 중인 프로그램(StudyFlow.exe)의 전체 경로
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


DATA_DIR = data_dir()
