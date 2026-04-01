from pathlib import Path

p = Path("server/index.mjs")
text = p.read_text()

text = text.replace(
    "if (brand) {",
    "if (brand && brand.length > 1) {"
)

p.write_text(text)
print("OK: filter guard added")
