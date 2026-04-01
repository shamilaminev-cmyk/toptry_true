from pathlib import Path

p = Path("server/index.mjs")
text = p.read_text()

text = text.replace(
    "where.brand = { contains: brand, mode: 'insensitive' };",
    """where.brand = {
      not: null,
      contains: brand,
      mode: 'insensitive'
    };"""
)

p.write_text(text)
print("OK: brand filter fixed")
