# import json
# import re
# import ssl
# import unicodedata
# import urllib.error
# import urllib.parse
# import urllib.request
# from datetime import datetime, timezone
# from typing import Any
# from zoneinfo import ZoneInfo
#
# import certifi
# from fastapi import HTTPException
# from pony.orm import db_session
#
# from src.models import ApiConnection, ManychatChat
# from src.schemas import (
#     BioLeadResponse,
#     BioLeadsListResponse,
#     BioManychatStatusResponse,
#     BioMetricsResponse,
#     BioViaOptionsResponse,
# )
# from src.services.airtable_services import (
#     AirtableServices,
#     _normalize_base_id,
#     _normalize_table_id,
# )
# from src.services.manychat_service import ManychatService
#
# _AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")
#
#
# def _norm(s: str) -> str:
#     t = (s or "").strip().lower()
#     t = unicodedata.normalize("NFD", t)
#     t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
#     return re.sub(r"\s+", "", t)
#
#
# def _pick_field(fields: dict[str, Any], aliases: list[str]) -> Any:
#     keys = list(fields.keys())
#     for a in aliases:
#         na = _norm(a)
#         for k in keys:
#             if _norm(k) == na:
#                 return fields[k]
#     return None
#
#
# def _to_str(v: Any) -> str | None:
#     if v is None:
#         return None
#     if isinstance(v, str):
#         s = v.strip()
#         return s or None
#     if isinstance(v, (int, float)):
#         return str(v)
#     if isinstance(v, list):
#         if not v:
#             return None
#         return ", ".join([str(x) for x in v if x is not None]).strip() or None
#     return str(v).strip() or None
#
#
# def _field_bool(v: Any) -> bool:
#     if v is True:
#         return True
#     if v is False or v is None:
#         return False
#     if isinstance(v, (int, float)):
#         return bool(int(v))
#     s = str(v).strip().lower()
#     return s in ("1", "true", "yes", "sí", "si")
#
#
# def _to_float(v: Any) -> float | None:
#     if v is None:
#         return None
#     if isinstance(v, (int, float)):
#         return float(v)
#     s = str(v).strip()
#     if not s:
#         return None
#     s = re.sub(r"[^0-9,.\-]", "", s).replace(",", ".")
#     try:
#         return float(s)
#     except ValueError:
#         return None
#
#
# def _extract_handle_any(raw: str | None) -> str:
#     v = (raw or "").strip()
#     if not v:
#         return ""
#     if "instagram.com/" in v or v.startswith("http://") or v.startswith("https://"):
#         s = v.replace("https://", "").replace("http://", "").strip("/")
#         if "instagram.com/" in s:
#             s = s.split("instagram.com/")[-1]
#         handle = s.split("/")[0].split("?")[0].strip()
#     else:
#         handle = v
#     return re.sub(r"[^a-zA-Z0-9._]", "", handle.lstrip("@").strip().lower())
#
#
# def _month_from_value(raw: str | None) -> str | None:
#     if not raw:
#         return None
#     s = raw.strip()
#     if re.match(r"^\d{4}-\d{2}", s):
#         return s[:7]
#     if re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$", s):
#         _, mm, yy = s.split("/")
#         year = f"20{yy}" if len(yy) == 2 else yy
#         return f"{year}-{mm.zfill(2)}"
#     return None
#
#
# def _month_key_buenos_aires(raw: str | None) -> str | None:
#     """YYYY-MM del instante según calendario en America/Argentina/Buenos_Aires."""
#     if not raw:
#         return None
#     s = str(raw).strip()
#     if not s:
#         return None
#     try:
#         if "T" in s or s.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", s):
#             s_iso = s.replace("Z", "+00:00")
#             dt = datetime.fromisoformat(s_iso)
#             if dt.tzinfo is None:
#                 dt = dt.replace(tzinfo=timezone.utc)
#             return dt.astimezone(_AR_TZ).strftime("%Y-%m")
#     except (ValueError, TypeError, OSError):
#         pass
#     # Fecha solo YYYY-MM-DD: mes civil explícito en el string
#     if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
#         return s[:7]
#     return _month_from_value(s)
#
#
# class BioService:
#     def _resolve_user_by_manychat_webhook_token(self, webhook_token: str) -> str | None:
#         token = str(webhook_token or "").strip()
#         if not token:
#             return None
#         with db_session:
#             for conn in list(ApiConnection.select()):
#                 if conn.platform != "manychat":
#                     continue
#                 creds = conn.credentials if isinstance(conn.credentials, dict) else {}
#                 saved = str(creds.get("webhook_token") or "").strip()
#                 if saved and saved == token:
#                     return conn.user_id
#         return None
#
#     def _create_airtable_lead_from_manychat(
#         self,
#         user_id: str,
#         ig_handle: str,
#         keyword: str,
#         full_name: str | None,
#         respondio_auto: bool = False,
#     ) -> None:
#         pat, base_id, table_id, table_name = self._load_airtable_conn(user_id)
#         table_seg = table_id or table_name
#         base_path = urllib.parse.quote(base_id, safe="")
#         table_path = urllib.parse.quote(table_seg, safe="")
#         handle = _extract_handle_any(ig_handle)
#         if not handle:
#             return
#
#         filter_formula = f'SEARCH("{handle}",{{IG}})'
#         exists_url = (
#             f"https://api.airtable.com/v0/{base_path}/{table_path}"
#             f"?maxRecords=1&filterByFormula={urllib.parse.quote(filter_formula, safe='')}"
#         )
#         headers = {
#             "Authorization": f"Bearer {pat}",
#             "Accept": "application/json",
#         }
#         req_exists = urllib.request.Request(exists_url, headers=headers, method="GET")
#         ssl_ctx = ssl.create_default_context(cafile=certifi.where())
#         with urllib.request.urlopen(req_exists, timeout=30, context=ssl_ctx) as response:
#             payload = response.read().decode("utf-8")
#             parsed = json.loads(payload) if payload else {}
#         records = parsed.get("records") if isinstance(parsed, dict) else []
#         if isinstance(records, list) and records:
#             if respondio_auto:
#                 record_id = str((records[0] or {}).get("id") or "").strip()
#                 if record_id:
#                     patch_url = f"https://api.airtable.com/v0/{base_path}/{table_path}/{urllib.parse.quote(record_id, safe='')}"
#                     patch_body = {"fields": {"Respondió auto": True}}
#                     req_patch = urllib.request.Request(
#                         patch_url,
#                         data=json.dumps(patch_body).encode("utf-8"),
#                         headers={**headers, "Content-Type": "application/json"},
#                         method="PATCH",
#                     )
#                     with urllib.request.urlopen(req_patch, timeout=30, context=ssl_ctx):
#                         pass
#             return
#
#         create_url = f"https://api.airtable.com/v0/{base_path}/{table_path}"
#         body = {
#             "fields": {
#                 "Nombre": (full_name or "").strip(),
#                 "IG": f"https://www.instagram.com/{handle}/",
#                 "Vía": "Automático - ManyChat",
#                 "Keyword": keyword,
#                 "Fecha bot": datetime.utcnow().isoformat(),
#                 "Respondió auto": bool(respondio_auto),
#             }
#         }
#         req_create = urllib.request.Request(
#             create_url,
#             data=json.dumps(body).encode("utf-8"),
#             headers={**headers, "Content-Type": "application/json"},
#             method="POST",
#         )
#         with urllib.request.urlopen(req_create, timeout=30, context=ssl_ctx):
#             pass
#
#     def process_manychat_webhook(self, body: dict[str, Any]) -> dict[str, Any]:
#         event = str(body.get("event") or "").strip().lower()
#         webhook_token = str(body.get("webhook_token") or "").strip()
#         keyword = str(body.get("keyword") or "").strip()
#         if not keyword and event == "respondio_auto":
#             keyword = "respondio_auto"
#         ig_username = _extract_handle_any(_to_str(body.get("contact_ig_username")) or "")
#         contact_name = _to_str(body.get("contact_name")) or _to_str(body.get("contact_ig_username")) or "Desconocido"
#         contact_lastname = _to_str(body.get("contact_lastname"))
#         manychat_contact_id = _to_str(body.get("manychat_contact_id"))
#         full_name = " ".join([x for x in [contact_name, contact_lastname] if x]).strip() or contact_name
#
#         if not webhook_token:
#             raise HTTPException(status_code=401, detail="Invalid webhook token")
#         if not keyword:
#             raise HTTPException(status_code=400, detail="Missing keyword")
#
#         user_id = self._resolve_user_by_manychat_webhook_token(webhook_token)
#         if not user_id:
#             raise HTTPException(status_code=401, detail="Invalid webhook token")
#
#         month = datetime.now(_AR_TZ).strftime("%Y-%m")
#         with db_session:
#             ManychatChat(
#                 user_id=user_id,
#                 keyword=keyword or "sin_keyword",
#                 contact_name=full_name or "Desconocido",
#                 contact_ig_username=ig_username or "",
#                 manychat_contact_id=manychat_contact_id or "",
#                 month=month,
#             )
#
#         if ig_username:
#             try:
#                 self._create_airtable_lead_from_manychat(
#                     user_id=user_id,
#                     ig_handle=ig_username,
#                     keyword=keyword,
#                     full_name=full_name,
#                     respondio_auto=(event == "respondio_auto"),
#                 )
#             except Exception:
#                 # Best effort: no romper webhook si Airtable falla.
#                 pass
#
#         return {"success": True, "user_id": user_id}
#
#     def _load_airtable_conn(self, user_id: str) -> tuple[str, str, str, str]:
#         with db_session:
#             conn = next(
#                 (c for c in list(ApiConnection.select()) if c.user_id == user_id and c.platform == "airtable"),
#                 None,
#             )
#             creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
#
#         pat = str(creds.get("personal_access_token") or creds.get("api_key") or creds.get("pat") or "").strip()
#         base_id = _normalize_base_id(str(creds.get("base_id") or ""))
#         table_id = _normalize_table_id(str(creds.get("table_id") or ""))
#         table_name = str(creds.get("table_name") or "").strip() or "Leads Marzo"
#
#         if not pat or not base_id:
#             raise HTTPException(status_code=400, detail="Configura tu conexión de Airtable en Ajustes → Conexiones API.")
#         return pat, base_id, table_id, table_name
#
#     def _airtable_row_to_payload(self, rec: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
#         fields = rec.get("fields")
#         if not isinstance(fields, dict):
#             return None
#         handle = _extract_handle_any(_to_str(_pick_field(fields, ["IG", "Instagram"])))
#         if not handle:
#             return None
#         return handle, {
#             "airtable_found": True,
#             "airtable_record_id": str(rec.get("id") or "") or None,
#             "status": _to_str(_pick_field(fields, ["Status", "Estado", "Etapa", "Stage"])),
#             "setter": _to_str(_pick_field(fields, ["Origen"])),
#             "programa": _to_str(_pick_field(fields, ["Programa Ofrecido", "Prog. ofrecido"])),
#             "pago": _to_float(_pick_field(fields, ["Pagó", "Pago"])),
#             "fecha_agendo": _to_str(_pick_field(fields, ["Agendó", "Agendo", "Agendó (fecha)"])),
#             "llamada_url": _to_str(_pick_field(fields, ["Llamada", "Link llamada", "Call link"])),
#             "dolores": _to_str(_pick_field(fields, ["Dolores de la llamada", "Dolores llamada"])),
#             "razon_compra": _to_str(
#                 _pick_field(
#                     fields,
#                     ["Razón compra", "Razon compra", "Razón de compra", "Razon de compra", "Por qué compra", "Porque compra", "Motivo compra"],
#                 )
#             ),
#             "notas": _to_str(_pick_field(fields, ["Notas"])),
#             "keyword": _to_str(fields.get("Keyword")),
#             "via": _to_str(_pick_field(fields, ["Vía", "Via"])),
#             "fecha": _to_str(_pick_field(fields, ["Fecha bot"])),
#             "respondio_auto": _field_bool(_pick_field(fields, ["Respondió auto"])),
#         }
#
#     def _airtable_month_match(self, rec: dict[str, Any], month: str | None) -> bool:
#         if not month:
#             return True
#         fields = rec.get("fields")
#         if not isinstance(fields, dict):
#             return True
#         candidates = [
#             _to_str(_pick_field(fields, ["Fecha bot"])),
#             _to_str(rec.get("createdTime")),
#         ]
#         for raw in candidates:
#             ym = _month_key_buenos_aires(raw)
#             if ym is not None:
#                 return ym == month
#         return True
#
#     def _is_via_bio_funnel(self, fields: dict[str, Any]) -> bool:
#         """Vía = Perfil (manual) o Automático - ManyChat (webhook), alineado con filterByFormula en Airtable."""
#         via_raw = _to_str(_pick_field(fields, ["Vía", "Via"]))
#         if not via_raw:
#             return False
#         n = _norm(via_raw)
#         return n == _norm("Perfil") or n == _norm("Automático - ManyChat")
#
#     def list_leads(self, user_id: str, month: str | None) -> BioLeadsListResponse:
#         try:
#             bio_via_formula = 'OR({Vía}="Perfil", {Vía}="Automático - ManyChat")'
#             airtable_rows = AirtableServices().list_leads_table_records(
#                 user_id,
#                 filter_by_formula=bio_via_formula,
#             ).records
#         except Exception as e:
#             raise HTTPException(status_code=502, detail=f"No se pudo leer leads desde Airtable: {e}") from e
#
#         manychat_service = ManychatService()
#         try:
#             manychat_creds = manychat_service.get_credentials(user_id)
#             manychat_active = bool(manychat_creds.api_key)
#         except Exception:
#             manychat_active = False
#
#         leads: list[BioLeadResponse] = []
#         for rec in airtable_rows:
#             if not isinstance(rec, dict):
#                 continue
#             fields = rec.get("fields")
#             if not isinstance(fields, dict):
#                 continue
#             if not self._is_via_bio_funnel(fields):
#                 continue
#             if not self._airtable_month_match(rec, month):
#                 continue
#
#             mapped = self._airtable_row_to_payload(rec)
#             if mapped is None:
#                 continue
#             handle_plain, airtable = mapped
#             if not handle_plain:
#                 continue
#
#             manychat_sub: dict[str, Any] | None = None
#             if manychat_active:
#                 try:
#                     manychat_sub = manychat_service.get_subscriber_by_instagram(user_id, handle_plain)
#                 except Exception:
#                     manychat_sub = None
#
#             manychat_subscribed_at = _to_str((manychat_sub or {}).get("subscribed_at"))
#             fecha_bot = _to_str(airtable.get("fecha"))
#             created_time = _to_str(rec.get("createdTime"))
#             lead_keyword = (
#                 _to_str(airtable.get("keyword"))
#                 or _to_str((manychat_sub or {}).get("current_cta_tag"))
#             )
#             if _norm(lead_keyword or "") != _norm("info"):
#                 continue
#             leads.append(
#                 BioLeadResponse(
#                     id=_to_str(rec.get("id")) or handle_plain,
#                     handle=f"@{handle_plain}",
#                     nombre=_to_str(_pick_field(fields, ["Nombre", "Name"])) or _to_str((manychat_sub or {}).get("nombre")),
#                     avatar_url=_to_str((manychat_sub or {}).get("avatar_url")),
#                     subscribed_at=fecha_bot or created_time or manychat_subscribed_at,
#                     keyword=lead_keyword,
#                     via=_to_str(airtable.get("via")),
#                     airtable_found=bool(airtable.get("airtable_record_id")),
#                     airtable_record_id=_to_str(airtable.get("airtable_record_id")),
#                     status=_to_str(airtable.get("status")),
#                     setter=_to_str(airtable.get("setter")),
#                     programa=_to_str(airtable.get("programa")),
#                     pago=_to_float(airtable.get("pago")),
#                     fecha_agendo=_to_str(airtable.get("fecha_agendo")),
#                     llamada_url=_to_str(airtable.get("llamada_url")),
#                     dolores=_to_str(airtable.get("dolores")),
#                     razon_compra=_to_str(airtable.get("razon_compra")),
#                     notas=_to_str(airtable.get("notas")),
#                     manychat_chat_url=_to_str((manychat_sub or {}).get("chat_url")),
#                     respondio_auto=bool(airtable.get("respondio_auto")),
#                 )
#             )
#         leads.sort(key=lambda x: x.subscribed_at or "", reverse=True)
#         return BioLeadsListResponse(leads=leads, manychat_active=manychat_active, connected_to_airtable=True)
#
#     def metrics(self, user_id: str, month: str | None) -> BioMetricsResponse:
#         rows = self.list_leads(user_id, month).leads
#         total_leads = len(rows)
#         agendaron = sum(
#             1 for r in rows
#             if bool(_to_str(r.fecha_agendo)) or bool(_to_str(r.llamada_url))
#         )
#         cerrados = sum(1 for r in rows if (r.status or "").strip().lower() == "cerrado")
#         cash_total = float(sum(float(r.pago or 0) for r in rows))
#         tasa_conversion = (float(agendaron) / float(total_leads) * 100.0) if total_leads > 0 else 0.0
#         cash_por_chat = round(cash_total / total_leads, 2) if total_leads > 0 else 0.0
#
#         tag_entraron = total_leads
#         tag_respondieron = sum(1 for r in rows if r.respondio_auto)
#         tasa_respuesta_auto = (
#             round(tag_respondieron / tag_entraron * 100, 1) if tag_entraron > 0 else None
#         )
#
#         return BioMetricsResponse(
#             total_leads=total_leads,
#             agendaron=agendaron,
#             cerrados=cerrados,
#             cash_total=cash_total,
#             cash_por_lead=(cash_total / total_leads) if total_leads > 0 else 0,
#             tasa_conversion=tasa_conversion,
#             cash_por_chat=cash_por_chat,
#             tasa_respuesta_auto=tasa_respuesta_auto,
#         )
#
#     def via_options(self, user_id: str) -> BioViaOptionsResponse:
#         """Valores únicos del campo Vía en todos los registros de la tabla de leads (Airtable)."""
#         try:
#             records = AirtableServices().list_leads_table_records(user_id).records
#         except Exception as e:
#             raise HTTPException(status_code=502, detail=f"No se pudo leer Airtable: {e}") from e
#         unique: set[str] = set()
#         for rec in records:
#             if not isinstance(rec, dict):
#                 continue
#             fields = rec.get("fields")
#             if not isinstance(fields, dict):
#                 continue
#             v = _to_str(_pick_field(fields, ["Vía", "Via"]))
#             if v:
#                 unique.add(v.strip())
#         options = sorted(unique, key=lambda x: x.lower())
#         return BioViaOptionsResponse(options=options)
#
#     def _resolve_status_airtable_key(self, fields: dict[str, Any]) -> str:
#         aliases = ["Estado", "Status", "Etapa", "Stage", "Estado lead", "Pipeline"]
#         for alias in aliases:
#             na = _norm(alias)
#             for k in fields.keys():
#                 if _norm(k) == na:
#                     return str(k)
#         return "Status"
#
#     def _airtable_get_record(self, pat: str, base_id: str, table_id: str, table_name: str, record_id: str) -> dict[str, Any]:
#         base_seg = urllib.parse.quote(base_id, safe="")
#         table_seg = urllib.parse.quote((table_id or table_name), safe="")
#         rec_seg = urllib.parse.quote(record_id, safe="")
#         url = f"https://api.airtable.com/v0/{base_seg}/{table_seg}/{rec_seg}"
#         headers = {
#             "Authorization": f"Bearer {pat}",
#             "Accept": "application/json",
#         }
#         req = urllib.request.Request(url, headers=headers, method="GET")
#         ssl_ctx = ssl.create_default_context(cafile=certifi.where())
#         try:
#             with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
#                 payload = response.read().decode("utf-8")
#                 parsed = json.loads(payload) if payload else {}
#         except urllib.error.HTTPError as e:
#             try:
#                 err_raw = e.read().decode("utf-8")
#             except Exception:
#                 err_raw = ""
#             raise HTTPException(status_code=e.code, detail=f"Airtable GET: {err_raw[:400] or e.reason}") from e
#         except Exception as e:
#             raise HTTPException(status_code=502, detail=f"No se pudo leer el registro en Airtable: {e}") from e
#         if not isinstance(parsed, dict):
#             raise HTTPException(status_code=502, detail="Respuesta inválida de Airtable al leer el registro.")
#         return parsed
#
#     def _canonical_status_for_airtable(self, raw: str) -> str:
#         n = _norm(raw)
#         synonyms = {
#             "cerrado": "Cerrado",
#             "cerrados": "Cerrado",
#             "seguimiento": "Seguimiento",
#             "descalificado": "Descalificado",
#             "noshow": "No show",
#             "nosho": "No show",
#         }
#         if n in synonyms:
#             return synonyms[n]
#         if "noshow" in n or "no show" in (raw or "").lower():
#             return "No show"
#         if "cerr" in n:
#             return "Cerrado"
#         if "segui" in n:
#             return "Seguimiento"
#         if "descal" in n:
#             return "Descalificado"
#         return (raw or "").strip()
#
#     def patch_status(self, user_id: str, record_id: str, status: str) -> BioLeadResponse:
#         status = self._canonical_status_for_airtable(status)
#         if not status:
#             raise HTTPException(status_code=400, detail="El status no puede estar vacío.")
#
#         pat, base_id, table_id, table_name = self._load_airtable_conn(user_id)
#         base_seg = urllib.parse.quote(base_id, safe="")
#         table_seg = urllib.parse.quote((table_id or table_name), safe="")
#         rec_seg = urllib.parse.quote(record_id, safe="")
#         url = f"https://api.airtable.com/v0/{base_seg}/{table_seg}/{rec_seg}"
#
#         current = self._airtable_get_record(pat, base_id, table_id, table_name, record_id)
#         fld = current.get("fields")
#         status_key = self._resolve_status_airtable_key(fld if isinstance(fld, dict) else {})
#
#         headers = {
#             "Authorization": f"Bearer {pat}",
#             "Accept": "application/json",
#             "Content-Type": "application/json",
#         }
#         body = {"fields": {status_key: status}}
#         req = urllib.request.Request(
#             url,
#             data=json.dumps(body).encode("utf-8"),
#             headers=headers,
#             method="PATCH",
#         )
#         ssl_ctx = ssl.create_default_context(cafile=certifi.where())
#         try:
#             with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
#                 payload = response.read().decode("utf-8")
#                 parsed = json.loads(payload) if payload else {}
#         except urllib.error.HTTPError as e:
#             try:
#                 err_raw = e.read().decode("utf-8")
#             except Exception:
#                 err_raw = ""
#             raise HTTPException(
#                 status_code=502,
#                 detail=f"No se pudo actualizar Airtable (campo {status_key!r}): {err_raw[:500] or e.reason}",
#             ) from e
#         except Exception as e:
#             raise HTTPException(status_code=502, detail=f"No se pudo actualizar Airtable: {e}") from e
#
#         fields = parsed.get("fields") if isinstance(parsed, dict) else {}
#         if not isinstance(fields, dict):
#             raise HTTPException(status_code=500, detail="Airtable respondió sin datos válidos.")
#         ig_raw = _to_str(_pick_field(fields, ["IG", "Instagram"]))
#         handle_plain = _extract_handle_any(ig_raw) or "sin_handle"
#         return BioLeadResponse(
#             id=record_id,
#             handle=f"@{handle_plain}",
#             airtable_found=True,
#             airtable_record_id=record_id,
#             via=_to_str(_pick_field(fields, ["Vía", "Via"])),
#             status=_to_str(_pick_field(fields, ["Status", "Estado", "Etapa", "Stage"])),
#             setter=_to_str(_pick_field(fields, ["Origen"])),
#             programa=_to_str(_pick_field(fields, ["Programa Ofrecido", "Prog. ofrecido"])),
#             pago=_to_float(_pick_field(fields, ["Pagó", "Pago"])),
#             fecha_agendo=_to_str(_pick_field(fields, ["Agendó", "Agendo", "Agendó (fecha)"])),
#             llamada_url=_to_str(_pick_field(fields, ["Llamada", "Link llamada", "Call link"])),
#             dolores=_to_str(_pick_field(fields, ["Dolores de la llamada", "Dolores llamada"])),
#             razon_compra=_to_str(
#                 _pick_field(
#                     fields,
#                     ["Razón compra", "Razon compra", "Razón de compra", "Razon de compra", "Por qué compra", "Porque compra", "Motivo compra"],
#                 )
#             ),
#             notas=_to_str(_pick_field(fields, ["Notas"])),
#             respondio_auto=_field_bool(_pick_field(fields, ["Respondió auto"])),
#         )
#
#     def manychat_status(self, user_id: str) -> BioManychatStatusResponse:
#         service = ManychatService()
#         try:
#             creds = service.get_credentials(user_id)
#             if not creds.api_key:
#                 return BioManychatStatusResponse(connected=False, tag=creds.tag, total_subscribers=0)
#             connected = service.verify_connection(user_id)
#             if not connected:
#                 return BioManychatStatusResponse(connected=False, tag=creds.tag, total_subscribers=0)
#             try:
#                 subscribers = service.get_subscribers_by_tag(user_id, creds.tag)
#             except Exception:
#                 subscribers = []
#             return BioManychatStatusResponse(connected=True, tag=creds.tag, total_subscribers=len(subscribers))
#         except Exception:
#             creds = service.get_credentials(user_id)
#             return BioManychatStatusResponse(connected=False, tag=creds.tag, total_subscribers=0)
