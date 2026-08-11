#!/usr/bin/env python3
"""Escribe docs/CLAUDE_BACKFILL_LINKS_FATHOM_JUANO.md desde dry-run."""
from __future__ import annotations

import io
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from claude_report import report_footer, write_claude_report  # noqa: E402

# Import after chdir
from backfill_links_fathom import load_csv, run_backfill, Stats  # noqa: E402
from decouple import config  # noqa: E402
from src.db import init_db  # noqa: E402


def main() -> int:
    init_db()
    csv_path = ROOT / "data" / "legacy" / "links_fathom.csv"
    csv_urls, stats = load_csv(csv_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        stats = run_backfill(1, csv_urls, stats, dry_run=True)
    dry_out = buf.getvalue()

    body = f"""## Objetivo

Backfill de `lead.link_llamada` desde `data/legacy/links_fathom.csv` (390 filas exportadas del jsonb legacy `linkLlamada`).

**Estado:** dry-run completado — **no aplicado** (pendiente OK).

## Resultado dry-run

```
{dry_out.strip()}
```

## Notas

- **330 leads** recibirían link nuevo (campo vacío hoy).
- **1 lead** (id **2533**, legacy `9e6cc26c…`) ya tiene link distinto al CSV → **no se sobrescribe**; quedaría en `legacy_meta.link_llamada_legacy`.
- **5 URLs duplicadas** en el CSV (2 legacy_ids cada una) → mismo link en 2 filas legacy; `call_report.fathom_url` es UNIQUE.
- **5 filas** traen 2 URLs en la celda → se toma la **primera** URL válida.
- **44 filas** texto libre descartadas (`No hubo`, `no hay`, etc.).
- Proyección: **12 → 342** leads con `link_llamada` (coherente: 12 actuales − 0 perdidos + 330 nuevos; el conflicto ya está en los 12).

## Comandos

```bash
cd backend
python ../scripts/backfill_links_fathom.py --user-id 1 --dry-run
python ../scripts/backfill_links_fathom.py --user-id 1 --yes   # aplicar
python ../scripts/backfill_links_fathom.py --user-id 1 --dry-run  # idempotencia
```

## Post-aplicación

```sql
SELECT COUNT(*) FROM lead
WHERE user_id = 1 AND COALESCE(link_llamada,'') <> '';

SELECT COUNT(*), ROUND(SUM(monto)::numeric,2)
FROM lead_payment WHERE user_id = 1 AND source = 'legacy_juano';
-- esperado: 362 / 265526.99
```

{report_footer("report_backfill_links_fathom.py", 1)}
"""
    path = write_claude_report("BACKFILL_LINKS_FATHOM_JUANO.md", body)
    print(f"Reporte: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
