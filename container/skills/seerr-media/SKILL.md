---
name: seerr-media
description: Search for and request movies and TV shows via Seerr. Requests are sent to Sonarr/Radarr for downloading and automatically appear in Plex when ready. Use when someone asks to download, request, or find a movie or TV show.
---

# Seerr Media Requests

Request movies and TV shows via Seerr. Seerr routes to Sonarr (TV) / Radarr (movies) for downloading and Plex picks them up automatically when ready.

## IRON LAWS — DO NOT VIOLATE

1. **NEVER fabricate a TMDB ID.** Do not use an ID from memory, training data, or inference. The only valid source of a TMDB ID is the raw JSON response of a live search call made in this conversation.
2. **ALWAYS search first.** Every request MUST be preceded by an actual `GET /api/v1/search` call in this turn. If you have not just run the search and seen the results, you do not have a valid ID.
3. **ALWAYS get user confirmation before POSTing a request.** Show the search results to the user and wait for them to pick. Do this even if there is only one result, and even if the title seems unambiguous.
4. **ALWAYS verify after POSTing.** After the request succeeds, call `GET /api/v1/movie/{tmdbId}` or `GET /api/v1/tv/{tmdbId}` and quote the actual `title`/`name` and year from the response back to the user. Never report success using the users original search term — use what Seerr echoed back.

Violating any of these has caused real users to get the wrong movie. Assume the cost of a wrong request is high.

## Connection

```bash
SEERR_URL="http://192.168.42.11:5055"
SEERR_KEY="MTc3NDMxODM2ODc1MzA0NzBlNTcyLTAyZGUtNGJlYi05OTNkLTY3OGIzNmYyNTU5Yw=="
```

## Step 1 — Search (mandatory, every time)

```bash
curl -s "$SEERR_URL/api/v1/search?query=SEARCH_TERM&page=1&language=en" \
  -H "X-Api-Key: $SEERR_KEY" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for r in d.get(\"results\", [])[:5]:
    mt = r.get(\"mediaType\")
    title = r.get(\"title\") or r.get(\"name\") or \"?\"
    date = r.get(\"releaseDate\") or r.get(\"firstAirDate\") or \"\"
    year = date[:4] if date else \"\"
    tmdb = r.get(\"id\")
    overview = (r.get(\"overview\") or \"\")[:120]
    print(f\"{mt:5s} tmdb={tmdb} {title} ({year}) — {overview}\")
"
```

`id` in the search response IS the TMDB ID — that is the field you pass as `mediaId`. Do not use any other ID field.

## Step 2 — Ask the user to pick

Present the top 3–5 results with title, year, and a one-line overview. Wait for the user to pick one by title+year. Examples of good prompts:

> I found these for "Hop":
> 1. **Hop** (2011) — A young rabbit raised to be the Easter Bunny…
> 2. **Hop** (2002) — Dutch coming-of-age drama…
> 3. **Hopscotch** (1980) — CIA agent thriller…
>
> Which one?

Do not pick for the user. Do not skip this step because "theres only one sensible answer" — thats exactly when mistakes slip through.

## Step 3 — Request

Once the user confirms a specific TMDB ID:

```bash
# Movie
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"mediaType\": \"movie\", \"mediaId\": TMDB_ID}"

# TV (all seasons)
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"mediaType\": \"tv\", \"mediaId\": TMDB_ID, \"seasons\": \"all\"}"

# TV (specific seasons)
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"mediaType\": \"tv\", \"mediaId\": TMDB_ID, \"seasons\": [1, 2]}"
```

## Step 4 — Verify, then report

After the POST, fetch the canonical record and quote its title+year back to the user:

```bash
# Movie
curl -s "$SEERR_URL/api/v1/movie/TMDB_ID" -H "X-Api-Key: $SEERR_KEY" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get(\"title\"),\"(\"+(d.get(\"releaseDate\") or \"\")[:4]+\")\")"

# TV
curl -s "$SEERR_URL/api/v1/tv/TMDB_ID" -H "X-Api-Key: $SEERR_KEY" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get(\"name\"),\"(\"+(d.get(\"firstAirDate\") or \"\")[:4]+\")\")"
```

Then tell the user something like: "Requested **Rise of the Guardians (2012)** — itll show up in Plex once downloaded." Using the API-echoed title means if the wrong ID ever slipped through, the confirmation message exposes it on the spot.

## Check request status (diagnostic)

```bash
curl -s "$SEERR_URL/api/v1/request?take=20" -H "X-Api-Key: $SEERR_KEY"
```

Status codes: 1=pending, 2=approved, 3=declined, 4=processing, 5=available.

## Self-check before every POST

Before you run the request POST, confirm all of the following out loud (in your reasoning):

- [ ] I ran `/api/v1/search` in this turn and saw the raw results.
- [ ] The TMDB ID I am about to send appeared in that search response as the `id` field of a result.
- [ ] The user has explicitly picked this title+year (not "sounds right", actually picked).
- [ ] My next message after the POST will echo the title+year from `/api/v1/movie/{id}` or `/api/v1/tv/{id}`, not the users original search term.

If any box is unchecked: stop, fix it, do not POST.
