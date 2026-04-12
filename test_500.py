import requests
resp = requests.post("http://127.0.0.1:8000/api/auth/token", data={"username": "test@example.com", "password": "password123"})
token = resp.json().get("access_token")

resp2 = requests.get("http://127.0.0.1:8000/api/groups", headers={"Authorization": f"Bearer {token}"})
print(resp2.status_code)
print(resp2.text)
