from pathlib import Path

p = Path("server/index.mjs")
t = p.read_text()

parts = t.split('app.get("/api/catalog/image"')
if len(parts) >= 3:
    # оставить только первый
    t = parts[0] + 'app.get("/api/catalog/image"' + parts[1]
    print("OK: duplicate catalog/image removed")
else:
    print("No duplicate found")

p.write_text(t)
