from pathlib import Path

p = Path("server/index.mjs")
t = p.read_text()

t = t.replace(
    '`http://127.0.0.1:`',
    '`http://127.0.0.1:5174`'
)

p.write_text(t)
print("OK: fixed INTERNAL_BASE_URL fallback")
