---
name: home-assistant
description: Control HVAC (Fujitsu Airstage units) and check who's home via Home Assistant. Use when someone asks about heating, cooling, temperature, aircon, or whether someone is home.
---

# Home Assistant

Control HVAC and check presence via Home Assistant on the home server.

## Connection

- **URL**: `http://192.168.42.11:8123`
- **Auth**: Bearer token in Authorization header

```bash
HA_URL="http://192.168.42.11:8123"
HA_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI1MmE3MjIwYTQ5MzY0OTE3OTlkZTIyMmFhMzRkYWRjNSIsImlhdCI6MTc3NDM4NzY5OSwiZXhwIjoyMDg5NzQ3Njk5fQ.FREA_wj1t7DFPY0rdtAMELN_T_G0KgvQ0tRUWAAda54"
```

All API calls need:
```
Authorization: Bearer $HA_TOKEN
Content-Type: application/json
```

## Discover entity IDs

Find the actual climate entity IDs (do this first if you don't know the entity names):

```bash
curl -s "$HA_URL/api/states" -H "Authorization: Bearer $HA_TOKEN" | \
  python3 -c "import sys,json; [print(f'{e[\"entity_id\"]}: {e[\"state\"]} {e[\"attributes\"].get(\"current_temperature\",\"\")}') for e in json.load(sys.stdin) if e['entity_id'].startswith('climate.')]"
```

## HVAC Control (Fujitsu Airstage units)

Climate entities are `climate.*` — discover them first if unsure of names.

**Set temperature:**
```bash
curl -s -X POST "$HA_URL/api/services/climate/set_temperature" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.ENTITY_NAME", "temperature": 22}'
```

**Set HVAC mode** (heat, cool, auto, fan_only, dry, off):
```bash
curl -s -X POST "$HA_URL/api/services/climate/set_hvac_mode" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.ENTITY_NAME", "hvac_mode": "cool"}'
```

**Set fan speed** (auto, low, medium, high):
```bash
curl -s -X POST "$HA_URL/api/services/climate/set_fan_mode" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.ENTITY_NAME", "fan_mode": "auto"}'
```

**Turn off a unit:**
```bash
curl -s -X POST "$HA_URL/api/services/climate/set_hvac_mode" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.ENTITY_NAME", "hvac_mode": "off"}'
```

**Turn off ALL units:**
```bash
curl -s -X POST "$HA_URL/api/services/climate/set_hvac_mode" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "all", "hvac_mode": "off"}'
```

## Presence Detection

People are tracked as `person.*` entities. State is `home` or `not_home`.

**Check if someone is home:**
```bash
curl -s "$HA_URL/api/states/person.aaron" -H "Authorization: Bearer $HA_TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d['attributes']['friendly_name']}: {d['state']}\")"
```

**Check all people:**
```bash
curl -s "$HA_URL/api/states" -H "Authorization: Bearer $HA_TOKEN" | \
  python3 -c "import sys,json; [print(f\"{e['attributes'].get('friendly_name','?')}: {e['state']}\") for e in json.load(sys.stdin) if e['entity_id'].startswith('person.')]"
```

**Quick check — anyone home?**
```bash
curl -s "$HA_URL/api/states/zone.home" -H "Authorization: Bearer $HA_TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"People home: {d['state']}\")"
```

## Response style

- When reporting HVAC status, include current temperature and mode
- When asked to change settings, confirm what you changed
- For presence, just give a clear answer — no need to dump raw API responses
