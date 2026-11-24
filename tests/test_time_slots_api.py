"""나만의 시간표(교시) 설정(timeSlotGroups)의 저장과 정리.

- 맞는 시간표는 그대로 저장되고, 교시는 시작 시각 순서로 정렬되는지
- 이름이 비었거나 시각이 틀리거나 끝이 시작보다 빠른 교시는 빠지는지
- 리스트가 아닌 값은 무시하고 원래 값을 지키는지, 개수 한계
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (불러오기만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)

fake = fake_google.install()
import app  # noqa: E402

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def saved():
    return client.get("/api/settings").get_json()["values"]["timeSlotGroups"]


check("기본값은 빈 목록", saved() == [])

groups = [{"name": " 학교 ", "slots": [
    {"label": "2교시", "start": "09:40", "end": "10:30"},
    {"label": "1교시", "start": "08:40", "end": "09:30"},
    {"label": "", "start": "10:40", "end": "11:30"},        # 이름 없음 → 빠짐
    {"label": "틀린시각", "start": "9:40", "end": "10:30"},   # 모양 틀림 → 빠짐
    {"label": "거꾸로", "start": "12:00", "end": "11:00"},    # 끝이 빠름 → 빠짐
    "이상한 값",
]}, {"name": "", "slots": []}]
response = client.put("/api/settings", json={"timeSlotGroups": groups})
check("저장 200", response.status_code == 200)
result = saved()
check("이름 앞뒤 빈칸 지움", result[0]["name"] == "학교", result)
check("맞는 교시만, 시작 순서로", [s["label"] for s in result[0]["slots"]] == ["1교시", "2교시"], result)
check("빈 이름은 '시간표'", result[1] == {"name": "시간표", "slots": []}, result)

client.put("/api/settings", json={"timeSlotGroups": "망가진 값"})
check("리스트가 아니면 원래 값 유지", [s["label"] for s in saved()[0]["slots"]] == ["1교시", "2교시"])

client.put("/api/settings", json={"fontSize": 15})
check("다른 설정만 보내도 유지", len(saved()) == 2)

client.put("/api/settings", json={"timeSlotGroups": [{"name": "g", "slots": []}] * 15})
check("시간표는 10개까지", len(saved()) == 10)

client.put("/api/settings", json={"timeSlotGroups": []})
check("빈 목록으로 지우기", saved() == [])

print(f"{'FAIL' if failures else 'OK'}: {len(failures)} failures")
sys.exit(1 if failures else 0)
