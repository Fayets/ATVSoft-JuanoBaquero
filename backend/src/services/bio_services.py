# import json
# import ssl
# import urllib.error
# import urllib.parse
# import urllib.request
# from datetime import datetime, timezone
#
# import certifi
# from pony.orm import db_session
#
# from fastapi import HTTPException
#
# from src.models import ApiConnection, BioManualEntry, ManychatChat
# from src.schemas import (
#     BioAutomationConfigRequest,
#     BioDataResponse,
#     BioManualEntryCreateRequest,
#     BioManualEntryResponse,
#     ManychatAutomationStatsResponse,
#     ManychatChatResponse,
#     ManychatLiveSummaryResponse,
# )
# from src.services.airtable_services import AirtableServices
# from src.services.bio_airtable_link import build_ig_lead_map_from_airtable, norm_ig
#
#
# class BioServices:
#     def _http_json(self, url: str, headers: dict[str, str]) -> dict:
#         req = urllib.request.Request(url, headers=headers, method="GET")
#         ssl_ctx = ssl.create_default_context(cafile=certifi.where())
#         try:
#             with urllib.request.urlopen(req, timeout=45, context=ssl_ctx) as response:
#                 payload = response.read().decode("utf-8")
#                 return json.loads(payload) if payload else {}
#         except urllib.error.HTTPError as e:
#             try:
#                 err_raw = e.read().decode("utf-8")
#             except Exception:
#                 err_raw = ""
#             return {"status": "error", "error": f"HTTP {e.code}", "message": err_raw[:220]}
#         except Exception as e:  # pragma: no cover
#             return {"status": "error", "error": str(e)}
#
#     def _parse_dt(self, raw: str | None) -> datetime:
#         if not raw:
#             return datetime.now(timezone.utc)
#         try:
#             return datetime.fromisoformat(raw.replace("Z", "+00:00"))
#         except Exception:
#             return datetime.now(timezone.utc)
#
#     def _subscriber_list_from_tag_response(self, data: object) -> list:
#         if isinstance(data, list):
#             return [x for x in data if isinstance(x, dict)]
#         if isinstance(data, dict):
#             for key in ("subscribers", "contacts", "items", "data"):
#                 inner = data.get(key)
#                 if isinstance(inner, list):
#                     return [x for x in inner if isinstance(x, dict)]
#         return []
#
#     def _count_tag_subscribers(self, headers: dict[str, str], tag_id: int) -> tuple[int, str | None]:
#         url = (
#             "https://api.manychat.com/fb/subscriber/getInfoByTag?tag_id="
#             + urllib.parse.quote(str(tag_id))
#         )
#         resp = self._http_json(url, headers=headers)
#         if isinstance(resp, dict) and resp.get("status") == "error":
#             msg = str(resp.get("message") or resp.get("error") or "Error ManyChat")
#             return 0, msg[:400]
#         if not isinstance(resp, dict):
#             return 0, "Respuesta inválida de ManyChat."
#         st = str(resp.get("status") or "")
#         if st and st != "success":
#             return 0, str(resp)[:400]
#         raw_data = resp.get("data")
#         items = self._subscriber_list_from_tag_response(raw_data)
#         return len(items), None
#
#     def _parse_flows_list(self, resp: dict) -> list[dict]:
#         if not isinstance(resp, dict):
#             return []
#         data = resp.get("data")
#         if isinstance(data, list):
#             return [x for x in data if isinstance(x, dict)]
#         if isinstance(data, dict):
#             inner = data.get("flows") or data.get("items") or data.get("data")
#             if isinstance(inner, list):
#                 return [x for x in inner if isinstance(x, dict)]
#         return []
#
#     def _match_flow_by_name(self, flows: list[dict], target: str) -> dict | None:
#         t = (target or "").strip().lower().replace("'", '"')
#         if not t:
#             return None
#         exact: dict | None = None
#         partial: dict | None = None
#         for f in flows:
#             name = str(f.get("name") or "").strip()
#             if not name:
#                 continue
#             n = name.lower().replace("'", '"')
#             if n == t:
#                 exact = f
#                 break
#             if t in n or n in t:
#                 partial = f
#         return exact or partial
#
#     def _resolve_tag_id(
#         self,
#         tags_list: list,
#         cred_id: int | None,
#         fallback_pred,
#     ) -> tuple[int | None, str | None]:
#         if cred_id and cred_id > 0:
#             for t in tags_list:
#                 if isinstance(t, dict) and int(t.get("id") or 0) == cred_id:
#                     return cred_id, str(t.get("name") or "").strip() or None
#             return cred_id, None
#         for t in tags_list:
#             if not isinstance(t, dict):
#                 continue
#             name = str(t.get("name") or "").strip()
#             tid = t.get("id")
#             if tid is None:
#                 continue
#             if fallback_pred(name.lower()):
#                 return int(tid), name
#         return None, None
#
#     def get_manychat_automation_stats(self, user_id: str) -> ManychatAutomationStatsResponse:
#         with db_session:
#             conn = next(
#                 (
#                     c
#                     for c in list(ApiConnection.select())
#                     if c.user_id == user_id and c.platform == "manychat"
#                 ),
#                 None,
#             )
#             creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
#             api_key = str(creds.get("api_key") or "").strip()
#             automation_name = str(creds.get("bio_automation_name") or "").strip()
#             cred_entry = creds.get("bio_tag_id")
#             cred_reply = creds.get("bio_tag_reply_id")
#             try:
#                 entry_id_cfg = (
#                     int(cred_entry)
#                     if cred_entry is not None
#                     and str(cred_entry).strip().isdigit()
#                     and int(cred_entry) > 0
#                     else None
#                 )
#             except (TypeError, ValueError):
#                 entry_id_cfg = None
#             try:
#                 reply_id_cfg = (
#                     int(cred_reply)
#                     if cred_reply is not None
#                     and str(cred_reply).strip().isdigit()
#                     and int(cred_reply) > 0
#                     else None
#                 )
#             except (TypeError, ValueError):
#                 reply_id_cfg = None
#
#         if not api_key:
#             return ManychatAutomationStatsResponse(
#                 info_note="Configura la API Key de ManyChat en Conexiones API.",
#             )
#
#         headers = {
#             "Authorization": f"Bearer {api_key}",
#             "Accept": "application/json",
#         }
#
#         info_note = (
#             "Las cifras del panel de ManyChat (envíos por nodo, % abierto, pausa inteligente) "
#             "no están expuestas en la API pública documentada. Aquí: flow por nombre (getFlows) "
#             "y embudo aproximado por contactos con cada tag."
#         )
#
#         flows_raw = self._http_json("https://api.manychat.com/fb/page/getFlows", headers=headers)
#         getflows_error: str | None = None
#         flows: list[dict] = []
#         if isinstance(flows_raw, dict) and flows_raw.get("status") == "error":
#             getflows_error = str(flows_raw.get("message") or flows_raw.get("error") or "")[:400]
#         else:
#             flows = self._parse_flows_list(flows_raw if isinstance(flows_raw, dict) else {})
#
#         matched = self._match_flow_by_name(flows, automation_name) if automation_name else None
#         flow_found = matched is not None
#         flow_ns = str(matched.get("ns") or matched.get("flow_ns") or "") or None if matched else None
#         flow_name = str(matched.get("name") or "").strip() or None if matched else None
#         flow_raw = dict(matched) if matched and isinstance(matched, dict) else {}
#
#         tags_resp = self._http_json("https://api.manychat.com/fb/page/getTags", headers=headers)
#         tags_list: list = []
#         if isinstance(tags_resp, dict):
#             td = tags_resp.get("data")
#             tags_list = td if isinstance(td, list) else []
#
#         def pred_reply(n: str) -> bool:
#             return "responde" in n and "bio" in n
#
#         def pred_entry(n: str) -> bool:
#             return ("perfil" in n and "ingres" in n) or "m-info" in n
#
#         entry_tag_id, entry_tag_name = self._resolve_tag_id(tags_list, entry_id_cfg, pred_entry)
#         reply_tag_id, reply_tag_name = self._resolve_tag_id(tags_list, reply_id_cfg, pred_reply)
#
#         entry_count, entry_err = (0, None)
#         if entry_tag_id:
#             entry_count, entry_err = self._count_tag_subscribers(headers, entry_tag_id)
#
#         reply_count, reply_err = (0, None)
#         if reply_tag_id:
#             reply_count, reply_err = self._count_tag_subscribers(headers, reply_tag_id)
#
#         rate: float | None = None
#         if entry_count > 0 and reply_tag_id:
#             rate = round(100.0 * float(reply_count) / float(entry_count), 2)
#
#         return ManychatAutomationStatsResponse(
#             info_note=info_note,
#             flow_found=flow_found,
#             flow_name=flow_name,
#             flow_ns=flow_ns,
#             flow_raw=flow_raw,
#             getflows_error=getflows_error,
#             entry_tag_id=entry_tag_id,
#             entry_tag_name=entry_tag_name,
#             entry_contacts_count=entry_count,
#             entry_tag_error=entry_err,
#             reply_tag_id=reply_tag_id,
#             reply_tag_name=reply_tag_name,
#             reply_contacts_count=reply_count,
#             reply_tag_error=reply_err,
#             reply_rate_percent=rate,
#         )
#
#     def _subscriber_ui_context(self, c: dict) -> tuple[str | None, str | None, str | None]:
#         """subscriber_id, last_input_text, vista previa de custom fields ManyChat."""
#         sid = str(c.get("id") or c.get("subscriber_id") or "").strip() or None
#         last_in = str(c.get("last_input_text") or "").strip() or None
#         parts: list[str] = []
#         cfs = c.get("custom_fields")
#         if isinstance(cfs, list):
#             for item in cfs:
#                 if not isinstance(item, dict):
#                     continue
#                 nm = str(item.get("name") or "").strip()
#                 val = item.get("value")
#                 if isinstance(val, (list, dict)):
#                     continue
#                 vs = str(val).strip() if val is not None else ""
#                 if nm and vs:
#                     parts.append(f"{nm}: {vs[:100]}")
#         preview = " · ".join(parts[:6])[:450] or None
#         return sid, last_in or None, preview
#
#     def _enrich_chats_with_airtable_leads(
#         self, user_id: str, chats: list[ManychatChatResponse]
#     ) -> list[ManychatChatResponse]:
#         """Cruza IG con la tabla de leads en Airtable (Conexiones) para estado y montos."""
#         if not chats:
#             return chats
#         try:
#             records = AirtableServices().list_leads_table_records(user_id).records
#         except HTTPException:
#             return chats
#         if not isinstance(records, list) or not records:
#             return chats
#         ig_map = build_ig_lead_map_from_airtable(records)
#         if not ig_map:
#             return chats
#         merged: list[ManychatChatResponse] = []
#         for ch in chats:
#             key = norm_ig(ch.contact_ig_username)
#             extra = ig_map.get(key) if key else None
#             if not extra:
#                 merged.append(ch)
#                 continue
#             d = ch.model_dump() if hasattr(ch, "model_dump") else ch.dict()
#             d.update(extra)
#             merged.append(ManychatChatResponse(**d))
#         return merged
#
#     def _load_live_manychat_chats(self, creds: dict) -> list[ManychatChatResponse]:
#         api_key = str(creds.get("api_key") or "").strip()
#         if not api_key:
#             return []
#
#         headers = {
#             "Authorization": f"Bearer {api_key}",
#             "Accept": "application/json",
#         }
#         tag_id = creds.get("bio_tag_id")
#         tag_name = str(creds.get("bio_tag_name") or "").strip()
#         automation_name = str(creds.get("bio_automation_name") or "").strip()
#
#         # Si no hay tag guardado, buscamos por nombre de automatización.
#         if not tag_id and automation_name:
#             tags_resp = self._http_json("https://api.manychat.com/fb/page/getTags", headers=headers)
#             tags = tags_resp.get("data") if isinstance(tags_resp, dict) else None
#             tags_list = tags if isinstance(tags, list) else []
#             automation_norm = automation_name.lower().strip()
#             for t in tags_list:
#                 if not isinstance(t, dict):
#                     continue
#                 name = str(t.get("name") or "").strip()
#                 if not name:
#                     continue
#                 name_norm = name.lower()
#                 if automation_norm in name_norm or name_norm in automation_norm:
#                     tag_id = t.get("id")
#                     tag_name = name
#                     break
#
#         if not tag_id:
#             return []
#
#         contacts_url = (
#             "https://api.manychat.com/fb/subscriber/getInfoByTag?tag_id="
#             + urllib.parse.quote(str(tag_id))
#         )
#         contacts_resp = self._http_json(contacts_url, headers=headers)
#         contacts = contacts_resp.get("data") if isinstance(contacts_resp, dict) else None
#         contacts_list = contacts if isinstance(contacts, list) else []
#
#         rows: list[ManychatChatResponse] = []
#         kw = tag_name or automation_name or f"tag:{tag_id}"
#         for c in contacts_list:
#             if not isinstance(c, dict):
#                 continue
#             sid = str(c.get("id") or c.get("subscriber_id") or "")
#             first_name = str(c.get("first_name") or c.get("name") or "").strip() or None
#             ig = str(c.get("ig_username") or c.get("username") or "").strip() or None
#             received_at = self._parse_dt(str(c.get("subscribed") or c.get("created_at") or ""))
#             sub_id, last_in, cf_preview = self._subscriber_ui_context(c)
#             rows.append(
#                 ManychatChatResponse(
#                     id=f"live-{sid or received_at.timestamp()}",
#                     keyword=kw,
#                     contact_name=first_name,
#                     contact_ig_username=ig,
#                     received_at=received_at,
#                     manychat_subscriber_id=sub_id,
#                     manychat_last_input=last_in,
#                     manychat_custom_fields_preview=cf_preview,
#                 )
#             )
#         rows.sort(key=lambda r: r.received_at, reverse=True)
#         return rows
#
#     def _chat_to_response(self, row: ManychatChat) -> ManychatChatResponse:
#         return ManychatChatResponse(
#             id=row.id,
#             keyword=row.keyword,
#             contact_name=row.contact_name,
#             contact_ig_username=row.contact_ig_username,
#             received_at=row.received_at,
#         )
#
#     def _manual_to_response(self, row: BioManualEntry) -> BioManualEntryResponse:
#         return BioManualEntryResponse(
#             id=row.id,
#             name=row.name,
#             date=row.date,
#             chats=row.chats,
#             cash=row.cash,
#             notes=row.notes,
#         )
#
#     def get_bio_data(self, user_id: str, month: str | None) -> BioDataResponse:
#         with db_session:
#             chats: list[ManychatChatResponse] = []
#             entries = [e for e in list(BioManualEntry.select()) if e.user_id == user_id]
#             if month:
#                 entries = [e for e in entries if e.month == month]
#             entries.sort(key=lambda e: e.created_at, reverse=True)
#
#             conn = next(
#                 (
#                     c
#                     for c in list(ApiConnection.select())
#                     if c.user_id == user_id and c.platform == "manychat"
#                 ),
#                 None,
#             )
#             creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
#             is_connected = bool(creds.get("webhook_token"))
#             chats = self._load_live_manychat_chats(creds)
#
#             months = sorted(
#                 {
#                     m
#                     for m in [
#                         *(e.month for e in entries if e.month),
#                         *(c.received_at.strftime("%Y-%m") for c in chats if c.received_at),
#                     ]
#                     if m
#                 },
#                 reverse=True,
#             )
#             if month:
#                 chats = [c for c in chats if c.received_at.strftime("%Y-%m") == month]
#
#             chats = self._enrich_chats_with_airtable_leads(user_id, chats)
#
#             return BioDataResponse(
#                 auto_chats=chats,
#                 manual_entries=[self._manual_to_response(e) for e in entries],
#                 is_connected=is_connected,
#                 available_months=months,
#                 manychat_automation_name=str(creds.get("bio_automation_name") or "").strip() or None,
#                 manychat_bio_tag_id=int(creds.get("bio_tag_id")) if str(creds.get("bio_tag_id") or "").isdigit() else None,
#                 manychat_bio_tag_reply_id=int(creds.get("bio_tag_reply_id"))
#                 if str(creds.get("bio_tag_reply_id") or "").isdigit()
#                 else None,
#             )
#
#     def add_manual_entry(self, user_id: str, body: BioManualEntryCreateRequest) -> BioManualEntryResponse:
#         month = body.month or datetime.utcnow().strftime("%Y-%m")
#         with db_session:
#             row = BioManualEntry(
#                 user_id=user_id,
#                 month=month,
#                 name=body.name,
#                 date=body.date,
#                 chats=max(0, int(body.chats or 0)),
#                 cash=float(body.cash or 0),
#                 notes=body.notes,
#             )
#             return self._manual_to_response(row)
#
#     def delete_manual_entry(self, user_id: str, entry_id: str) -> None:
#         with db_session:
#             row = BioManualEntry.get(id=entry_id)
#             if row and row.user_id == user_id:
#                 row.delete()
#
#     def delete_auto_chat(self, user_id: str, chat_id: str) -> None:
#         with db_session:
#             row = ManychatChat.get(id=chat_id)
#             if row and row.user_id == user_id:
#                 row.delete()
#
#     def set_automation_config(self, user_id: str, body: BioAutomationConfigRequest) -> None:
#         with db_session:
#             conn = next(
#                 (
#                     c
#                     for c in list(ApiConnection.select())
#                     if c.user_id == user_id and c.platform == "manychat"
#                 ),
#                 None,
#             )
#             if conn is None:
#                 conn = ApiConnection(user_id=user_id, platform="manychat", credentials={})
#             creds = conn.credentials if isinstance(conn.credentials, dict) else {}
#             name = (body.manychat_automation_name or "").strip()
#             if name:
#                 creds["bio_automation_name"] = name
#             else:
#                 creds.pop("bio_automation_name", None)
#             if body.manychat_bio_tag_id is not None and body.manychat_bio_tag_id > 0:
#                 creds["bio_tag_id"] = int(body.manychat_bio_tag_id)
#             elif body.manychat_bio_tag_id == 0:
#                 creds.pop("bio_tag_id", None)
#             payload = (
#                 body.model_dump(exclude_unset=True)
#                 if hasattr(body, "model_dump")
#                 else body.dict(exclude_unset=True)
#             )
#             if "manychat_bio_tag_reply_id" in payload:
#                 rid = payload.get("manychat_bio_tag_reply_id")
#                 if rid is not None and int(rid) > 0:
#                     creds["bio_tag_reply_id"] = int(rid)
#                 else:
#                     creds.pop("bio_tag_reply_id", None)
#             conn.credentials = creds
#
#     def get_manychat_live_summary(self, user_id: str) -> ManychatLiveSummaryResponse:
#         with db_session:
#             conn = next(
#                 (
#                     c
#                     for c in list(ApiConnection.select())
#                     if c.user_id == user_id and c.platform == "manychat"
#                 ),
#                 None,
#             )
#             creds = conn.credentials if conn and isinstance(conn.credentials, dict) else {}
#             api_key = str(creds.get("api_key") or "").strip()
#             if not api_key:
#                 return ManychatLiveSummaryResponse()
#
#         headers = {
#             "Authorization": f"Bearer {api_key}",
#             "Accept": "application/json",
#         }
#         info = self._http_json("https://api.manychat.com/fb/page/getInfo", headers=headers)
#         tags = self._http_json("https://api.manychat.com/fb/page/getTags", headers=headers)
#         growth = self._http_json("https://api.manychat.com/fb/page/getGrowthTools", headers=headers)
#         custom = self._http_json("https://api.manychat.com/fb/page/getCustomFields", headers=headers)
#         bot = self._http_json("https://api.manychat.com/fb/page/getBotFields", headers=headers)
#
#         info_data = info.get("data") if isinstance(info, dict) else {}
#         tags_data = tags.get("data") if isinstance(tags, dict) else []
#         growth_data = growth.get("data") if isinstance(growth, dict) else []
#         custom_data = custom.get("data") if isinstance(custom, dict) else []
#         bot_data = bot.get("data") if isinstance(bot, dict) else []
#
#         tags_list = tags_data if isinstance(tags_data, list) else []
#         growth_list = growth_data if isinstance(growth_data, list) else []
#         custom_list = custom_data if isinstance(custom_data, list) else []
#         bot_list = bot_data if isinstance(bot_data, list) else []
#
#         sample_tags = [str(t.get("name") or "") for t in tags_list if isinstance(t, dict) and t.get("name")][:6]
#         sample_growth = [str(g.get("name") or "") for g in growth_list if isinstance(g, dict) and g.get("name")][:6]
#
#         return ManychatLiveSummaryResponse(
#             page_name=str((info_data or {}).get("name") or "") or None,
#             category=str((info_data or {}).get("category") or "") or None,
#             timezone=str((info_data or {}).get("timezone") or "") or None,
#             tags_count=len(tags_list),
#             growth_tools_count=len(growth_list),
#             custom_fields_count=len(custom_list),
#             bot_fields_count=len(bot_list),
#             sample_tags=sample_tags,
#             sample_growth_tools=sample_growth,
#         )
