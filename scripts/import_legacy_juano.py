#!/usr/bin/env python3
"""Importador CRM legacy juano → ATV.

Ejecutar desde backend:
  python ../scripts/import_legacy_juano.py --list-users
  python ../scripts/import_legacy_juano.py --user-id 1 --dry-run

Requiere CSV en ./data/legacy/: pagos.csv, leads.csv, cuotas.csv
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from src.services.legacy_juano_import import (  # noqa: E402
    LegacyJuanoImporter,
    format_summary,
    list_auth_users,
    resolve_target_user,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Importar CRM legacy juano a ATV")
    parser.add_argument("--user-id", type=int, help="Tenant destino (auth user id)")
    parser.add_argument("--list-users", action="store_true", help="Listar usuarios ATV y salir")
    parser.add_argument("--dry-run", action="store_true", help="Simular sin escribir en BD")
    parser.add_argument(
        "--only",
        choices=("leads", "pagos", "cuotas"),
        default=None,
        help="Importar solo una tabla",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirmar import real sin prompt interactivo",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=ROOT / "data" / "legacy",
        help="Directorio con los CSV",
    )
    args = parser.parse_args()

    if args.list_users:
        print("Usuarios ATV (authuser):")
        for uid, name in list_auth_users():
            print(f"  id={uid}  username={name!r}")
        return 0

    if args.user_id is None:
        print("ERROR: Indicá --user-id N o usá --list-users para ver opciones.", file=sys.stderr)
        return 1

    try:
        uid, username = resolve_target_user(args.user_id)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    print(f"Tenant destino: user_id={uid} username={username!r}")
    if not args.dry_run:
        print("⚠️  IMPORT REAL — se escribirá en la base de datos.")
        if not args.yes:
            try:
                answer = input(f"¿Importar legacy_juano al usuario {username!r} (id={uid})? [y/N] ").strip().lower()
            except EOFError:
                answer = "n"
            if answer not in ("y", "yes", "s", "si", "sí"):
                print("Cancelado.")
                return 1

    importer = LegacyJuanoImporter(uid, args.data_dir, dry_run=args.dry_run)
    try:
        importer.verify_csvs()
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    try:
        stats = importer.run(only=args.only)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    print(format_summary(stats, args.dry_run, user_id=uid, username=username))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
