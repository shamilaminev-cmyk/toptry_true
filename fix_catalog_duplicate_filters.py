from pathlib import Path

p = Path("pages/Catalog.tsx")
text = p.read_text()

# удаляем второй блок фильтров (грубый, но безопасный способ)
parts = text.split("placeholder=\"Бренд\"")

if len(parts) > 2:
    # оставляем только первый
    text = parts[0] + "placeholder=\"Бренд\"" + parts[1]

p.write_text(text)
print("OK: duplicate filters removed")
